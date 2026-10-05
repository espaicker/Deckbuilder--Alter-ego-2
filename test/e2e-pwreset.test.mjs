import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-pwreset");
const PORT = 3094;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;
let serverOutput = "";

async function startServer() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  serverOutput = "";
  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env, PORT: String(PORT), NODE_ENV: "test", DATA_DIR,
        JWT_SECRET: "test-jwt-pwreset", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-pwreset",
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

async function req(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function extractTokenFromOutput() {
  // O link aparece no console dev: .../resetar-senha?token=XXX
  const m = serverOutput.match(/resetar-senha\?token=([a-f0-9]+)/);
  return m ? m[1] : null;
}

test("E2E Recuperacao de senha + email", async (t) => {
  await startServer();

  await t.test("Registro sem email e rejeitado", async () => {
    const { status } = await req("POST", "/api/auth/register", { username: "user1", password: "senha123456" });
    assert.equal(status, 400);
  });

  await t.test("Registro com email invalido e rejeitado", async () => {
    const { status } = await req("POST", "/api/auth/register", { username: "user1", password: "senha123456", email: "naoehemail" });
    assert.equal(status, 400);
  });

  await t.test("Registro valido com email funciona", async () => {
    const { status, data } = await req("POST", "/api/auth/register", { username: "user1", password: "senha123456", email: "user1@teste.com", accepted_terms: true });
    assert.equal(status, 201, JSON.stringify(data));
    assert.ok(data.token);
  });

  await t.test("Email duplicado (case-insensitive) e rejeitado", async () => {
    const { status } = await req("POST", "/api/auth/register", { username: "user2", password: "senha123456", email: "USER1@TESTE.COM", accepted_terms: true });
    assert.equal(status, 409);
  });

  await t.test("forgot-password com email inexistente responde sucesso generico e nao envia email", async () => {
    const outputBefore = serverOutput.length;
    const { status, data } = await req("POST", "/api/auth/forgot-password", { email: "naoexiste@teste.com" });
    assert.equal(status, 200);
    assert.ok(data.message.includes("Se esse e-mail existir"));
    // Confirma que nenhum email foi impresso (nenhum link gerado)
    const newOutput = serverOutput.slice(outputBefore);
    assert.ok(!newOutput.includes("resetar-senha?token="), "Nao deveria gerar link para email inexistente");
  });

  let resetToken;
  await t.test("forgot-password com email valido gera token no console", async () => {
    serverOutput = ""; // limpa para capturar so o novo
    const { status } = await req("POST", "/api/auth/forgot-password", { email: "user1@teste.com" });
    assert.equal(status, 200);
    // aguarda o log aparecer
    await new Promise(r => setTimeout(r, 200));
    resetToken = extractTokenFromOutput();
    assert.ok(resetToken, "Token deveria aparecer no console dev");
  });

  await t.test("e-mail de recuperacao tem saudacao, assunto e validade", async () => {
    assert.match(serverOutput, /Assunto: Redefinição de senha - Forja de Alter Egos/);
    assert.match(serverOutput, /Olá, user1!/);
    assert.match(serverOutput, /vale por 60 minutos e só pode ser usado uma vez/);
  });

  let pendingToken;
  await t.test("segundo pedido gera outro link pendente", async () => {
    serverOutput = "";
    await req("POST", "/api/auth/forgot-password", { email: "user1@teste.com" });
    await new Promise(r => setTimeout(r, 200));
    pendingToken = extractTokenFromOutput();
    assert.ok(pendingToken && pendingToken !== resetToken);
  });

  await t.test("reset-password funciona uma vez", async () => {
    const { status, data } = await req("POST", "/api/auth/reset-password", { token: resetToken, newPassword: "novaSenha987" });
    assert.equal(status, 200, JSON.stringify(data));
  });

  await t.test("dono da conta recebe aviso de senha alterada", async () => {
    await new Promise(r => setTimeout(r, 200));
    assert.match(serverOutput, /Sua senha foi alterada - Forja de Alter Egos/);
  });

  await t.test("outros links pendentes sao invalidados apos redefinir", async () => {
    const { status } = await req("POST", "/api/auth/reset-password", { token: pendingToken, newPassword: "maisUmaSenha55" });
    assert.equal(status, 400);
  });

  await t.test("senha nova funciona no login", async () => {
    const { status } = await req("POST", "/api/auth/login", { username: "user1", password: "novaSenha987" });
    assert.equal(status, 200);
  });

  await t.test("senha antiga nao funciona mais", async () => {
    const { status } = await req("POST", "/api/auth/login", { username: "user1", password: "senha123456" });
    assert.equal(status, 401);
  });

  await t.test("reset-password com mesmo token falha na segunda vez", async () => {
    const { status } = await req("POST", "/api/auth/reset-password", { token: resetToken, newPassword: "outraSenha123" });
    assert.equal(status, 400);
  });

  await t.test("reset-password com token invalido e rejeitado", async () => {
    const { status } = await req("POST", "/api/auth/reset-password", { token: "tokenfalso123", newPassword: "qualquer12345" });
    assert.equal(status, 400);
  });

  stopServer();
});
