import { Router } from "express";
import { buildPublicMeta } from "../lib/metaAnalytics.js";
import { readCardData } from "../lib/cardStore.js";

const router = Router();

// O meta e calculado sobre todos os decks publicados e todos os torneios
// finalizados. Em memoria por um minuto para nao refazer a conta a cada visita.
// Nos testes (NODE_ENV=test) o cache fica desligado.
const CACHE_TTL_MS = process.env.NODE_ENV === "test" ? 0 : 60 * 1000;
const cache = new Map(); // escopo -> { at, value }

export function clearMetaCache() {
  cache.clear();
}

function loadParticipations(db, officialOnly) {
  const officialClause = officialOnly ? "AND t.is_official = 1" : "";
  const rows = db.prepare(`
    SELECT tp.id AS tp_id, cd.main_deck, cd.alter_ego_id,
      SUM(CASE WHEN (tm.player1_id = tp.id AND tm.result = 'player1') OR (tm.player2_id = tp.id AND tm.result = 'player2') OR (tm.result = 'bye' AND tm.player1_id = tp.id) THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN (tm.player1_id = tp.id AND tm.result = 'player2') OR (tm.player2_id = tp.id AND tm.result = 'player1') THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN tm.result = 'draw' THEN 1 ELSE 0 END) AS draws
    FROM tournament_players tp
    JOIN tournaments t ON t.id = tp.tournament_id AND t.status = 'finalizado' ${officialClause}
    JOIN community_decks cd ON cd.id = tp.deck_id
    JOIN tournament_matches tm ON tm.tournament_id = t.id AND (tm.player1_id = tp.id OR tm.player2_id = tp.id) AND tm.result != 'pending'
    GROUP BY tp.id
  `).all();
  return rows.map((r) => ({
    mainDeck: r.main_deck,
    alterEgoId: r.alter_ego_id,
    wins: r.wins || 0,
    losses: r.losses || 0,
    draws: r.draws || 0,
  }));
}

/**
 * GET /api/meta — metagame publico (sem login).
 * Query: oficial=1 restringe o desempenho aos torneios oficiais.
 * So expoe dados ja publicos: decks publicados e resultados de torneio.
 */
router.get("/", (req, res) => {
  try {
    const officialOnly = req.query.oficial === "1" || req.query.oficial === "true";
    const scope = officialOnly ? "oficial" : "todos";
    const cached = cache.get(scope);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      res.set("Cache-Control", "public, max-age=60");
      return res.json(cached.value);
    }

    const communityDecks = req.db
      .prepare("SELECT alter_ego_id, main_deck FROM community_decks")
      .all();
    const deckParticipations = loadParticipations(req.db, officialOnly);

    let cardIndex = new Map();
    try {
      cardIndex = new Map(readCardData().cards.map((c) => [c.id, c]));
    } catch { /* sem dados de cartas: usa os ids */ }

    const value = { scope, ...buildPublicMeta({ communityDecks, deckParticipations, cardIndex }) };
    cache.set(scope, { at: Date.now(), value });
    res.set("Cache-Control", "public, max-age=60");
    res.json(value);
  } catch (err) {
    console.error("[meta] error:", err);
    res.status(500).json({ error: "Erro ao calcular o metagame." });
  }
});

export default router;
