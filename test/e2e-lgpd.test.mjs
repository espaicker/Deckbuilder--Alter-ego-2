import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-lgpd");
const PORT = 3090;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

async function startServer() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env, PORT: String(PORT), NODE_ENV: "test", DATA_DIR,
        JWT_SECRET: "test-jwt-lgpd", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-lgpd",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    serverProcess.stdout.on("data", (d) => { out += d.toString(); if (out.includes("Rodando em")) resolve(); });
    serverProcess.stderr.on("data", (d) => { out += d.toString(); });
    serverProcess.on("error", reject);
    setTimeout(() => { if (!out.includes("Rodando em")) reject(new Error("Timeout: " + out)); }, 10000);
  });
}
function stopServer() {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  rmSync(DATA_DIR, { recursive: true, force: true });
}
async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
async function register(username, extra = {}) {
  return req("POST", "/api/auth/register", { username, password: "senha123456", email: `${username}@teste.com`, accepted_terms: true, ...extra });
}
async function login(username, password = "senha123456") {
  const { data } = await req("POST", "/api/auth/login", { username, password });
  return data;
}
async function publishDeck(token, name) {
  const mainDeck = { "ACO-0001": 4, "ACO-0002": 4, "ACA-0001": 4, "ACA-0002": 4, "ACD-0001": 4, "ACE-0001": 4, "ACE-0002": 4, "REO-0001": 4, "RED-0001": 4, "REE-0001": 4, "REA-0001": 2, "TAB-0001": 4, "TAS-0001": 4 };
  const { data } = await req("POST", "/api/decks", { name, alter_ego_id: "AE-0001", main_deck: mainDeck, drop_pile: { Vermelho: 7, Verde: 3 }, description: "" }, token);
  return data.id;
}

test("E2E LGPD - protecao de dados", async (t) => {
  await startServer();

  await t.test("Cadastro SEM accepted_terms e rejeitado", async () => {
    const { status } = await req("POST", "/api/auth/register", { username: "semtermos", password: "senha123456", email: "semtermos@teste.com" });
    assert.equal(status, 400);
  });

  await t.test("Cadastro com accepted_terms=true funciona", async () => {
    const { status, data } = await register("alice");
    assert.equal(status, 201, JSON.stringify(data));
    assert.ok(data.token);
  });

  let aliceToken, bobToken;
  await t.test("Setup: alice e bob logados", async () => {
    const alice = await login("alice");
    await register("bob");
    const bob = await login("bob");
    aliceToken = alice.token; bobToken = bob.token;
    assert.ok(aliceToken && bobToken);
  });

  await t.test("GET /me/export retorna dados do usuario logado", async () => {
    await publishDeck(aliceToken, "Deck da Alice");
    const { status, data } = await req("GET", "/api/auth/me/export", undefined, aliceToken);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.account.username, "alice");
    assert.equal(data.account.email, "alice@teste.com");
    assert.ok(data.published_decks.some((d) => d.name === "Deck da Alice"));
  });

  await t.test("Export NAO retorna dados de outro usuario", async () => {
    const { data: aliceData } = await req("GET", "/api/auth/me/export", undefined, aliceToken);
    assert.equal(aliceData.account.email, "alice@teste.com");
    assert.notEqual(aliceData.account.username, "bob");
    const { data: bobData } = await req("GET", "/api/auth/me/export", undefined, bobToken);
    assert.equal(bobData.account.username, "bob");
    assert.equal(bobData.account.email, "bob@teste.com");
  });

  await t.test("Export exige autenticacao", async () => {
    const { status } = await req("GET", "/api/auth/me/export");
    assert.equal(status, 401);
  });

  await t.test("DELETE /me sem senha e rejeitado", async () => {
    const { status } = await req("DELETE", "/api/auth/me", {}, aliceToken);
    assert.equal(status, 400);
  });

  await t.test("DELETE /me com senha errada e rejeitado", async () => {
    const { status } = await req("DELETE", "/api/auth/me", { password: "errada" }, aliceToken);
    assert.equal(status, 401);
  });

  let aliceDeckId;
  await t.test("DELETE /me com senha correta anonimiza a conta", async () => {
    const { data: exp } = await req("GET", "/api/auth/me/export", undefined, aliceToken);
    aliceDeckId = exp.published_decks[0].id;
    const { status, data } = await req("DELETE", "/api/auth/me", { password: "senha123456" }, aliceToken);
    assert.equal(status, 200, JSON.stringify(data));
    assert.match(data.anonymized_username, /Usuario removido #/);
  });

  await t.test("Login com credenciais antigas falha apos exclusao", async () => {
    const { status } = await req("POST", "/api/auth/login", { username: "alice", password: "senha123456" });
    assert.equal(status, 401);
  });

  await t.test("Deck publicado continua existindo mas com autor anonimizado", async () => {
    const { data } = await req("GET", "/api/decks/community");
    const deck = data.find((d) => d.id === aliceDeckId);
    assert.ok(deck, "deck deve continuar existindo");
    assert.match(deck.author, /Usuario removido #/);
  });

  await t.test("Email e hash de senha nao vazam para outro usuario apos anonimizacao", async () => {
    // bob nao consegue ver dados da alice via export (so os proprios)
    const { data: bobData } = await req("GET", "/api/auth/me/export", undefined, bobToken);
    assert.equal(bobData.account.username, "bob");
    // A exclusao da conta revoga as sessoes abertas (requisito 2.16): o token
    // antigo da alice nao vale mais, com mensagem em pt-BR.
    const aliceExport = await req("GET", "/api/auth/me/export", undefined, aliceToken);
    assert.equal(aliceExport.status, 401, "token antigo deve ser rejeitado apos a exclusao da conta");
    assert.match(aliceExport.data?.error ?? "", /sess[aã]o|login|token/i);
    // Anonimizacao conferida por outros caminhos: o admin ve a conta como
    // "Usuario removido #<id>" (sem "alice")...
    const aliceId = JSON.parse(Buffer.from(aliceToken.split(".")[1], "base64url").toString("utf-8")).sub;
    const admin = await req("POST", "/api/admin/login", { username: "admin", password: "test-admin-lgpd" });
    assert.equal(admin.status, 200, JSON.stringify(admin.data));
    const { data: users } = await req("GET", "/api/admin/users", undefined, admin.data.token);
    const anonymized = users.find((u) => u.id === aliceId);
    assert.equal(anonymized?.username, `Usuario removido #${aliceId}`);
    assert.ok(!users.some((u) => u.username === "alice"), "username original nao deve continuar no banco");
    // ...e o e-mail foi apagado de verdade: ele fica livre para um novo cadastro.
    const reuse = await register("novaalice", { email: "alice@teste.com" });
    assert.equal(reuse.status, 201, `email deve ter sido apagado: ${JSON.stringify(reuse.data)}`);
  });

  stopServer();
});
