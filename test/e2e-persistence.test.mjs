// Bugs 1.4-1.9 / Esperado 2.4-2.12 (Properties 1, 3, 4, 5):
// - cartas, imagens de cartas e avatares vao para DATA_DIR (nunca src/ ou public/)
//   e sao servidos em /assets/... tambem sem novo build;
// - GET /api/cards entrega os dados atuais das cartas;
// - GET /api/admin/backup entrega o banco (com escritas recentes) so para admin;
// - encerramento gracioso (mensagem IPC "shutdown") grava o banco e sai com 0.
//
// No codigo sem correcao estes testes alteram arquivos versionados
// (src/data/modelo_cartas.json, public/assets/cards, public/assets/avatars):
// tudo e restaurado no after() (e no exit do processo, por seguranca).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import initSqlJs from "sql.js";
import sharp from "sharp";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-persistence");
const PORT = 3080;
const BASE_URL = `http://localhost:${PORT}`;
const ADMIN_PASSWORD = "test-admin-persistence";
const PASSWORD = "senha123456";
const CARD_ID = "TST-0001";

// --- Protecao dos arquivos versionados -------------------------------------
const SRC_CARDS_JSON = join(PROJECT_ROOT, "src", "data", "modelo_cartas.json");
const PUBLIC_CARDS_DIR = join(PROJECT_ROOT, "public", "assets", "cards");
const PUBLIC_AVATARS_DIR = join(PROJECT_ROOT, "public", "assets", "avatars");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const listDir = (dir) => (existsSync(dir) ? new Set(readdirSync(dir)) : null);

const original = {
  cardsJson: readFileSync(SRC_CARDS_JSON),
  cardsDir: listDir(PUBLIC_CARDS_DIR),
  avatarsDir: listDir(PUBLIC_AVATARS_DIR),
};
const originalCardsJsonHash = sha256(original.cardsJson);

let restored = false;
function restoreVersionedFiles() {
  if (restored) return;
  restored = true;
  if (sha256(readFileSync(SRC_CARDS_JSON)) !== originalCardsJsonHash) writeFileSync(SRC_CARDS_JSON, original.cardsJson);
  for (const [dir, before] of [[PUBLIC_CARDS_DIR, original.cardsDir], [PUBLIC_AVATARS_DIR, original.avatarsDir]]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!before || !before.has(name)) {
        try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
      }
    }
    if (!before) {
      try { rmdirSync(dir); } catch { /* ignore */ }
    }
  }
}
process.on("exit", restoreVersionedFiles);

// --- Servidor ----------------------------------------------------------------
let serverProcess = null;
let serverOutput = "";

function startServer({ clean }) {
  if (clean) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
  }
  serverOutput = "";
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env, PORT: String(PORT), NODE_ENV: "test", DATA_DIR,
        JWT_SECRET: "test-jwt-persistence", ADMIN_USERNAME: "admin", ADMIN_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    serverProcess = child;
    child.stdout.on("data", (d) => { serverOutput += d.toString(); if (serverOutput.includes("Rodando em")) resolve(child); });
    child.stderr.on("data", (d) => { serverOutput += d.toString(); });
    child.on("error", reject);
    setTimeout(() => { if (!serverOutput.includes("Rodando em")) reject(new Error("Timeout: " + serverOutput)); }, 15000);
  });
}

