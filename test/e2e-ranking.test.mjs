import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-ranking");
const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

async function startServer() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "test",
        DATA_DIR,
        JWT_SECRET: "test-jwt-secret-ranking",
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "test-admin-pw-ranking",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    serverProcess.stdout.on("data", (data) => {
      output += data.toString();
      if (output.includes("Rodando em")) resolve();
    });
    serverProcess.stderr.on("data", (data) => { output += data.toString(); });
    serverProcess.on("error", reject);
    serverProcess.on("exit", (code) => {
      if (!output.includes("Rodando em")) reject(new Error(`Server exit ${code}: ${output}`));
    });
    setTimeout(() => {
      if (!output.includes("Rodando em")) reject(new Error(`Timeout: ${output}`));
    }, 10000);
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
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function registerAndLogin(username) {
  await req("POST", "/api/auth/register", { username, password: "senha123456", email: `${username}@teste.com`, accepted_terms: true }); // patched
  const { data } = await req("POST", "/api/auth/login", { username, password: "senha123456" });
  return data.token;
}

async function adminLogin() {
  const { data } = await req("POST", "/api/admin/login", { username: "admin", password: "test-admin-pw-ranking" });
  return data.token;
}

async function publishDeck(token, name) {
  const mainDeck = {
    "ACO-0001": 4, "ACO-0002": 4, "ACA-0001": 4, "ACA-0002": 4,
    "ACD-0001": 4, "ACE-0001": 4, "ACE-0002": 4, "REO-0001": 4,
    "RED-0001": 4, "REE-0001": 4, "REA-0001": 2, "TAB-0001": 4, "TAS-0001": 4,
  };
  const { data } = await req("POST", "/api/decks", {
    name, alter_ego_id: "AE-0001", main_deck: mainDeck, drop_pile: { Vermelho: 7, Verde: 3 }, description: ""
  }, token);
  return data.id;
}

/**
 * Helper: run a full tournament to completion (swiss, 4 players, 2 rounds then finalize)
 */
async function runTournament(organizerToken, playerTokens, deckIds, tournamentId) {
  // Start
  await req("POST", `/api/tournaments/${tournamentId}/start`, {}, organizerToken);

  // Get matches and report each round until finished
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: t } = await req("GET", `/api/tournaments/${tournamentId}`);
    if (t.status === "finalizado") return t;

    const pendingMatches = t.matches.filter(m => m.result === "pending");
    for (const match of pendingMatches) {
      await req("POST", `/api/tournaments/${tournamentId}/matches/${match.id}/report`, { result: "player1" }, organizerToken);
    }

    // Try to advance
    const { data: nextData } = await req("POST", `/api/tournaments/${tournamentId}/next-round`, {}, organizerToken);
    if (nextData?.finished) break;
  }

  const { data: final } = await req("GET", `/api/tournaments/${tournamentId}`);
  return final;
}

