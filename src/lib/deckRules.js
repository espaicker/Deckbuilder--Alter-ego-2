/**
 * Regras de construção:
 * - Deck principal: exatamente 50 cartas.
 * - Sideboard: até 15 cartas extras, trocáveis com o deck antes das partidas.
 * - Limite de cópias (4) vale para deck + sideboard somados, como no Magic.
 * - Drops: não são escolhidos pelo jogador. Todo deck leva sempre 10 Drops de
 *   cada cor do Alter Ego, e o jogador decide a composição na hora de jogar.
 */
export const DECK_RULES = Object.freeze({ mainDeckSize: 50, sideboardMaxSize: 15, dropsPerColor: 10, maxCopies: 4 });

/** Monte de Drops padrão do Alter Ego: sempre `dropsPerColor` de cada cor dele. */
export function standardDropPile(alterEgo, rules = DECK_RULES) {
  if (!alterEgo || !Array.isArray(alterEgo.colors)) return {};
  return Object.fromEntries(alterEgo.colors.map((color) => [color, rules.dropsPerColor]));
}

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

function isPlayableCard(card) {
  return !!card && card.type !== "Alter Ego" && card.type !== "Drop";
}

/**
 * Normaliza um build salvo (localStorage / deck nomeado). Builds antigos com
 * `dropPile` continuam carregando: o monte salvo é simplesmente ignorado,
 * porque os Drops agora são sempre o padrão do Alter Ego.
 */
export function normalizeBuild(rawBuild, cardIndex) {
  const raw = isRecord(rawBuild) ? rawBuild : {};
  const alterEgo = cardIndex.get(raw.alterEgoId);
  const alterEgoId = alterEgo?.type === "Alter Ego" ? alterEgo.id : null;
  if (!alterEgoId) return { alterEgoId: null, mainDeck: {}, sideboard: {} };
  const isPlayableId = (id) => isPlayableCard(cardIndex.get(id));
  return {
    alterEgoId,
    mainDeck: normalizeQuantities(raw.mainDeck, isPlayableId),
    sideboard: normalizeQuantities(raw.sideboard, isPlayableId),
  };
}

/** Soma de cópias de uma carta no deck principal + sideboard. */
export function combinedCopies(mainDeck, sideboard, cardId) {
  const main = isRecord(mainDeck) && isPositiveInteger(mainDeck[cardId]) ? mainDeck[cardId] : 0;
  const side = isRecord(sideboard) && isPositiveInteger(sideboard[cardId]) ? sideboard[cardId] : 0;
  return main + side;
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

function validateSection(entries, label, alterEgo, cardIndex, issues) {
  for (const [id, quantity] of Object.entries(entries)) {
    const card = cardIndex.get(id);
    if (!isPlayableCard(card)) {
      issues.push(`Carta inválida no ${label}: ${id}.`);
      continue;
    }
    if (!isPositiveInteger(quantity)) {
      issues.push(`Quantidade inválida para ${card.name} no ${label}.`);
      continue;
    }
    if (!colorsSubset(card.colors, alterEgo.colors)) issues.push(`${card.name} usa cores não permitidas pelo Alter Ego.`);
  }
}

/**
 * Valida deck principal + sideboard. Drops não são validados: são sempre o
 * monte padrão do Alter Ego (ver standardDropPile).
 */
export function validateDeck({ alterEgo, mainDeck, sideboard, cardIndex, rules = DECK_RULES }) {
  const issues = [];
  const safeMainDeck = isRecord(mainDeck) ? mainDeck : {};
  const safeSideboard = isRecord(sideboard) ? sideboard : {};
  if (!alterEgo) return ["Nenhum Alter Ego selecionado."];

  validateSection(safeMainDeck, "deck", alterEgo, cardIndex, issues);
  validateSection(safeSideboard, "sideboard", alterEgo, cardIndex, issues);

  // Limite de cópias conta deck + sideboard juntos.
  const ids = new Set([...Object.keys(safeMainDeck), ...Object.keys(safeSideboard)]);
  for (const id of ids) {
    const card = cardIndex.get(id);
    if (!isPlayableCard(card)) continue;
    if (combinedCopies(safeMainDeck, safeSideboard, id) > rules.maxCopies) {
      issues.push(`${card.name}: máximo de ${rules.maxCopies} cópias (deck + sideboard).`);
    }
  }

  const mainDeckCount = countEntries(safeMainDeck);
  const sideboardCount = countEntries(safeSideboard);
  if (mainDeckCount !== rules.mainDeckSize) issues.push(`Deck principal: ${mainDeckCount}/${rules.mainDeckSize} cartas.`);
  if (sideboardCount > rules.sideboardMaxSize) issues.push(`Sideboard: ${sideboardCount}/${rules.sideboardMaxSize} cartas (máximo ${rules.sideboardMaxSize}).`);
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

function exportLines(entries, cardIndex) {
  return Object.entries(isRecord(entries) ? entries : {})
    .filter(([, quantity]) => isPositiveInteger(quantity))
    .map(([id, quantity]) => ({ id, quantity, card: cardIndex.get(id) }))
    .sort((a, b) => (a.card?.name || a.id).localeCompare(b.card?.name || b.id))
    .map(({ id, quantity, card }) => card ? `${quantity}x ${card.name} [${card.id}]` : `${quantity}x Carta indisponível [${id}]`);
}

export function createExportText({ alterEgo, mainDeck, sideboard, cardIndex, rules = DECK_RULES }) {
  if (!alterEgo) return "";
  const sideLines = exportLines(sideboard, cardIndex);
  const drops = Object.entries(standardDropPile(alterEgo, rules));
  return [
    `ALTER EGO: ${alterEgo.name} [${alterEgo.id}]`, `CORES: ${alterEgo.colors.join(" / ")}`, "",
    `DECK (${countEntries(mainDeck || {})}/${rules.mainDeckSize})`,
    ...exportLines(mainDeck, cardIndex),
    "", `SIDEBOARD (${countEntries(sideboard || {})}/${rules.sideboardMaxSize})`,
    ...(sideLines.length ? sideLines : ["(vazio)"]),
    "", `DROPS (${drops.reduce((total, [, quantity]) => total + quantity, 0)})`,
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