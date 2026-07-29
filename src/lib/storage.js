/**
 * Módulo de persistência local (localStorage).
 *
 * Centraliza o acesso ao localStorage com:
 * - Tratamento de erros (quota excedida, dados corrompidos)
 * - Parse seguro de JSON
 * - Validação de tamanho de valor
 */

const MAX_VALUE_SIZE = 1024 * 512; // 512KB por chave
const STORAGE_PREFIX = "deckbuilder:";

function prefixedKey(key) {
  return `${STORAGE_PREFIX}${key}`;
}

/**
 * Tenta fazer JSON.parse de forma segura.
 * Retorna null se o valor for inválido.
 */
export function safeJsonParse(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Lê um valor do localStorage.
 * @returns {{ key: string, value: string }} ou lança Error se não encontrado
 */
export async function storageGet(key) {
  if (typeof key !== "string" || !key) {
    throw new Error("Chave inválida");
  }
  const value = window.localStorage.getItem(prefixedKey(key));
  if (value === null) {
    throw new Error("not found");
  }
  return { key, value };
}

/**
 * Grava um valor no localStorage.
 * Valida tamanho antes de gravar para evitar QuotaExceededError silencioso.
 * @returns {{ key: string, value: string }}
 */
export async function storageSet(key, value) {
  if (typeof key !== "string" || !key) {
    throw new Error("Chave inválida");
  }
  if (typeof value !== "string") {
    throw new Error("Valor deve ser uma string");
  }
  if (value.length > MAX_VALUE_SIZE) {
    throw new Error("Valor excede o tamanho máximo permitido");
  }
  try {
    window.localStorage.setItem(prefixedKey(key), value);
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      throw new Error("Espaço de armazenamento cheio. Remova decks salvos antigos.");
    }
    throw error;
  }
  return { key, value };
}

/**
 * Remove um valor do localStorage.
 * @returns {{ key: string, deleted: boolean }}
 */
export async function storageDelete(key) {
  if (typeof key !== "string" || !key) {
    throw new Error("Chave inválida");
  }
  window.localStorage.removeItem(prefixedKey(key));
  return { key, deleted: true };
}

/**
 * Objeto de storage com interface compatível ao código legado.
 */
export const storage = {
  get: storageGet,
  set: storageSet,
  delete: storageDelete,
};