function waitForExit(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

async function killServer() {
  const child = serverProcess;
  serverProcess = null;
  if (!child) return;
  child.kill();
  await waitForExit(child, 5000);
}

after(async () => {
  await killServer();
  rmSync(DATA_DIR, { recursive: true, force: true });
  restoreVersionedFiles();
});

// --- HTTP --------------------------------------------------------------------
async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function multipart(path, field, filename, content, token) {
  const boundary = "----ForjaPersistence" + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, Authorization: `Bearer ${token}` },
    body,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function registerAndLogin(username) {
  const reg = await req("POST", "/api/auth/register", {
    username, password: PASSWORD, email: `${username}@teste.com`, accepted_terms: true,
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  return reg.data.token;
}

const jpeg = (color) => sharp({ create: { width: 16, height: 16, channels: 3, background: color } }).jpeg().toBuffer();

// --- Testes ------------------------------------------------------------------
test("E2E Persistencia: conteudo do admin, backup e encerramento", async (t) => {
  await startServer({ clean: true });

  let adminToken;
  let playerToken;

  await t.test("setup: admin e jogador autenticados", async () => {
    const admin = await req("POST", "/api/admin/login", { username: "admin", password: ADMIN_PASSWORD });
    assert.equal(admin.status, 200, JSON.stringify(admin.data));
    adminToken = admin.data.token;
    playerToken = await registerAndLogin("persistente");
  });

  await t.test(`admin cria ${CARD_ID}: gravada em DATA_DIR/cards/modelo_cartas.json`, async () => {
    const created = await req("POST", "/api/admin/cards", {
      id: CARD_ID, name: "Carta de Teste", type: "Ação", subtype: "ofensiva",
      colors: ["Vermelho"], cost: 1, attributes: {}, effect: "Efeito de teste.", keywords: [],
    }, adminToken);
    assert.equal(created.status, 201, JSON.stringify(created.data));

    const dataJson = join(DATA_DIR, "cards", "modelo_cartas.json");
    assert.ok(existsSync(dataJson), "DATA_DIR/cards/modelo_cartas.json nao existe (carta gravada fora de DATA_DIR)");
    const data = JSON.parse(readFileSync(dataJson, "utf-8"));
    assert.ok(data.cards.some((c) => c.id === CARD_ID), `${CARD_ID} ausente de DATA_DIR/cards/modelo_cartas.json`);
  });

  await t.test("criar carta nao altera src/data/modelo_cartas.json", () => {
    assert.equal(sha256(readFileSync(SRC_CARDS_JSON)), originalCardsJsonHash, "src/data/modelo_cartas.json foi alterado pela API do admin");
  });

  await t.test(`GET /api/cards entrega os dados atuais (inclui ${CARD_ID}) sem novo build`, async () => {
    const res = await fetch(`${BASE_URL}/api/cards`);
    assert.equal(res.status, 200, `GET /api/cards respondeu ${res.status}`);
    const data = await res.json();
    assert.ok(Array.isArray(data.cards), "formato: cards deve ser lista");
    assert.ok(Array.isArray(data.colors), "formato: colors deve ser lista");
    assert.equal(typeof data.types, "object", "formato: types deve ser objeto");
    assert.ok(data.cards.some((c) => c.id === CARD_ID), `${CARD_ID} ausente de /api/cards`);
  });

  await t.test("upload de imagem de carta vai para DATA_DIR e e servido em /assets/cards", async () => {
    const up = await multipart(`/api/admin/cards/${CARD_ID}/image`, "image", "carta.jpg", await jpeg("#0a0"), adminToken);
    assert.equal(up.status, 200, JSON.stringify(up.data));
    assert.ok(existsSync(join(DATA_DIR, "assets", "cards", `${CARD_ID}.jpg`)), "imagem nao foi gravada em DATA_DIR/assets/cards");

    const res = await fetch(`${BASE_URL}/assets/cards/${CARD_ID}.jpg`);
    await res.arrayBuffer();
    assert.equal(res.status, 200, `GET /assets/cards/${CARD_ID}.jpg respondeu ${res.status}`);
    assert.match(res.headers.get("content-type") || "", /image\/jpeg/);
  });

  await t.test("avatar enviado e servido em /assets/avatars", async () => {
    const up = await multipart("/api/profile/avatar", "avatar", "avatar.jpg", await jpeg("#c00"), playerToken);
    assert.equal(up.status, 200, JSON.stringify(up.data));
    const url = up.data.avatar_url;
    assert.match(url, /^\/assets\/avatars\/[^/]+\.jpg$/);

    const res = await fetch(`${BASE_URL}${url}`);
    await res.arrayBuffer();
    assert.equal(res.status, 200, `GET ${url} respondeu ${res.status}`);
    assert.match(res.headers.get("content-type") || "", /image\/jpeg/);
  });

  await t.test("GET /api/admin/backup: admin baixa o banco com a escrita mais recente", async () => {
    await registerAndLogin("recente"); // escrita dentro da janela de debounce

    const res = await fetch(`${BASE_URL}/api/admin/backup`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 200, `GET /api/admin/backup respondeu ${res.status}`);
    assert.equal(body.subarray(0, 16).toString("latin1"), "SQLite format 3\0", "corpo nao e um banco SQLite");

    const SQL = await initSqlJs();
    const copy = new SQL.Database(body);
    try {
      const rows = copy.exec("SELECT username FROM users WHERE username = 'recente'");
      assert.equal(rows.length, 1, "backup nao contem a escrita feita logo antes");
    } finally {
      copy.close();
    }
  });

  await t.test("GET /api/admin/backup: jogador recebe 403 e anonimo 401, com mensagem em pt-BR", async () => {
    const asPlayer = await req("GET", "/api/admin/backup", undefined, playerToken);
    assert.equal(asPlayer.status, 403, `jogador recebeu ${asPlayer.status}`);
    assert.equal(typeof asPlayer.data?.error, "string");
    assert.match(asPlayer.data.error, /administradores/i);

    const anon = await req("GET", "/api/admin/backup");
    assert.equal(anon.status, 401, `anonimo recebeu ${anon.status}`);
    assert.equal(typeof anon.data?.error, "string");
    assert.match(anon.data.error, /token/i);
  });

  await t.test("mensagem IPC 'shutdown' grava pendencias e sai com codigo 0 em ate 5 s", async () => {
    await registerAndLogin("ultimo"); // escrita pendente no momento do encerramento

    const child = serverProcess;
    child.send("shutdown");
    const exit = await waitForExit(child, 5000);
    if (!exit) {
      await killServer();
      assert.fail("servidor ignorou a mensagem 'shutdown' e nao encerrou em 5 s (sem encerramento gracioso)");
    }
    serverProcess = null;
    assert.equal(exit.code, 0, `codigo de saida ${exit.code} (sinal ${exit.signal})`);

    // Reinicia com o mesmo DATA_DIR: a escrita feita antes do encerramento sobreviveu.
    await startServer({ clean: false });
    const login = await req("POST", "/api/auth/login", { username: "ultimo", password: PASSWORD });
    assert.equal(login.status, 200, "usuario criado antes do encerramento sumiu apos reinicio");
  });

  await killServer();
});
