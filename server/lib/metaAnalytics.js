/**
 * Modulo puro de analytics de metagame.
 * Sem efeitos colaterais - testavel isoladamente.
 */

const LOW_SAMPLE_THRESHOLD = 10;

/**
 * @param {Object} params
 * @param {Array} params.deckParticipations - [{mainDeck:{cardId:qty}, alterEgoId, wins, losses, draws}]
 * @param {Map} params.cardIndex - Map<cardId, {name, type, subtype, colors}>
 * @returns {{ cardStats: Array, archetypeStats: Array }}
 */
export function computeMetaStats({ deckParticipations, cardIndex }) {
  if (!deckParticipations || deckParticipations.length === 0) {
    return { cardStats: [], archetypeStats: [] };
  }

  const totalDecks = deckParticipations.length;
  const cardMap = {}; // cardId -> {timesIncluded, totalGames, wins, losses, draws}
  const aeMap = {};   // alterEgoId -> same structure

  for (const p of deckParticipations) {
    const games = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);

    // Archetype (Alter Ego) stats
    const ae = p.alterEgoId || "unknown";
    if (!aeMap[ae]) aeMap[ae] = { timesIncluded: 0, totalGames: 0, wins: 0, losses: 0, draws: 0 };
    aeMap[ae].timesIncluded++;
    aeMap[ae].totalGames += games;
    aeMap[ae].wins += p.wins || 0;
    aeMap[ae].losses += p.losses || 0;
    aeMap[ae].draws += p.draws || 0;

    // Card stats
    const deck = typeof p.mainDeck === "string" ? JSON.parse(p.mainDeck) : (p.mainDeck || {});
    const seenCards = new Set();
    for (const cardId of Object.keys(deck)) {
      if (seenCards.has(cardId)) continue;
      seenCards.add(cardId);
      if (!cardMap[cardId]) cardMap[cardId] = { timesIncluded: 0, totalGames: 0, wins: 0, losses: 0, draws: 0 };
      cardMap[cardId].timesIncluded++;
      cardMap[cardId].totalGames += games;
      cardMap[cardId].wins += p.wins || 0;
      cardMap[cardId].losses += p.losses || 0;
      cardMap[cardId].draws += p.draws || 0;
    }
  }

  // Build cardStats array
  const cardStats = Object.entries(cardMap)
    .map(([cardId, s]) => {
      const card = cardIndex ? cardIndex.get(cardId) : null;
      const winRate = s.totalGames > 0 ? Math.round((s.wins / s.totalGames) * 100) : 0;
      return {
        cardId,
        cardName: card ? card.name : cardId,
        timesIncluded: s.timesIncluded,
        percentOfDecks: Math.round((s.timesIncluded / totalDecks) * 100),
        totalGames: s.totalGames,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        winRate,
        lowSampleSize: s.totalGames < LOW_SAMPLE_THRESHOLD,
      };
    })
    .sort((a, b) => b.timesIncluded - a.timesIncluded);

  // Build archetypeStats array
  const archetypeStats = Object.entries(aeMap)
    .map(([alterEgoId, s]) => {
      const winRate = s.totalGames > 0 ? Math.round((s.wins / s.totalGames) * 100) : 0;
      return {
        alterEgoId,
        timesIncluded: s.timesIncluded,
        percentOfDecks: Math.round((s.timesIncluded / totalDecks) * 100),
        totalGames: s.totalGames,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        winRate,
        lowSampleSize: s.totalGames < LOW_SAMPLE_THRESHOLD,
      };
    })
    .sort((a, b) => b.timesIncluded - a.timesIncluded);

  return { cardStats, archetypeStats };
}

/**
 * Fracao minima de decks de um Alter Ego que precisam incluir uma carta para
 * ela entrar na "lista tipica" do arquetipo.
 */
export const TYPICAL_LIST_MIN_INCLUSION = 0.5;
const TYPICAL_LIST_MAX_CARDS = 25;
const TOP_CARDS_LIMIT = 20;

