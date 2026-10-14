import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

/**
 * Fonte unica dos caminhos de dados do servidor.
 *
 * DATA_DIR aponta para o diretorio de dados mutaveis (banco, segredos,
 * cartas, imagens de cartas, avatares e backups). Em producao no Render e
 * o disco persistente montado em /data. Sem a variavel, usa a propria pasta
 * server/ (desenvolvimento local e testes), com os mesmos nomes de sempre.
 *
 * As copias do repositorio (src/data, public/assets, dist/) so servem de
 * seed/fallback e nunca sao alteradas pelo servidor.
 */
export const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PROJECT_ROOT = resolve(SERVER_DIR, "..");

/** Funcao pura: deriva todos os caminhos a partir de `env` (testavel). */
export function resolvePaths(env = process.env) {
  const DATA_DIR = resolve(env.DATA_DIR || SERVER_DIR);
  return {
    SERVER_DIR,
    PROJECT_ROOT,
    DATA_DIR,
    DB_PATH: join(DATA_DIR, "deckbuilder.db"),
    JWT_SECRET_PATH: join(DATA_DIR, ".jwt-secret"),
    ADMIN_CREDENTIALS_PATH: join(DATA_DIR, ".admin-credentials.json"),
    CARDS_JSON_PATH: join(DATA_DIR, "cards", "modelo_cartas.json"),
    CARDS_IMG_DIR: join(DATA_DIR, "assets", "cards"),
    AVATARS_DIR: join(DATA_DIR, "assets", "avatars"),
    BACKUPS_DIR: join(DATA_DIR, "backups"),
    SEED_CARDS_JSON_PATH: join(PROJECT_ROOT, "src", "data", "modelo_cartas.json"),
    PUBLIC_CARDS_IMG_DIR: join(PROJECT_ROOT, "public", "assets", "cards"),
    PUBLIC_AVATARS_DIR: join(PROJECT_ROOT, "public", "assets", "avatars"),
    DIST_DIR: join(PROJECT_ROOT, "dist"),
  };
}

const paths = resolvePaths(process.env);

export default paths;
export const {
  DATA_DIR,
  DB_PATH,
  JWT_SECRET_PATH,
  ADMIN_CREDENTIALS_PATH,
  CARDS_JSON_PATH,
  CARDS_IMG_DIR,
  AVATARS_DIR,
  BACKUPS_DIR,
  SEED_CARDS_JSON_PATH,
  PUBLIC_CARDS_IMG_DIR,
  PUBLIC_AVATARS_DIR,
  DIST_DIR,
} = paths;

/** Garante que DATA_DIR existe (so cria se faltar). */
export function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}
