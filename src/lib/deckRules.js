export const DECK_RULES = Object.freeze({ mainDeckSize: 50, dropPileSize: 10, maxCopies: 4 });

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function colorsSubset(cardColors, allowedColors) {
  return Array.isArray(cardColors) && cardColors.every((color) => allowedColors.includes(color));
}

export function countEntries(entries) {
  return Object.values(entries).reduce((total, quantity) => total + (isPositiveInteger(quantity) ? quantity : 0), 0);
}

export function createCardIndex(cards) {
  return new Map(cards.map((card) => [card.id, card]));
}

function normalizeQuantities(entries, isAllowedKey) {
  if (!isRecord(entries)) return {};
  return Object.fromEntries(Object.entries(entries).filter(([key, quantity]) => isAllowedKey(key) && isPositiveInteger(quantity)));
}

export function normalizeBuild(rawBuild, cardIndex, gameColors) {
  const raw = isRecord(rawBuild) ? rawBuild : {};
  const alterEgo = cardIndex.get(raw.alterEgoId);
  const alterEgoId = alterEgo?.type === "Alter Ego" ? alterEgo.id : null;
  if (!alterEgoId) return { alterEgoId: null, mainDeck: {}, dropPile: {} };
  return {
    alterEgoId,
    mainDeck: normalizeQuantities(raw.mainDeck, (id) => {
      const card = cardIndex.get(id);
      return card && card.type !== "Alter Ego" && card.type !== "Drop";
    }),
    dropPile: normalizeQuantities(raw.dropPile, (color) => gameColors.includes(color)),
  };
}

export function normalizeSavedDeckIndex(rawIndex) {
  if (!Array.isArray(rawIndex)) return [];
  const keys = new Set();
  return rawIndex.filter((entry) => {
    if (!isRecord(entry) || typeof entry.key !== "string" || !entry.key) return false;
    if (typeof entry.name !== "string" || !entry.name.trim() || keys.has(entry.key)) return false;
    keys.add(entry.key);
    return true;
  });
}

export function validateDeck({ alterEgo, mainDeck, dropPile, cardIndex, rules = DECK_RULES }) {
  const issues = [];
  const safeMainDeck = isRecord(mainDeck) ? mainDeck : {};
  const safeDropPile = isRecord(dropPile) ? dropPile : {};
  if (!alterEgo) return ["Nenhum Alter Ego selecionado."];
  for (const [id, quantity] of Object.entries(safeMainDeck)) {
    const card = cardIndex.get(id);
    if (!card || card.type === "Alter Ego" || card.type === "Drop") {
      issues.push(`Carta inválida no deck: ${id}.`);
      continue;
    }
    if (!isPositiveInteger(quantity)) {
      issues.push(`Quantidade inválida para ${card.name}.`);
      continue;
    }
    if (quantity > rules.maxCopies) issues.push(`${card.name}: máximo de ${rules.maxCopies} cópias.`);
    if (!colorsSubset(card.colors, alterEgo.colors)) issues.push(`${card.name} usa cores não permitidas pelo Alter Ego.`);
  }
  for (const [color, quantity] of Object.entries(safeDropPile)) {
    if (!isPositiveInteger(quantity)) issues.push(`Quantidade inválida de Drop ${color}.`);
    else if (!alterEgo.colors.includes(color)) issues.push(`Drop ${color} não é permitido pelo Alter Ego.`);
  }
  const mainDeckCount = countEntries(safeMainDeck);
  const dropCount = countEntries(safeDropPile);
  if (mainDeckCount !== rules.mainDeckSize) issues.push(`Deck principal: ${mainDeckCount}/${rules.mainDeckSize} cartas.`);
  if (dropCount !== rules.dropPileSize) issues.push(`Monte de Drops: ${dropCount}/${rules.dropPileSize}.`);
  return issues;
}

export function colorBreakdown(mainDeck, dropPile, cardIndex) {
  const deckCounts = {};
  let deckTotal = 0;
  for (const [id, quantity] of Object.entries(isRecord(mainDeck) ? mainDeck : {})) {
    if (!isPositiveInteger(quantity)) continue;
    const card = cardIndex.get(id);
    if (!card || card.type === "Alter Ego" || card.type === "Drop") continue;
    if (!Array.isArray(card.colors) || card.colors.length === 0) continue;
    const color = card.colors[0];
    deckCounts[color] = (deckCounts[color] || 0) + quantity;
    deckTotal += quantity;
  }
  const dropCounts = {};
  let dropTotal = 0;
  for (const [color, quantity] of Object.entries(isRecord(dropPile) ? dropPile : {})) {
    if (!isPositiveInteger(quantity)) continue;
    dropCounts[color] = (dropCounts[color] || 0) + quantity;
    dropTotal += quantity;
  }
  return { deckCounts, deckTotal, dropCounts, dropTotal };
}

