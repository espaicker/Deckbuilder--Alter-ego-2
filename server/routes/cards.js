import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../middleware/auth.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CARDS_JSON_PATH = join(__dirname, "../../src/data/modelo_cartas.json");

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

const CARDS_IMG_DIR = join(__dirname, "../../public/assets/cards");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_MAP = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

/**
 * POST /api/admin/cards/:id/image — Upload de imagem para uma carta
 * Recebe multipart/form-data com campo "image"
 */
router.post("/:id/image", requireAdmin, (req, res) => {
  const cardId = req.params.id;

  // Validate card exists
  const data = readCardsData();
  if (!data.cards.some((c) => c.id === cardId)) {
    return res.status(404).json({ error: "Carta nao encontrada." });
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return res.status(400).json({ error: "Envie como multipart/form-data." });
  }

  // Collect raw body
  const chunks = [];
  let size = 0;

  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_IMAGE_SIZE) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (size > MAX_IMAGE_SIZE) {
      return res.status(413).json({ error: "Imagem muito grande (max 5MB)." });
    }

    const raw = Buffer.concat(chunks);
    const boundary = contentType.split("boundary=")[1];
    if (!boundary) return res.status(400).json({ error: "Boundary nao encontrado." });

    // Parse multipart manually (simple single-file)
    const parts = raw.toString("binary").split("--" + boundary);
    let imageBuffer = null;
    let mimeType = null;

    for (const part of parts) {
      if (part.includes("Content-Disposition") && part.includes('name="image"')) {
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd === -1) continue;
        const headers = part.slice(0, headerEnd);
        const body = part.slice(headerEnd + 4);
        // Remove trailing \r\n--
        const cleaned = body.replace(/\r\n$/, "");
        imageBuffer = Buffer.from(cleaned, "binary");

        const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
        mimeType = ctMatch ? ctMatch[1].trim() : "image/jpeg";
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({ error: "Nenhuma imagem encontrada no upload." });
    }
    if (!ALLOWED_TYPES.has(mimeType)) {
      return res.status(400).json({ error: "Tipo de imagem invalido. Use JPG, PNG ou WebP." });
    }

    // Save file
    if (!existsSync(CARDS_IMG_DIR)) {
      mkdirSync(CARDS_IMG_DIR, { recursive: true });
    }

    const ext = EXT_MAP[mimeType] || ".jpg";
    const filename = cardId + ext;
    const filepath = join(CARDS_IMG_DIR, filename);
    writeFileSync(filepath, imageBuffer);

    res.json({ message: "Imagem salva!", filename });
  });

  req.on("error", () => {
    res.status(500).json({ error: "Erro ao processar upload." });
  });
});

export default router;
