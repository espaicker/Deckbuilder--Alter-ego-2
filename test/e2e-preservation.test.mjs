// Preservacao 3.2, 3.3, 3.9, 3.11, 3.13 (Properties 8, 10 e 11), observada no
// codigo SEM a correcao com entradas fora da condicao do bug:
// (a) CORS com NODE_ENV=test: qualquer origem e refletida com credenciais
//     (Vary: Origin); com ALLOWED_ORIGINS definido (valores com espacos sao
//     aparados), so as origens listadas recebem Access-Control-Allow-Origin e as
//     demais respondem normalmente, sem o cabecalho;
// (b) imagens do repositorio presentes no build: GET /assets/cards/<id>.jpg
//     devolve os mesmos bytes (pulado sem dist/);
// (c) /api/health, rotas /api/* publicas, 404 do Express para /api e /assets
//     inexistentes, "/" e "/admin" e o fallback da SPA respondem como antes;
// (d) isolamento: o servidor (com DATA_DIR temporario e NODE_ENV=test) so grava
//     dentro de DATA_DIR enquanto faz cadastro, login, decks e forum. As escritas
//     do processo filho sao registradas por test/helpers/fs-trace.mjs, e o hash de
//     src/data/modelo_cartas.json e as listagens de public/assets/ e server/ (fora
//     de .test-data-*) sao comparadas antes/depois.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { rmSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { forAll, gen, makeRng } from "./helpers/prop.mjs";
import { readTrace } from "./helpers/fs-trace.mjs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = join(PROJECT_ROOT, "server");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const HAS_DIST = existsSync(join(DIST_DIR, "index.html"));
const PASSWORD = "senha123456";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const isInside = (child, parent) => {
  const rel = relative(norm(parent), norm(child));
  return rel === "" || (!rel.startsWith("..") && !rel.includes(":"));
};

// --- Estado dos arquivos versionados (antes de subir qualquer servidor) ------
function snapshotTree(root, { skip = () => false } = {}) {
  const out = new Map();
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(root, full);
      if (skip(rel, name)) continue;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { out.set(rel + sep, "dir"); walk(full); } else out.set(rel, `${st.size}:${st.mtimeMs}`);
    }
  };
  walk(root);
  return out;
}
const SRC_CARDS_JSON = join(PROJECT_ROOT, "src", "data", "modelo_cartas.json");
function snapshotVersioned() {
  return {
    cardsJson: sha256(readFileSync(SRC_CARDS_JSON)),
    publicAssets: snapshotTree(join(PROJECT_ROOT, "public", "assets")),
    server: snapshotTree(SERVER_DIR, { skip: (rel, name) => rel.split(sep)[0].startsWith(".test-data-") || name === "node_modules" }),
  };
}
const versionedBefore = snapshotVersioned();

// --- Servidores ----------------------------------------------------------------
const TRACER = pathToFileURL(join(PROJECT_ROOT, "test", "helpers", "fs-trace.mjs")).href;
const children = new Set();

function startServer({ name, port, env = {}, traceFile }) {
  const dataDir = join(SERVER_DIR, `.test-data-${name}`);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const args = traceFile ? ["--import", TRACER, "server/index.js"] : ["server/index.js"];
  const childEnv = {
    ...process.env, PORT: String(port), NODE_ENV: "test", DATA_DIR: dataDir,
    JWT_SECRET: `test-jwt-${name}`, ADMIN_USERNAME: "admin", ADMIN_PASSWORD: `test-admin-${name}`,
    ...env,
  };
  if (!("ALLOWED_ORIGINS" in env)) delete childEnv.ALLOWED_ORIGINS;
  if (traceFile) Object.assign(childEnv, { FS_TRACE_FILE: traceFile, FS_TRACE_BLOCK: "0", FS_TRACE_PROBES: "0" });
  let output = "";
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: PROJECT_ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    children.add({ child, dataDir });
    child.stdout.on("data", (d) => { output += d.toString(); if (output.includes("Rodando em")) resolve({ child, dataDir, base: `http://localhost:${port}` }); });
    child.stderr.on("data", (d) => { output += d.toString(); });
    child.on("error", reject);
    setTimeout(() => { if (!output.includes("Rodando em")) reject(new Error("Timeout: " + output)); }, 20000);
  });
}

function waitForExit(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}

async function stopAll() {
  for (const entry of [...children]) {
    children.delete(entry);
    entry.child.kill();
    await waitForExit(entry.child, 5000);
    rmSync(entry.dataDir, { recursive: true, force: true });
  }
}

