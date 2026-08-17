import test from "node:test";
import assert from "node:assert/strict";
import { computeMetaStats } from "../server/lib/metaAnalytics.js";

const mockIndex = new Map([
  ["C1", { name: "Carta 1", type: "Acao" }],
  ["C2", { name: "Carta 2", type: "Reacao" }],
  ["C3", { name: "Carta 3", type: "Tatica" }],
]);

test("metaAnalytics - computeMetaStats", async (t) => {
  await t.test("contagem de inclusao e winrate corretos", () => {
    const data = [
      { mainDeck: { C1: 4, C2: 4 }, alterEgoId: "AE-01", wins: 3, losses: 0, draws: 0 },
      { mainDeck: { C1: 4, C3: 4 }, alterEgoId: "AE-01", wins: 2, losses: 1, draws: 0 },
      { mainDeck: { C2: 4, C3: 4 }, alterEgoId: "AE-02", wins: 0, losses: 3, draws: 0 },
    ];
    const r = computeMetaStats({ deckParticipations: data, cardIndex: mockIndex });

    // C1 aparece em 2 de 3 decks (67%)
    const c1 = r.cardStats.find(c => c.cardId === "C1");
    assert.equal(c1.timesIncluded, 2);
    assert.equal(c1.percentOfDecks, 67);
    assert.equal(c1.totalGames, 6); // 3+3 games from those 2 participations
    assert.equal(c1.wins, 5); // 3+2
    assert.equal(c1.winRate, 83); // 5/6 = 83%

    // C2 aparece em 2 de 3 decks
    const c2 = r.cardStats.find(c => c.cardId === "C2");
    assert.equal(c2.timesIncluded, 2);
    assert.equal(c2.wins, 3); // 3+0
    assert.equal(c2.winRate, 50); // 3/6

    // Archetype stats
    const ae01 = r.archetypeStats.find(a => a.alterEgoId === "AE-01");
    assert.equal(ae01.timesIncluded, 2);
    assert.equal(ae01.wins, 5);
    assert.equal(ae01.winRate, 83);

    const ae02 = r.archetypeStats.find(a => a.alterEgoId === "AE-02");
    assert.equal(ae02.timesIncluded, 1);
    assert.equal(ae02.winRate, 0);
  });

  await t.test("lowSampleSize quando < 10 games", () => {
    const data = [
      { mainDeck: { C1: 4 }, alterEgoId: "AE-01", wins: 1, losses: 0, draws: 0 },
    ];
    const r = computeMetaStats({ deckParticipations: data, cardIndex: mockIndex });
    assert.equal(r.cardStats[0].lowSampleSize, true);
    assert.equal(r.archetypeStats[0].lowSampleSize, true);
  });

  await t.test("lista vazia nao quebra", () => {
    const r = computeMetaStats({ deckParticipations: [], cardIndex: mockIndex });
    assert.deepEqual(r.cardStats, []);
    assert.deepEqual(r.archetypeStats, []);
  });

  await t.test("null/undefined nao quebra", () => {
    const r = computeMetaStats({ deckParticipations: null, cardIndex: null });
    assert.deepEqual(r.cardStats, []);
    assert.deepEqual(r.archetypeStats, []);
  });

  await t.test("mainDeck como string JSON funciona", () => {
    const data = [
      { mainDeck: JSON.stringify({ C1: 4, C2: 2 }), alterEgoId: "AE-01", wins: 2, losses: 1, draws: 0 },
    ];
    const r = computeMetaStats({ deckParticipations: data, cardIndex: mockIndex });
    assert.equal(r.cardStats.length, 2);
    assert.equal(r.cardStats[0].cardName, "Carta 1");
  });
});