export function createExportText({ alterEgo, mainDeck, dropPile, cardIndex, rules = DECK_RULES }) {
  if (!alterEgo) return "";
  const cards = Object.entries(isRecord(mainDeck) ? mainDeck : {})
    .filter(([, quantity]) => isPositiveInteger(quantity))
    .map(([id, quantity]) => ({ id, quantity, card: cardIndex.get(id) }))
    .sort((a, b) => (a.card?.name || a.id).localeCompare(b.card?.name || b.id));
  const drops = Object.entries(isRecord(dropPile) ? dropPile : {}).filter(([, quantity]) => isPositiveInteger(quantity));
  return [
    `ALTER EGO: ${alterEgo.name} [${alterEgo.id}]`, `CORES: ${alterEgo.colors.join(" / ")}`, "",
    `DECK (${countEntries(mainDeck || {})}/${rules.mainDeckSize})`,
    ...cards.map(({ id, quantity, card }) => card ? `${quantity}x ${card.name} [${card.id}]` : `${quantity}x Carta indisponível [${id}]`),
    "", `DROPS (${countEntries(dropPile || {})}/${rules.dropPileSize})`,
    ...drops.map(([color, quantity]) => `${quantity}x Drop ${color}`),
  ].join("\n");
}

/**
 * Conta quantas cartas do deck existem em cada valor de custo. Usado no
 * gráfico de curva de custo — ajuda a ver se o deck está bem balanceado
 * ou "pesado" demais em cartas caras.
 */
export function costCurve(mainDeck, cardIndex) {
  const counts = {};
  let maxCost = 0;
  for (const [id, quantity] of Object.entries(isRecord(mainDeck) ? mainDeck : {})) {
    if (!isPositiveInteger(quantity)) continue;
    const card = cardIndex.get(id);
    if (!card || typeof card.cost !== "number") continue;
    counts[card.cost] = (counts[card.cost] || 0) + quantity;
    if (card.cost > maxCost) maxCost = card.cost;
  }
  return { counts, maxCost };
}

/**
 * Agrupa as cartas do deck por tipo (Ação/Reação/Tática) e, dentro de cada
 * tipo, por subtipo (ofensiva/defensiva/etc). Usado no gráfico de
 * composição do deck.
 */
export function typeSubtypeBreakdown(mainDeck, cardIndex) {
  const breakdown = {};
  let total = 0;
  for (const [id, quantity] of Object.entries(isRecord(mainDeck) ? mainDeck : {})) {
    if (!isPositiveInteger(quantity)) continue;
    const card = cardIndex.get(id);
    if (!card) continue;
    const subtype = card.subtype || "—";
    if (!breakdown[card.type]) breakdown[card.type] = {};
    breakdown[card.type][subtype] = (breakdown[card.type][subtype] || 0) + quantity;
    total += quantity;
  }
  return { breakdown, total };
}

/**
 * Calcula a média de Ataque (cartas ofensivas) e Defesa (cartas
 * defensivas) do deck, ponderada pela quantidade de cada carta.
 */
export function attackDefenseAverages(mainDeck, cardIndex) {
  let attackSum = 0;
  let attackCount = 0;
  let defenseSum = 0;
  let defenseCount = 0;
  for (const [id, quantity] of Object.entries(isRecord(mainDeck) ? mainDeck : {})) {
    if (!isPositiveInteger(quantity)) continue;
    const card = cardIndex.get(id);
    const attributes = card?.attributes;
    if (!attributes) continue;
    if (typeof attributes.ataque === "number") {
      attackSum += attributes.ataque * quantity;
      attackCount += quantity;
    }
    if (typeof attributes.defesa === "number") {
      defenseSum += attributes.defesa * quantity;
      defenseCount += quantity;
    }
  }
  return {
    avgAttack: attackCount ? attackSum / attackCount : null,
    avgDefense: defenseCount ? defenseSum / defenseCount : null,
    attackCount,
    defenseCount,
  };
}