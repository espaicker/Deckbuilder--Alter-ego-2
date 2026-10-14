// Bug 1.5 / Esperado 2.5 (Property 3): snapshots periodicos com rotacao em
// DATA_DIR/backups. So os K mais recentes ficam; arquivos que nao sao
// snapshots nunca sao apagados.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { forAll, gen } from "./helpers/prop.mjs";

const BASE = fs.mkdtempSync(join(tmpdir(), "forja-backup-"));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

const SQL = await initSqlJs();
const SNAPSHOT_RE = /^deckbuilder-\d{8}T\d{6}Z\.db$/;
const STRANGE_FILES = [
  "notas.txt",
  "deckbuilder-manual.db",
  "deckbuilder-20240101.db",
  "outro-20240101T000000Z.db",
  "deckbuilder-20240101T000000Z.db.bak",
];

async function loadModule() {
  // No codigo sem correcao o modulo nao existe: nao ha backup nenhum.
  return import("../server/lib/backup.js");
}

function snapshotName(date) {
  const iso = date.toISOString(); // 2024-01-02T03:04:05.000Z
  return `deckbuilder-${iso.slice(0, 19).replace(/[-:]/g, "")}Z.db`;
}

/** Banco sql.js real exposto pelo contrato usado no backup: serialize(). */
function makeDb() {
  const raw = new SQL.Database();
  raw.run("CREATE TABLE marks (n INTEGER NOT NULL)");
  return { raw, serialize: () => raw.export() };
}

test("Property 3: mantem exatamente os min(N, K) snapshots mais recentes", async () => {
  const { createSnapshot } = await loadModule();
  let caseNo = 0;

  await forAll(
    gen.record({
      n: gen.int(1, 12),
      keep: gen.int(1, 8),
      gapsSec: gen.array(gen.int(1, 90_000), { min: 12, max: 12 }),
      strange: gen.subset(STRANGE_FILES),
    }),
    ({ n, keep, gapsSec, strange }) => {
      const backupsDir = join(BASE, `caso-${caseNo++}`, "backups");
      fs.mkdirSync(backupsDir, { recursive: true });
      for (const name of strange) fs.writeFileSync(join(backupsDir, name), `conteudo de ${name}`);

      const db = makeDb();
      const created = [];
      let t = Date.UTC(2024, 0, 1, 0, 0, 0);
      for (let i = 0; i < n; i++) {
        t += gapsSec[i] * 1000;
        db.raw.run("INSERT INTO marks (n) VALUES (?)", [i]);
        const now = new Date(t);
        createSnapshot(db, { backupsDir, keep, now });
        created.push({ name: snapshotName(now), lastMark: i });
      }

      const expected = created.slice(-Math.min(n, keep));
      const snapshots = fs.readdirSync(backupsDir).filter((f) => SNAPSHOT_RE.test(f)).sort();
      assert.deepEqual(snapshots, expected.map((s) => s.name).sort());

      for (const snap of expected) {
        const reopened = new SQL.Database(fs.readFileSync(join(backupsDir, snap.name)));
        try {
          const [{ values }] = reopened.exec("SELECT COUNT(*), MAX(n) FROM marks");
          assert.deepEqual(values[0], [snap.lastMark + 1, snap.lastMark], `conteudo de ${snap.name}`);
        } finally {
          reopened.close();
        }
      }

      for (const name of strange) {
        assert.equal(fs.readFileSync(join(backupsDir, name), "utf-8"), `conteudo de ${name}`, `${name} foi alterado`);
      }
      db.raw.close();
    },
    { runs: 30 },
  );
});

test("resolveBackupConfig: desligado em NODE_ENV=test, salvo BACKUP_ENABLED=1|true", async () => {
  const { resolveBackupConfig } = await loadModule();
  assert.equal(resolveBackupConfig({ NODE_ENV: "test" }).enabled, false);
  assert.equal(resolveBackupConfig({ NODE_ENV: "test", BACKUP_ENABLED: "1" }).enabled, true);
  assert.equal(resolveBackupConfig({ NODE_ENV: "test", BACKUP_ENABLED: "true" }).enabled, true);
  assert.equal(resolveBackupConfig({ NODE_ENV: "production" }).enabled, true);
});
