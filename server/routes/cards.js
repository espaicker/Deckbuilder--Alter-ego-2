import { Router } from "express";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import multer from "multer";
import sharp from "sharp";
import { join } from "path";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../middleware/auth.js";
import { CARDS_IMG_DIR } from "../lib/paths.js";
import { readCardData, writeCardData } from "../lib/cardStore.js";
import { writeFileAtomicSync } from "../lib/atomicWrite.js";

const router = Router();
const uploadImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Router publico montado em /api/cards: entrega os dados atuais das cartas
 * (DATA_DIR) para o frontend, sem exigir novo build apos edicoes do admin.
 * Sem autenticacao: os mesmos dados ja vao embutidos no bundle.
 */
export const publicCardsRouter = Router();

publicCardsRouter.get("/", (req, res) => {
  try {
    res.set("Cache-Control", "no-cache");
    res.json(readCardData());
  } catch (err) {
    console.error("[cards] public list error:", err);
    res.status(500).json({ error: "Erro ao buscar cartas." });
  }
});

function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido." });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "Acesso restrito a administradores." });
    }
    req.admin = { username: payload.username };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
}


/**
 * GET /api/admin/cards — Lista todas as cartas + metadados do JSON
 */
router.get("/", requireAdmin, (req, res) => {
  try {
    const data = readCardData();
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

    const data = readCardData();

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
    writeCardData(data);

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

    const data = readCardData();
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

    writeCardData(data);

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
    const data = readCardData();
    const index = data.cards.findIndex((c) => c.id === cardId);
    if (index === -1) {
      return res.status(404).json({ error: "Carta não encontrada." });
    }
    const removed = data.cards.splice(index, 1)[0];
    writeCardData(data);
    res.json({ message: `Carta "${removed.name}" removida.` });
  } catch (err) {
    console.error("[admin/cards] delete error:", err);
    res.status(500).json({ error: "Erro ao remover carta." });
  }
});

/**
 * POST /api/admin/cards/:id/image - upload de imagem da carta.
 * multer (memory) + sharp: valida imagem real, reprocessa e salva
 * SEMPRE como <ID>.jpg. Substitui o parser multipart manual antigo.
 */
router.post("/:id/image", requireAdmin, uploadImage.single("image"), async (req, res) => {
  try {
    const cardId = req.params.id;
    const data = readCardData();
    if (!data.cards.some((c) => c.id === cardId)) {
      return res.status(404).json({ error: "Carta nao encontrada." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Nenhuma imagem enviada." });
    }
    let processed;
    try {
      processed = await sharp(req.file.buffer).jpeg({ quality: 90 }).toBuffer();
    } catch (imgErr) {
      return res.status(400).json({ error: "Arquivo invalido. Envie uma imagem real (JPG, PNG ou WebP)." });
    }
    if (!existsSync(CARDS_IMG_DIR)) {
      mkdirSync(CARDS_IMG_DIR, { recursive: true });
    }
    [".png", ".webp"].forEach((ext) => {
      const old = join(CARDS_IMG_DIR, cardId + ext);
      if (existsSync(old)) { try { unlinkSync(old); } catch {} }
    });
    const filename = cardId + ".jpg";
    writeFileAtomicSync(join(CARDS_IMG_DIR, filename), processed);
    res.json({ message: "Imagem salva!", filename });
  } catch (err) {
    console.error("[admin/cards] image upload error:", err);
    res.status(500).json({ error: "Erro ao processar upload." });
  }
});

export default router;
