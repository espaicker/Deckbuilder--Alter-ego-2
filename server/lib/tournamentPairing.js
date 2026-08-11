/**
 * Motor de torneio: pareamento suíço, chaveamento de mata-mata e cálculo
 * de classificação. Módulo puro — não conhece o banco de dados, só
 * trabalha com os objetos passados. Isso facilita testar (veja
 * test/tournamentPairing.test.mjs) e reaproveitar tanto pra Suíço quanto
 * pra fase final (top cut) de um mesmo torneio.
 *
 * Convenções:
 *   - "player" = { id, hadBye } — id é o id da inscrição (tournament_players.id)
 *   - "match"  = { player1Id, player2Id, result }
 *       result: "pending" | "player1" | "player2" | "draw" | "bye"
 *       player2Id é null quando o confronto é um bye.
 */

const POINTS = { win: 3, draw: 1, loss: 0 };
const MIN_OPPONENT_WIN_PERCENT = 1 / 3; // mesmo piso usado pelo Magic no cálculo de OMW%

/* ============================================================
   CLASSIFICAÇÃO
   ============================================================ */

/**
 * Calcula pontos, vitórias/derrotas/empates e o desempate de % de vitória
 * dos adversários (OMW%) pra cada jogador, a partir do histórico completo
 * de partidas (todas as rodadas já ocorridas).
 *
 * @param {Array<{id:number}>} players
 * @param {Array<{player1Id:number, player2Id:number|null, result:string}>} matches
 * @returns {Array} standings ordenadas (1º lugar primeiro)
 */
export function computeStandings(players, matches) {
  const decided = matches.filter((m) => m.result !== "pending");
  const byPlayer = new Map(players.map((p) => [p.id, {
    playerId: p.id,
    wins: 0, losses: 0, draws: 0, byes: 0,
    matchPoints: 0, matchesPlayed: 0,
    opponents: [],
  }]));

  for (const match of decided) {
    const p1 = byPlayer.get(match.player1Id);
    const p2 = match.player2Id !== null ? byPlayer.get(match.player2Id) : null;
    if (!p1) continue;

    if (match.result === "bye") {
      p1.byes += 1;
      p1.matchPoints += POINTS.win;
      p1.matchesPlayed += 1;
      continue; // bye não conta como adversário pra ninguém
    }
    if (!p2) continue;

    p1.matchesPlayed += 1;
    p2.matchesPlayed += 1;
    p1.opponents.push(p2.playerId);
    p2.opponents.push(p1.playerId);

    if (match.result === "draw") {
      p1.draws += 1; p2.draws += 1;
      p1.matchPoints += POINTS.draw; p2.matchPoints += POINTS.draw;
    } else if (match.result === "player1") {
      p1.wins += 1; p2.losses += 1;
      p1.matchPoints += POINTS.win;
    } else if (match.result === "player2") {
      p2.wins += 1; p1.losses += 1;
      p2.matchPoints += POINTS.win;
    }
  }

  const rows = [...byPlayer.values()];
  const winPercentOf = (row) =>
    row.matchesPlayed === 0 ? 0 : row.matchPoints / (row.matchesPlayed * POINTS.win);

  for (const row of rows) {
    if (row.opponents.length === 0) {
      row.opponentsMatchWinPercent = 0;
    } else {
      const sum = row.opponents.reduce((total, opponentId) => {
        const opponent = byPlayer.get(opponentId);
        const percent = opponent ? winPercentOf(opponent) : 0;
        return total + Math.max(percent, MIN_OPPONENT_WIN_PERCENT);
      }, 0);
      row.opponentsMatchWinPercent = sum / row.opponents.length;
    }
  }

  rows.sort((a, b) => {
    if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
    return b.opponentsMatchWinPercent - a.opponentsMatchWinPercent;
  });

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

/* ============================================================
   PAREAMENTO SUÍÇO
   ============================================================ */

function buildPlayedSet(matches) {
  const played = new Map();
  const mark = (a, b) => {
    if (!played.has(a)) played.set(a, new Set());
    played.get(a).add(b);
  };
  for (const match of matches) {
    if (match.player2Id === null) continue;
    mark(match.player1Id, match.player2Id);
    mark(match.player2Id, match.player1Id);
  }
  return played;
}

/**
 * Gera os confrontos da próxima rodada suíça.
 *
 * @param {Array<{id:number, hadBye:boolean}>} activePlayers - só quem não deu drop
 * @param {Array} previousMatches - todas as partidas de rodadas anteriores (pra evitar repetir adversário)
 * @param {Array} standings - resultado de computeStandings(...) com os MESMOS jogadores
 * @returns {Array<{player1Id:number, player2Id:number|null, result:string}>}
 */
export function generateSwissPairings(activePlayers, previousMatches, standings) {
  const pointsOf = new Map(standings.map((s) => [s.playerId, s.matchPoints]));
  const played = buildPlayedSet(previousMatches);
  const hadByeOf = new Map(activePlayers.map((p) => [p.id, !!p.hadBye]));

  // Ordena por pontuação (desc); empate mantém a ordem de entrada (estável)
  // — evita determinismo estranho e ainda assim é justo.
  const ordered = [...activePlayers].sort(
    (a, b) => (pointsOf.get(b.id) || 0) - (pointsOf.get(a.id) || 0)
  );

  // Agrupa por pontuação
  const groups = [];
  for (const player of ordered) {
    const points = pointsOf.get(player.id) || 0;
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.points === points) {
      lastGroup.players.push(player);
    } else {
      groups.push({ points, players: [player] });
    }
  }

  const pairs = [];
  let floater = null;

  for (const group of groups) {
    const pool = floater ? [floater, ...group.players] : [...group.players];
    floater = null;

    if (pool.length % 2 !== 0) {
      // sobra alguém: o de pontuação mais baixa do grupo desce pro próximo
      floater = pool.pop();
    }

    pairs.push(...pairGroupAvoidingRematches(pool, played));
  }

  const matches = pairs.map(([a, b]) => ({ player1Id: a.id, player2Id: b.id, result: "pending" }));

  if (floater) {
    // ninguém sobrou pra parear com o floater final: ele tira o bye —
    // preferindo alguém que ainda não teve bye nesse torneio.
    matches.push({ player1Id: floater.id, player2Id: null, result: "bye" });
  }

  return reassignByeToPlayerWithoutOne(matches, hadByeOf);
}

