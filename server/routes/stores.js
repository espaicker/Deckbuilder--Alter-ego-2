import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const MAX_NAME = 100;
const MAX_CITY = 80;
const MAX_STATE = 40;
const MAX_ADDRESS = 200;
const MAX_CONTACT = 200;

/**
 * POST /api/stores — qualquer usuario logado solicita cadastro de loja.
 * Fica approved = 0 (pendente) ate um admin aprovar.
 */
router.post("/", requireAuth, (req, res) => {
  const { name, city, state, address, contact_info } = req.body || {};

  if (!name || typeof name !== "string" || !name.trim() || name.length > MAX_NAME) {
    return res.status(400).json({ error: `Nome e obrigatorio (max. ${MAX_NAME} caracteres).` });
  }
  if (!city || typeof city !== "string" || !city.trim() || city.length > MAX_CITY) {
    return res.status(400).json({ error: "Cidade e obrigatoria." });
  }
  if (!state || typeof state !== "string" || !state.trim() || state.length > MAX_STATE) {
    return res.status(400).json({ error: "Estado e obrigatorio." });
  }
  const safeAddress =
    typeof address === "string" ? address.slice(0, MAX_ADDRESS) : null;
  const safeContact =
    typeof contact_info === "string" ? contact_info.slice(0, MAX_CONTACT) : null;

  const result = req.db
    .prepare(
      `INSERT INTO stores (name, city, state, address, contact_info, owner_user_id, approved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .run(
      name.trim(),
      city.trim(),
      state.trim(),
      safeAddress,
      safeContact,
      req.user.id,
      Date.now()
    );

  res.status(201).json({
    id: result.lastInsertRowid,
    message: "Solicitacao enviada! Sua loja aparecera no diretorio apos aprovacao de um administrador.",
  });
});

/**
 * GET /api/stores — diretorio publico. So lojas approved = 1.
 * Inclui contagem de torneios associados. Nao expoe owner email pessoal.
 */
router.get("/", (req, res) => {
  const rows = req.db
    .prepare(
      `SELECT s.id, s.name, s.city, s.state, s.address, s.contact_info, s.created_at,
              (SELECT COUNT(*) FROM tournaments t WHERE t.store_id = s.id) AS tournament_count
       FROM stores s
       WHERE s.approved = 1
       ORDER BY s.name ASC`
    )
    .all();
  res.json(rows);
});

/**
 * GET /api/stores/mine — lojas aprovadas do usuario logado (para vincular torneio).
 */
router.get("/mine", requireAuth, (req, res) => {
  const rows = req.db
    .prepare(
      "SELECT id, name, city, state, approved FROM stores WHERE owner_user_id = ? ORDER BY name ASC"
    )
    .all(req.user.id);
  res.json(rows);
});

export default router;
