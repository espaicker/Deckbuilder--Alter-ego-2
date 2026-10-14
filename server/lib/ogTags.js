/**
 * Pre-visualizacao de links (Open Graph / Twitter) para as paginas
 * compartilhaveis. Robos de WhatsApp, Discord etc. nao executam JavaScript,
 * entao o servidor injeta as tags no index.html antes de envia-lo.
 *
 * Tudo que vem do banco passa por escapeHtml.
 */
import { escapeHtml } from "./emailTemplates.js";

export const SITE_NAME = "Forja de Alter Egos";
export const DEFAULT_META = {
  title: "Forja de Alter Egos — Deck Builder",
  description: "Monte, compartilhe e compare decks de Alter Ego. Torneios, ranking e metagame da comunidade.",
  image: "/assets/cards/AE-0001.jpg",
  type: "website",
};

const MAX_DESCRIPTION = 200;

const FORMAT_LABELS = {
  swiss: "Suíço",
  swiss_topcut: "Suíço + Mata-mata",
  single_elim: "Eliminação simples",
};
const STATUS_LABELS = {
  inscricao: "Inscrições abertas",
  em_andamento: "Em andamento",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

/** Origem publica do site (sem barra final), ou null se nao configurada. */
export function resolveSiteUrl(env = process.env) {
  for (const raw of [env.SITE_URL, env.RENDER_EXTERNAL_URL]) {
    if (!raw) continue;
    try {
      const url = new URL(String(raw).trim());
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch { /* ignora valor invalido */ }
  }
  return null;
}

function truncate(text, max = MAX_DESCRIPTION) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function deckMeta(db, id, cardIndex) {
  const deck = db.prepare(`
    SELECT d.name, d.alter_ego_id, d.description, u.username AS author
    FROM community_decks d JOIN users u ON u.id = d.user_id
    WHERE d.id = ?
  `).get(id);
  if (!deck) return null;
  const ae = cardIndex ? cardIndex.get(deck.alter_ego_id) : null;
  const aeName = ae ? ae.name : deck.alter_ego_id;
  const base = `Deck de ${deck.author} com ${aeName}.`;
  return {
    title: `${deck.name} — deck de ${aeName}`,
    description: truncate(deck.description ? `${base} ${deck.description}` : `${base} Veja a lista completa, o sideboard e compare com outros decks.`),
    image: `/assets/cards/${encodeURIComponent(deck.alter_ego_id)}.jpg`,
    type: "article",
  };
}

function profileMeta(db, username) {
  const user = db.prepare("SELECT username, bio, avatar_url FROM users WHERE username = ?").get(username);
  if (!user) return null;
  return {
    title: `${user.username} — perfil de jogador`,
    description: truncate(user.bio || `Decks, torneios e estatísticas de ${user.username} na ${SITE_NAME}.`),
    image: user.avatar_url || DEFAULT_META.image,
    type: "profile",
  };
}

function tournamentMeta(db, id) {
  const t = db.prepare(`
    SELECT t.name, t.format, t.status, t.is_official, s.name AS store_name, s.city AS store_city,
      (SELECT COUNT(*) FROM tournament_players tp WHERE tp.tournament_id = t.id) AS players
    FROM tournaments t LEFT JOIN stores s ON s.id = t.store_id
    WHERE t.id = ?
  `).get(id);
  if (!t) return null;
  const parts = [
    `Torneio ${FORMAT_LABELS[t.format] || t.format}`,
    STATUS_LABELS[t.status] || t.status,
    `${t.players} jogador${t.players === 1 ? "" : "es"}`,
  ];
  if (t.is_official) parts.push("Oficial");
  if (t.store_name) parts.push(t.store_city ? `${t.store_name} (${t.store_city})` : t.store_name);
  return {
    title: `${t.name} — torneio`,
    description: truncate(parts.join(" · ")),
    image: DEFAULT_META.image,
    type: "website",
  };
}

/**
 * Metadados da pagina para um caminho da SPA. Caminhos desconhecidos ou
 * recursos inexistentes caem no padrao do site.
 */
export function resolveOgMeta(pathname, { db, cardIndex } = {}) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  let meta = null;
  try {
    let m;
    if (db && (m = path.match(/^\/comunidade\/decks\/(\d+)$/))) {
      meta = deckMeta(db, Number(m[1]), cardIndex);
    } else if (db && (m = path.match(/^\/comunidade\/jogadores\/([^/]+)$/))) {
      const username = safeDecode(m[1]);
      if (username) meta = profileMeta(db, username);
    } else if (db && (m = path.match(/^\/comunidade\/torneios\/(\d+)$/))) {
      meta = tournamentMeta(db, Number(m[1]));
    } else if (path === "/comunidade/meta") {
      meta = {
        title: "Metagame — Alter Egos mais jogados",
        description: "Participação de cada Alter Ego nos decks da comunidade, taxa de vitória em torneios e a lista típica de cada arquétipo.",
        image: DEFAULT_META.image,
        type: "website",
      };
    }
  } catch (err) {
    console.error("[og] Falha ao montar a pre-visualizacao:", err?.message || err);
    meta = null;
  }
  return meta || DEFAULT_META;
}

const STRIP_TAGS_RE = /\s*<meta\s+(?:name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>/gi;

/**
 * Devolve o HTML com <title>, description, Open Graph e Twitter Card da
 * pagina. Remove as tags padrao que ja existirem para nao duplicar.
 */
export function renderHtmlWithMeta(html, meta, { siteUrl = null, pathname = "/" } = {}) {
  const m = { ...DEFAULT_META, ...meta };
  const title = m.title === DEFAULT_META.title ? m.title : `${m.title} | ${SITE_NAME}`;
  const absolute = (url) => {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    return siteUrl ? `${siteUrl}${url.startsWith("/") ? "" : "/"}${url}` : null;
  };
  const image = absolute(m.image);
  const pageUrl = siteUrl ? `${siteUrl}${String(pathname).startsWith("/") ? "" : "/"}${pathname}` : null;

  const tags = [
    `<meta name="description" content="${escapeHtml(m.description)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:type" content="${escapeHtml(m.type)}" />`,
    `<meta property="og:title" content="${escapeHtml(m.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(m.description)}" />`,
    `<meta property="og:locale" content="pt_BR" />`,
  ];
  if (pageUrl) tags.push(`<meta property="og:url" content="${escapeHtml(pageUrl)}" />`);
  if (image) tags.push(`<meta property="og:image" content="${escapeHtml(image)}" />`);
  tags.push(`<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`);
  tags.push(`<meta name="twitter:title" content="${escapeHtml(m.title)}" />`);
  tags.push(`<meta name="twitter:description" content="${escapeHtml(m.description)}" />`);
  if (image) tags.push(`<meta name="twitter:image" content="${escapeHtml(image)}" />`);

  let out = String(html).replace(STRIP_TAGS_RE, "");
  const titleTag = `<title>${escapeHtml(title)}</title>`;
  out = /<title>[\s\S]*?<\/title>/i.test(out)
    ? out.replace(/<title>[\s\S]*?<\/title>/i, () => titleTag)
    : out.replace(/<\/head>/i, () => `    ${titleTag}\n  </head>`);
  const block = tags.map((t) => `    ${t}`).join("\n");
  return out.replace(/<\/head>/i, () => `${block}\n  </head>`);
}