/**
 * Pareia os jogadores de um grupo (mesma pontuação) tentando não repetir
 * nenhum confronto já ocorrido. Faz isso de forma gulosa: pega o primeiro
 * jogador da lista e procura, na ordem, o primeiro adversário ainda não
 * enfrentado. Se não achar ninguém "limpo" (comum em grupos pequenos ou
 * torneios com muitas rodadas), aceita repetir — melhor jogar de novo
 * contra alguém do que não jogar.
 */
function pairGroupAvoidingRematches(pool, played) {
  const remaining = [...pool];
  const pairs = [];

  while (remaining.length > 0) {
    const player = remaining.shift();
    const playedByPlayer = played.get(player.id) || new Set();

    let opponentIndex = remaining.findIndex((candidate) => !playedByPlayer.has(candidate.id));
    if (opponentIndex === -1) opponentIndex = 0; // ninguém "limpo": repete mesmo

    const [opponent] = remaining.splice(opponentIndex, 1);
    pairs.push([player, opponent]);
  }

  return pairs;
}

function reassignByeToPlayerWithoutOne(matches, hadByeOf) {
  const byeMatch = matches.find((m) => m.result === "bye");
  if (!byeMatch || !hadByeOf.get(byeMatch.player1Id)) return matches;

  // O jogador escolhido pro bye já teve um antes neste torneio — tenta
  // trocar de lugar com o adversário de menor pontuação num confronto
  // normal que ainda não teve bye, pra ninguém tomar dois byes enquanto
  // outra pessoa não tomou nenhum.
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const candidateMatch = matches[i];
    if (candidateMatch.result === "bye") continue;
    const candidateId = candidateMatch.player2Id;
    if (candidateId !== null && !hadByeOf.get(candidateId)) {
      const originalByePlayer = byeMatch.player1Id;
      byeMatch.player1Id = candidateId;
      candidateMatch.player2Id = originalByePlayer;
      break;
    }
  }
  return matches;
}

