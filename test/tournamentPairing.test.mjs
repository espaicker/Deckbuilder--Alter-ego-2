import test from "node:test";
import assert from "node:assert/strict";
import {
  computeStandings,
  generateSwissPairings,
  generateBracketRound1,
  advanceBracketRound,
  bracketRoundCount,
  suggestedSwissRounds,
} from "../server/lib/tournamentPairing.js";

function players(ids) {
  return ids.map((id) => ({ id, hadBye: false }));
}

test("computeStandings - pontos de vitória, derrota e empate", () => {
  const p = players([1, 2, 3, 4]);
  const matches = [
    { player1Id: 1, player2Id: 2, result: "player1" },
    { player1Id: 3, player2Id: 4, result: "draw" },
  ];
  const standings = computeStandings(p, matches);
  const byId = Object.fromEntries(standings.map((s) => [s.playerId, s]));

  assert.equal(byId[1].matchPoints, 3);
  assert.equal(byId[1].wins, 1);
  assert.equal(byId[2].matchPoints, 0);
  assert.equal(byId[2].losses, 1);
  assert.equal(byId[3].matchPoints, 1);
  assert.equal(byId[4].matchPoints, 1);
});

test("computeStandings - bye conta como vitória e não vira adversário de ninguém", () => {
  const p = players([1, 2]);
  const matches = [{ player1Id: 1, player2Id: null, result: "bye" }];
  const standings = computeStandings(p, matches);
  const byId = Object.fromEntries(standings.map((s) => [s.playerId, s]));

  assert.equal(byId[1].matchPoints, 3);
  assert.equal(byId[1].byes, 1);
  assert.equal(byId[1].opponents.length, 0);
});

test("computeStandings - pending não conta pra ninguém", () => {
  const p = players([1, 2]);
  const matches = [{ player1Id: 1, player2Id: 2, result: "pending" }];
  const standings = computeStandings(p, matches);
  assert.equal(standings[0].matchPoints, 0);
  assert.equal(standings[1].matchPoints, 0);
});

test("computeStandings - OMW% aplica o piso de 1/3 quando o adversário perdeu tudo", () => {
  const p = players([1, 2, 3]);
  // 2 perde as duas partidas que jogar (win% real = 0%, deveria virar 1/3 no cálculo)
  const matches = [
    { player1Id: 1, player2Id: 2, result: "player1" },
    { player1Id: 3, player2Id: 2, result: "player1" },
  ];
  const standings = computeStandings(p, matches);
  const byId = Object.fromEntries(standings.map((s) => [s.playerId, s]));

  // 1 só jogou contra 2 (0% real) -> OMW% de 1 deve virar exatamente o piso, 1/3
  assert.ok(Math.abs(byId[1].opponentsMatchWinPercent - 1 / 3) < 1e-9);
  assert.ok(Math.abs(byId[3].opponentsMatchWinPercent - 1 / 3) < 1e-9);
});

test("computeStandings - ordena por pontos primeiro, OMW% só desempata pontuação igual", () => {
  const p = players([1, 2, 3, 4]);
  const matches = [
    { player1Id: 1, player2Id: 2, result: "player1" }, // 1 ganha (fraco adversário)
    { player1Id: 3, player2Id: 4, result: "draw" }, // 3 e 4 empatam
  ];
  const standings = computeStandings(p, matches);
  // 1 tem 3 pontos (1 vitória), maior que 3 e 4 (1 ponto cada de empate) e que 2 (0 pontos)
  assert.equal(standings[0].playerId, 1);
  assert.equal(standings[0].matchPoints, 3);
});

test("generateSwissPairings - pareia todo mundo na rodada 1 (par)", () => {
  const p = players([1, 2, 3, 4]);
  const standings = computeStandings(p, []);
  const matches = generateSwissPairings(p, [], standings);

  assert.equal(matches.length, 2);
  const paired = new Set(matches.flatMap((m) => [m.player1Id, m.player2Id]));
  assert.deepEqual([...paired].sort(), [1, 2, 3, 4]);
});

test("generateSwissPairings - número ímpar de jogadores gera exatamente 1 bye", () => {
  const p = players([1, 2, 3]);
  const standings = computeStandings(p, []);
  const matches = generateSwissPairings(p, [], standings);

  const byes = matches.filter((m) => m.result === "bye");
  assert.equal(byes.length, 1);
  assert.equal(matches.reduce((total, m) => total + (m.player2Id !== null ? 2 : 1), 0), 3);
});

