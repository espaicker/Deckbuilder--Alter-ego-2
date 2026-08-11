import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-tournaments");
const PORT = 3098;
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
        JWT_SECRET: "test-jwt-secret-tournaments",
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "test-admin-password-tournaments",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    serverProcess.stdout.on("data", (data) => {
      output += data.toString();
      if (output.includes("Rodando em")) resolve();
    });
    serverProcess.stderr.on("data", (data) => {
      output += data.toString();
    });
    serverProcess.on("error", reject);
    serverProcess.on("exit", (code) => {
      if (!output.includes("Rodando em")) {
        reject(new Error(`Server exited with code ${code}: ${output}`));
      }
    });
    setTimeout(() => {
      if (!output.includes("Rodando em")) {
        reject(new Error(`Server startup timeout. Output: ${output}`));
      }
    }, 10000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
}

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function registerAndLogin(username) {
  await req("POST", "/api/auth/register", { username, password: "senha123456" });
  const { data } = await req("POST", "/api/auth/login", { username, password: "senha123456" });
  return data.token;
}

async function publishDeck(token, name, alterEgoId, mainDeck, dropPile) {
  const { status, data } = await req(
    "POST",
    "/api/decks",
    { name, alter_ego_id: alterEgoId, main_deck: mainDeck, drop_pile: dropPile, description: "" },
    token
  );
  assert.equal(status, 201, JSON.stringify(data));
  return data.id;
}

// Deck válido de 50 cartas + 10 drops pra Burnout (Vermelho/Verde), reaproveitado
// em todas as inscrições de teste (o conteúdo do deck não importa pro torneio,
// só precisa existir e pertencer ao jogador).
const VALID_MAIN_DECK = {
  "ACO-0001": 4, "ACO-0002": 4, "ACA-0001": 4, "ACA-0002": 4,
  "ACD-0001": 4, "ACE-0001": 4, "ACE-0002": 4, "REO-0001": 4,
  "RED-0001": 4, "REE-0001": 4, "REA-0001": 2, "TAB-0001": 4,
  "TAS-0001": 4,
};
const VALID_DROP_PILE = { Vermelho: 7, Verde: 3 };

