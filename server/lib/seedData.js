import { existsSync, mkdirSync, copyFileSync, cpSync, constants } from "fs";
import { dirname } from "path";
import defaultPaths from "./paths.js";

/**
 * Semeia DATA_DIR na primeira inicializacao a partir das copias do
 * repositorio: JSON de cartas, imagens de cartas e avatares. So cria o que
 * falta e NUNCA sobrescreve arquivos que ja existem em DATA_DIR.
 *
 * Depois do seed, DATA_DIR e a fonte de verdade: cartas novas adicionadas ao
 * JSON do repositorio em deploys futuros nao sao mescladas automaticamente
 * (imagens novas do repositorio continuam acessiveis pelo fallback de
 * public/ e dist/).
 *
 * `paths` tem o formato de resolvePaths() (server/lib/paths.js).
 */
export function seedDataDir(paths = defaultPaths, { log = console.log } = {}) {
  const { DATA_DIR, CARDS_JSON_PATH, CARDS_IMG_DIR, AVATARS_DIR, SEED_CARDS_JSON_PATH, PUBLIC_CARDS_IMG_DIR, PUBLIC_AVATARS_DIR } = paths;
  const criados = [];

  for (const dir of [DATA_DIR, dirname(CARDS_JSON_PATH), dirname(CARDS_IMG_DIR)]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // JSON de cartas: copia exclusiva (nunca sobrescreve).
  if (!existsSync(CARDS_JSON_PATH) && existsSync(SEED_CARDS_JSON_PATH)) {
    try {
      copyFileSync(SEED_CARDS_JSON_PATH, CARDS_JSON_PATH, constants.COPYFILE_EXCL);
      criados.push(CARDS_JSON_PATH);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }

  // Imagens de cartas: so na primeira vez (diretorio ainda nao existe).
  if (!existsSync(CARDS_IMG_DIR)) {
    if (PUBLIC_CARDS_IMG_DIR && existsSync(PUBLIC_CARDS_IMG_DIR)) {
      cpSync(PUBLIC_CARDS_IMG_DIR, CARDS_IMG_DIR, { recursive: true, force: false, errorOnExist: false });
    }
    if (!existsSync(CARDS_IMG_DIR)) mkdirSync(CARDS_IMG_DIR, { recursive: true });
    criados.push(CARDS_IMG_DIR);
  }

  // Avatares: cria o diretorio; copia os do repositorio so se acabou de criar.
  if (!existsSync(AVATARS_DIR)) {
    mkdirSync(AVATARS_DIR, { recursive: true });
    if (PUBLIC_AVATARS_DIR && existsSync(PUBLIC_AVATARS_DIR)) {
      cpSync(PUBLIC_AVATARS_DIR, AVATARS_DIR, { recursive: true, force: false, errorOnExist: false });
    }
    criados.push(AVATARS_DIR);
  }

  if (criados.length > 0 && log) {
    log(`[seed] Dados iniciais criados em ${DATA_DIR}: ${criados.map((p) => p.slice(DATA_DIR.length + 1).replace(/\\/g, "/")).join(", ")}`);
  }
  return { criados };
}