test("generateSwissPairings - evita repetir confronto já ocorrido quando possível", () => {
  const p = players([1, 2, 3, 4]);
  // Rodada 1 já ocorrida: 1v2 e 3v4, todos com 1 vitória cada (grupo único de pontuação igual)
  const previousMatches = [
    { player1Id: 1, player2Id: 2, result: "player1" },
    { player1Id: 3, player2Id: 4, result: "player1" },
  ];
  const standings = computeStandings(p, previousMatches);
  const matches = generateSwissPairings(p, previousMatches, standings);

  for (const match of matches) {
    const alreadyPlayed =
      (match.player1Id === 1 && match.player2Id === 2) ||
      (match.player1Id === 3 && match.player2Id === 4);
    assert.equal(alreadyPlayed, false, "não deveria repetir 1v2 nem 3v4 quando dá pra evitar");
  }
});

test("generateSwissPairings - com só 2 jogadores no torneio, aceita repetir (não tem outra opção)", () => {
  const p = players([1, 2]);
  const previousMatches = [{ player1Id: 1, player2Id: 2, result: "player1" }];
  const standings = computeStandings(p, previousMatches);
  const matches = generateSwissPairings(p, previousMatches, standings);

  assert.equal(matches.length, 1);
  assert.deepEqual([matches[0].player1Id, matches[0].player2Id].sort(), [1, 2]);
});

test("generateSwissPairings - prefere dar o bye a quem ainda não teve um", () => {
  const p = [
    { id: 1, hadBye: true },
    { id: 2, hadBye: false },
    { id: 3, hadBye: false },
  ];
  const standings = computeStandings(p, []);
  const matches = generateSwissPairings(p, [], standings);

  const byeMatch = matches.find((m) => m.result === "bye");
  assert.notEqual(byeMatch.player1Id, 1, "quem já teve bye não deveria tomar outro se dá pra evitar");
});

test("generateBracketRound1 - 8 jogadores gera o chaveamento padrão (1v8, 4v5, 2v7, 3v6)", () => {
  const p = players([1, 2, 3, 4, 5, 6, 7, 8]);
  const matches = generateBracketRound1(p);

  const asPairs = matches.map((m) => [m.player1Id, m.player2Id].sort((a, b) => a - b));
  assert.equal(matches.length, 4);
  assert.ok(asPairs.some(([a, b]) => a === 1 && b === 8));
  assert.ok(asPairs.some(([a, b]) => a === 4 && b === 5));
  assert.ok(asPairs.some(([a, b]) => a === 2 && b === 7));
  assert.ok(asPairs.some(([a, b]) => a === 3 && b === 6));
});

test("generateBracketRound1 - número não-potência-de-2 dá bye aos melhores seeds", () => {
  const p = players([1, 2, 3, 4, 5, 6]); // bracket de 8, seeds 7 e 8 são fantasmas
  const matches = generateBracketRound1(p);

  const byes = matches.filter((m) => m.result === "bye");
  // seeds 1 e 2 enfrentariam os fantasmas 8 e 7 -> ambos ganham bye
  const byePlayers = byes.map((m) => m.player1Id).sort((a, b) => a - b);
  assert.deepEqual(byePlayers, [1, 2]);
});

test("advanceBracketRound - vencedores avançam pro slot certo", () => {
  const round1 = [
    { player1Id: 1, player2Id: 8, result: "player1", bracketSlot: 0 },
    { player1Id: 4, player2Id: 5, result: "player2", bracketSlot: 1 },
    { player1Id: 2, player2Id: 7, result: "player1", bracketSlot: 2 },
    { player1Id: 3, player2Id: 6, result: "player1", bracketSlot: 3 },
  ];
  const round2 = advanceBracketRound(round1);

  assert.equal(round2.length, 2);
  assert.deepEqual([round2[0].player1Id, round2[0].player2Id], [1, 5]);
  assert.deepEqual([round2[1].player1Id, round2[1].player2Id], [2, 3]);
});

test("advanceBracketRound - erro se algum confronto ainda não foi decidido", () => {
  const round1 = [
    { player1Id: 1, player2Id: 8, result: "pending", bracketSlot: 0 },
    { player1Id: 4, player2Id: 5, result: "player2", bracketSlot: 1 },
  ];
  assert.throws(() => advanceBracketRound(round1));
});

test("bracketRoundCount e suggestedSwissRounds retornam valores sensatos", () => {
  assert.equal(bracketRoundCount(8), 3);
  assert.equal(bracketRoundCount(6), 3); // arredonda pro bracket de 8
  assert.equal(bracketRoundCount(2), 1);

  assert.equal(suggestedSwissRounds(8), 3);
  assert.ok(suggestedSwissRounds(64) >= 6);
  assert.equal(suggestedSwissRounds(2), 3); // piso mínimo de 3 rodadas
});