test("E2E Ranking — pontuação automática e anti-exploit", async (t) => {
  await startServer();

  let adminToken;
  const tokens = {};
  const deckIds = {};
  const PLAYERS = ["jogador1", "jogador2", "jogador3", "jogador4"];

  await t.test("Setup: admin login + 4 jogadores com decks", async () => {
    adminToken = await adminLogin();
    for (const name of PLAYERS) {
      tokens[name] = await registerAndLogin(name);
      deckIds[name] = await publishDeck(tokens[name], `Deck ${name}`);
    }
  });

  // === TESTE 1: Torneio OFICIAL gera pontos ===
  let officialTournamentId;

  await t.test("Admin cria torneio OFICIAL (is_official = true)", async () => {
    const { status, data } = await req("POST", "/api/tournaments", {
      name: "Torneio Oficial de Teste",
      format: "swiss",
      is_official: true,
    }, adminToken);
    assert.equal(status, 201, JSON.stringify(data));
    officialTournamentId = data.id;
  });

  await t.test("4 jogadores se inscrevem no torneio oficial", async () => {
    for (const name of PLAYERS) {
      const { status } = await req("POST", `/api/tournaments/${officialTournamentId}/register`, { deck_id: deckIds[name] }, tokens[name]);
      assert.equal(status, 201);
    }
  });

  await t.test("Torneio oficial é finalizado e gera pontos no point_history", async () => {
    const final = await runTournament(adminToken, tokens, deckIds, officialTournamentId);
    assert.equal(final.status, "finalizado");

    // Check ranking has entries
    const { status, data } = await req("GET", "/api/ranking");
    assert.equal(status, 200);
    assert.ok(data.ranking.length > 0, "Ranking deve ter jogadores após torneio oficial");

    // Total points distributed should include match wins (3 each) + champion bonus (10)
    const totalPoints = data.ranking.reduce((sum, r) => sum + r.total_points, 0);
    assert.ok(totalPoints > 0, "Pontos totais devem ser > 0");

    // Champion should have the most points
    const champion = data.ranking[0];
    assert.ok(champion.total_points >= 10, "Campeão deve ter pelo menos 10 pontos (bônus campeão)");
  });

  await t.test("Ranking retorna winrate para cada jogador", async () => {
    const { data } = await req("GET", "/api/ranking");
    for (const player of data.ranking) {
      assert.ok(typeof player.winrate === "number", "winrate deve ser número");
      assert.ok(player.winrate >= 0 && player.winrate <= 100, "winrate deve estar entre 0-100");
    }
  });

  // === TESTE 2: Torneio NÃO-OFICIAL não gera pontos ===
  let unofficialTournamentId;

  await t.test("Jogador comum cria torneio NÃO-OFICIAL (is_official ignorado sem admin)", async () => {
    const { status, data } = await req("POST", "/api/tournaments", {
      name: "Torneio Casual",
      format: "swiss",
      is_official: true, // tentativa de marcar como oficial, mas sem ser admin
    }, tokens.jogador1);
    assert.equal(status, 201);
    unofficialTournamentId = data.id;
  });

  await t.test("4 jogadores se inscrevem no torneio casual", async () => {
    for (const name of PLAYERS) {
      await req("POST", `/api/tournaments/${unofficialTournamentId}/register`, { deck_id: deckIds[name] }, tokens[name]);
    }
  });

  await t.test("Ranking snapshot antes do torneio casual", async () => {
    // Save current ranking state
    const { data: before } = await req("GET", "/api/ranking");
    const beforePoints = before.ranking.reduce((sum, r) => sum + r.total_points, 0);

    // Run the unofficial tournament
    await runTournament(tokens.jogador1, tokens, deckIds, unofficialTournamentId);

    // Check ranking didn't change
    const { data: after } = await req("GET", "/api/ranking");
    const afterPoints = after.ranking.reduce((sum, r) => sum + r.total_points, 0);

    assert.equal(beforePoints, afterPoints, "Pontos não devem mudar após torneio não-oficial");
  });

  // === TESTE 3: Filtro por nome funciona ===
  await t.test("Filtro de busca por nome funciona", async () => {
    const { data } = await req("GET", "/api/ranking?search=jogador1");
    assert.ok(data.ranking.length > 0, "Deve encontrar jogador1");
    assert.ok(data.ranking.every(r => r.username.includes("jogador1")), "Todos resultados devem conter jogador1");
  });

  await t.test("Busca inexistente retorna vazio", async () => {
    const { data } = await req("GET", "/api/ranking?search=inexistente_xyz");
    assert.equal(data.ranking.length, 0);
  });

  // === TESTE 4: Histórico de pontos ===
  await t.test("Histórico de pontos de um jogador", async () => {
    const { data: ranking } = await req("GET", "/api/ranking");
    const player = ranking.ranking[0];
    const { status, data } = await req("GET", `/api/ranking/${player.user_id}/history`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0, "Campeão deve ter registros de histórico");
    // Each entry should have expected fields
    const entry = data[0];
    assert.ok(entry.points_awarded > 0);
    assert.ok(entry.reason);
    assert.ok(entry.tournament_name);
  });

  // === TESTE 5: Segurança - admin role necessário para is_official ===
  await t.test("Usuário comum não consegue criar torneio oficial", async () => {
    const { data: t1 } = await req("GET", `/api/tournaments/${unofficialTournamentId}`);
    // The tournament created by a non-admin with is_official=true should have is_official=0
    assert.equal(t1.is_official, 0, "Torneio de user comum deve ter is_official = 0");
  });

  await t.test("Admin consegue criar torneio oficial", async () => {
    const { data: t2 } = await req("GET", `/api/tournaments/${officialTournamentId}`);
    assert.equal(t2.is_official, 1, "Torneio de admin deve ter is_official = 1");
  });

  stopServer();
});
