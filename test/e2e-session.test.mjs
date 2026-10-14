// Bugs 1.11-1.13 / Esperado 2.14-2.17 (Property 6): troca de senha, redefinicao
// de senha e exclusao de conta revogam os tokens emitidos antes. Rotas com
// requireAuth respondem 401 em pt-BR; rotas com optionalAuth tratam o token
// revogado como anonimo.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-session");
const PORT = 3081;
const BASE_URL = `http://localhost:${PORT}`;
const PASSWORD = "senha123456";

let serverProcess;
let serverOutput = "";

function startServer() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  serverOutput = "";
  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env, PORT: String(PORT), NODE_ENV: "test", DATA_DIR,
        JWT_SECRET: "test-jwt-session", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-session",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.on("data", (d) => { serverOutput += d.toString(); if (serverOutput.includes("Rodando em")) resolve(); });
    serverProcess.stderr.on("data", (d) => { serverOutput += d.toString(); });
    serverProcess.on("error", reject);
    setTimeout(() => { if (!serverOutput.includes("Rodando em")) reject(new Error("Timeout: " + serverOutput)); }, 10000);
  });
}

function stopServer() {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  rmSync(DATA_DIR, { recursive: true, force: true });
}

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function registerAndLogin(username) {
  const reg = await req("POST", "/api/auth/register", {
    username, password: PASSWORD, email: `${username}@teste.com`, accepted_terms: true,
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const { status, data } = await req("POST", "/api/auth/login", { username, password: PASSWORD });
  assert.equal(status, 200, JSON.stringify(data));
  return data.token;
}

async function resetPassword(email, newPassword) {
  serverOutput = "";
  const forgot = await req("POST", "/api/auth/forgot-password", { email });
  assert.equal(forgot.status, 200);
  await new Promise((r) => setTimeout(r, 300));
  const token = serverOutput.match(/resetar-senha\?token=([a-f0-9]+)/)?.[1];
  assert.ok(token, "token de redefinicao deveria aparecer no console dev");
  const reset = await req("POST", "/api/auth/reset-password", { token, newPassword });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
}

function assertRevoked({ status, data }, context) {
  assert.equal(status, 401, `${context}: token antigo respondeu ${status} (deveria ser 401)`);
  assert.equal(typeof data?.error, "string", `${context}: resposta sem mensagem de erro`);
  assert.match(data.error, /sess[aã]o|login|token/i, `${context}: mensagem fora do padrao pt-BR: ${data.error}`);
}

// Deck valido para o Alter Ego AE-0001 (mesmo usado em e2e-profile).
const VALID_DECK = {
  name: "Deck da sessao",
  alter_ego_id: "AE-0001",
  main_deck: {
    "ACO-0001": 4, "ACO-0002": 4, "ACO-0006": 4, "ACO-0007": 4,
    "ACO-0008": 4, "ACO-0009": 4, "ACO-0017": 4, "ACO-0019": 4,
    "ACA-0001": 4, "ACA-0002": 4, "ACE-0001": 4, "ACE-0002": 4,
    "REA-0001": 2,
  },
  drop_pile: { Vermelho: 7, Verde: 3 },
  description: "",
};

test("E2E Sessao: revogacao de tokens", async (t) => {
  await startServer();
  try {
    await t.test("troca de senha devolve token novo e revoga o antigo", async () => {
      const oldToken = await registerAndLogin("trocador");
      const changed = await req("POST", "/api/auth/change-password", {
        currentPassword: PASSWORD, newPassword: "novaSenha987",
      }, oldToken);
      assert.equal(changed.status, 200, `POST /api/auth/change-password respondeu ${changed.status}: ${JSON.stringify(changed.data)}`);
      assert.equal(typeof changed.data?.token, "string", "troca de senha deveria devolver um token novo");

      assertRevoked(await req("GET", "/api/auth/me/export", undefined, oldToken), "apos troca de senha");
      const fresh = await req("GET", "/api/auth/me/export", undefined, changed.data.token);
      assert.equal(fresh.status, 200, "token novo deveria ser aceito");

      const login = await req("POST", "/api/auth/login", { username: "trocador", password: "novaSenha987" });
      assert.equal(login.status, 200, "login com a senha nova deveria funcionar");
    });

    await t.test("redefinicao de senha revoga o token antigo", async () => {
      const oldToken = await registerAndLogin("redefinidor");
      const before = await req("GET", "/api/auth/me/export", undefined, oldToken);
      assert.equal(before.status, 200);

      await resetPassword("redefinidor@teste.com", "outraSenha321");
      assertRevoked(await req("GET", "/api/auth/me/export", undefined, oldToken), "apos redefinicao de senha");
    });

    await t.test("exclusao de conta revoga o token antigo", async () => {
      const oldToken = await registerAndLogin("excluido");
      const del = await req("DELETE", "/api/auth/me", { password: PASSWORD }, oldToken);
      assert.equal(del.status, 200, JSON.stringify(del.data));

      assertRevoked(await req("GET", "/api/auth/me/export", undefined, oldToken), "apos exclusao de conta");
    });

    await t.test("rotas com optionalAuth tratam token revogado como anonimo", async () => {
      const oldToken = await registerAndLogin("opcional");
      const pub = await req("POST", "/api/decks", VALID_DECK, oldToken);
      assert.equal(pub.status, 201, JSON.stringify(pub.data));

      const mineBefore = await req("GET", "/api/decks/community", undefined, oldToken);
      assert.equal(mineBefore.status, 200);
      assert.equal(mineBefore.data.find((d) => d.author === "opcional")?.is_mine, true, "base: deck deveria ser is_mine");

      await resetPassword("opcional@teste.com", "outraSenha321");

      const community = await req("GET", "/api/decks/community", undefined, oldToken);
      assert.equal(community.status, 200, "rota opcional nao deve bloquear token revogado");
      const deck = community.data.find((d) => d.author === "opcional");
      assert.equal(deck?.is_mine, false, "token revogado ainda identifica o usuario em /api/decks/community (is_mine: true)");

      const profile = await req("GET", "/api/profile/opcional", undefined, oldToken);
      assert.equal(profile.status, 200, "perfil publico deve responder como anonimo");
    });
  } finally {
    stopServer();
  }
});
