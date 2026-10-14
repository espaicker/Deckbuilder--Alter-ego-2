// Fase A (e2e): GET /api/meta publico, is_mine no link direto do deck e
// pre-visualizacao Open Graph no HTML das paginas compartilhaveis.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync, mkdirSync, existsSync } from "node:fs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-sharemeta");
const PORT = 3084;
const BASE_URL = `http://localhost:${PORT}`;
const SITE_URL = "https://forja.example";
const PASSWORD = "senha123456";
const HAS_DIST = existsSync(join(PROJECT_ROOT, "dist", "index.html"));

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

let serverProcess;

function startServer() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env, PORT: String(PORT), NODE_ENV: "test", DATA_DIR, SITE_URL,
        JWT_SECRET: "test-jwt-sharemeta", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-sharemeta",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    serverProcess.stdout.on("data", (d) => { output += d.toString(); if (output.includes("Rodando em")) resolve(); });
    serverProcess.stderr.on("data", (d) => { output += d.toString(); });
    serverProcess.on("error", reject);
    setTimeout(() => { if (!output.includes("Rodando em")) reject(new Error(`Timeout: ${output}`)); }, 15000);
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

async function register(username) {
  const { status, data } = await req("POST", "/api/auth/register", {
    username, password: PASSWORD, email: `${username}@teste.com`, accepted_terms: true,
  });
  assert.equal(status, 201, JSON.stringify(data));
  return data.token;
}

async function html(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, type: res.headers.get("content-type") || "", body: await res.text(), csp: res.headers.get("content-security-policy") };
}

test("E2E Links compartilhaveis e meta publico", async (t) => {
  await startServer();
  try {
    let tokenA;
    let tokenB;
    let deckId;

    await t.test("GET /api/meta sem decks: 200, publico e vazio", async () => {
      const { status, data } = await req("GET", "/api/meta");
      assert.equal(status, 200);
      assert.equal(data.total_decks, 0);
      assert.deepEqual(data.archetypes, []);
      assert.equal(data.scope, "todos");
    });

    await t.test("setup: dois jogadores, um deck publicado", async () => {
      tokenA = await register("ana_meta");
      tokenB = await register("bruno_meta");
      const pub = await req("POST", "/api/decks", { ...VALID_DECK, name: `Deck "da" <Ana>` }, tokenA);
      assert.equal(pub.status, 201, JSON.stringify(pub.data));
      deckId = pub.data.id;
    });

    await t.test("GET /api/meta reflete o deck publicado e a lista tipica", async () => {
      const { status, data } = await req("GET", "/api/meta");
      assert.equal(status, 200);
      assert.equal(data.total_decks, 1);
      const ae = data.archetypes.find((a) => a.alter_ego_id === "AE-0001");
      assert.ok(ae, "AE-0001 deveria aparecer no meta");
      assert.equal(ae.percent, 100);
      assert.equal(ae.win_rate, null, "sem torneios finalizados");
      assert.ok(ae.typical_list.some((c) => c.card_id === "ACO-0001" && c.avg_qty === 4));
      const official = await req("GET", "/api/meta?oficial=1");
      assert.equal(official.data.scope, "oficial");
    });

    await t.test("GET /api/decks/:id informa is_mine so para o dono", async () => {
      const own = await req("GET", `/api/decks/${deckId}`, undefined, tokenA);
      assert.equal(own.status, 200);
      assert.equal(own.data.is_mine, true);
      assert.equal(own.data.user_id, undefined, "user_id nao deve vazar");
      const other = await req("GET", `/api/decks/${deckId}`, undefined, tokenB);
      assert.equal(other.data.is_mine, false);
      const anon = await req("GET", `/api/decks/${deckId}`);
      assert.equal(anon.data.is_mine, false);
    });

    await t.test("HTML do deck tem titulo e Open Graph proprios, escapados", { skip: !HAS_DIST && "dist/ nao existe (rode npm run build)" }, async () => {
      const page = await html(`/comunidade/decks/${deckId}`);
      assert.equal(page.status, 200);
      assert.match(page.type, /text\/html/);
      assert.ok(!page.body.includes("<Ana>"), "nome do deck nao pode virar HTML");
      assert.match(page.body, /<meta property="og:title" content="Deck &quot;da&quot; &lt;Ana&gt; — deck de [^"]+" \/>/);
      assert.match(page.body, /og:description" content="Deck de ana_meta com /);
      assert.ok(page.body.includes(`<meta property="og:url" content="${SITE_URL}/comunidade/decks/${deckId}" />`));
      assert.ok(page.body.includes(`<meta property="og:image" content="${SITE_URL}/assets/cards/AE-0001.jpg" />`));
      assert.ok(page.csp, "pagina continua com CSP");
    });

    await t.test("HTML de perfil, meta e caminhos inexistentes", { skip: !HAS_DIST && "dist/ nao existe (rode npm run build)" }, async () => {
      const profile = await html("/comunidade/jogadores/ana_meta");
      assert.match(profile.body, /og:title" content="ana_meta — perfil de jogador"/);

      const meta = await html("/comunidade/meta");
      assert.match(meta.body, /og:title" content="Metagame/);

      for (const path of ["/comunidade/decks/99999", "/comunidade/jogadores/ninguem", "/catalogo", "/"]) {
        const page = await html(path);
        assert.equal(page.status, 200, path);
        assert.match(page.body, /<title>Forja de Alter Egos — Deck Builder<\/title>/, path);
        assert.equal((page.body.match(/property="og:title"/g) || []).length, 1, `${path}: og:title duplicado`);
      }
    });
  } finally {
    stopServer();
  }
});
