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


/**
 * GET /api/admin/analytics — Dados analíticos para o painel admin
 * Cartas mais jogadas nos decks vencedores + win% por arquétipo
 */
router.get("/analytics", requireAdmin, (req, res) => {
  try {
    // Top cards in winning decks (decks that won matches in official tournaments)
    const topCards = req.db.prepare(`
      SELECT card_id, card_name, card_type, times_used, wins,
        CASE WHEN times_used > 0 THEN ROUND((wins * 100.0 / times_used), 1) ELSE 0 END AS win_rate
      FROM (
        SELECT
          je.key AS card_id,
          je.value AS qty,
          (SELECT name FROM json_each(?) WHERE key = je.key LIMIT 1) AS card_name,
          COUNT(DISTINCT tm.id) AS times_used,
          SUM(CASE
            WHEN (tm.player1_id = tp.id AND tm.result = 'player1') THEN 1
            WHEN (tm.player2_id = tp.id AND tm.result = 'player2') THEN 1
            ELSE 0
          END) AS wins
        FROM tournament_players tp
        JOIN tournaments t ON t.id = tp.tournament_id AND t.is_official = 1 AND t.status = 'finalizado'
        JOIN community_decks cd ON cd.id = tp.deck_id
        JOIN json_each(cd.main_deck) je
        JOIN tournament_matches tm ON tm.tournament_id = t.id
          AND (tm.player1_id = tp.id OR tm.player2_id = tp.id)
          AND tm.result != 'pending' AND tm.result != 'bye'
        GROUP BY je.key
      )
      ORDER BY wins DESC, times_used DESC
      LIMIT 20
    `).all("{}");

    // Win rate by card type (archetype analysis)
    // Simplified: analyze decks by majority card type
    const archetypeStats = req.db.prepare(`
      SELECT
        cd.alter_ego_id AS archetype,
        COUNT(DISTINCT tp.id) AS decks_played,
        SUM(CASE
          WHEN (tm.player1_id = tp.id AND tm.result = 'player1') THEN 1
          WHEN (tm.player2_id = tp.id AND tm.result = 'player2') THEN 1
          WHEN (tm.result = 'bye' AND tm.player1_id = tp.id) THEN 1
          ELSE 0
        END) AS wins,
        COUNT(tm.id) AS total_matches,
        ROUND(
          SUM(CASE
            WHEN (tm.player1_id = tp.id AND tm.result = 'player1') THEN 1
            WHEN (tm.player2_id = tp.id AND tm.result = 'player2') THEN 1
            WHEN (tm.result = 'bye' AND tm.player1_id = tp.id) THEN 1
            ELSE 0
          END) * 100.0 / COUNT(tm.id), 1
        ) AS win_rate
      FROM tournament_players tp
      JOIN tournaments t ON t.id = tp.tournament_id AND t.is_official = 1 AND t.status = 'finalizado'
      JOIN community_decks cd ON cd.id = tp.deck_id
      JOIN tournament_matches tm ON tm.tournament_id = t.id
        AND (tm.player1_id = tp.id OR tm.player2_id = tp.id)
        AND tm.result != 'pending'
      GROUP BY cd.alter_ego_id
      HAVING total_matches >= 1
      ORDER BY win_rate DESC
    `).all();

    // Tournament activity over time
    const tournamentActivity = req.db.prepare(`
      SELECT
        strftime('%Y-%m', t.created_at) AS month,
        COUNT(*) AS tournaments_created,
        SUM(CASE WHEN t.status = 'finalizado' THEN 1 ELSE 0 END) AS tournaments_finished,
        (SELECT COUNT(*) FROM tournament_players tp2 WHERE tp2.tournament_id IN
          (SELECT id FROM tournaments WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', t.created_at))
        ) AS total_registrations
      FROM tournaments t
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `).all();

    // Overall stats
    const overall = {
      total_official_tournaments: req.db.prepare("SELECT COUNT(*) as cnt FROM tournaments WHERE is_official = 1").get()?.cnt || 0,
      total_finished: req.db.prepare("SELECT COUNT(*) as cnt FROM tournaments WHERE status = 'finalizado'").get()?.cnt || 0,
      total_matches_played: req.db.prepare("SELECT COUNT(*) as cnt FROM tournament_matches WHERE result != 'pending'").get()?.cnt || 0,
      total_ranked_players: req.db.prepare("SELECT COUNT(DISTINCT user_id) as cnt FROM point_history").get()?.cnt || 0,
    };

    res.json({
      topCards,
      archetypeStats,
      tournamentActivity,
      overall,
    });
  } catch (err) {
    console.error("[admin/analytics] error:", err);
    res.status(500).json({ error: "Erro ao buscar analytics." });
  }
});

export default router;
