/**
 * Modulo puro de calculo de pontos de ranking.
 * Sem efeitos colaterais - testavel isoladamente.
 */

// Constantes de pontuacao (ajuste aqui, nao espalhadas no codigo)
export const POINTS = {
  WIN: 3,
  DRAW: 1,
  LOSS: 0,
  PARTICIPATION: 1,
  PLACEMENT: [10, 6, 3, 3, 1, 1, 1, 1],
};

export function placementBonus(position) {
  if (position < 1) return 0;
  const idx = position - 1;
  return idx < POINTS.PLACEMENT.length ? POINTS.PLACEMENT[idx] : 0;
}

/**
 * @param {Array} finalStandings - ordenado por posicao.
 *   { playerId, userId, wins, draws, losses, dropped, matchesPlayed }
 * @returns {Array} [{ userId, playerId, points, reason }]
 */
export function calculateTournamentPoints(finalStandings) {
  const results = [];
  for (let i = 0; i < finalStandings.length; i++) {
    const s = finalStandings[i];
    const position = i + 1;
    if (s.matchesPlayed === 0 && s.dropped) continue;
    const matchPoints = (s.wins * POINTS.WIN) + (s.draws * POINTS.DRAW);
    const bonus = placementBonus(position);
    const total = matchPoints + bonus + POINTS.PARTICIPATION;
    const parts = [];
    if (s.wins > 0) parts.push(s.wins + " vitoria" + (s.wins > 1 ? "s" : ""));
    if (s.draws > 0) parts.push(s.draws + " empate" + (s.draws > 1 ? "s" : ""));
    if (s.losses > 0) parts.push(s.losses + " derrota" + (s.losses > 1 ? "s" : ""));
    parts.push(position + "o lugar");
    if (s.dropped) parts.push("(desistiu)");
    results.push({ userId: s.userId, playerId: s.playerId, points: total, reason: parts.join(", ") });
  }
  return results;
}