test("E2E Torneios - fluxo completo", async (t) => {
  await startServer();

  const tokens = {};
  const deckIds = {};
  const PLAYER_NAMES = ["alice", "bruno", "carla", "diego"];

  await t.test("Setup: registra 4 jogadores e publica um deck válido pra cada", async () => {
    for (const name of PLAYER_NAMES) {
      tokens[name] = await registerAndLogin(name);
      deckIds[name] = await publishDeck(
        tokens[name],
        `Deck de ${name}`,
        "AE-0001",
        VALID_MAIN_DECK,
        VALID_DROP_PILE
      );
    }
    assert.ok(tokens.alice && tokens.bruno && tokens.carla && tokens.diego);
  });

  let tournamentId;

  await t.test("Cria torneio suíço + top cut (qualquer usuário logado pode criar)", async () => {
    const { status, data } = await req(
      "POST",
      "/api/tournaments",
      { name: "Copa de Teste", description: "Torneio automatizado", format: "swiss_topcut", top_cut_size: 4 },
      tokens.alice
    );
    assert.equal(status, 201, JSON.stringify(data));
    tournamentId = data.id;
  });

  await t.test("Torneio criado aparece na listagem", async () => {
    const { status, data } = await req("GET", "/api/tournaments");
    assert.equal(status, 200);
    assert.ok(data.some((tour) => tour.id === tournamentId));
  });

  await t.test("Rejeita criar torneio com formato inválido", async () => {
    const { status } = await req("POST", "/api/tournaments", { name: "X", format: "invalido" }, tokens.alice);
    assert.equal(status, 400);
  });

  await t.test("Rejeita swiss_topcut sem top_cut_size válido", async () => {
    const { status } = await req(
      "POST",
      "/api/tournaments",
      { name: "X", format: "swiss_topcut", top_cut_size: 3 },
      tokens.alice
    );
    assert.equal(status, 400);
  });

  await t.test("4 jogadores se inscrevem com seus decks", async () => {
    for (const name of PLAYER_NAMES) {
      const { status, data } = await req(
        "POST",
        `/api/tournaments/${tournamentId}/register`,
        { deck_id: deckIds[name] },
        tokens[name]
      );
      assert.equal(status, 201, JSON.stringify(data));
    }
  });

  await t.test("Rejeita inscrição duplicada", async () => {
    const { status } = await req(
      "POST",
      `/api/tournaments/${tournamentId}/register`,
      { deck_id: deckIds.alice },
      tokens.alice
    );
    assert.equal(status, 409);
  });

  await t.test("Rejeita inscrição com deck de outra pessoa", async () => {
    const token = await registerAndLogin("eduardo");
    const { status } = await req(
      "POST",
      `/api/tournaments/${tournamentId}/register`,
      { deck_id: deckIds.alice },
      token
    );
    assert.equal(status, 400);
  });

  await t.test("Não-organizador não pode iniciar o torneio", async () => {
    const { status } = await req("POST", `/api/tournaments/${tournamentId}/start`, {}, tokens.bruno);
    assert.equal(status, 403);
  });

  await t.test("Organizador inicia o torneio (gera rodada 1)", async () => {
    const { status, data } = await req("POST", `/api/tournaments/${tournamentId}/start`, {}, tokens.alice);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.round, 1);
  });

  let round1Matches;
  await t.test("Rodada 1 tem 2 confrontos (4 jogadores, sem bye)", async () => {
    const { data } = await req("GET", `/api/tournaments/${tournamentId}`);
    round1Matches = data.matches.filter((m) => m.roundNumber === 1);
    assert.equal(round1Matches.length, 2);
    assert.equal(data.current_round, 1);
    assert.equal(data.round_count, 3); // suggestedSwissRounds(4) = 3
  });

  await t.test("Não deixa avançar rodada com confrontos pendentes", async () => {
    const { status } = await req("POST", `/api/tournaments/${tournamentId}/next-round`, {}, tokens.alice);
    assert.equal(status, 409);
  });

  await t.test("Jogador reporta o próprio resultado", async () => {
    const match = round1Matches[0];
    const { status } = await req(
      "POST",
      `/api/tournaments/${tournamentId}/matches/${match.id}/report`,
      { result: "player1" },
      tokens[match.player1Name]
    );
    assert.equal(status, 200);
  });

  await t.test("Jogador de fora do confronto não pode reportar", async () => {
    const match = round1Matches[1];
    const intruderToken = await registerAndLogin("intruso");
    const { status } = await req(
      "POST",
      `/api/tournaments/${tournamentId}/matches/${match.id}/report`,
      { result: "player1" },
      intruderToken
    );
    assert.equal(status, 403);
  });

  await t.test("Organizador reporta o segundo confronto", async () => {
    const match = round1Matches[1];
    const { status } = await req(
      "POST",
      `/api/tournaments/${tournamentId}/matches/${match.id}/report`,
      { result: "player2" },
      tokens.alice
    );
    assert.equal(status, 200);
  });

  await t.test("Avança pra rodada 2 depois de tudo reportado", async () => {
    const { status, data } = await req("POST", `/api/tournaments/${tournamentId}/next-round`, {}, tokens.alice);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.round, 2);
  });

  await t.test("Classificação reflete os resultados da rodada 1", async () => {
    const { data } = await req("GET", `/api/tournaments/${tournamentId}`);
    const winners = data.standings.filter((s) => s.matchPoints === 3);
    const losers = data.standings.filter((s) => s.matchPoints === 0);
    assert.equal(winners.length, 2);
    assert.equal(losers.length, 2);
  });

  await t.test("Reporta rodada 2 inteira e avança pra rodada 3 (última suíça)", async () => {
    const { data } = await req("GET", `/api/tournaments/${tournamentId}`);
    const round2 = data.matches.filter((m) => m.roundNumber === 2);
    for (const match of round2) {
      await req(
        "POST",
        `/api/tournaments/${tournamentId}/matches/${match.id}/report`,
        { result: "player1" },
        tokens.alice
      );
    }
    const { status, data: nextData } = await req(
      "POST",
      `/api/tournaments/${tournamentId}/next-round`,
      {},
      tokens.alice
    );
    assert.equal(status, 200, JSON.stringify(nextData));
    assert.equal(nextData.round, 3);
  });

  await t.test("Reporta rodada 3 (fim da fase suíça)", async () => {
    const { data } = await req("GET", `/api/tournaments/${tournamentId}`);
    const round3 = data.matches.filter((m) => m.roundNumber === 3);
    for (const match of round3) {
      await req(
        "POST",
        `/api/tournaments/${tournamentId}/matches/${match.id}/report`,
        { result: "player1" },
        tokens.alice
      );
    }
  });

  await t.test("next-round rejeita depois do fim da fase suíça (precisa usar start-topcut)", async () => {
    const { status, data } = await req(
      "POST",
      `/api/tournaments/${tournamentId}/next-round`,
      {},
      tokens.alice
    );
    assert.equal(status, 409, JSON.stringify(data));
  });

  await t.test("Avança pro mata-mata (top 4)", async () => {
    const { status, data } = await req(
      "POST",
      `/api/tournaments/${tournamentId}/start-topcut`,
      {},
      tokens.alice
    );
    assert.equal(status, 200, JSON.stringify(data));
  });

  await t.test("Mata-mata tem 2 confrontos (top 4 = semifinais)", async () => {
    const { data } = await req("GET", `/api/tournaments/${tournamentId}`);
    const topCutMatches = data.matches.filter((m) => m.stage === "topcut");
    assert.equal(topCutMatches.length, 2);
  });

  await t.test("Finaliza a semifinal e avança pra final", async () => {
    const { data } = await req("GET", `/api/tournaments/${tournamentId}`);
    const semis = data.matches.filter((m) => m.stage === "topcut");
    for (const match of semis) {
      await req(
        "POST",
        `/api/tournaments/${tournamentId}/matches/${match.id}/report`,
        { result: "player1" },
        tokens.alice
      );
    }
    const { status, data: nextData } = await req(
      "POST",
      `/api/tournaments/${tournamentId}/next-round`,
      {},
      tokens.alice
    );
    assert.equal(status, 200, JSON.stringify(nextData));
  });

  await t.test("Finaliza a final e o torneio é marcado como finalizado", async () => {
    const { data } = await req("GET", `/api/tournaments/${tournamentId}`);
    const final = data.matches.filter((m) => m.stage === "topcut").pop();
    await req(
      "POST",
      `/api/tournaments/${tournamentId}/matches/${final.id}/report`,
      { result: "player1" },
      tokens.alice
    );
    const { data: result } = await req("POST", `/api/tournaments/${tournamentId}/next-round`, {}, tokens.alice);
    assert.equal(result.finished, true);

    const { data: finalState } = await req("GET", `/api/tournaments/${tournamentId}`);
    assert.equal(finalState.status, "finalizado");
  });

  await t.test("Jogador que dá drop ANTES do início não entra pareado na rodada 1", async () => {
    const { data: created } = await req(
      "POST",
      "/api/tournaments",
      { name: "Copa com desistência prévia", format: "swiss" },
      tokens.alice
    );
    const dropTestTournamentId = created.id;

    for (const name of ["alice", "bruno", "carla"]) {
      const { status } = await req(
        "POST",
        `/api/tournaments/${dropTestTournamentId}/register`,
        { deck_id: deckIds[name] },
        tokens[name]
      );
      assert.equal(status, 201);
    }

    // Bruno desiste ainda na fase de inscrição, antes de o torneio começar.
    const { status: dropStatus } = await req(
      "POST",
      `/api/tournaments/${dropTestTournamentId}/drop`,
      {},
      tokens.bruno
    );
    assert.equal(dropStatus, 200);

    const { status: startStatus } = await req(
      "POST",
      `/api/tournaments/${dropTestTournamentId}/start`,
      {},
      tokens.alice
    );
    assert.equal(startStatus, 200);

    const { data: state } = await req("GET", `/api/tournaments/${dropTestTournamentId}`);
    const round1Matches = state.matches.filter((m) => m.roundNumber === 1);

    // Só alice e carla restaram ativas: 1 confronto entre elas, sem bye.
    assert.equal(round1Matches.length, 1);
    const involvedPlayerIds = [round1Matches[0].player1Id, round1Matches[0].player2Id];
    const brunoRegistration = state.players.find((p) => p.username === "bruno");
    assert.ok(!involvedPlayerIds.includes(brunoRegistration.id));
  });

  await t.test("Torneio cancelado por quem não é organizador é rejeitado", async () => {
    const { status, data } = await req(
      "POST",
      "/api/tournaments",
      { name: "Pra cancelar", format: "single_elim" },
      tokens.bruno
    );
    const { status: cancelStatus } = await req(
      "POST",
      `/api/tournaments/${data.id}/cancel`,
      {},
      tokens.alice
    );
    assert.equal(cancelStatus, 403);
    assert.equal(status, 201);
  });

  stopServer();
});
