import { Router } from "express";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CARDS_JSON_PATH = join(__dirname, "../../src/data/modelo_cartas.json");

function readCardsData() {
  return JSON.parse(readFileSync(CARDS_JSON_PATH, "utf-8"));
}

function writeCardsData(data) {
  writeFileSync(CARDS_JSON_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * GET /api/admin/cards — Lista todas as cartas + metadados do JSON
 */
router.get("/", requireAdmin, (req, res) => {
  try {
    const data = readCardsData();
    res.json({
      cards: data.cards,
      meta: {
        colors: data.colors,
        types: data.types,
        known_keywords: data.known_keywords,
      },
    });
  } catch (err) {
    console.error("[admin/cards] list error:", err);
    res.status(500).json({ error: "Erro ao buscar cartas." });
  }
});

/**
 * POST /api/admin/cards — Adiciona uma nova carta ao JSON
 */
router.post("/", requireAdmin, (req, res) => {
  try {
    const { id, name, type, subtype, colors, cost, attributes, effect, keywords } = req.body || {};

    // Validações
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return res.status(400).json({ error: "ID da carta é obrigatório." });
    }
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Nome da carta é obrigatório." });
    }
    if (!type || typeof type !== "string") {
      return res.status(400).json({ error: "Tipo é obrigatório." });
    }
    if (!Array.isArray(colors) || colors.length === 0) {
      return res.status(400).json({ error: "Pelo menos uma cor é obrigatória." });
    }

    const data = readCardsData();

    // Verifica se ID já existe
    if (data.cards.some((c) => c.id === id.trim())) {
      return res.status(409).json({ error: `Já existe uma carta com o ID "${id}".` });
    }

    // Valida tipo
    if (!data.types[type]) {
      return res.status(400).json({ error: `Tipo "${type}" não é válido.` });
    }

    // Monta o objeto da carta
    const card = {
      id: id.trim(),
      name: name.trim(),
      type,
      subtype: subtype || null,
      colors,
      cost: data.types[type].has_cost ? (typeof cost === "number" ? cost : parseInt(cost, 10) || 0) : null,
      attributes: attributes || {},
      effect: effect && effect.trim() ? effect.trim() : null,
      keywords: Array.isArray(keywords) ? keywords : [],
    };

    data.cards.push(card);
    writeCardsData(data);

    res.status(201).json({ message: `Carta "${card.name}" adicionada com sucesso!`, card });
  } catch (err) {
    console.error("[admin/cards] create error:", err);
    res.status(500).json({ error: "Erro ao adicionar carta." });
  }
});

/**
 * PUT /api/admin/cards/:id — Edita uma carta existente
 */
router.put("/:id", requireAdmin, (req, res) => {
  try {
    const cardId = req.params.id;
    const { name, type, subtype, colors, cost, attributes, effect, keywords } = req.body || {};

    const data = readCardsData();
    const index = data.cards.findIndex((c) => c.id === cardId);
    if (index === -1) {
      return res.status(404).json({ error: "Carta não encontrada." });
    }

    // Atualiza campos fornecidos
    if (name) data.cards[index].name = name.trim();
    if (type) data.cards[index].type = type;
    if (subtype !== undefined) data.cards[index].subtype = subtype || null;
    if (Array.isArray(colors)) data.cards[index].colors = colors;
    if (cost !== undefined) {
      const typeInfo = data.types[data.cards[index].type];
      data.cards[index].cost = typeInfo?.has_cost ? (typeof cost === "number" ? cost : parseInt(cost, 10) || 0) : null;
    }
    if (attributes !== undefined) data.cards[index].attributes = attributes;
    if (effect !== undefined) data.cards[index].effect = effect && effect.trim() ? effect.trim() : null;
    if (keywords !== undefined) data.cards[index].keywords = Array.isArray(keywords) ? keywords : [];

    writeCardsData(data);

    res.json({ message: `Carta "${data.cards[index].name}" atualizada.`, card: data.cards[index] });
  } catch (err) {
    console.error("[admin/cards] update error:", err);
    res.status(500).json({ error: "Erro ao atualizar carta." });
  }
});

/**
 * DELETE /api/admin/cards/:id — Remove uma carta do JSON
 */
router.delete("/:id", requireAdmin, (req, res) => {
  try {
    const cardId = req.params.id;
    const data = readCardsData();
    const index = data.cards.findIndex((c) => c.id === cardId);
    if (index === -1) {
      return res.status(404).json({ error: "Carta não encontrada." });
    }
    const removed = data.cards.splice(index, 1)[0];
    writeCardsData(data);
    res.json({ message: `Carta "${removed.name}" removida.` });
  } catch (err) {
    console.error("[admin/cards] delete error:", err);
    res.status(500).json({ error: "Erro ao remover carta." });
  }
});

export default router;
