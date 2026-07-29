import test from "node:test";
import assert from "node:assert/strict";
import { attackDefenseAverages, colorBreakdown, costCurve, createCardIndex, createExportText, normalizeBuild, normalizeSavedDeckIndex, typeSubtypeBreakdown, validateDeck } from "../src/lib/deckRules.js";

const cards = [
  { id: "AE-1", name: "Hero", type: "Alter Ego", colors: ["Azul"] },
  { id: "AC-1", name: "Carta Azul", type: "Ação", colors: ["Azul"] },
  { id: "AC-2", name: "Carta Vermelha", type: "Ação", colors: ["Vermelho"] },
];
const cardIndex = createCardIndex(cards);

test("normaliza dados persistidos", () => {
  assert.deepEqual(normalizeBuild({ alterEgoId: "AE-1", mainDeck: { "AC-1": 2, REMOVIDA: 1, "AE-1": 1 }, dropPile: { Azul: 3, Rosa: 1 } }, cardIndex, ["Azul", "Vermelho"]), { alterEgoId: "AE-1", mainDeck: { "AC-1": 2 }, dropPile: { Azul: 3 } });
});

test("valida cores, cópias e tamanhos", () => {
  const issues = validateDeck({ alterEgo: cards[0], mainDeck: { "AC-1": 5, "AC-2": 1 }, dropPile: { Vermelho: 10 }, cardIndex });
  assert.ok(issues.some((issue) => issue.includes("máximo de 4")));
  assert.ok(issues.some((issue) => issue.includes("cores não permitidas")));
  assert.ok(issues.some((issue) => issue.includes("Drop Vermelho não é permitido")));
  assert.ok(issues.some((issue) => issue.includes("Deck principal: 6/50")));
});

test("exportação tolera uma carta removida", () => {
  const text = createExportText({ alterEgo: cards[0], mainDeck: { "AC-1": 1, REMOVIDA: 2 }, dropPile: { Azul: 10 }, cardIndex });
  assert.match(text, /Carta indisponível \[REMOVIDA\]/);
});

test("índice salvo elimina registros inválidos e duplicados", () => {
  assert.deepEqual(normalizeSavedDeckIndex([{ key: "deck:1", name: "Válido" }, { key: "deck:1", name: "Duplicado" }, { key: "deck:2", name: "   " }, null]), [{ key: "deck:1", name: "Válido" }]);
});

test("colorBreakdown soma cartas do deck por cor e ignora entradas inválidas", () => {
  const result = colorBreakdown(
    { "AC-1": 3, "AC-2": 2, INVALIDA: 5, "AE-1": 1 },
    { Azul: 6, Rosa: 2, Vermelho: 0 },
    cardIndex
  );
  assert.deepEqual(result.deckCounts, { Azul: 3, Vermelho: 2 });
  assert.equal(result.deckTotal, 5);
  assert.deepEqual(result.dropCounts, { Azul: 6, Rosa: 2 });
  assert.equal(result.dropTotal, 8);
});

const statsCards = [
  { id: "AE-1", name: "Hero", type: "Alter Ego", colors: ["Azul"], attributes: { vida: 20, ataque: 3, defesa: 2 } },
  { id: "OF-1", name: "Ofensiva Barata", type: "Ação", subtype: "ofensiva", colors: ["Azul"], cost: 1, attributes: { ataque: 2 } },
  { id: "OF-2", name: "Ofensiva Cara", type: "Ação", subtype: "ofensiva", colors: ["Azul"], cost: 4, attributes: { ataque: 6 } },
  { id: "DF-1", name: "Defensiva", type: "Reação", subtype: "defensiva", colors: ["Azul"], cost: 2, attributes: { defesa: 3 } },
  { id: "AUX-1", name: "Auxiliar", type: "Ação", subtype: "auxiliar", colors: ["Azul"], cost: 1, attributes: {} },
];
const statsCardIndex = createCardIndex(statsCards);

test("costCurve conta cartas por custo e acha o maior custo", () => {
  const result = costCurve({ "OF-1": 3, "OF-2": 1, "DF-1": 2, INVALIDA: 9 }, statsCardIndex);
  assert.deepEqual(result.counts, { 1: 3, 4: 1, 2: 2 });
  assert.equal(result.maxCost, 4);
});

test("typeSubtypeBreakdown agrupa por tipo e subtipo", () => {
  const result = typeSubtypeBreakdown({ "OF-1": 3, "OF-2": 1, "DF-1": 2, "AUX-1": 1 }, statsCardIndex);
  assert.deepEqual(result.breakdown, {
    "Ação": { ofensiva: 4, auxiliar: 1 },
    "Reação": { defensiva: 2 },
  });
  assert.equal(result.total, 7);
});

test("attackDefenseAverages pondera pela quantidade e ignora cartas sem o atributo", () => {
  const result = attackDefenseAverages({ "OF-1": 3, "OF-2": 1, "DF-1": 2, "AUX-1": 5 }, statsCardIndex);
  // (2*3 + 6*1) / 4 = 3
  assert.equal(result.avgAttack, 3);
  assert.equal(result.attackCount, 4);
  // (3*2) / 2 = 3
  assert.equal(result.avgDefense, 3);
  assert.equal(result.defenseCount, 2);
});