import { Router } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { validateDeck, createCardIndex } from "../../src/lib/deckRules.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CARDS_JSON_PATH = join(__dirname, "../../src/data/modelo_cartas.json");

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Carrega o banco de cartas do disco a cada chamada (mesmo padrão usado em
 * routes/cards.js) e monta o índice + a lista de cores válidas do jogo,
 * usados para validar decks publicados com as MESMAS regras do front-end.
 */
function loadCardData() {
  const data = JSON.parse(readFileSync(CARDS_JSON_PATH, "utf-8"));
  return { cardIndex: createCardIndex(data.cards), colors: data.colors };
}

/**
 * GET /api/decks/community — Lista todos os decks publicados (público)
 */
router.get("/community", optionalAuth, (req, res) => {
  try {
    const decks = req.db.prepare(`
      SELECT
        d.id, d.name, d.alter_ego_id, d.main_deck, d.drop_pile,
        d.description, d.created_at,
        u.username AS author
      FROM community_decks d
      JOIN users u ON u.id = d.user_id
      ORDER BY d.id DESC
      LIMIT 100
    `).all();

    const parsed = decks.map((d) => ({
      ...d,
      main_deck: JSON.parse(d.main_deck),
      drop_pile: JSON.parse(d.drop_pile),
      is_mine: req.user ? d.user_id === req.user.id : false,
    }));

    // Remove user_id do response
    const safe = parsed.map(({ user_id, ...rest }) => rest);

    res.json(safe);
  } catch (err) {
    console.error("[decks] community error:", err);
    res.status(500).json({ error: "Erro ao buscar decks." });
  }
});

/**
 * GET /api/decks/me — Lista os decks do usuário autenticado
 */
router.get("/me", requireAuth, (req, res) => {
  try {
    const decks = req.db.prepare(`
      SELECT id, name, alter_ego_id, main_deck, drop_pile, description, created_at
      FROM community_decks
      WHERE user_id = ?
      ORDER BY id DESC
    `).all(req.user.id);

    const parsed = decks.map((d) => ({
      ...d,
      main_deck: JSON.parse(d.main_deck),
      drop_pile: JSON.parse(d.drop_pile),
    }));

    res.json(parsed);
  } catch (err) {
    console.error("[decks] me error:", err);
    res.status(500).json({ error: "Erro ao buscar seus decks." });
  }
});

/**
 * POST /api/decks — Publica um deck na comunidade
 */
router.post("/", requireAuth, (req, res) => {
  try {
    const { name, alter_ego_id, main_deck, drop_pile, description } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Nome do deck é obrigatório." });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `Nome deve ter no máximo ${MAX_NAME_LENGTH} caracteres.` });
    }
    if (!alter_ego_id || typeof alter_ego_id !== "string") {
      return res.status(400).json({ error: "Alter Ego é obrigatório." });
    }
    if (!main_deck || typeof main_deck !== "object") {
      return res.status(400).json({ error: "Deck principal é obrigatório." });
    }
    if (!drop_pile || typeof drop_pile !== "object") {
      return res.status(400).json({ error: "Monte de Drops é obrigatório." });
    }

    // Valida o deck com as MESMAS regras do front-end (src/lib/deckRules.js):
    // cartas existem de verdade, cores batem com o Alter Ego, máximo de
    // cópias, tamanho exato do deck e do monte de Drops. Isso impede que um
    // deck incompleto ou adulterado (bug no cliente, ou alguém chamando a
    // API direto) polua a comunidade e as estatísticas do admin.
    const { cardIndex, colors: gameColors } = loadCardData();
    const alterEgo = cardIndex.get(alter_ego_id);
    if (!alterEgo || alterEgo.type !== "Alter Ego") {
      return res.status(400).json({ error: "Alter Ego inválido." });
    }
    if (!Array.isArray(gameColors) || gameColors.length === 0) {
      return res.status(500).json({ error: "Erro ao validar deck (dados de cores indisponíveis)." });
    }

    const issues = validateDeck({ alterEgo, mainDeck: main_deck, dropPile: drop_pile, cardIndex });
    if (issues.length > 0) {
      return res.status(400).json({ error: "Deck inválido.", issues });
    }

    const safeDescription = typeof description === "string"
      ? description.slice(0, MAX_DESCRIPTION_LENGTH)
      : "";

    const result = req.db.prepare(`
      INSERT INTO community_decks (user_id, name, alter_ego_id, main_deck, drop_pile, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      name.trim().slice(0, MAX_NAME_LENGTH),
      alter_ego_id,
      JSON.stringify(main_deck),
      JSON.stringify(drop_pile),
      safeDescription
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      message: "Deck publicado com sucesso!",
    });
  } catch (err) {
    console.error("[decks] create error:", err);
    res.status(500).json({ error: "Erro ao publicar deck." });
  }
});

/**
 * DELETE /api/decks/:id — Remove um deck (só o dono pode)
 */
router.delete("/:id", requireAuth, (req, res) => {
  try {
    const deckId = parseInt(req.params.id, 10);
    if (!Number.isFinite(deckId)) {
      return res.status(400).json({ error: "ID inválido." });
    }

    const deck = req.db.prepare("SELECT user_id FROM community_decks WHERE id = ?").get(deckId);
    if (!deck) {
      return res.status(404).json({ error: "Deck não encontrado." });
    }
    if (deck.user_id !== req.user.id) {
      return res.status(403).json({ error: "Você só pode remover seus próprios decks." });
    }

    req.db.prepare("DELETE FROM community_decks WHERE id = ?").run(deckId);
    res.json({ message: "Deck removido." });
  } catch (err) {
    console.error("[decks] delete error:", err);
    res.status(500).json({ error: "Erro ao remover deck." });
  }
});

/**
 * GET /api/decks/:id — Pega um deck específico (para comparação)
 */
router.get("/:id", optionalAuth, (req, res) => {
  try {
    const deckId = parseInt(req.params.id, 10);
    if (!Number.isFinite(deckId)) {
      return res.status(400).json({ error: "ID inválido." });
    }

    const deck = req.db.prepare(`
      SELECT
        d.id, d.name, d.alter_ego_id, d.main_deck, d.drop_pile,
        d.description, d.created_at,
        u.username AS author
      FROM community_decks d
      JOIN users u ON u.id = d.user_id
      WHERE d.id = ?
    `).get(deckId);

    if (!deck) {
      return res.status(404).json({ error: "Deck não encontrado." });
    }

    res.json({
      ...deck,
      main_deck: JSON.parse(deck.main_deck),
      drop_pile: JSON.parse(deck.drop_pile),
    });
  } catch (err) {
    console.error("[decks] get error:", err);
    res.status(500).json({ error: "Erro ao buscar deck." });
  }
});

export default router;
