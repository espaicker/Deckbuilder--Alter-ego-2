import test from "node:test";
import assert from "node:assert/strict";
import { calculateTournamentPoints, placementBonus, POINTS } from "../server/lib/ranking.js";

test("ranking - constantes", async (t) => {
  await t.test("WIN=3, DRAW=1, PARTICIPATION=1", () => {
    assert.equal(POINTS.WIN, 3);
    assert.equal(POINTS.DRAW, 1);
    assert.equal(POINTS.PARTICIPATION, 1);
  });
  await t.test("Bonus colocacao: 1o=10, 2o=6, 3-4o=3, 5-8o=1, 9o+=0", () => {
    assert.equal(placementBonus(1), 10);
    assert.equal(placementBonus(2), 6);
    assert.equal(placementBonus(3), 3);
    assert.equal(placementBonus(4), 3);
    assert.equal(placementBonus(5), 1);
    assert.equal(placementBonus(8), 1);
    assert.equal(placementBonus(9), 0);
  });
});

test("ranking - calculateTournamentPoints", async (t) => {
  await t.test("1o com 3V 0D = 9+10+1 = 20 pts", () => {
    const standings = [
      { playerId:1, userId:10, wins:3, draws:0, losses:0, dropped:false, matchesPlayed:3 },
      { playerId:2, userId:20, wins:2, draws:0, losses:1, dropped:false, matchesPlayed:3 },
      { playerId:3, userId:30, wins:1, draws:0, losses:2, dropped:false, matchesPlayed:3 },
      { playerId:4, userId:40, wins:0, draws:0, losses:3, dropped:false, matchesPlayed:3 },
    ];
    const r = calculateTournamentPoints(standings);
    assert.equal(r[0].points, 20); // 9+10+1
    assert.equal(r[1].points, 13); // 6+6+1
    assert.equal(r[2].points, 7);  // 3+3+1
    assert.equal(r[3].points, 4);  // 0+3+1
  });

  await t.test("Drop no meio ainda ganha pontos", () => {
    const standings = [
      { playerId:1, userId:10, wins:2, draws:0, losses:0, dropped:false, matchesPlayed:2 },
      { playerId:2, userId:20, wins:1, draws:0, losses:1, dropped:true, matchesPlayed:2 },
    ];
    const r = calculateTournamentPoints(standings);
    assert.equal(r.length, 2);
    assert.ok(r[1].points > 0);
    assert.ok(r[1].reason.includes("desistiu"));
  });

  await t.test("Drop antes do inicio (0 partidas) nao aparece", () => {
    const standings = [
      { playerId:1, userId:10, wins:2, draws:0, losses:0, dropped:false, matchesPlayed:2 },
      { playerId:2, userId:20, wins:0, draws:0, losses:0, dropped:true, matchesPlayed:0 },
    ];
    const r = calculateTournamentPoints(standings);
    assert.equal(r.length, 1);
  });

  await t.test("Empates geram 1pt cada", () => {
    const standings = [
      { playerId:1, userId:10, wins:1, draws:2, losses:0, dropped:false, matchesPlayed:3 },
    ];
    const r = calculateTournamentPoints(standings);
    assert.equal(r[0].points, 16); // 3+2+10+1
  });

  await t.test("9o lugar nao recebe bonus", () => {
    const standings = Array.from({length:10}, (_,i) => ({
      playerId:i+1, userId:(i+1)*10, wins:10-i, draws:0, losses:i, dropped:false, matchesPlayed:10
    }));
    const r = calculateTournamentPoints(standings);
    assert.equal(r[8].points, (2*3)+0+1); // 9o: 2wins*3 + 0bonus + 1part = 7
  });
});