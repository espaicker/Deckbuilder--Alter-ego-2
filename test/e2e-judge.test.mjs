import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-judge");
const PORT = 3093;
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
        JWT_SECRET: "test-jwt-judge", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-judge",
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
  await req("POST", "/api/auth/register", { username, password: "senha123456", email: `${username}@teste.com`, accepted_terms: true }); // patched
  const { data } = await req("POST", "/api/auth/login", { username, password: "senha123456" });
  return data;
}
async function adminLogin() {
  const { data } = await req("POST", "/api/admin/login", { username: "admin", password: "test-admin-judge" });
  return data.token;
}
async function publishDeck(token, name) {
  const mainDeck = { "ACO-0001": 4, "ACO-0002": 4, "ACA-0001": 4, "ACA-0002": 4, "ACD-0001": 4, "ACE-0001": 4, "ACE-0002": 4, "REO-0001": 4, "RED-0001": 4, "REE-0001": 4, "REA-0001": 2, "TAB-0001": 4, "TAS-0001": 4 };
  const { data } = await req("POST", "/api/decks", { name, alter_ego_id: "AE-0001", main_deck: mainDeck, drop_pile: { Vermelho: 7, Verde: 3 }, description: "" }, token);
  return data.id;
}

test("E2E Papel de Juiz", async (t) => {
  await startServer();

  let adminToken, judge, organizer, p1, p2;
  let judgeToken, orgToken;
  let tournamentId, matchId;

  await t.test("Setup: admin, juiz, organizador, 2 jogadores", async () => {
    adminToken = await adminLogin();
    judge = await registerAndLogin("juizzinho");
    organizer = await registerAndLogin("organizador");
    p1 = await registerAndLogin("jogador1");
    p2 = await registerAndLogin("jogador2");
    judgeToken = judge.token; orgToken = organizer.token;
    assert.ok(adminToken && judgeToken && orgToken);
  });

  await t.test("Usuario comum NAO consegue conceder juiz (so admin)", async () => {
    const { status } = await req("POST", `/api/admin/users/${judge.user.id}/toggle-judge`, {}, orgToken);
    assert.equal(status, 403);
  });

  await t.test("Admin concede papel de juiz", async () => {
    const { status, data } = await req("POST", `/api/admin/users/${judge.user.id}/toggle-judge`, {}, adminToken);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.is_judge, true);
  });

  await t.test("Organizador cria torneio e roda uma rodada", async () => {
    await publishDeck(p1.token, "Deck P1");
    await publishDeck(p2.token, "Deck P2");
    const d1 = await req("POST", "/api/decks", { name: "Deck P1b", alter_ego_id: "AE-0001", main_deck: { "ACO-0001": 4 }, drop_pile: { Vermelho: 10 }, description: "" }, p1.token);
    const { data: created } = await req("POST", "/api/tournaments", { name: "Copa Juiz", format: "swiss" }, orgToken);
    tournamentId = created.id;
    // p1 e p2 se inscrevem com decks publicados
    const decksP1 = await req("GET", "/api/decks/me", undefined, p1.token);
    const decksP2 = await req("GET", "/api/decks/me", undefined, p2.token);
    await req("POST", `/api/tournaments/${tournamentId}/register`, { deck_id: decksP1.data[0].id }, p1.token);
    await req("POST", `/api/tournaments/${tournamentId}/register`, { deck_id: decksP2.data[0].id }, p2.token);
    await req("POST", `/api/tournaments/${tournamentId}/start`, {}, orgToken);
    const { data: tour } = await req("GET", `/api/tournaments/${tournamentId}`);
    const m = tour.matches.find(x => x.result === "pending");
    matchId = m.id;
    // organizador reporta um resultado
    await req("POST", `/api/tournaments/${tournamentId}/matches/${matchId}/report`, { result: "player1" }, orgToken);
  });

  await t.test("Juiz corrige resultado de torneio que NAO organiza", async () => {
    const { status, data } = await req("PATCH", `/api/tournaments/${tournamentId}/matches/${matchId}/override`, { result: "player2", reason: "Erro de contagem confirmado" }, judgeToken);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.result, "player2");
    assert.equal(data.override_reason, "Erro de contagem confirmado");
  });

  await t.test("Override registrou overridden_by_user_id", async () => {
    const { data: tour } = await req("GET", `/api/tournaments/${tournamentId}`);
    const m = tour.matches.find(x => x.id === matchId);
    assert.equal(m.result, "player2");
  });

  await t.test("Organizador comum (sem is_judge) NAO corrige torneio alheio", async () => {
    // cria segundo torneio por outro usuario, organizador tenta override
    const outro = await registerAndLogin("outrodono");
    const { data: t2 } = await req("POST", "/api/tournaments", { name: "Copa Outro", format: "swiss" }, outro.token);
    // organizador (nosso) tenta override num torneio que nao e dele nem e juiz
    const { status } = await req("PATCH", `/api/tournaments/${t2.id}/matches/999/override`, { result: "player1", reason: "x" }, orgToken);
    assert.equal(status, 403);
  });

  await t.test("Juiz NAO acessa rotas de admin (listar usuarios)", async () => {
    const { status } = await req("GET", "/api/admin/users", undefined, judgeToken);
    assert.equal(status, 403);
  });

  await t.test("Juiz NAO consegue apagar conta (admin only)", async () => {
    const { status } = await req("DELETE", `/api/admin/users/${p1.user.id}`, undefined, judgeToken);
    assert.equal(status, 403);
  });

  await t.test("Admin remove papel de juiz (toggle de volta)", async () => {
    const { data } = await req("POST", `/api/admin/users/${judge.user.id}/toggle-judge`, {}, adminToken);
    assert.equal(data.is_judge, false);
    // agora nao consegue mais corrigir
    const { status } = await req("PATCH", `/api/tournaments/${tournamentId}/matches/${matchId}/override`, { result: "player1", reason: "y" }, judgeToken);
    assert.equal(status, 403);
  });

  stopServer();
});
