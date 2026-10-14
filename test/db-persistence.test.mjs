// Bug 1.2 / Esperado 2.2 (Property 1): escritas no banco nao devem regravar o
// arquivo inteiro a cada comando. Leituras em memoria veem a escrita na hora;
// o disco so recebe o estado no flush (ou no fim da janela de debounce).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import initSqlJs from "sql.js";
import { forAll, gen } from "./helpers/prop.mjs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-dbpersist");
const DB_PATH = join(DATA_DIR, "deckbuilder.db");
// Janela de debounce longa: nenhum timer deve gravar durante o teste.
const SAVE_DELAY_MS = 60_000;

rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
// DATA_DIR precisa estar definido antes do import do modulo do banco.
process.env.DATA_DIR = DATA_DIR;
process.env.DB_SAVE_DELAY_MS = String(SAVE_DELAY_MS);

const { initDb } = await import("../server/db.js");
const SQL = await initSqlJs();

after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

function openDb() {
  // Sem argumentos o codigo original usa DATA_DIR/deckbuilder.db; o corrigido
  // aceita { dbPath, saveDelayMs } (mesmo caminho).
  return initDb({ dbPath: DB_PATH, saveDelayMs: SAVE_DELAY_MS });
}

function readDiskRows(table) {
  if (!existsSync(DB_PATH)) return null;
  const disk = new SQL.Database(readFileSync(DB_PATH));
  try {
    const res = disk.exec(`SELECT id, v FROM ${table} ORDER BY id`);
    if (res.length === 0) return [];
    return res[0].values.map(([id, v]) => ({ id, v }));
  } catch {
    return null; // tabela ainda nao existe no disco
  } finally {
    disk.close();
  }
}

function closeDb(db) {
  if (typeof db.close === "function") db.close();
}

test("50 INSERTs seguidos nao sao gravados um a um no disco", async () => {
  const db = await openDb();
  try {
    db.exec("CREATE TABLE IF NOT EXISTS persist_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL)");
    if (typeof db.flush === "function") db.flush();

    const insert = db.prepare("INSERT INTO persist_probe (v) VALUES (?)");
    for (let i = 0; i < 50; i++) insert.run(`linha-${i}`);

    // Leitura em memoria ve as 50 linhas imediatamente.
    const inMemory = db.prepare("SELECT COUNT(*) AS n FROM persist_probe").get();
    assert.equal(inMemory.n, 50);

    // O arquivo em disco ainda nao deve ter as 50 linhas (sem flush).
    const onDisk = readDiskRows("persist_probe") ?? [];
    assert.ok(
      onDisk.length < 50,
      `arquivo do banco ja contem as ${onDisk.length} linhas sem flush (gravacao sincrona por comando)`,
    );

    assert.equal(typeof db.flush, "function", "DbWrapper nao expoe flush()");
    db.flush();
    assert.equal((readDiskRows("persist_probe") ?? []).length, 50, "apos flush() o disco deve ter as 50 linhas");
  } finally {
    closeDb(db);
  }
});

const opGen = gen.oneOf(
  gen.map(gen.string({ min: 0, max: 12 }), (v) => ({ op: "insert", v })),
  gen.map(gen.string({ min: 0, max: 12 }), (v) => ({ op: "update", v })),
  gen.constant({ op: "delete" }),
  gen.constant({ op: "flush" }),
);

test("Property 1: disco reaberto = estado em memoria no ultimo flush", async () => {
  await forAll(gen.array(opGen, { min: 1, max: 15 }), async (ops) => {
    const db = await openDb();
    try {
      db.exec("CREATE TABLE IF NOT EXISTS prop_items (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL)");
      const flush = () => {
        if (typeof db.flush === "function") db.flush();
      };
      const memRows = () => db.prepare("SELECT id, v FROM prop_items ORDER BY id").all();

      flush();
      let expectedOnDisk = memRows();

      for (const step of ops) {
        if (step.op === "insert") {
          const { lastInsertRowid } = db.prepare("INSERT INTO prop_items (v) VALUES (?)").run(step.v);
          const row = db.prepare("SELECT v FROM prop_items WHERE id = ?").get(lastInsertRowid);
          assert.equal(row?.v, step.v, "leitura imediata deve ver o INSERT");
        } else if (step.op === "update") {
          db.prepare("UPDATE prop_items SET v = ? WHERE id = (SELECT MAX(id) FROM prop_items)").run(step.v);
        } else if (step.op === "delete") {
          db.prepare("DELETE FROM prop_items WHERE id = (SELECT MIN(id) FROM prop_items)").run();
        } else {
          flush();
          expectedOnDisk = memRows();
        }
      }

      assert.deepEqual(readDiskRows("prop_items"), expectedOnDisk, "disco difere do estado no ultimo flush");
    } finally {
      closeDb(db);
    }
  }, { runs: 40 });
});
