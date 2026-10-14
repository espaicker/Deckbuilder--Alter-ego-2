// Bug 1.3 / Esperado 2.3, 2.8 (Property 2): gravacao atomica. Em qualquer
// falha (escrita, fsync, rename), o destino continua sendo a versao anterior
// completa ou a nova completa, e nenhum temporario fica para tras.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forAll, gen } from "./helpers/prop.mjs";

const BASE = fs.mkdtempSync(join(tmpdir(), "forja-atomic-"));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

async function loadModule() {
  // No codigo sem correcao o modulo nao existe (_save() grava direto no destino).
  return import("../server/lib/atomicWrite.js");
}

function injectFailure(step) {
  if (step === "none") return fs;
  return {
    ...fs,
    [step]: () => {
      const err = new Error(`falha injetada em ${step}`);
      err.code = "EIO";
      throw err;
    },
  };
}

function tempFilesIn(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"));
}

const contentGen = gen.oneOf(
  gen.constant(Buffer.alloc(0)),
  gen.map(gen.string({ min: 1, max: 64 }), (s) => Buffer.from(s, "utf-8")),
  gen.bytes({ min: 1, max: 512 }),
  gen.bytes({ min: 64 * 1024, max: 256 * 1024 }),
);

test("Property 2: destino e sempre a versao anterior ou a nova, sem .tmp restante", async () => {
  const { writeFileAtomicSync } = await loadModule();
  let caseNo = 0;

  await forAll(
    gen.record({
      previous: gen.oneOf(gen.constant(null), contentGen),
      next: contentGen,
      failAt: gen.elements(["none", "writeSync", "fsyncSync", "renameSync"]),
    }),
    ({ previous, next, failAt }) => {
      const dir = join(BASE, `caso-${caseNo++}`);
      fs.mkdirSync(dir, { recursive: true });
      const target = join(dir, "deckbuilder.db");
      if (previous) fs.writeFileSync(target, previous);

      const fsImpl = injectFailure(failAt);
      if (failAt === "none") {
        writeFileAtomicSync(target, next, { fsImpl });
        assert.ok(fs.readFileSync(target).equals(next), "destino deve conter a versao nova");
      } else {
        assert.throws(() => writeFileAtomicSync(target, next, { fsImpl }), /falha injetada/);
        if (previous) {
          assert.ok(fs.readFileSync(target).equals(previous), "destino deve continuar com a versao anterior");
        } else {
          assert.equal(fs.existsSync(target), false, "destino nao deveria ter sido criado");
        }
      }
      assert.deepEqual(tempFilesIn(dir), [], "nenhum arquivo temporario deve restar");
    },
    { runs: 60 },
  );
});

test("cleanupStaleTemps remove so os temporarios do arquivo indicado", async () => {
  const { cleanupStaleTemps } = await loadModule();
  const dir = join(BASE, "cleanup");
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    ".deckbuilder.db.123.1700000000000.ab12.tmp": "lixo1",
    ".deckbuilder.db.999.1700000000001.cd34.tmp": "lixo2",
    ".modelo_cartas.json.5.1700000000002.ef56.tmp": "outro arquivo",
    "deckbuilder.db": "banco",
    "notas.tmp": "nao e temporario do banco",
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(join(dir, name), content);

  cleanupStaleTemps(dir, "deckbuilder.db");

  assert.deepEqual(fs.readdirSync(dir).sort(), [
    ".modelo_cartas.json.5.1700000000002.ef56.tmp",
    "deckbuilder.db",
    "notas.tmp",
  ].sort());
  assert.equal(fs.readFileSync(join(dir, "deckbuilder.db"), "utf-8"), "banco");
});
