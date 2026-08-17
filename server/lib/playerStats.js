/**
 * Modulo puro de calculo de estatisticas de jogador.
 * Sem efeitos colaterais - testavel isoladamente.
 */

/**
 * @param {Object} params
 * @param {Array} params.tournamentPlayerRows - inscricoes [{deck_id, alter_ego_id, main_deck}]
 * @param {Array} params.matchRows - partidas [{player1Id, player2Id, result, playerId}]
 *   playerId = id deste jogador na tournament_players
 * @param {Map} params.cardIndex - Map<cardId, {type, subtype, colors}>
 * @returns {Object} stats
 */
export function computePlayerStats({ tournamentPlayerRows, matchRows, cardIndex }) {
  let wins = 0, losses = 0, draws = 0;

  for (const m of matchRows) {
    if (m.result === "bye") { wins++; continue; }
    if (m.result === "player1" && m.isPlayer1) wins++;
    else if (m.result === "player2" && !m.isPlayer1) wins++;
    else if (m.result === "draw") draws++;
    else losses++;
  }

  const totalGames = wins + losses + draws;
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : null;

  // Favorite Alter Ego (most used)
  const aeCount = {};
  for (const row of tournamentPlayerRows) {
    const ae = row.alter_ego_id;
    if (ae) aeCount[ae] = (aeCount[ae] || 0) + 1;
  }
  const favoriteAlterEgo = Object.entries(aeCount).sort((a,b) => b[1]-a[1])[0]?.[0] || null;

  // Favorite color (weighted by card quantity across all decks)
  const colorCount = {};
  let offensiveCards = 0;
  let defensiveCards = 0;

  for (const row of tournamentPlayerRows) {
    let deck;
    try { deck = typeof row.main_deck === "string" ? JSON.parse(row.main_deck) : row.main_deck; } catch { continue; }
    for (const [cardId, qty] of Object.entries(deck)) {
      const card = cardIndex.get(cardId);
      if (!card) continue;
      const q = Number(qty) || 0;
      // Count colors
      if (card.colors) {
        for (const color of card.colors) {
          colorCount[color] = (colorCount[color] || 0) + q;
        }
      }
      // Count offensive/defensive by subtype
      if ((card.type === "Acao" || card.type === "Ação" || card.type === "Reacao" || card.type === "Reação") && card.subtype) {
        if (card.subtype === "ofensiva") offensiveCards += q;
        else if (card.subtype === "defensiva") defensiveCards += q;
      }
    }
  }

  const favoriteColor = Object.entries(colorCount).sort((a,b) => b[1]-a[1])[0]?.[0] || null;

  // Playstyle
  let playstyle = null;
  const total = offensiveCards + defensiveCards;
  if (total > 0) {
    const ratio = offensiveCards / total;
    if (ratio > 0.6) playstyle = "Agressivo";
    else if (ratio < 0.4) playstyle = "Controle";
    else playstyle = "Equilibrado";
  }

  return {
    winRate,
    favoriteAlterEgo,
    favoriteColor,
    playstyle,
    tournamentsPlayed: tournamentPlayerRows.length,
    totalWins: wins,
    totalLosses: losses,
    totalDraws: draws,
  };
}