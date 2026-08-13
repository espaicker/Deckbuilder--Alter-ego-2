import { Router } from "express";

const router = Router();

/**
 * GET /api/ranking — Ranking global público (paginado, com filtro por nome)
 *
 * Query params:
 *   - page (default 1)
 *   - limit (default 50, max 100)
 *   - search (filtro por username)
 *
 * Retorna apenas pontos de torneios oficiais (is_official = 1).
 */
router.get("/", (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const search = (req.query.search || "").trim();

    let whereClause = "WHERE t.is_official = 1";
    const params = [];

    if (search) {
      whereClause += " AND u.username LIKE ?";
      params.push(`%${search}%`);
    }

    // Total count for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT ph.user_id) as total
      FROM point_history ph
      JOIN users u ON u.id = ph.user_id
      JOIN tournaments t ON t.id = ph.tournament_id
      ${whereClause}
    `;
    const totalResult = req.db.prepare(countQuery).get(...params);
    const total = totalResult?.total || 0;

    // Ranking aggregation query
    const rankingQuery = `
      SELECT
        u.id AS user_id,
        u.username,
        SUM(ph.points_awarded) AS total_points,
        COUNT(DISTINCT ph.tournament_id) AS tournaments_played
      FROM point_history ph
      JOIN users u ON u.id = ph.user_id
      JOIN tournaments t ON t.id = ph.tournament_id
      ${whereClause}
      GROUP BY ph.user_id
      ORDER BY total_points DESC, tournaments_played DESC
      LIMIT ? OFFSET ?
    `;

    const rows = req.db.prepare(rankingQuery).all(...params, limit, offset);

    // For each player, compute winrate from official tournament matches
    const enriched = rows.map((row, index) => {
      const matchStats = req.db.prepare(`
        SELECT
          COUNT(*) AS total_matches,
          SUM(CASE
            WHEN (tm.player1_id = tp.id AND tm.result = 'player1') THEN 1
            WHEN (tm.player2_id = tp.id AND tm.result = 'player2') THEN 1
            WHEN (tm.result = 'bye' AND tm.player1_id = tp.id) THEN 1
            ELSE 0
          END) AS wins
        FROM tournament_matches tm
        JOIN tournament_players tp ON tp.user_id = ? AND tp.tournament_id = tm.tournament_id
          AND (tm.player1_id = tp.id OR tm.player2_id = tp.id)
        JOIN tournaments t ON t.id = tm.tournament_id AND t.is_official = 1
        WHERE tm.result != 'pending'
      `).get(row.user_id);

      const totalMatches = matchStats?.total_matches || 0;
      const wins = matchStats?.wins || 0;
      const winrate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

      return {
        position: offset + index + 1,
        user_id: row.user_id,
        username: row.username,
        total_points: row.total_points,
        tournaments_played: row.tournaments_played,
        winrate,
      };
    });

    res.json({
      ranking: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[ranking] error:", err);
    res.status(500).json({ error: "Erro ao buscar ranking." });
  }
});

/**
 * GET /api/ranking/:userId/history — Histórico de pontos de um jogador
 */
router.get("/:userId/history", (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: "ID inválido." });
    }

    const rows = req.db.prepare(`
      SELECT ph.*, t.name AS tournament_name
      FROM point_history ph
      JOIN tournaments t ON t.id = ph.tournament_id
      WHERE ph.user_id = ? AND t.is_official = 1
      ORDER BY ph.created_at DESC
      LIMIT 100
    `).all(userId);

    res.json(rows);
  } catch (err) {
    console.error("[ranking] history error:", err);
    res.status(500).json({ error: "Erro ao buscar histórico." });
  }
});

export default router;
