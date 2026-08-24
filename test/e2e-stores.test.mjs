import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-stores");
const PORT = 3092;
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
        JWT_SECRET: "test-jwt-stores", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-stores",
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
async function registerAndLogin(username) {
  await req("POST", "/api/auth/register", { username, password: "senha123456", email: `${username}@teste.com` });
  const { data } = await req("POST", "/api/auth/login", { username, password: "senha123456" });
  return data;
}
async function adminLogin() {
  const { data } = await req("POST", "/api/admin/login", { username: "admin", password: "test-admin-stores" });
  return data.token;
}

test("E2E Portal de Lojas Parceiras", async (t) => {
  await startServer();

  let adminToken, dono, outro;
  let storeId;

  await t.test("Setup: admin + dois usuarios", async () => {
    adminToken = await adminLogin();
    dono = await registerAndLogin("donoloja");
    outro = await registerAndLogin("outrousuario");
    assert.ok(adminToken && dono.token && outro.token);
  });

  await t.test("Usuario logado solicita cadastro de loja (fica pendente)", async () => {
    const { status, data } = await req("POST", "/api/stores", { name: "Loja Teste", city: "Fortaleza", state: "CE", contact_info: "contato@loja.com" }, dono.token);
    assert.equal(status, 201, JSON.stringify(data));
    storeId = data.id;
    assert.ok(storeId);
  });

  await t.test("Loja recem-criada NAO aparece em GET /api/stores (nao aprovada)", async () => {
    const { status, data } = await req("GET", "/api/stores");
    assert.equal(status, 200);
    assert.equal(data.find((s) => s.id === storeId), undefined);
  });

  await t.test("Usuario comum NAO consegue aprovar loja (so admin)", async () => {
    const { status } = await req("POST", `/api/admin/stores/${storeId}/approve`, {}, outro.token);
    assert.equal(status, 403);
  });

  await t.test("Admin ve loja na lista de pendentes", async () => {
    const { status, data } = await req("GET", "/api/admin/stores/pending", undefined, adminToken);
    assert.equal(status, 200);
    assert.ok(data.find((s) => s.id === storeId));
  });

  await t.test("Admin aprova a loja", async () => {
    const { status, data } = await req("POST", `/api/admin/stores/${storeId}/approve`, {}, adminToken);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.approved, true);
  });

  await t.test("Depois de aprovada, loja APARECE em GET /api/stores", async () => {
    const { status, data } = await req("GET", "/api/stores");
    assert.equal(status, 200);
    const s = data.find((x) => x.id === storeId);
    assert.ok(s, "loja aprovada deve aparecer");
    assert.equal(s.name, "Loja Teste");
    assert.equal(s.tournament_count, 0);
  });

  await t.test("Dono consegue vincular torneio a propria loja", async () => {
    const { status, data } = await req("POST", "/api/tournaments", { name: "Torneio da Loja", format: "swiss", store_id: storeId }, dono.token);
    assert.equal(status, 201, JSON.stringify(data));
    const { data: detail } = await req("GET", `/api/tournaments/${data.id}`);
    assert.equal(detail.store_id, storeId);
    assert.equal(detail.store_name, "Loja Teste");
  });

  await t.test("Outro usuario NAO consegue vincular torneio a loja que nao e sua", async () => {
    const { status } = await req("POST", "/api/tournaments", { name: "Torneio Roubado", format: "swiss", store_id: storeId }, outro.token);
    assert.equal(status, 403);
  });

  await t.test("Contagem de torneios reflete no diretorio", async () => {
    const { data } = await req("GET", "/api/stores");
    const s = data.find((x) => x.id === storeId);
    assert.equal(s.tournament_count, 1);
  });

  await t.test("Admin rejeita (apaga) uma nova loja pendente", async () => {
    const { data: created } = await req("POST", "/api/stores", { name: "Loja Ruim", city: "X", state: "XX" }, outro.token);
    const { status } = await req("POST", `/api/admin/stores/${created.id}/reject`, {}, adminToken);
    assert.equal(status, 200);
    const { data: pending } = await req("GET", "/api/admin/stores/pending", undefined, adminToken);
    assert.equal(pending.find((s) => s.id === created.id), undefined);
  });

  stopServer();
});
