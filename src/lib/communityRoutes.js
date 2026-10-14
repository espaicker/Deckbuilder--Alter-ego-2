/**
 * URLs compartilhaveis da Comunidade.
 *
 *   /comunidade                      -> decklists
 *   /comunidade/<aba>                -> noticias, decks, torneios, ranking, meta, forum, lojas, perfil
 *   /comunidade/decks/<id>           -> detalhe de um deck publicado
 *   /comunidade/torneios/<id>        -> detalhe de um torneio
 *   /comunidade/jogadores/<usuario>  -> perfil publico de um jogador
 *
 * Funcoes puras (sem React) para poderem ser testadas com node:test.
 */

// chave interna da aba -> trecho da URL
const SLUG_BY_SUBTAB = {
  noticias: "noticias",
  decklists: "decks",
  torneios: "torneios",
  ranking: "ranking",
  meta: "meta",
  forum: "forum",
  lojas: "lojas",
  perfil: "perfil",
};
const SUBTAB_BY_SLUG = Object.fromEntries(Object.entries(SLUG_BY_SUBTAB).map(([k, v]) => [v, k]));

export const DEFAULT_SUBTAB = "decklists";

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function positiveInt(segment) {
  return /^\d+$/.test(segment) && Number(segment) > 0 ? Number(segment) : null;
}

/** Le o caminho atual e devolve { subtab, deckId, tournamentId, username }. */
export function parseCommunityPath(pathname) {
  const route = { subtab: DEFAULT_SUBTAB, deckId: null, tournamentId: null, username: null };
  const parts = String(pathname || "").split("/").filter(Boolean);
  if (parts[0] !== "comunidade") return route;
  const [, slug, param] = parts;
  if (!slug) return route;

  if (slug === "jogadores") {
    route.subtab = "ranking";
    route.username = param ? decodeSegment(param) : null;
    return route;
  }
  const subtab = SUBTAB_BY_SLUG[slug];
  if (!subtab) return route;
  route.subtab = subtab;
  if (param && subtab === "decklists") route.deckId = positiveInt(param);
  if (param && subtab === "torneios") route.tournamentId = positiveInt(param);
  return route;
}

export function subtabPath(subtab) {
  const slug = SLUG_BY_SUBTAB[subtab];
  return slug && subtab !== DEFAULT_SUBTAB ? `/comunidade/${slug}` : "/comunidade";
}

export const deckPath = (id) => `/comunidade/decks/${encodeURIComponent(id)}`;
export const tournamentPath = (id) => `/comunidade/torneios/${encodeURIComponent(id)}`;
export const playerPath = (username) => `/comunidade/jogadores/${encodeURIComponent(username)}`;
