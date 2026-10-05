import test from "node:test";
import assert from "node:assert/strict";
import { attackDefenseAverages, colorBreakdown, combinedCopies, costCurve, createCardIndex, createExportText, normalizeBuild, normalizeSavedDeckIndex, standardDropPile, typeSubtypeBreakdown, validateDeck } from "../src/lib/deckRules.js";

const cards = [
  { id: "AE-1", name: "Hero", type: "Alter Ego", colors: ["Azul"] },
  { id: "AC-1", name: "Carta Azul", type: "Ação", colors: ["Azul"] },
  { id: "AC-2", name: "Carta Vermelha", type: "Ação", colors: ["Vermelho"] },
];
const cardIndex = createCardIndex(cards);

// Gera um deck principal válido de 50 cartas azuis (13 cartas x 4, menos 2).
const blueCards = Array.from({ length: 13 }, (_, i) => ({ id: `AZ-${i}`, name: `Azul ${i}`, type: "Ação", colors: ["Azul"] }));
const fullIndex = createCardIndex([...cards, ...blueCards]);
const fullMain = Object.fromEntries(blueCards.map((c, i) => [c.id, i < 12 ? 4 : 2])); // 12*4 + 2 = 50

test("normaliza dados persistidos e ignora dropPile antigo", () => {
  assert.deepEqual(
    normalizeBuild({ alterEgoId: "AE-1", mainDeck: { "AC-1": 2, REMOVIDA: 1, "AE-1": 1 }, sideboard: { "AC-1": 1, FALSA: 2 }, dropPile: { Azul: 3 } }, cardIndex),
    { alterEgoId: "AE-1", mainDeck: { "AC-1": 2 }, sideboard: { "AC-1": 1 } }
  );
});

test("build antigo sem sideboard carrega com sideboard vazio", () => {
  assert.deepEqual(normalizeBuild({ alterEgoId: "AE-1", mainDeck: { "AC-1": 2 }, dropPile: { Azul: 10 } }, cardIndex).sideboard, {});
});

test("valida cores, cópias e tamanhos", () => {
  const issues = validateDeck({ alterEgo: cards[0], mainDeck: { "AC-1": 5, "AC-2": 1 }, cardIndex });
  assert.ok(issues.some((issue) => issue.includes("máximo de 4")));
  assert.ok(issues.some((issue) => issue.includes("cores não permitidas")));
  assert.ok(issues.some((issue) => issue.includes("Deck principal: 6/50")));
});

test("deck de 50 com sideboard vazio é válido (drops não são validados)", () => {
  assert.deepEqual(validateDeck({ alterEgo: cards[0], mainDeck: fullMain, sideboard: {}, cardIndex: fullIndex }), []);
});

test("sideboard com até 15 cartas é válido", () => {
  const sideboard = { "AC-1": 4, "AZ-12": 2 }; // AZ-12 tem 2 no deck -> 4 no total
  assert.deepEqual(validateDeck({ alterEgo: cards[0], mainDeck: fullMain, sideboard, cardIndex: fullIndex }), []);
});

test("sideboard acima de 15 cartas é rejeitado", () => {
  const extra = Array.from({ length: 4 }, (_, i) => ({ id: `SB-${i}`, name: `Side ${i}`, type: "Ação", colors: ["Azul"] }));
  const idx = createCardIndex([...cards, ...blueCards, ...extra]);
  const sideboard = Object.fromEntries(extra.map((c) => [c.id, 4])); // 16
  const issues = validateDeck({ alterEgo: cards[0], mainDeck: fullMain, sideboard, cardIndex: idx });
  assert.ok(issues.some((issue) => issue.includes("Sideboard: 16/15")));
});

test("limite de 4 cópias soma deck + sideboard", () => {
  const sideboard = { "AZ-0": 1 }; // AZ-0 já tem 4 no deck
  const issues = validateDeck({ alterEgo: cards[0], mainDeck: fullMain, sideboard, cardIndex: fullIndex });
  assert.ok(issues.some((issue) => issue.includes("Azul 0: máximo de 4 cópias (deck + sideboard)")));
  assert.equal(combinedCopies(fullMain, sideboard, "AZ-0"), 5);
});

test("sideboard respeita as cores do Alter Ego", () => {
  const issues = validateDeck({ alterEgo: cards[0], mainDeck: fullMain, sideboard: { "AC-2": 1 }, cardIndex: fullIndex });
  assert.ok(issues.some((issue) => issue.includes("Carta Vermelha usa cores não permitidas")));
});

test("drops padrão: 10 de cada cor do Alter Ego", () => {
  assert.deepEqual(standardDropPile({ colors: ["Vermelho", "Verde"] }), { Vermelho: 10, Verde: 10 });
  assert.deepEqual(standardDropPile(null), {});
});

test("exportação tolera carta removida e lista sideboard e drops padrão", () => {
  const text = createExportText({ alterEgo: cards[0], mainDeck: { "AC-1": 1, REMOVIDA: 2 }, sideboard: { "AC-1": 2 }, cardIndex });
  assert.match(text, /Carta indisponível \[REMOVIDA\]/);
  assert.match(text, /SIDEBOARD \(2\/15\)\n2x Carta Azul \[AC-1\]/);
  assert.match(text, /DROPS \(10\)\n10x Drop Azul/);
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