const TRACE_FILE = join(tmpdir(), `forja-e2e-preservation-${process.pid}-${Date.now()}.log`);
after(async () => {
  await stopAll();
  rmSync(TRACE_FILE, { force: true });
});

async function http(base, method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let data = null;
  try { data = JSON.parse(buf.toString("utf-8")); } catch { /* nao e JSON */ }
  return { status: res.status, headers: res.headers, buf, text: buf.toString("utf-8"), data };
}

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

const hostGen = gen.map(
  gen.array(gen.string({ min: 1, max: 8, alphabet: "abcdefghijklmnopqrstuvwxyz0123456789" }), { min: 1, max: 3 }),
  (labels) => labels.join(".") + ".example",
);
const originGen = gen.map(
  gen.record({ https: gen.bool(0.7), host: hostGen, port: gen.oneOf(gen.constant(null), gen.int(1024, 65000)) }),
  ({ https, host, port }) => `${https ? "https" : "http"}://${host}${port ? `:${port}` : ""}`,
);

// ALLOWED_ORIGINS fixo (semente fixa), com espacos para conferir o trim de hoje.
const ALLOWED = (() => {
  const rng = makeRng(0xa110ed);
  const list = new Set();
  while (list.size < 3) list.add(originGen(rng));
  return [...list];
})();

