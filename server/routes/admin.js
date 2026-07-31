import { Router } from "express";
import bcrypt from "bcryptjs";
import { requireAdmin, requireSuperAdmin, signUserToken } from "../middleware/auth.js";
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

    const user = { id: 0, username: ADMIN_USERNAME, role: "superadmin" };
    const token = signUserToken(user);

    res.json({ token, user });
  } catch (err) {
    console.error("[admin] login error:", err);
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * GET /api/admin/users — Lista todos os usuários
 */
router.get("/users", requireAdmin, (req, res) => {
  try {
    const users = req.db.prepare(`
      SELECT id, username, email, avatar_url, role, created_at FROM users ORDER BY id DESC
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
    const user = req.db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(userId);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }
    if (["admin", "superadmin"].includes(user.role) && req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Apenas o administrador principal pode remover administradores." });
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
 * PUT /api/admin/users/:id/role — Promove/rebaixa usuários.
 * Só o superadmin pode alterar permissões administrativas.
 */
router.put("/users/:id/role", requireSuperAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role } = req.body || {};
    const allowedRoles = new Set(["player", "admin"]);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: "ID inválido." });
    }
    if (!allowedRoles.has(role)) {
      return res.status(400).json({ error: "Cargo inválido. Use player ou admin." });
    }

    const user = req.db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(userId);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }
    if (user.role === "superadmin") {
      return res.status(403).json({ error: "O administrador principal não pode ser alterado por este painel." });
    }

    req.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
    const updated = req.db.prepare("SELECT id, username, email, avatar_url, role, created_at FROM users WHERE id = ?").get(userId);
    res.json({ message: `Usuário "${updated.username}" atualizado para ${role}.`, user: updated });
  } catch (err) {
    console.error("[admin] update role error:", err);
    res.status(500).json({ error: "Erro ao atualizar permissão." });
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
