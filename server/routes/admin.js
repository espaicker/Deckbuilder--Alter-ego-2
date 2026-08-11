import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../middleware/auth.js";
import { getAdminCredentials } from "../secrets.js";
import { adminLoginLimiter } from "../middleware/rateLimit.js";

const router = Router();

// Credenciais de admin: vêm de ADMIN_USERNAME/ADMIN_PASSWORD (env) ou são
// geradas automaticamente na primeira execução — nunca ficam em texto puro
// no código-fonte. Veja server/secrets.js.
const { username: ADMIN_USERNAME, passwordHash: ADMIN_PASSWORD_HASH } = getAdminCredentials();

/**
 * POST /api/admin/login — Login de admin
 */
router.post("/login", adminLoginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "Usuário e senha são obrigatórios." });
    }

    if (username !== ADMIN_USERNAME) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!valid) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const token = jwt.sign(
      { sub: 0, username: ADMIN_USERNAME, role: "admin" },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ token, user: { id: 0, username: ADMIN_USERNAME, role: "admin" } });
  } catch (err) {
    console.error("[admin] login error:", err);
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * Middleware que exige role admin no token
 */
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
 * GET /api/admin/users — Lista todos os usuários
 */
router.get("/users", requireAdmin, (req, res) => {
  try {
    const users = req.db.prepare(`
      SELECT id, username, created_at FROM users ORDER BY id DESC
    `).all();
    res.json(users);
  } catch (err) {
    console.error("[admin] users error:", err);
    res.status(500).json({ error: "Erro ao buscar usuários." });
  }
});

/**
 * DELETE /api/admin/users/:id — Remove um usuário e todos os seus decks
 */
router.delete("/users/:id", requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: "ID inválido." });
    }
    const user = req.db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }
    // Remove decks first, then user
    req.db.prepare("DELETE FROM community_decks WHERE user_id = ?").run(userId);
    req.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    res.json({ message: `Usuário "${user.username}" e seus decks foram removidos.` });
  } catch (err) {
    console.error("[admin] delete user error:", err);
    res.status(500).json({ error: "Erro ao remover usuário." });
  }
});

/**
 * GET /api/admin/decks — Lista todos os decks com info do autor
 */
router.get("/decks", requireAdmin, (req, res) => {
  try {
    const decks = req.db.prepare(`
      SELECT
        d.id, d.name, d.alter_ego_id, d.main_deck, d.drop_pile,
        d.description, d.created_at, d.user_id,
        u.username AS author
      FROM community_decks d
      JOIN users u ON u.id = d.user_id
      ORDER BY d.id DESC
    `).all();

    const parsed = decks.map((d) => ({
      ...d,
      main_deck: JSON.parse(d.main_deck),
      drop_pile: JSON.parse(d.drop_pile),
    }));

    res.json(parsed);
  } catch (err) {
    console.error("[admin] decks error:", err);
    res.status(500).json({ error: "Erro ao buscar decks." });
  }
});

/**
 * DELETE /api/admin/decks/:id — Remove qualquer deck (admin override)
 */
router.delete("/decks/:id", requireAdmin, (req, res) => {
  try {
    const deckId = parseInt(req.params.id, 10);
    if (!Number.isFinite(deckId)) {
      return res.status(400).json({ error: "ID inválido." });
    }
    const deck = req.db.prepare("SELECT id, name FROM community_decks WHERE id = ?").get(deckId);
    if (!deck) {
      return res.status(404).json({ error: "Deck não encontrado." });
    }
    req.db.prepare("DELETE FROM community_decks WHERE id = ?").run(deckId);
    res.json({ message: `Deck "${deck.name}" removido.` });
  } catch (err) {
    console.error("[admin] delete deck error:", err);
    res.status(500).json({ error: "Erro ao remover deck." });
  }
});

/**
 * GET /api/admin/stats — Estatísticas gerais
 */
router.get("/stats", requireAdmin, (req, res) => {
  try {
    const totalUsers = req.db.prepare("SELECT COUNT(*) as count FROM users").get();
    const totalDecks = req.db.prepare("SELECT COUNT(*) as count FROM community_decks").get();
    const decksByAlterEgo = req.db.prepare(`
      SELECT alter_ego_id, COUNT(*) as count
      FROM community_decks
      GROUP BY alter_ego_id
      ORDER BY count DESC
    `).all();
    const topAuthors = req.db.prepare(`
      SELECT u.username, COUNT(d.id) as deck_count
      FROM users u
      LEFT JOIN community_decks d ON d.user_id = u.id
      GROUP BY u.id
      ORDER BY deck_count DESC
      LIMIT 10
    `).all();

    res.json({
      totalUsers: totalUsers?.count || 0,
      totalDecks: totalDecks?.count || 0,
      decksByAlterEgo,
      topAuthors,
    });
  } catch (err) {
    console.error("[admin] stats error:", err);
    res.status(500).json({ error: "Erro ao buscar estatísticas." });
  }
});

export default router;
