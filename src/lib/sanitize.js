/**
 * Funções de sanitização e validação de entrada.
 */

// Escapa caracteres HTML perigosos para prevenir XSS (cobre & < > " ')
const HTML_ESCAPE_MAP = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
});
const HTML_ESCAPE_RE = /[&<>"']/g;

export function escapeHtml(value) {
  return String(value).replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * Valida que um ID de carta contém apenas caracteres seguros.
 * Previne path traversal em URLs de imagem.
 */
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isSafeCardId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 30 && SAFE_ID_RE.test(id);
}

/** Retorna o caminho seguro para a imagem, ou null se o ID for inválido. */
export function safeCardImagePath(id) {
  if (!isSafeCardId(id)) return null;
  return `./assets/cards/${id}.jpg`;
}

/** Escapa metacaracteres de regex para uso seguro em new RegExp. */
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Limita o comprimento de uma string. */
export function truncateString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.slice(0, maxLength);
}
