// Bugs 1.6, 1.7 / Esperado 2.7 (Property 4): o seed de DATA_DIR cria so o
// que falta (JSON de cartas, imagens de cartas, avatares) a partir das copias
// do repositorio e nunca altera arquivos ja existentes em DATA_DIR.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { forAll, gen } from "./helpers/prop.mjs";

const BASE = fs.mkdtempSync(join(tmpdir(), "forja-seed-"));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

async function loadModule() {
  // No codigo sem correcao o modulo nao existe: nada e semeado em DATA_DIR.
  return import("../server/lib/seedData.js");
}

const hash = (buf) => createHash("sha256").update(buf).digest("hex");

/** Mapa caminho-relativo -> sha256 de todos os arquivos sob `root`. */
function snapshotTree(root) {
  const out = {};
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[relative(root, full).replace(/\\/g, "/")] = hash(fs.readFileSync(full));
    }
  };
  walk(root);
  return out;
}

function writeFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(join(dir, name), content);
}

function makePaths(caseDir) {
  const repo = join(caseDir, "repo");
  const dataDir = join(caseDir, "data");
  return {
    DATA_DIR: dataDir,
    CARDS_JSON_PATH: join(dataDir, "cards", "modelo_cartas.json"),
    CARDS_IMG_DIR: join(dataDir, "assets", "cards"),
    AVATARS_DIR: join(dataDir, "assets", "avatars"),
    BACKUPS_DIR: join(dataDir, "backups"),
    DB_PATH: join(dataDir, "deckbuilder.db"),
    SEED_CARDS_JSON_PATH: join(repo, "src", "data", "modelo_cartas.json"),
    PUBLIC_CARDS_IMG_DIR: join(repo, "public", "assets", "cards"),
    PUBLIC_AVATARS_DIR: join(repo, "public", "assets", "avatars"),
    _repo: repo,
  };
}

const fileSetGen = (names) =>
  gen.map(gen.subset(names), (picked, rng) => {
    const files = {};
    for (const name of picked) files[name] = gen.bytes({ min: 0, max: 128 })(rng);
    return files;
  });

// Estado do diretorio em DATA_DIR: ausente, vazio ou com alguns arquivos
// (alguns com o mesmo nome dos do repositorio, mas conteudo diferente).
const dirStateGen = (names) =>
  gen.oneOf(gen.constant(null), gen.constant({}), fileSetGen(names));

test("Property 4: seed cria so o que falta e nunca altera bytes existentes", async () => {
  const { seedDataDir } = await loadModule();
  let caseNo = 0;

  await forAll(
    gen.record({
      seedJson: gen.map(gen.string({ min: 2, max: 40 }), (s) => JSON.stringify({ cards: [], colors: [], types: {}, tag: s })),
      seedCards: fileSetGen(["ACA-0001.jpg", "ACA-0002.jpg", "AE-0001.jpg", "82.jpg"]),
      seedAvatars: fileSetGen(["1.jpg", "2.jpg"]),
      existingJson: gen.oneOf(gen.constant(null), gen.bytes({ min: 0, max: 128 })),
      existingCards: dirStateGen(["ACA-0001.jpg", "TST-0001.jpg", "outra.jpg"]),
      existingAvatars: dirStateGen(["1.jpg", "7.jpg"]),
    }),
    (sample) => {
      const caseDir = join(BASE, `caso-${caseNo++}`);
      const paths = makePaths(caseDir);

      // "Repositorio" de origem do seed.
      fs.mkdirSync(join(paths._repo, "src", "data"), { recursive: true });
      fs.writeFileSync(paths.SEED_CARDS_JSON_PATH, sample.seedJson);
      writeFiles(paths.PUBLIC_CARDS_IMG_DIR, sample.seedCards);
      writeFiles(paths.PUBLIC_AVATARS_DIR, sample.seedAvatars);

      // Estado pre-existente em DATA_DIR.
      fs.mkdirSync(paths.DATA_DIR, { recursive: true });
      if (sample.existingJson) {
        fs.mkdirSync(join(paths.DATA_DIR, "cards"), { recursive: true });
        fs.writeFileSync(paths.CARDS_JSON_PATH, sample.existingJson);
      }
      if (sample.existingCards) writeFiles(paths.CARDS_IMG_DIR, sample.existingCards);
      if (sample.existingAvatars) writeFiles(paths.AVATARS_DIR, sample.existingAvatars);

      const before = snapshotTree(paths.DATA_DIR);
      const repoBefore = snapshotTree(paths._repo);

      const { _repo, ...seedPaths } = paths;
      seedDataDir(seedPaths);
      const afterFirst = snapshotTree(paths.DATA_DIR);

      // Nada que ja existia mudou.
      for (const [file, digest] of Object.entries(before)) {
        assert.equal(afterFirst[file], digest, `arquivo existente alterado: ${file}`);
      }

      // JSON de cartas: existe; se nao existia, e a copia do repositorio.
      assert.ok(fs.existsSync(paths.CARDS_JSON_PATH), "JSON de cartas nao foi criado em DATA_DIR");
      if (!sample.existingJson) {
        assert.equal(fs.readFileSync(paths.CARDS_JSON_PATH, "utf-8"), sample.seedJson);
      }

      // Imagens de cartas: se o diretorio nao existia, recebe todas as do repositorio.
      assert.ok(fs.existsSync(paths.CARDS_IMG_DIR), "diretorio de imagens de cartas nao foi criado");
      if (!sample.existingCards) {
        for (const [name, content] of Object.entries(sample.seedCards)) {
          assert.equal(afterFirst[`assets/cards/${name}`], hash(content), `imagem ${name} nao semeada`);
        }
      }

      // Avatares: diretorio existe; se nao existia, recebe os do repositorio.
      assert.ok(fs.existsSync(paths.AVATARS_DIR), "diretorio de avatares nao foi criado");
      if (!sample.existingAvatars) {
        for (const [name, content] of Object.entries(sample.seedAvatars)) {
          assert.equal(afterFirst[`assets/avatars/${name}`], hash(content), `avatar ${name} nao semeado`);
        }
      }

      // Segunda execucao nao muda nada; o repositorio nunca e alterado.
      seedDataDir(seedPaths);
      assert.deepEqual(snapshotTree(paths.DATA_DIR), afterFirst, "segunda execucao alterou DATA_DIR");
      assert.deepEqual(snapshotTree(paths._repo), repoBefore, "seed alterou arquivos do repositorio");
    },
    { runs: 40 },
  );
});
