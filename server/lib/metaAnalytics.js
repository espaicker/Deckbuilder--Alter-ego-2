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