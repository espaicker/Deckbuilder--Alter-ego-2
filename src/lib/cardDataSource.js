/**
 * Dados das cartas em tempo de execucao: o frontend busca GET /api/cards
 * (dados atuais em DATA_DIR, inclusive edicoes do admin feitas depois do
 * build) e usa o JSON embutido no build apenas como fallback.
 *
 * Modulo puro (sem React), testavel em Node.
 */

export const CARDS_ENDPOINT = "/api/cards";

/** Formato minimo de src/data/modelo_cartas.json. */
export function isValidCardData(data) {
  return (
    !!data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Array.isArray(data.cards) &&
    Array.isArray(data.colors) &&
    !!data.types &&
    typeof data.types === "object" &&
    !Array.isArray(data.types)
  );
}

/**
 * Busca os dados das cartas na API. Qualquer falha (rede, status != 200,
 * JSON invalido, formato invalido ou timeout) devolve o `fallback`.
 * @returns {Promise<{ data: object, source: "api" | "bundled" }>}
 */
export async function fetchCardData({ fallback, fetchImpl = globalThis.fetch, timeoutMs = 5000, url = CARDS_ENDPOINT } = {}) {
  const bundled = { data: fallback, source: "bundled" };
  if (typeof fetchImpl !== "function") return bundled;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  const request = (async () => {
    const res = await fetchImpl(url, { signal: controller?.signal, headers: { Accept: "application/json" } });
    if (!res || res.status !== 200) return null;
    const data = await res.json();
    return isValidCardData(data) ? data : null;
  })().catch(() => null);

  try {
    const data = await Promise.race([request, timeout]);
    return data ? { data, source: "api" } : bundled;
  } finally {
    clearTimeout(timer);
  }
}
