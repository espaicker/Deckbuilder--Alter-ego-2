import test from "node:test";
import assert from "node:assert/strict";
import { computePlayerStats } from "../server/lib/playerStats.js";

const mockCardIndex = new Map([
  ["ATK-01", { type: "Ação", subtype: "ofensiva", colors: ["Vermelho"] }],
  ["ATK-02", { type: "Ação", subtype: "ofensiva", colors: ["Azul"] }],
  ["DEF-01", { type: "Ação", subtype: "defensiva", colors: ["Verde"] }],
  ["DEF-02", { type: "Reação", subtype: "defensiva", colors: ["Verde"] }],
  ["AUX-01", { type: "Ação", subtype: "auxiliar", colors: ["Amarelo"] }],
  ["TAT-01", { type: "Tática", subtype: null, colors: ["Roxo"] }],
]);

test("playerStats - winRate e contadores", async (t) => {
  await t.test("3 vitorias 1 derrota = 75%", () => {
    const r = computePlayerStats({
      tournamentPlayerRows: [{ alter_ego_id: "AE-0001", main_deck: {} }],
      matchRows: [
        { result: "player1", isPlayer1: true },
        { result: "player2", isPlayer1: false },
        { result: "player1", isPlayer1: true },
        { result: "player2", isPlayer1: true },
      ],
      cardIndex: mockCardIndex,
    });
    assert.equal(r.winRate, 75);
    assert.equal(r.totalWins, 3);
    assert.equal(r.totalLosses, 1);
  });

  await t.test("bye conta como vitoria", () => {
    const r = computePlayerStats({
      tournamentPlayerRows: [{ alter_ego_id: "AE-0001", main_deck: {} }],
      matchRows: [{ result: "bye", isPlayer1: true }],
      cardIndex: mockCardIndex,
    });
    assert.equal(r.totalWins, 1);
    assert.equal(r.winRate, 100);
  });

  await t.test("sem partidas retorna null/zero sem erro", () => {
    const r = computePlayerStats({
      tournamentPlayerRows: [],
      matchRows: [],
      cardIndex: mockCardIndex,
    });
    assert.equal(r.winRate, null);
    assert.equal(r.totalWins, 0);
    assert.equal(r.playstyle, null);
    assert.equal(r.favoriteAlterEgo, null);
  });
});

test("playerStats - favoriteAlterEgo e favoriteColor", async (t) => {
  await t.test("alter ego mais usado", () => {
    const r = computePlayerStats({
      tournamentPlayerRows: [
        { alter_ego_id: "AE-0001", main_deck: JSON.stringify({"ATK-01": 4}) },
        { alter_ego_id: "AE-0001", main_deck: JSON.stringify({"ATK-01": 4}) },
        { alter_ego_id: "AE-0002", main_deck: JSON.stringify({"DEF-01": 4}) },
      ],
      matchRows: [],
      cardIndex: mockCardIndex,
    });
    assert.equal(r.favoriteAlterEgo, "AE-0001");
    assert.equal(r.favoriteColor, "Vermelho"); // ATK-01 e Vermelho
  });
});

test("playerStats - playstyle", async (t) => {
  await t.test("maioria ofensiva = Agressivo", () => {
    const r = computePlayerStats({
      tournamentPlayerRows: [{ alter_ego_id: "AE-0001", main_deck: JSON.stringify({"ATK-01": 8, "DEF-01": 2}) }],
      matchRows: [],
      cardIndex: mockCardIndex,
    });
    assert.equal(r.playstyle, "Agressivo");
  });

  await t.test("maioria defensiva = Controle", () => {
    const r = computePlayerStats({
      tournamentPlayerRows: [{ alter_ego_id: "AE-0001", main_deck: JSON.stringify({"DEF-01": 8, "DEF-02": 4, "ATK-01": 2}) }],
      matchRows: [],
      cardIndex: mockCardIndex,
    });
    assert.equal(r.playstyle, "Controle");
  });

  await t.test("equilibrado = 50/50", () => {
    const r = computePlayerStats({
      tournamentPlayerRows: [{ alter_ego_id: "AE-0001", main_deck: JSON.stringify({"ATK-01": 5, "DEF-01": 5}) }],
      matchRows: [],
      cardIndex: mockCardIndex,
    });
    assert.equal(r.playstyle, "Equilibrado");
  });

  await t.test("sem ofensivas nem defensivas = null", () => {
    const r = computePlayerStats({
      tournamentPlayerRows: [{ alter_ego_id: "AE-0001", main_deck: JSON.stringify({"AUX-01": 10, "TAT-01": 5}) }],
      matchRows: [],
      cardIndex: mockCardIndex,
    });
    assert.equal(r.playstyle, null);
  });
});