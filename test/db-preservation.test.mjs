// Preservacao 3.2, 3.4, 3.7, 3.16 (Properties 8 e 10), observada no codigo SEM
// a correcao e que deve continuar valendo depois dela:
// - o DbWrapper devolve os mesmos { changes, lastInsertRowid } e as mesmas linhas
//   para sequencias de INSERT/UPDATE/DELETE/SELECT (modelo abaixo = baseline observado);
// - um banco com schema antigo abre com initDb() sem perder nenhuma linha
//   (e com token_version = 0 quando essa coluna existir);
// - PRAGMA foreign_keys efetivo continua 0 depois de initDb() (sql.js reinicia
//   os PRAGMAs no export()), entao inserts que dependem disso continuam aceitos;
// - so sql.js, sem dependencia nativa nova;
// - sem DATA_DIR, banco e segredos continuam em server/.
//
// Baseline observado (sql.js 1.14.x, DbWrapper original):
// - INSERT que insere: changes 1, lastInsertRowid = id novo;
// - INSERT OR IGNORE ignorado, UPDATE, DELETE e SELECT via run(): lastInsertRowid 0
//   (o export() de cada escrita reabre o banco e zera last_insert_rowid);
// - SELECT via run(): changes 0; UPDATE/DELETE: changes = linhas afetadas.
//
// Compativel com o codigo corrigido: flush()/close() so sao chamados se existirem;
// asserts de token_version so se a coluna existir.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import initSqlJs from "sql.js";
import { forAll, gen } from "./helpers/prop.mjs";
import { readTrace } from "./helpers/fs-trace.mjs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = join(PROJECT_ROOT, "server");
const DATA_DIR = join(SERVER_DIR, ".test-data-dbpreserve");
const DB_PATH = join(DATA_DIR, "deckbuilder.db");

rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;

const { initDb } = await import("../server/db.js");
const SQL = await initSqlJs();

const liveWrappers = new Set();

async function boot() {
  const db = await initDb();
  liveWrappers.add(db);
  return db;
}

/** Grava pendencias, se o wrapper suportar (codigo corrigido). */
function persist(db) {
  if (typeof db.flush === "function") db.flush();
}

/** Encerra o wrapper (para timers de debounce no codigo corrigido). */
function shutdown(db) {
  if (!liveWrappers.has(db)) return;
  liveWrappers.delete(db);
  if (typeof db.close === "function") db.close();
  else persist(db);
}

function openDisk() {
  return new SQL.Database(readFileSync(DB_PATH));
}

function diskRows(sql) {
  const disk = openDisk();
  try {
    const stmt = disk.prepare(sql);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } finally {
    disk.close();
  }
}

