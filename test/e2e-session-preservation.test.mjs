// Preservacao 3.5, 3.6, 3.15 (Property 9), observada no codigo SEM a correcao:
// - tokens "antigos" (jwt.sign({ sub, username }), sem claim tv) de usuarios sem
//   evento de seguranca continuam aceitos, com o MESMO status/corpo que o token
//   emitido pelo login, em GET /api/decks/me e GET /api/auth/me/export;
// - o token de admin (sub: 0, role: "admin", sem linha em users) continua aceito em
//   /api/admin/users, /api/admin/cards, /api/admin/articles e na moderacao do forum;
// - jogador nas rotas de admin -> 403, sem token -> 401, token invalido/expirado
//   -> 401, sempre com as mesmas mensagens em pt-BR.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync, mkdirSync, readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { forAll, gen } from "./helpers/prop.mjs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-sessionpreserve");
const PORT = 3083;
const BASE_URL = `http://localhost:${PORT}`;
const JWT_SECRET = "test-jwt-session-preservation";
const ADMIN_PASSWORD = "test-admin-session-preservation";
const PASSWORD = "senha123456";

const MSG_NO_TOKEN = "Token não fornecido.";
const MSG_BAD_TOKEN = "Token inválido ou expirado.";
const MSG_ADMIN_ONLY = "Acesso restrito a administradores.";

const REPO_CARDS = JSON.parse(readFileSync(join(PROJECT_ROOT, "src", "data", "modelo_cartas.json"), "utf-8"));

let serverProcess = null;

function startServer() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  let output = "";
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env, PORT: String(PORT), NODE_ENV: "test", DATA_DIR,
        JWT_SECRET, ADMIN_USERNAME: "admin", ADMIN_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    serverProcess = child;
    child.stdout.on("data", (d) => { output += d.toString(); if (output.includes("Rodando em")) resolve(); });
    child.stderr.on("data", (d) => { output += d.toString(); });
    child.on("error", reject);
    setTimeout(() => { if (!output.includes("Rodando em")) reject(new Error("Timeout: " + output)); }, 15000);
  });
}

function waitForExit(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}