/* ============================================================
   MATA-MATA (ELIMINAÇÃO SIMPLES)
   ============================================================ */

function nextPowerOfTwo(n) {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/**
 * Ordem de seed padrão de chaveamento (1º x último, 2º x penúltimo...),
 * construída recursivamente pra garantir que os melhores colocados só se
 * encontrem nas fases finais — o mesmo princípio usado em qualquer chave
 * de torneio esportivo ou de card game.
 */
function seedOrder(bracketSize) {
  let seeds = [1, 2];
  while (seeds.length < bracketSize) {
    const sum = seeds.length * 2 + 1;
    const next = [];
    for (const seed of seeds) next.push(seed, sum - seed);
    seeds = next;
  }
  return seeds;
}

/**
 * Gera a primeira rodada de um chaveamento eliminatório a partir de uma
 * lista de jogadores JÁ ORDENADA por seed (melhor colocado primeiro —
 * pode vir da classificação suíça, no caso de "suíço + mata-mata", ou da
 * ordem de inscrição/aleatória num torneio só de mata-mata).
 *
 * Se o número de jogadores não for potência de 2, os seeds mais altos
 * recebem bye na primeira rodada (avançam sozinhos).
 */
export function generateBracketRound1(seededPlayers) {
  const bracketSize = nextPowerOfTwo(seededPlayers.length);
  const order = seedOrder(bracketSize);
  // seededPlayers[seed - 1] === undefined quando o seed é "fantasma" (bye)
  const bySeed = (seed) => seededPlayers[seed - 1] || null;

  const matches = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = bySeed(order[i]);
    const b = bySeed(order[i + 1]);
    if (a && b) {
      matches.push({ player1Id: a.id, player2Id: b.id, result: "pending", bracketSlot: i / 2 });
    } else if (a || b) {
      // um dos dois é fantasma: o outro avança de graça
      matches.push({ player1Id: (a || b).id, player2Id: null, result: "bye", bracketSlot: i / 2 });
    }
  }
  return matches;
}

/**
 * Gera a rodada seguinte do mata-mata a partir dos vencedores da rodada
 * anterior (já com resultado definido). O vencedor do slot 2k enfrenta o
 * vencedor do slot 2k+1 — é a mesma lógica de qualquer chave eliminatória.
 */
export function advanceBracketRound(previousRoundMatches) {
  const winnerOf = (match) => {
    if (match.result === "bye") return match.player1Id;
    if (match.result === "player1") return match.player1Id;
    if (match.result === "player2") return match.player2Id;
    return null; // ainda não decidido
  };

  const bySlot = [...previousRoundMatches].sort((a, b) => a.bracketSlot - b.bracketSlot);
  const matches = [];
  for (let i = 0; i < bySlot.length; i += 2) {
    const winnerA = winnerOf(bySlot[i]);
    const winnerB = bySlot[i + 1] ? winnerOf(bySlot[i + 1]) : null;
    if (winnerA === null || (bySlot[i + 1] && winnerB === null)) {
      throw new Error("Não é possível avançar: há confronto da rodada anterior sem resultado.");
    }
    if (winnerA !== null && winnerB !== null) {
      matches.push({ player1Id: winnerA, player2Id: winnerB, result: "pending", bracketSlot: i / 2 });
    } else if (winnerA !== null) {
      matches.push({ player1Id: winnerA, player2Id: null, result: "bye", bracketSlot: i / 2 });
    }
  }
  return matches;
}

/**
 * Quantas rodadas um chaveamento eliminatório de N jogadores precisa.
 */
export function bracketRoundCount(playerCount) {
  return Math.log2(nextPowerOfTwo(playerCount));
}

/**
 * Sugestão de número de rodadas suíças pelo tamanho do grupo — o mesmo
 * princípio usado por eventos competitivos (rodadas suficientes pra ter
 * um campeão único ou quase único no topo). O organizador pode sempre
 * ajustar manualmente antes de começar.
 */
export function suggestedSwissRounds(playerCount) {
  if (playerCount <= 1) return 1;
  return Math.max(3, Math.ceil(Math.log2(playerCount)));
}