after(() => {
  for (const db of [...liveWrappers]) {
    try { shutdown(db); } catch { /* ignore */ }
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Property 8: mesmos retornos e linhas para sequencias de operacoes
// ---------------------------------------------------------------------------
const nameGen = gen.oneOf(gen.constant(null), gen.string({ min: 0, max: 10 }));
const opGen = gen.oneOf(
  gen.record({ op: gen.constant("insert"), name: nameGen, n: gen.int(-5, 20) }),
  gen.record({ op: gen.constant("insert"), name: nameGen, n: gen.int(-5, 20) }),
  gen.record({ op: gen.constant("insertOrIgnore"), id: gen.int(1, 12), name: nameGen, n: gen.int(-5, 20) }),
  gen.record({ op: gen.constant("update"), minN: gen.int(-5, 20), delta: gen.int(-3, 3) }),
  gen.record({ op: gen.constant("delete"), id: gen.int(1, 12) }),
  gen.record({ op: gen.constant("execUpdate"), id: gen.int(1, 12), n: gen.int(-5, 20) }),
  gen.record({ op: gen.constant("select") }),
  gen.record({ op: gen.constant("get"), id: gen.int(1, 12) }),
  gen.record({ op: gen.constant("selectRun") }),
);

test("Property 8: DbWrapper devolve os mesmos { changes, lastInsertRowid } e linhas do codigo original", async () => {
  const db = await boot();
  try {
    await forAll(gen.array(opGen, { min: 1, max: 25 }), (ops) => {
      db.exec("DROP TABLE IF EXISTS prop_t");
      db.exec("CREATE TABLE prop_t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER NOT NULL)");
      const model = new Map(); // id -> { id, name, n }
      let seq = 0; // sqlite_sequence de prop_t
      const sorted = () => [...model.values()].sort((a, b) => a.id - b.id).map((r) => ({ ...r }));

      for (const step of ops) {
        switch (step.op) {
          case "insert": {
            const r = db.prepare("INSERT INTO prop_t (name, n) VALUES (?, ?)").run(step.name, step.n);
            seq += 1;
            model.set(seq, { id: seq, name: step.name, n: step.n });
            assert.deepEqual(r, { changes: 1, lastInsertRowid: seq }, `insert ${JSON.stringify(step)}`);
            break;
          }
          case "insertOrIgnore": {
            const r = db.prepare("INSERT OR IGNORE INTO prop_t (id, name, n) VALUES (?, ?, ?)").run(step.id, step.name, step.n);
            if (model.has(step.id)) {
              assert.deepEqual(r, { changes: 0, lastInsertRowid: 0 }, `insert ignorado ${JSON.stringify(step)}`);
            } else {
              model.set(step.id, { id: step.id, name: step.name, n: step.n });
              seq = Math.max(seq, step.id);
              assert.deepEqual(r, { changes: 1, lastInsertRowid: step.id }, `insert explicito ${JSON.stringify(step)}`);
            }
            break;
          }
          case "update": {
            const r = db.prepare("UPDATE prop_t SET n = n + ? WHERE n >= ?").run(step.delta, step.minN);
            let changed = 0;
            for (const row of model.values()) {
              if (row.n >= step.minN) { row.n += step.delta; changed += 1; }
            }
            assert.deepEqual(r, { changes: changed, lastInsertRowid: 0 }, `update ${JSON.stringify(step)}`);
            break;
          }
          case "delete": {
            const r = db.prepare("DELETE FROM prop_t WHERE id = ?").run(step.id);
            const existed = model.delete(step.id);
            assert.deepEqual(r, { changes: existed ? 1 : 0, lastInsertRowid: 0 }, `delete ${JSON.stringify(step)}`);
            break;
          }
          case "execUpdate": {
            const ret = db.exec(`UPDATE prop_t SET n = ${step.n} WHERE id = ${step.id}`);
            assert.equal(ret, undefined, "exec() nao devolve valor");
            if (model.has(step.id)) model.get(step.id).n = step.n;
            break;
          }
          case "select":
            assert.deepEqual(db.prepare("SELECT id, name, n FROM prop_t ORDER BY id").all(), sorted());
            break;
          case "get": {
            const row = db.prepare("SELECT id, name, n FROM prop_t WHERE id = ?").get(step.id);
            const expected = model.get(step.id);
            assert.deepEqual(row, expected ? { ...expected } : undefined, `get ${step.id}`);
            break;
          }
          case "selectRun":
            assert.deepEqual(db.prepare("SELECT COUNT(*) AS c FROM prop_t").run(), { changes: 0, lastInsertRowid: 0 });
            break;
          default:
            throw new Error(`operacao desconhecida ${step.op}`);
        }
      }

      // Leitura em memoria = modelo; depois de gravar, o disco = memoria.
      assert.deepEqual(db.prepare("SELECT id, name, n FROM prop_t ORDER BY id").all(), sorted());
      persist(db);
      assert.deepEqual(diskRows("SELECT id, name, n FROM prop_t ORDER BY id"), sorted(), "banco reaberto do disco difere da memoria");
    }, { runs: 60, seed: 0x8a7e01 });
  } finally {
    db.exec("DROP TABLE IF EXISTS prop_t");
    shutdown(db);
  }
});

// ---------------------------------------------------------------------------
// Migracao sem perda (3.4)
// ---------------------------------------------------------------------------
const LEGACY_SCHEMA = {
  v0: `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  v1: `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      bio TEXT DEFAULT '',
      avatar_url TEXT DEFAULT NULL,
      email TEXT
    );`,
};
const LEGACY_DECKS = `
  CREATE TABLE community_decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    alter_ego_id TEXT NOT NULL,
    main_deck TEXT NOT NULL,
    drop_pile TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );`;
const LEGACY_TOURNAMENTS = `
  CREATE TABLE tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    format TEXT NOT NULL CHECK (format IN ('swiss', 'swiss_topcut', 'single_elim')),
    top_cut_size INTEGER,
    round_count INTEGER,
    current_round INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER,
    organizer_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'inscricao'
      CHECK (status IN ('inscricao','em_andamento','finalizado','cancelado')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE
  );`;
const LEGACY_FORUM_CATEGORIES = `
  CREATE TABLE forum_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`;
const DEFAULT_CATEGORIES = ["Geral", "Estratégia", "Torneios", "Bug Reports"];

const textGen = gen.string({ min: 1, max: 12 });
const legacyGen = gen.record({
  version: gen.elements(["v0", "v1"]),
  users: gen.array(
    gen.record({
      name: gen.string({ min: 1, max: 8, alphabet: "abcdefghijklmnopqrstuvwxyz" }),
      hash: textGen,
      createdAt: gen.elements(["2024-01-02 03:04:05", "2025-06-30 23:59:59"]),
      bio: gen.oneOf(gen.constant(null), textGen),
      email: gen.oneOf(gen.constant(null), gen.map(textGen, (s) => `${s}@ex.com`)),
      decks: gen.array(gen.record({ name: textGen, ae: gen.elements(["AE-0001", "AE-0002"]), desc: textGen }), { min: 0, max: 3 }),
      tournaments: gen.array(
        gen.record({ name: textGen, format: gen.elements(["swiss", "swiss_topcut", "single_elim"]), status: gen.elements(["inscricao", "em_andamento", "finalizado", "cancelado"]) }),
        { min: 0, max: 2 },
      ),
    }),
    { min: 0, max: 6 },
  ),
  categories: gen.oneOf(gen.constant(null), gen.array(textGen, { min: 1, max: 3 })),
});

function buildLegacyDb(sample) {
  const legacy = new SQL.Database();
  legacy.run(LEGACY_SCHEMA[sample.version]);
  legacy.run(LEGACY_DECKS);
  legacy.run(LEGACY_TOURNAMENTS);
  if (sample.categories) legacy.run(LEGACY_FORUM_CATEGORIES);

  const users = [];
  const decks = [];
  const tournaments = [];
  sample.users.forEach((u, i) => {
    const username = `${u.name}${i}`;
    if (sample.version === "v1") {
      legacy.run("INSERT INTO users (username, password_hash, created_at, bio, avatar_url, email) VALUES (?, ?, ?, ?, ?, ?)",
        [username, u.hash, u.createdAt, u.bio, u.bio ? `/assets/avatars/${i + 1}.jpg` : null, u.email]);
    } else {
      legacy.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)", [username, u.hash, u.createdAt]);
    }
    const id = i + 1;
    users.push({
      id, username, password_hash: u.hash, created_at: u.createdAt,
      bio: sample.version === "v1" ? u.bio : "",
      avatar_url: sample.version === "v1" && u.bio ? `/assets/avatars/${i + 1}.jpg` : null,
      email: sample.version === "v1" ? u.email : null,
    });
    for (const d of u.decks) {
      legacy.run("INSERT INTO community_decks (user_id, name, alter_ego_id, main_deck, drop_pile, description) VALUES (?, ?, ?, ?, ?, ?)",
        [id, d.name, d.ae, JSON.stringify({ "ACO-0001": 4 }), JSON.stringify({ Vermelho: 10 }), d.desc]);
      decks.push({ id: decks.length + 1, user_id: id, name: d.name, alter_ego_id: d.ae, description: d.desc });
    }
    for (const t of u.tournaments) {
      legacy.run("INSERT INTO tournaments (name, format, organizer_id, status) VALUES (?, ?, ?, ?)", [t.name, t.format, id, t.status]);
      tournaments.push({ id: tournaments.length + 1, name: t.name, format: t.format, organizer_id: id, status: t.status });
    }
  });
  if (sample.categories) {
    sample.categories.forEach((name, i) => legacy.run("INSERT INTO forum_categories (name, sort_order) VALUES (?, ?)", [name, i]));
  }
  const bytes = legacy.export();
  legacy.close();
  return { bytes, users, decks, tournaments };
}

function assertMigrated(db, sample, expected, context) {
  const hasTokenVersion = db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "token_version");

  const users = db.prepare("SELECT * FROM users ORDER BY id").all();
  assert.equal(users.length, expected.users.length, `${context}: quantidade de usuarios mudou`);
  users.forEach((row, i) => {
    const want = expected.users[i];
    for (const key of ["id", "username", "password_hash", "created_at", "bio", "avatar_url", "email"]) {
      assert.equal(row[key], want[key], `${context}: users.${key} do usuario ${want.id}`);
    }
    assert.equal(row.terms_accepted_at, null, `${context}: terms_accepted_at deveria ser NULL`);
    assert.equal(row.is_judge, 0, `${context}: is_judge deveria ser 0`);
    if (hasTokenVersion) assert.equal(row.token_version, 0, `${context}: token_version deveria ser 0`);
  });

  const decks = db.prepare("SELECT id, user_id, name, alter_ego_id, description, sideboard FROM community_decks ORDER BY id").all();
  assert.deepEqual(decks, expected.decks.map((d) => ({ ...d, sideboard: "{}" })), `${context}: decks`);

  const tournaments = db.prepare("SELECT id, name, format, organizer_id, status, store_id, is_official FROM tournaments ORDER BY id").all();
  assert.deepEqual(tournaments, expected.tournaments.map((t) => ({ ...t, store_id: null, is_official: 0 })), `${context}: torneios`);

  const categories = db.prepare("SELECT name FROM forum_categories ORDER BY id").all().map((c) => c.name);
  assert.deepEqual(categories, sample.categories ?? DEFAULT_CATEGORIES, `${context}: categorias do forum`);
}

test("Migracao (3.4): banco com schema antigo abre com initDb() sem perder linhas, inclusive no segundo boot", async () => {
  await forAll(legacyGen, async (sample) => {
    for (const db of [...liveWrappers]) shutdown(db);
    rmSync(DB_PATH, { force: true });
    const expected = buildLegacyDb(sample);
    writeFileSync(DB_PATH, Buffer.from(expected.bytes));

    const first = await boot();
    assertMigrated(first, sample, expected, "primeiro boot");
    assert.equal(first.prepare("PRAGMA foreign_keys").get().foreign_keys, 0, "PRAGMA foreign_keys efetivo apos initDb()");
    shutdown(first);

    // O arquivo em disco ja tem o schema migrado e os mesmos dados.
    const diskUsers = diskRows("SELECT id, username, password_hash FROM users ORDER BY id");
    assert.deepEqual(diskUsers, expected.users.map(({ id, username, password_hash }) => ({ id, username, password_hash })), "usuarios no disco");

    const second = await boot();
    assertMigrated(second, sample, expected, "segundo boot");
    shutdown(second);
  }, { runs: 15, seed: 0x3a4f02 });
});

// ---------------------------------------------------------------------------
// PRAGMA foreign_keys efetivo (achado do design, item 3)
// ---------------------------------------------------------------------------
test("PRAGMA foreign_keys vale 0 apos initDb() e apos escritas (inserts sem pai continuam aceitos)", async () => {
  for (const db of [...liveWrappers]) shutdown(db);
  rmSync(DB_PATH, { force: true });
  const db = await boot();
  try {
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 0, "logo apos initDb()");

    // Artigo do admin (id 0, sem linha em users) — como em POST /api/admin/articles.
    const article = db.prepare(
      "INSERT INTO articles (title, slug, body, published, author_user_id, created_at, published_at) VALUES (?, ?, ?, 0, ?, ?, NULL)",
    ).run("Titulo", "titulo", "Corpo", 0, Date.now());
    assert.deepEqual(article, { changes: 1, lastInsertRowid: 1 });

    const orphanDeck = db.prepare(
      "INSERT INTO community_decks (user_id, name, alter_ego_id, main_deck, drop_pile) VALUES (?, ?, ?, ?, ?)",
    ).run(999, "orfao", "AE-0001", "{}", "{}");
    assert.equal(orphanDeck.changes, 1);

    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 0, "apos escritas");
    persist(db);
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 0, "apos gravar em disco");
  } finally {
    shutdown(db);
  }
});

// ---------------------------------------------------------------------------
// 3.16: so sql.js, sem dependencia nativa nova
// ---------------------------------------------------------------------------
test("package.json (3.16): mesmas dependencias de hoje, banco via sql.js e nenhum driver nativo", () => {
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8"));
  assert.deepEqual(Object.keys(pkg.dependencies || {}).sort(), [
    "bcryptjs", "cors", "express", "express-rate-limit", "jsonwebtoken", "multer",
    "react", "react-dom", "react-router-dom", "sharp", "sql.js",
  ]);
  assert.deepEqual(Object.keys(pkg.devDependencies || {}).sort(), ["@vitejs/plugin-react", "vite"]);
  const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  for (const native of ["better-sqlite3", "sqlite3", "sqlite", "pg", "mysql", "mysql2", "@libsql/client", "libsql"]) {
    assert.ok(!(native in all), `dependencia de banco nativa/externa encontrada: ${native}`);
  }
  assert.match(readFileSync(join(SERVER_DIR, "db.js"), "utf-8"), /from\s+["']sql\.js["']/, "server/db.js deve usar sql.js");
});

// ---------------------------------------------------------------------------
// 3.2: sem DATA_DIR, banco e segredos continuam em server/
// ---------------------------------------------------------------------------
test("Sem DATA_DIR (3.2): banco em server/deckbuilder.db e segredos em server/.jwt-secret e server/.admin-credentials.json", async () => {
  const expected = {
    DB_PATH: join(SERVER_DIR, "deckbuilder.db"),
    JWT_SECRET_PATH: join(SERVER_DIR, ".jwt-secret"),
    ADMIN_CREDENTIALS_PATH: join(SERVER_DIR, ".admin-credentials.json"),
  };

  // Codigo corrigido: constantes centralizadas em server/lib/paths.js.
  const pathsFile = join(SERVER_DIR, "lib", "paths.js");
  if (existsSync(pathsFile)) {
    const { resolvePaths } = await import(pathToFileURL(pathsFile).href);
    const resolved = resolvePaths({});
    for (const [key, value] of Object.entries(expected)) assert.equal(resolve(resolved[key]), value, `resolvePaths({}).${key}`);
    assert.equal(resolve(resolved.DATA_DIR), SERVER_DIR, "resolvePaths({}).DATA_DIR");
  }

  // Comportamento (vale nas duas versoes): processo filho sem DATA_DIR, com todas
  // as escritas em disco BLOQUEADAS (nada e gravado em server/), registrando
  // quais caminhos os modulos consultam.
  const traceFile = join(tmpdir(), `forja-dbpreserve-trace-${process.pid}-${Date.now()}.log`);
  const tracer = pathToFileURL(join(PROJECT_ROOT, "test", "helpers", "fs-trace.mjs")).href;
  const secretsUrl = pathToFileURL(join(SERVER_DIR, "secrets.js")).href;
  const dbUrl = pathToFileURL(join(SERVER_DIR, "db.js")).href;
  const script = `
    const { getJwtSecret, getAdminCredentials } = await import(${JSON.stringify(secretsUrl)});
    try { getJwtSecret(); } catch {}
    try { getAdminCredentials(); } catch {}
    const { initDb } = await import(${JSON.stringify(dbUrl)});
    try { const db = await initDb(); try { db.close?.(); } catch {} } catch {}
  `;
  const env = { ...process.env, NODE_ENV: "test", FS_TRACE_FILE: traceFile, FS_TRACE_BLOCK: "1", FS_TRACE_PROBES: "1" };
  for (const key of ["DATA_DIR", "JWT_SECRET", "ADMIN_PASSWORD", "ADMIN_USERNAME", "DB_SAVE_DELAY_MS"]) delete env[key];

  try {
    const code = await new Promise((resolveExit, reject) => {
      const child = spawn(process.execPath, ["--import", tracer, "--input-type=module", "-e", script], {
        cwd: PROJECT_ROOT, env, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (d) => { output += d; });
      child.stderr.on("data", (d) => { output += d; });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`processo filho travou: ${output}`)); }, 20000);
      child.on("exit", (c) => { clearTimeout(timer); resolveExit({ c, output }); });
    });
    assert.equal(code.c, 0, `processo filho falhou: ${code.output}`);

    const trace = readTrace(traceFile);
    const touched = new Set(trace.flatMap((e) => e.paths));
    for (const [key, value] of Object.entries(expected)) {
      assert.ok(touched.has(value), `${key}: ${value} nao foi consultado sem DATA_DIR (caminhos: ${[...touched].filter((p) => !p.includes("node_modules")).join(", ")})`);
    }
    for (const p of touched) {
      const base = p.split(sep).pop();
      if (["deckbuilder.db", ".jwt-secret", ".admin-credentials.json"].includes(base)) {
        assert.equal(dirname(p), SERVER_DIR, `${base} resolvido fora de server/: ${p}`);
      }
    }
    assert.ok(trace.filter((e) => !e.probe).every((e) => e.blocked), "toda escrita deveria ter sido bloqueada");
  } finally {
    rmSync(traceFile, { force: true });
  }
});