after(async () => {
  const child = serverProcess;
  serverProcess = null;
  if (child) {
    child.kill();
    await waitForExit(child, 5000);
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
});

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** Token no formato emitido antes da mudanca (sem claim tv). */
const legacyToken = (payload, options = { expiresIn: "7d" }) => jwt.sign(payload, JWT_SECRET, options);

// Deck valido para o Alter Ego AE-0001 (mesmo usado em e2e-profile/e2e-session).
const VALID_DECK = {
  alter_ego_id: "AE-0001",
  main_deck: {
    "ACO-0001": 4, "ACO-0002": 4, "ACO-0006": 4, "ACO-0007": 4,
    "ACO-0008": 4, "ACO-0009": 4, "ACO-0017": 4, "ACO-0019": 4,
    "ACA-0001": 4, "ACA-0002": 4, "ACE-0001": 4, "ACE-0002": 4,
    "REA-0001": 2,
  },
  description: "",
};

/** Remove campos que mudam a cada chamada (horario da exportacao). */
const stableExport = (data) => {
  const { exported_at, ...rest } = data;
  assert.equal(typeof exported_at, "string");
  return rest;
};

test("E2E Preservacao de sessao: tokens antigos sem tv e token de admin", async (t) => {
  await startServer();

  let usedNames = 0;
  const players = [];

  await t.test("Property 9: token antigo (sem tv) = token do login em /api/decks/me e /api/auth/me/export", async () => {
    await forAll(
      gen.record({
        name: gen.string({ min: 3, max: 10, alphabet: "abcdefghijklmnopqrstuvwxyz" }),
        decks: gen.int(0, 2),
        withRole: gen.bool(0.3),
      }),
      async ({ name, decks, withRole }) => {
        usedNames += 1;
        const username = `${name}${usedNames}`;
        const reg = await req("POST", "/api/auth/register", {
          username, password: PASSWORD, email: `${username}@teste.com`, accepted_terms: true,
        });
        assert.equal(reg.status, 201, JSON.stringify(reg.data));
        const login = await req("POST", "/api/auth/login", { username, password: PASSWORD });
        assert.equal(login.status, 200, JSON.stringify(login.data));
        const loginToken = login.data.token;
        const id = login.data.user.id;
        assert.equal(id, reg.data.user.id);

        const deckIds = [];
        for (let i = 0; i < decks; i++) {
          const pub = await req("POST", "/api/decks", { ...VALID_DECK, name: `Deck ${username} ${i}` }, loginToken);
          assert.equal(pub.status, 201, JSON.stringify(pub.data));
          assert.deepEqual(Object.keys(pub.data).sort(), ["id", "message"]);
          assert.equal(pub.data.message, "Deck publicado com sucesso!");
          deckIds.push(pub.data.id);
        }

        // Formatos antigos: so { sub, username } (e, em alguns clientes, role: null).
        const old = legacyToken(withRole ? { sub: id, username, role: null } : { sub: id, username });
        players.push({ id, username, token: old, loginToken });

        const mineLogin = await req("GET", "/api/decks/me", undefined, loginToken);
        const mineOld = await req("GET", "/api/decks/me", undefined, old);
        assert.equal(mineOld.status, 200, `token antigo recusado em /api/decks/me: ${JSON.stringify(mineOld.data)}`);
        assert.deepEqual(mineOld, mineLogin, "token antigo e token do login devem ver o mesmo /api/decks/me");
        assert.deepEqual(mineOld.data.map((d) => d.id), [...deckIds].reverse(), "decks do usuario (mais recente primeiro)");
        for (const d of mineOld.data) {
          assert.deepEqual(Object.keys(d).sort(), ["alter_ego_id", "created_at", "description", "drop_pile", "id", "main_deck", "name", "sideboard"]);
          assert.deepEqual(d.main_deck, VALID_DECK.main_deck);
          assert.deepEqual(d.sideboard, {});
        }

        const expLogin = await req("GET", "/api/auth/me/export", undefined, loginToken);
        const expOld = await req("GET", "/api/auth/me/export", undefined, old);
        assert.equal(expOld.status, 200, `token antigo recusado em /api/auth/me/export: ${JSON.stringify(expOld.data)}`);
        assert.equal(expLogin.status, 200);
        assert.deepEqual(stableExport(expOld.data), stableExport(expLogin.data), "token antigo e token do login devem exportar os mesmos dados");
        assert.deepEqual(Object.keys(expOld.data).sort(), [
          "account", "exported_at", "forum_replies", "forum_topics", "organized_tournaments",
          "partner_stores", "point_history", "published_decks", "tournament_registrations",
        ]);
        assert.equal(expOld.data.account.id, id);
        assert.equal(expOld.data.account.username, username);
        assert.equal(expOld.data.account.email, `${username}@teste.com`);
        assert.deepEqual(expOld.data.published_decks.map((d) => d.id).sort((a, b) => a - b), [...deckIds].sort((a, b) => a - b));
      },
      { runs: 6, seed: 0x5e55a0 },
    );
  });

  await t.test("token antigo de usuario sem evento de seguranca continua aceito nas rotas com optionalAuth", async () => {
    const p = players[0];
    const community = await req("GET", "/api/decks/community", undefined, p.token);
    assert.equal(community.status, 200);
    for (const deck of community.data) {
      assert.equal(deck.is_mine, deck.author === p.username, `is_mine do deck ${deck.id}`);
    }
    const profile = await req("GET", `/api/profile/${p.username}`, undefined, p.token);
    const profileLogin = await req("GET", `/api/profile/${p.username}`, undefined, p.loginToken);
    assert.equal(profile.status, 200);
    assert.deepEqual(profile, profileLogin, "perfil com token antigo = perfil com token do login");
  });

  await t.test("mensagens pt-BR: sem token, token invalido, token expirado", async () => {
    const p = players[0];
    assert.deepEqual(await req("GET", "/api/decks/me"), { status: 401, data: { error: MSG_NO_TOKEN } });
    assert.deepEqual(await req("GET", "/api/auth/me/export", undefined, "nao-e-um-jwt"), { status: 401, data: { error: MSG_BAD_TOKEN } });
    const wrongSecret = jwt.sign({ sub: p.id, username: p.username }, "outro-segredo", { expiresIn: "7d" });
    assert.deepEqual(await req("GET", "/api/decks/me", undefined, wrongSecret), { status: 401, data: { error: MSG_BAD_TOKEN } });
    const expired = legacyToken({ sub: p.id, username: p.username, exp: Math.floor(Date.now() / 1000) - 60 }, {});
    assert.deepEqual(await req("GET", "/api/auth/me/export", undefined, expired), { status: 401, data: { error: MSG_BAD_TOKEN } });
  });

  let adminLoginToken;
  await t.test("login de admin continua igual", async () => {
    const wrong = await req("POST", "/api/admin/login", { username: "admin", password: "errada" });
    assert.deepEqual(wrong, { status: 401, data: { error: "Credenciais inválidas." } });
    const missing = await req("POST", "/api/admin/login", { username: "admin" });
    assert.deepEqual(missing, { status: 400, data: { error: "Usuário e senha são obrigatórios." } });

    const ok = await req("POST", "/api/admin/login", { username: "admin", password: ADMIN_PASSWORD });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(ok.data.user, { id: 0, username: "admin", role: "admin" });
    const payload = jwt.verify(ok.data.token, JWT_SECRET);
    assert.equal(payload.sub, 0);
    assert.equal(payload.role, "admin");
    assert.equal(payload.username, "admin");
    adminLoginToken = ok.data.token;
  });

  await t.test("Property 9 (admin): token de admin (sub 0, sem linha em users) aceito nas rotas de admin e moderacao", async () => {
    const author = players[1] ?? players[0];
    const topic = await req("POST", "/api/forum/categories/1/topics", { title: "Topico para moderar", body: "Corpo do topico" }, author.token);
    assert.equal(topic.status, 201, JSON.stringify(topic.data));
    assert.equal(topic.data.message, "Tópico criado!");

    let articleCount = 0;
    await forAll(
      gen.record({ source: gen.elements(["login", "legacy"]), title: gen.string({ min: 3, max: 20 }) }),
      async ({ source, title }) => {
        const admin = source === "login" ? adminLoginToken : legacyToken({ sub: 0, username: "admin", role: "admin" });

        const users = await req("GET", "/api/admin/users", undefined, admin);
        assert.equal(users.status, 200, JSON.stringify(users.data));
        assert.deepEqual(
          users.data.map((u) => u.username).sort(),
          players.map((p) => p.username).sort(),
          "admin ve todos os usuarios cadastrados",
        );
        for (const u of users.data) assert.deepEqual(Object.keys(u).sort(), ["created_at", "id", "is_judge", "username"]);

        const cards = await req("GET", "/api/admin/cards", undefined, admin);
        assert.equal(cards.status, 200);
        assert.equal(cards.data.cards.length, REPO_CARDS.cards.length, "mesmas cartas do repositorio");
        assert.deepEqual(Object.keys(cards.data.meta).sort(), ["colors", "known_keywords", "types"]);
        assert.deepEqual(cards.data.meta.colors, REPO_CARDS.colors);

        const created = await req("POST", "/api/admin/articles", { title, body: "Corpo do artigo" }, admin);
        assert.equal(created.status, 201, JSON.stringify(created.data));
        assert.equal(created.data.message, "Rascunho criado.");
        articleCount += 1;
        const articles = await req("GET", "/api/admin/articles", undefined, admin);
        assert.equal(articles.status, 200);
        assert.equal(articles.data.length, articleCount);
        const mine = articles.data.find((a) => a.id === created.data.id);
        assert.equal(mine.author, "admin", "artigo do admin (author_user_id 0) aparece como 'admin'");
        assert.equal(mine.published, 0);

        const reports = await req("GET", "/api/forum/reports", undefined, admin);
        assert.equal(reports.status, 200);
        assert.ok(Array.isArray(reports.data));

        const pin = await req("POST", `/api/forum/topics/${topic.data.id}/pin`, undefined, admin);
        assert.equal(pin.status, 200);
        assert.ok(
          (pin.data.is_pinned === 1 && pin.data.message === "Tópico fixado.") ||
            (pin.data.is_pinned === 0 && pin.data.message === "Tópico desfixado."),
          JSON.stringify(pin.data),
        );
        const lock = await req("POST", `/api/forum/topics/${topic.data.id}/lock`, undefined, admin);
        assert.equal(lock.status, 200);
        assert.ok(
          (lock.data.is_locked === 1 && lock.data.message === "Tópico trancado.") ||
            (lock.data.is_locked === 0 && lock.data.message === "Tópico destrancado."),
          JSON.stringify(lock.data),
        );
      },
      { runs: 6, seed: 0xad1100 },
    );
  });

  await t.test("jogador nas rotas de admin -> 403, sem token -> 401 (mensagens pt-BR)", async () => {
    const p = players[0];
    for (const token of [p.token, p.loginToken]) {
      for (const path of ["/api/admin/users", "/api/admin/cards", "/api/admin/articles", "/api/forum/reports"]) {
        assert.deepEqual(await req("GET", path, undefined, token), { status: 403, data: { error: MSG_ADMIN_ONLY } }, `${path} com token de jogador`);
      }
    }
    for (const path of ["/api/admin/users", "/api/admin/cards", "/api/admin/articles", "/api/forum/reports"]) {
      assert.deepEqual(await req("GET", path), { status: 401, data: { error: MSG_NO_TOKEN } }, `${path} sem token`);
      assert.deepEqual(await req("GET", path, undefined, "lixo"), { status: 401, data: { error: MSG_BAD_TOKEN } }, `${path} com token invalido`);
    }
    // Admin nao publica deck (conta sem linha em users).
    const adminDeck = await req("POST", "/api/decks", { ...VALID_DECK, name: "Deck do admin" }, adminLoginToken);
    assert.deepEqual(adminDeck, { status: 403, data: { error: "A conta de administrador não publica decks. Entre com uma conta de jogador." } });
  });
});
