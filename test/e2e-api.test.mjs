import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, unlinkSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SERVER_DIR = join(PROJECT_ROOT, "server");
const DB_PATH = join(SERVER_DIR, "deckbuilder.db");
const BASE_URL = "http://localhost:3099";

// Use a different port to not conflict with running dev server
const PORT = 3099;

let serverProcess;

async function startServer() {
  // Remove old test database
  if (existsSync(DB_PATH)) {
    try { unlinkSync(DB_PATH); } catch {}
  }

  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "test",
        JWT_SECRET: "test-jwt-secret-do-not-use-in-production",
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "test-admin-password-e2e",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    serverProcess.stdout.on("data", (data) => {
      output += data.toString();
      if (output.includes("Rodando em")) {
        resolve();
      }
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

    // Timeout
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
  // Cleanup test database
  if (existsSync(DB_PATH)) {
    try { unlinkSync(DB_PATH); } catch {}
  }
}

async function req(method, path, body = null, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { status: res.status, data };
}

// -- Test data --
const DECK_BURNOUT = {
  name: "Burnout Aggro",
  alter_ego_id: "AE-0001",
  main_deck: {
    "ACO-0001": 4, "ACO-0002": 4, "ACA-0001": 4, "ACA-0002": 4,
    "ACD-0001": 4, "ACE-0001": 4, "ACE-0002": 4, "REO-0001": 4,
    "RED-0001": 4, "REE-0001": 4, "REA-0001": 2, "TAB-0001": 4,
    "TAS-0001": 4
  },
  drop_pile: { "Vermelho": 7, "Verde": 3 },
  description: "Deck agressivo focado em dano direto com Burnout.",
};

const DECK_SPARK = {
  name: "Spark Controle",
  alter_ego_id: "AE-0003",
  main_deck: {
    "ACO-0003": 4, "ACO-0004": 4, "ACO-0005": 4, "ACD-0002": 4,
    "ACD-0003": 4, "ACD-0004": 4, "ACD-0005": 4, "REA-0002": 4,
    "REA-0004": 4, "REE-0003": 4, "REE-0004": 2, "TAB-0002": 4,
    "TAS-0003": 4
  },
  drop_pile: { "Azul": 7, "Vermelho": 3 },
  description: "Controle com draw e counter. Vence pelo card advantage.",
};

const DECK_KIMERA = {
  name: "Kimera Combo",
  alter_ego_id: "AE-0004",
  main_deck: {
    "ACO-0003": 4, "ACO-0004": 4, "ACO-0005": 4, "ACD-0002": 4,
    "ACD-0003": 4, "ACD-0004": 4, "ACD-0005": 4, "REA-0002": 4,
    "REA-0004": 4, "REA-0005": 4, "REE-0003": 2, "TAB-0002": 4,
    "TAS-0003": 4
  },
  drop_pile: { "Amarelo": 5, "Azul": 5 },
  description: "Combo deck que abusa do bounce da Kimera para gerar valor.",
};

// -- Tests --

test("E2E API - Full integration test", async (t) => {
  await startServer();
  t.after(stopServer);

  let tokenA, tokenB, tokenC;
  let deckIdA, deckIdB;

  await t.test("Health check", async () => {
    const { status, data } = await req("GET", "/api/health");
    assert.equal(status, 200);
    assert.equal(data.status, "ok");
  });

  // === AUTH ===

  await t.test("Register user JogadorA", async () => {
    const { status, data } = await req("POST", "/api/auth/register", {
      username: "JogadorA",
      password: "senha123",
    });
    assert.equal(status, 201);
    assert.ok(data.token);
    assert.equal(data.user.username, "JogadorA");
    tokenA = data.token;
  });

  await t.test("Register user JogadorB", async () => {
    const { status, data } = await req("POST", "/api/auth/register", {
      username: "JogadorB",
      password: "senha456",
    });
    assert.equal(status, 201);
    assert.ok(data.token);
    tokenB = data.token;
  });

  await t.test("Register user ProPlayer", async () => {
    const { status, data } = await req("POST", "/api/auth/register", {
      username: "ProPlayer",
      password: "rankedmaster",
    });
    assert.equal(status, 201);
    tokenC = data.token;
  });

  await t.test("Register rejects duplicate username", async () => {
    const { status, data } = await req("POST", "/api/auth/register", {
      username: "JogadorA",
      password: "outrasenha",
    });
    assert.equal(status, 409);
    assert.match(data.error, /já está em uso/);
  });

  await t.test("Register rejects short username", async () => {
    const { status } = await req("POST", "/api/auth/register", {
      username: "ab",
      password: "senha123",
    });
    assert.equal(status, 400);
  });

  await t.test("Register rejects short password", async () => {
    const { status } = await req("POST", "/api/auth/register", {
      username: "ValidUser",
      password: "12345",
    });
    assert.equal(status, 400);
  });

  await t.test("Login with correct credentials", async () => {
    const { status, data } = await req("POST", "/api/auth/login", {
      username: "JogadorA",
      password: "senha123",
    });
    assert.equal(status, 200);
    assert.ok(data.token);
    assert.equal(data.user.username, "JogadorA");
  });

  await t.test("Login rejects wrong password", async () => {
    const { status, data } = await req("POST", "/api/auth/login", {
      username: "JogadorA",
      password: "wrongpass",
    });
    assert.equal(status, 401);
    assert.match(data.error, /incorretos/);
  });

  await t.test("Login rejects nonexistent user", async () => {
    const { status } = await req("POST", "/api/auth/login", {
      username: "NaoExiste",
      password: "senha123",
    });
    assert.equal(status, 401);
  });

  // === PUBLISH DECKS ===

  await t.test("JogadorA publishes Burnout deck", async () => {
    const { status, data } = await req("POST", "/api/decks", DECK_BURNOUT, tokenA);
    assert.equal(status, 201);
    assert.ok(data.id);
    assert.match(data.message, /publicado/);
    deckIdA = data.id;
  });

  await t.test("JogadorB publishes Spark deck", async () => {
    const { status, data } = await req("POST", "/api/decks", DECK_SPARK, tokenB);
    assert.equal(status, 201);
    assert.ok(data.id);
    deckIdB = data.id;
  });

  await t.test("ProPlayer publishes Kimera deck", async () => {
    const { status, data } = await req("POST", "/api/decks", DECK_KIMERA, tokenC);
    assert.equal(status, 201);
    assert.ok(data.id);
  });

  await t.test("Publish rejects without auth", async () => {
    const { status } = await req("POST", "/api/decks", DECK_BURNOUT);
    assert.equal(status, 401);
  });

  await t.test("Publish rejects empty name", async () => {
    const { status } = await req("POST", "/api/decks", { ...DECK_BURNOUT, name: "" }, tokenA);
    assert.equal(status, 400);
  });

  // === VALIDAÇÃO DE REGRAS DO DECK (servidor) ===

  await t.test("Publish rejects deck with wrong card count", async () => {
    const incomplete = { ...DECK_BURNOUT, main_deck: { "ACO-0001": 4 } }; // só 4 de 50
    const { status, data } = await req("POST", "/api/decks", incomplete, tokenA);
    assert.equal(status, 400);
    assert.ok(Array.isArray(data.issues));
    assert.ok(data.issues.some((issue) => issue.includes("Deck principal")));
  });

  await t.test("Publish rejects more than max copies of a card", async () => {
    const tooMany = {
      ...DECK_BURNOUT,
      main_deck: { ...DECK_BURNOUT.main_deck, "ACO-0001": 8 }, // 8 cópias, máx é 4
    };
    const { status, data } = await req("POST", "/api/decks", tooMany, tokenA);
    assert.equal(status, 400);
    assert.ok(data.issues.some((issue) => issue.includes("máximo de 4 cópias")));
  });

  await t.test("Publish rejects card with color outside Alter Ego's colors", async () => {
    // ACO-0010 é Amarelo; o Alter Ego Burnout (AE-0001) é Vermelho/Verde
    const wrongColor = {
      ...DECK_BURNOUT,
      main_deck: { ...DECK_BURNOUT.main_deck, "TAB-0001": 2, "ACO-0010": 2 },
    };
    const { status, data } = await req("POST", "/api/decks", wrongColor, tokenA);
    assert.equal(status, 400);
    assert.ok(data.issues.some((issue) => issue.includes("cores não permitidas")));
  });

  await t.test("Publish rejects unknown card id", async () => {
    const fakeCard = { ...DECK_BURNOUT, main_deck: { ...DECK_BURNOUT.main_deck, "TAB-0001": 1, "CARTA-FALSA": 1 } };
    const { status, data } = await req("POST", "/api/decks", fakeCard, tokenA);
    assert.equal(status, 400);
    assert.ok(data.issues.some((issue) => issue.includes("Carta inválida")));
  });

  await t.test("Publish rejects invalid alter_ego_id", async () => {
    const { status, data } = await req("POST", "/api/decks", { ...DECK_BURNOUT, alter_ego_id: "NAO-EXISTE" }, tokenA);
    assert.equal(status, 400);
    assert.match(data.error, /Alter Ego inválido/);
  });

  await t.test("Publish rejects wrong drop pile size", async () => {
    const wrongDrops = { ...DECK_BURNOUT, drop_pile: { Vermelho: 2 } }; // só 2 de 10
    const { status, data } = await req("POST", "/api/decks", wrongDrops, tokenA);
    assert.equal(status, 400);
    assert.ok(data.issues.some((issue) => issue.includes("Monte de Drops")));
  });

  // === LIST COMMUNITY ===

  await t.test("Community lists all 3 decks", async () => {
    const { status, data } = await req("GET", "/api/decks/community");
    assert.equal(status, 200);
    assert.equal(data.length, 3);
    // Most recent first
    assert.equal(data[0].name, "Kimera Combo");
    assert.equal(data[1].name, "Spark Controle");
    assert.equal(data[2].name, "Burnout Aggro");
    // Check structure
    assert.equal(typeof data[0].main_deck, "object");
    assert.equal(typeof data[0].drop_pile, "object");
    assert.ok(data[0].author);
  });

  // === GET SPECIFIC DECK ===

  await t.test("Get deck by ID returns full data", async () => {
    const { status, data } = await req("GET", `/api/decks/${deckIdA}`);
    assert.equal(status, 200);
    assert.equal(data.name, "Burnout Aggro");
    assert.equal(data.alter_ego_id, "AE-0001");
    assert.equal(data.author, "JogadorA");
    assert.deepEqual(data.drop_pile, { Vermelho: 7, Verde: 3 });
  });

  await t.test("Get nonexistent deck returns 404", async () => {
    const { status } = await req("GET", "/api/decks/99999");
    assert.equal(status, 404);
  });

  // === MY DECKS ===

  await t.test("My decks returns only user's decks", async () => {
    const { status, data } = await req("GET", "/api/decks/me", null, tokenA);
    assert.equal(status, 200);
    assert.equal(data.length, 1);
    assert.equal(data[0].name, "Burnout Aggro");
  });

  await t.test("My decks rejects without auth", async () => {
    const { status } = await req("GET", "/api/decks/me");
    assert.equal(status, 401);
  });

  // === DELETE ===

  await t.test("Cannot delete another user's deck", async () => {
    const { status } = await req("DELETE", `/api/decks/${deckIdA}`, null, tokenB);
    assert.equal(status, 403);
  });

  await t.test("Owner can delete their own deck", async () => {
    const { status, data } = await req("DELETE", `/api/decks/${deckIdB}`, null, tokenB);
    assert.equal(status, 200);
    assert.match(data.message, /removido/);
  });

  await t.test("Community now has 2 decks after deletion", async () => {
    const { status, data } = await req("GET", "/api/decks/community");
    assert.equal(status, 200);
    assert.equal(data.length, 2);
  });

  await t.test("Delete nonexistent returns 404", async () => {
    const { status } = await req("DELETE", `/api/decks/${deckIdB}`, null, tokenB);
    assert.equal(status, 404);
  });

  // === AUTH EDGE CASES ===

  await t.test("Invalid token is rejected", async () => {
    const { status } = await req("GET", "/api/decks/me", null, "invalid.token.here");
    assert.equal(status, 401);
  });

  // === SEGURANÇA (correções críticas) ===

  await t.test("Register rejects reserved username 'admin'", async () => {
    const { status, data } = await req("POST", "/api/auth/register", {
      username: "admin",
      password: "qualquersenha",
    });
    assert.equal(status, 409);
    assert.match(data.error, /reservado/);
  });

  await t.test("Register rejects reserved username case-insensitively", async () => {
    const { status } = await req("POST", "/api/auth/register", {
      username: "Admin",
      password: "qualquersenha",
    });
    assert.equal(status, 409);
  });

  await t.test("Admin login works with ADMIN_PASSWORD env var", async () => {
    const { status, data } = await req("POST", "/api/admin/login", {
      username: "admin",
      password: "test-admin-password-e2e",
    });
    assert.equal(status, 200);
    assert.ok(data.token);
    assert.equal(data.user.role, "admin");
  });

  await t.test("Admin login rejects wrong password", async () => {
    const { status } = await req("POST", "/api/admin/login", {
      username: "admin",
      password: "senha-errada",
    });
    assert.equal(status, 401);
  });

  await t.test("Admin token can access /api/admin/stats", async () => {
    const login = await req("POST", "/api/admin/login", {
      username: "admin",
      password: "test-admin-password-e2e",
    });
    const { status, data } = await req("GET", "/api/admin/stats", null, login.data.token);
    assert.equal(status, 200);
    assert.ok(typeof data.totalUsers === "number");
  });

  await t.test("Regular user token cannot access /api/admin/stats", async () => {
    const { status } = await req("GET", "/api/admin/stats", null, tokenA);
    assert.equal(status, 403);
  });
});