test("E2E Preservacao: CORS, assets do build, rotas /api e SPA, isolamento de DATA_DIR", async (t) => {
  const open = await startServer({ name: "preserve", port: 3084, traceFile: TRACE_FILE });
  const listed = await startServer({
    name: "preservecors", port: 3085,
    env: { ALLOWED_ORIGINS: ALLOWED.map((o, i) => (i % 2 ? ` ${o} ` : o)).join(",") },
  });

  await t.test("(c) /api/health e rotas publicas respondem como antes", async () => {
    const before = Date.now();
    const health = await http(open.base, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.match(health.headers.get("content-type") || "", /application\/json/);
    assert.deepEqual(Object.keys(health.data).sort(), ["status", "timestamp"]);
    assert.equal(health.data.status, "ok");
    assert.ok(Number.isInteger(health.data.timestamp) && health.data.timestamp >= before - 1000 && health.data.timestamp <= Date.now() + 1000);

    const categories = await http(open.base, "GET", "/api/forum/categories");
    assert.equal(categories.status, 200);
    assert.deepEqual(categories.data.map((c) => c.name), ["Geral", "Estratégia", "Torneios", "Bug Reports"]);
    assert.ok(categories.data.every((c) => c.topic_count === 0));

    for (const path of ["/api/articles", "/api/stores", "/api/tournaments", "/api/decks/community"]) {
      const r = await http(open.base, "GET", path);
      assert.equal(r.status, 200, path);
      assert.deepEqual(r.data, [], path);
    }
    const ranking = await http(open.base, "GET", "/api/ranking");
    assert.deepEqual(ranking.data, { ranking: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } });
  });

  await t.test("(c) 404 do Express para /api e /assets inexistentes; SPA nao captura essas rotas", async () => {
    await forAll(
      gen.record({
        prefix: gen.elements(["/api/", "/assets/", "/assets/cards/"]),
        name: gen.string({ min: 1, max: 12, alphabet: "abcdefghijklmnopqrstuvwxyz0123456789-" }),
        ext: gen.elements(["", ".js", ".css", ".png", ".jpg"]),
        method: gen.elements(["GET", "POST"]),
      }),
      async ({ prefix, name, ext, method }) => {
        const path = `${prefix}naoexiste-${name}${ext}`;
        const r = await http(open.base, method, path);
        assert.equal(r.status, 404, `${method} ${path}`);
        assert.match(r.headers.get("content-type") || "", /text\/html/);
        assert.ok(r.text.includes(`Cannot ${method} ${path}`), `${method} ${path}: corpo ${r.text.slice(0, 120)}`);
      },
      { runs: 20, seed: 0x404404 },
    );
  });

  await t.test("(c) '/', '/admin' e fallback da SPA servem os HTML do build", { skip: !HAS_DIST && "dist/ nao existe" }, async () => {
    const indexHtml = readFileSync(join(DIST_DIR, "index.html"));
    const adminHtml = readFileSync(join(DIST_DIR, "admin.html"));

    for (const [path, expected] of [["/", indexHtml], ["/admin", adminHtml]]) {
      const r = await http(open.base, "GET", path);
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get("content-type") || "", /text\/html/);
      assert.ok(r.buf.equals(expected), `${path} deveria servir o HTML do build`);
    }

    await forAll(
      gen.array(gen.string({ min: 1, max: 10, alphabet: "abcdefghijklmnopqrstuvwxyz0123456789-" }), { min: 1, max: 3 }),
      async (segments) => {
        const path = `/rota-${segments.join("/")}`;
        const r = await http(open.base, "GET", path);
        assert.equal(r.status, 200, path);
        assert.ok(r.buf.equals(indexHtml), `${path} deveria cair no index.html da SPA`);
      },
      { runs: 15, seed: 0x5ba000 },
    );

    // Scripts/estilos do build continuam nas mesmas URLs com os mesmos bytes.
    const builtRefs = [...indexHtml.toString("utf-8").matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(builtRefs.length > 0, "index.html do build sem referencias em /assets/");
    for (const ref of builtRefs) {
      const r = await http(open.base, "GET", ref);
      assert.equal(r.status, 200, ref);
      assert.ok(r.buf.equals(readFileSync(join(DIST_DIR, ref))), `${ref} com bytes diferentes do build`);
    }
  });

  await t.test("(b) imagens do repositorio presentes no build: mesmos bytes em /assets/cards/<id>.jpg", { skip: !HAS_DIST && "dist/ nao existe" }, async () => {
    const publicDir = join(PROJECT_ROOT, "public", "assets", "cards");
    const distDir = join(DIST_DIR, "assets", "cards");
    const candidates = (existsSync(publicDir) ? readdirSync(publicDir) : [])
      .filter((name) => /^[A-Za-z0-9_-]+\.jpg$/.test(name) && existsSync(join(distDir, name)))
      .filter((name) => readFileSync(join(publicDir, name)).equals(readFileSync(join(distDir, name))))
      .sort();
    if (candidates.length === 0) {
      t.diagnostic("nenhuma imagem de public/assets/cards identica em dist/assets/cards");
      return;
    }
    await forAll(gen.elements(candidates), async (name) => {
      const r = await http(open.base, "GET", `/assets/cards/${name}`);
      assert.equal(r.status, 200, name);
      assert.match(r.headers.get("content-type") || "", /image\/jpeg/);
      assert.ok(r.buf.equals(readFileSync(join(publicDir, name))), `/assets/cards/${name} com bytes diferentes`);
    }, { runs: 10, seed: 0x1a6e5 });
  });

  await t.test("(a) CORS fora de producao sem ALLOWED_ORIGINS: origens aleatorias refletidas com credenciais", async () => {
    await forAll(gen.record({ origin: originGen, path: gen.elements(["/api/health", "/api/forum/categories", "/api/decks/community"]) }), async ({ origin, path }) => {
      const r = await http(open.base, "GET", path, { headers: { Origin: origin } });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("access-control-allow-origin"), origin);
      assert.equal(r.headers.get("access-control-allow-credentials"), "true");
      assert.match(r.headers.get("vary") || "", /Origin/);

      const pre = await http(open.base, "OPTIONS", "/api/auth/login", {
        headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" },
      });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get("access-control-allow-origin"), origin);
      assert.equal(pre.headers.get("access-control-allow-credentials"), "true");
      assert.equal(pre.headers.get("access-control-allow-methods"), "GET,HEAD,PUT,PATCH,POST,DELETE");
      assert.equal(pre.headers.get("access-control-allow-headers"), "content-type,authorization");
    }, { runs: 20, seed: 0xc0e5a1 });

    const noOrigin = await http(open.base, "GET", "/api/health");
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);
  });

  await t.test("(a) CORS com ALLOWED_ORIGINS: so as origens listadas recebem Access-Control-Allow-Origin", async () => {
    await forAll(
      gen.record({ pick: gen.elements(["listed", "listed", "other"]), listed: gen.elements(ALLOWED), other: originGen }),
      async ({ pick, listed: listedOrigin, other }) => {
        const origin = pick === "listed" ? listedOrigin : other;
        const allowed = ALLOWED.includes(origin);
        const r = await http(listed.base, "GET", "/api/health", { headers: { Origin: origin } });
        assert.equal(r.status, 200, "origem nao listada continua recebendo a resposta (so sem cabecalho CORS)");
        assert.equal(r.headers.get("access-control-allow-origin"), allowed ? origin : null, `origem ${origin}`);
        assert.equal(r.headers.get("access-control-allow-credentials"), "true");

        const pre = await http(listed.base, "OPTIONS", "/api/auth/login", { headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
        assert.equal(pre.status, 204);
        assert.equal(pre.headers.get("access-control-allow-origin"), allowed ? origin : null, `preflight ${origin}`);
      },
      { runs: 24, seed: 0xa11e57 },
    );
  });

  await t.test("(d) cadastro, login, decks e forum: respostas de hoje e escritas so dentro de DATA_DIR", async () => {
    const shortName = await http(open.base, "POST", "/api/auth/register", { body: { username: "ab", password: "x" } });
    assert.deepEqual([shortName.status, shortName.data], [400, { error: "Nome de usuário deve ter 3-20 caracteres (letras, números, _ ou -)." }]);

    let n = 0;
    await forAll(
      gen.record({ name: gen.string({ min: 3, max: 10, alphabet: "abcdefghijklmnopqrstuvwxyz" }), withDeck: gen.bool(0.7), withTopic: gen.bool(0.5) }),
      async ({ name, withDeck, withTopic }) => {
        n += 1;
        const username = `${name}${n}`;
        const reg = await http(open.base, "POST", "/api/auth/register", {
          body: { username, password: PASSWORD, email: `${username}@teste.com`, accepted_terms: true },
        });
        assert.equal(reg.status, 201, reg.text);
        assert.deepEqual(Object.keys(reg.data).sort(), ["token", "user"]);
        assert.deepEqual(reg.data.user, { id: n, username });

        const wrong = await http(open.base, "POST", "/api/auth/login", { body: { username, password: "errada" } });
        assert.deepEqual([wrong.status, wrong.data], [401, { error: "Usuário ou senha incorretos." }]);
        const login = await http(open.base, "POST", "/api/auth/login", { body: { username, password: PASSWORD } });
        assert.equal(login.status, 200);
        assert.deepEqual(login.data.user, { id: n, username });
        const auth = { Authorization: `Bearer ${login.data.token}` };

        if (withDeck) {
          const pub = await http(open.base, "POST", "/api/decks", { headers: auth, body: { ...VALID_DECK, name: `Deck ${username}` } });
          assert.equal(pub.status, 201, pub.text);
          assert.equal(pub.data.message, "Deck publicado com sucesso!");
          const mine = await http(open.base, "GET", "/api/decks/me", { headers: auth });
          assert.deepEqual(mine.data.map((d) => d.id), [pub.data.id]);
          const community = await http(open.base, "GET", "/api/decks/community", { headers: auth });
          assert.equal(community.data.find((d) => d.id === pub.data.id)?.is_mine, true);
          if (n % 2 === 0) {
            const del = await http(open.base, "DELETE", `/api/decks/${pub.data.id}`, { headers: auth });
            assert.equal(del.status, 200, del.text);
            assert.deepEqual((await http(open.base, "GET", "/api/decks/me", { headers: auth })).data, []);
          }
        }
        if (withTopic) {
          const topic = await http(open.base, "POST", "/api/forum/categories/1/topics", { headers: auth, body: { title: `Topico ${username}`, body: "Corpo" } });
          assert.equal(topic.status, 201, topic.text);
          assert.equal(topic.data.message, "Tópico criado!");
        }
      },
      { runs: 8, seed: 0xd47a00 },
    );

    const trace = readTrace(TRACE_FILE);
    const writes = [...new Set(trace.flatMap((e) => e.paths))];
    assert.ok(writes.some((p) => isInside(p, open.dataDir)), "o rastreador nao registrou nenhuma escrita (banco em DATA_DIR esperado)");
    const outside = writes.filter((p) => !isInside(p, open.dataDir));
    assert.deepEqual(outside, [], `o servidor gravou fora de DATA_DIR: ${outside.join(", ")}`);

    // Arquivos versionados: nada que ESTE servidor gravou mudou fora de DATA_DIR.
    // (Diferencas causadas por outros arquivos de teste rodando em paralelo sao
    // apenas registradas.)
    const versionedAfter = snapshotVersioned();
    const diffs = [];
    if (versionedAfter.cardsJson !== versionedBefore.cardsJson) diffs.push(SRC_CARDS_JSON);
    for (const [key, root] of [["publicAssets", join(PROJECT_ROOT, "public", "assets")], ["server", SERVER_DIR]]) {
      const a = versionedBefore[key];
      const b = versionedAfter[key];
      for (const rel of new Set([...a.keys(), ...b.keys()])) {
        if (a.get(rel) !== b.get(rel)) diffs.push(join(root, rel));
      }
    }
    if (diffs.length > 0) t.diagnostic(`alteracoes em arquivos versionados durante o teste (outros processos): ${diffs.join(", ")}`);
    const ours = diffs.filter((d) => writes.some((w) => norm(w) === norm(d.replace(/[\\/]$/, ""))));
    assert.deepEqual(ours, [], "o servidor alterou arquivos versionados");
  });

  await stopAll();
});
