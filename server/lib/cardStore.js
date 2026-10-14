import { existsSync, readFileSync } from "fs";
import { CARDS_JSON_PATH, SEED_CARDS_JSON_PATH } from "./paths.js";
import { writeFileAtomicSync } from "./atomicWrite.js";

/**
 * Dados das cartas (mesmo formato de src/data/modelo_cartas.json).
 *
 * A fonte de verdade e DATA_DIR/cards/modelo_cartas.json (semeado no boot).
 * Se ele nao existir (seed falhou), le a copia do repositorio como fallback
 * somente leitura. Leitura por chamada, sem cache (arquivo pequeno).
 */
export function readCardData() {
  const source = existsSync(CARDS_JSON_PATH) ? CARDS_JSON_PATH : SEED_CARDS_JSON_PATH;
  return JSON.parse(readFileSync(source, "utf-8"));
}

/** Grava os dados das cartas em DATA_DIR de forma atomica. */
export function writeCardData(data) {
  writeFileAtomicSync(CARDS_JSON_PATH, JSON.stringify(data, null, 2));
}