function parseEntries(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

function positiveQty(qty) {
  const n = Number(qty);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Lista tipica de um conjunto de decks do mesmo Alter Ego: cartas presentes em
 * pelo menos `minInclusion` dos decks, com a quantidade media (arredondada)
 * entre os decks que a usam. Ordena por inclusao e depois por nome.
 *
 * @param {Array<Object|string>} mainDecks - mapas { cardId: qty } (ou JSON)
 * @param {Map} cardIndex
 */
export function computeTypicalList(mainDecks, cardIndex, { minInclusion = TYPICAL_LIST_MIN_INCLUSION, limit = TYPICAL_LIST_MAX_CARDS } = {}) {
  const decks = (mainDecks || []).map(parseEntries);
  if (decks.length === 0) return [];

  const stats = new Map(); // cardId -> { decks, totalQty }
  for (const deck of decks) {
    for (const [cardId, qty] of Object.entries(deck)) {
      const n = positiveQty(qty);
      if (n === 0) continue;
      const s = stats.get(cardId) || { decks: 0, totalQty: 0 };
      s.decks++;
      s.totalQty += n;
      stats.set(cardId, s);
    }
  }

  return [...stats.entries()]
    .map(([cardId, s]) => {
      const card = cardIndex ? cardIndex.get(cardId) : null;
      return {
        card_id: cardId,
        name: card ? card.name : cardId,
        type: card ? card.type : null,
        inclusion: Math.round((s.decks / decks.length) * 100),
        avg_qty: Math.max(1, Math.round(s.totalQty / s.decks)),
        _ratio: s.decks / decks.length,
      };
    })
    .filter((c) => c._ratio >= minInclusion)
    .sort((a, b) => b._ratio - a._ratio || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, limit)
    .map(({ _ratio, ...rest }) => rest);
}

/**
 * Meta publico: junta a popularidade nos decks publicados (todos os decks da
 * comunidade) com o desempenho em torneios finalizados.
 *
 * @param {Object} params
 * @param {Array} params.communityDecks - [{ alter_ego_id, main_deck }]
 * @param {Array} params.deckParticipations - mesmo formato de computeMetaStats
 * @param {Map} params.cardIndex
 */
export function buildPublicMeta({ communityDecks = [], deckParticipations = [], cardIndex, now = Date.now() }) {
  const tournament = computeMetaStats({ deckParticipations, cardIndex });
  const aeTournament = new Map(tournament.archetypeStats.map((a) => [a.alterEgoId, a]));
  const cardTournament = new Map(tournament.cardStats.map((c) => [c.cardId, c]));

  const totalDecks = communityDecks.length;
  const byAlterEgo = new Map(); // alterEgoId -> [mainDeck]
  const cardInclusion = new Map(); // cardId -> decks que incluem
  for (const deck of communityDecks) {
    const aeId = deck.alter_ego_id || "unknown";
    const mainDeck = parseEntries(deck.main_deck);
    if (!byAlterEgo.has(aeId)) byAlterEgo.set(aeId, []);
    byAlterEgo.get(aeId).push(mainDeck);
    for (const [cardId, qty] of Object.entries(mainDeck)) {
      if (positiveQty(qty) > 0) cardInclusion.set(cardId, (cardInclusion.get(cardId) || 0) + 1);
    }
  }

  const archetypes = [...byAlterEgo.entries()]
    .map(([aeId, decks]) => {
      const ae = cardIndex ? cardIndex.get(aeId) : null;
      const t = aeTournament.get(aeId);
      return {
        alter_ego_id: aeId,
        name: ae ? ae.name : aeId,
        colors: ae && Array.isArray(ae.colors) ? ae.colors : [],
        decks: decks.length,
        percent: totalDecks > 0 ? Math.round((decks.length / totalDecks) * 100) : 0,
        tournament_entries: t ? t.timesIncluded : 0,
        games: t ? t.totalGames : 0,
        wins: t ? t.wins : 0,
        losses: t ? t.losses : 0,
        draws: t ? t.draws : 0,
        win_rate: t && t.totalGames > 0 ? t.winRate : null,
        low_sample: t ? t.lowSampleSize : true,
        typical_list: computeTypicalList(decks, cardIndex),
      };
    })
    .sort((a, b) => b.decks - a.decks || a.name.localeCompare(b.name, "pt-BR"));

  const topCards = [...cardInclusion.entries()]
    .map(([cardId, count]) => {
      const card = cardIndex ? cardIndex.get(cardId) : null;
      const t = cardTournament.get(cardId);
      return {
        card_id: cardId,
        name: card ? card.name : cardId,
        type: card ? card.type : null,
        decks: count,
        percent: totalDecks > 0 ? Math.round((count / totalDecks) * 100) : 0,
        win_rate: t && t.totalGames > 0 ? t.winRate : null,
        low_sample: t ? t.lowSampleSize : true,
      };
    })
    .sort((a, b) => b.decks - a.decks || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, TOP_CARDS_LIMIT);

  return {
    generated_at: now,
    total_decks: totalDecks,
    tournament_entries: deckParticipations.length,
    archetypes,
    top_cards: topCards,
  };
}
