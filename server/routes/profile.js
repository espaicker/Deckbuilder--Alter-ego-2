import { Router } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AVATAR_DIR = join(__dirname, "../../public/assets/avatars");
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAGIC_BYTES = {
  "image/jpeg": [0xFF, 0xD8, 0xFF],
  "image/png": [0x89, 0x50, 0x4E, 0x47],
  "image/webp": null, // checked via RIFF header
};

const router = Router();

function detectMime(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return "image/webp";
  return null;
}

/**
 * GET /api/profile/:username — Perfil público com heurísticas
 */
router.get("/:username", optionalAuth, (req, res) => {
  try {
    const user = req.db.prepare(
      "SELECT id, username, bio, avatar_url, created_at FROM users WHERE username = ?"
    ).get(req.params.username);

    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    // Decks publicados
    const decks = req.db.prepare(
      "SELECT id, name, alter_ego_id, main_deck, drop_pile, created_at FROM community_decks WHERE user_id = ? ORDER BY created_at DESC"
    ).all(user.id);

    // Tournament stats
    const tournamentStats = req.db.prepare(`
      SELECT COUNT(DISTINCT tp.tournament_id) AS tournaments_played
      FROM tournament_players tp
      JOIN tournaments t ON t.id = tp.tournament_id
      WHERE tp.user_id = ? AND t.status = 'finalizado'
    `).get(user.id);

    // Match stats (wins/losses/draws)
    const matchStats = req.db.prepare(`
      SELECT
        COUNT(*) AS total_matches,
        SUM(CASE
          WHEN (tm.player1_id = tp.id AND tm.result = 'player1') THEN 1
          WHEN (tm.player2_id = tp.id AND tm.result = 'player2') THEN 1
          WHEN (tm.result = 'bye' AND tm.player1_id = tp.id) THEN 1
          ELSE 0
        END) AS wins,
        SUM(CASE WHEN tm.result = 'draw' THEN 1 ELSE 0 END) AS draws
      FROM tournament_matches tm
      JOIN tournament_players tp ON tp.user_id = ? AND tp.tournament_id = tm.tournament_id
        AND (tm.player1_id = tp.id OR tm.player2_id = tp.id)
      WHERE tm.result != 'pending'
    `).get(user.id);

    const totalMatches = matchStats?.total_matches || 0;
    const wins = matchStats?.wins || 0;
    const draws = matchStats?.draws || 0;
    const losses = totalMatches - wins - draws;
    const winrate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

    // Ranking points
    const pointsRow = req.db.prepare(`
      SELECT COALESCE(SUM(ph.points_awarded), 0) AS total_points
      FROM point_history ph
      JOIN tournaments t ON t.id = ph.tournament_id AND t.is_official = 1
      WHERE ph.user_id = ?
    `).get(user.id);

    // Heuristics: most played decks (by tournament usage)
    const mostPlayedDecks = req.db.prepare(`
      SELECT cd.name, cd.alter_ego_id, COUNT(*) AS times_used
      FROM tournament_players tp
      JOIN community_decks cd ON cd.id = tp.deck_id
      WHERE tp.user_id = ?
      GROUP BY tp.deck_id
      ORDER BY times_used DESC
      LIMIT 5
    `).all(user.id);

    // Heuristics: preferred color (from all decks main_deck)
    const colorCounts = {};
    for (const deck of decks) {
      let mainDeck;
      try { mainDeck = JSON.parse(deck.main_deck); } catch { continue; }
      // We need card data to determine colors — use the alter_ego colors as proxy
      // For accurate color, count from alter_ego_id colors
    }
    // Simpler approach: count alter_ego colors from tournament decks
    const colorRows = req.db.prepare(`
      SELECT cd.alter_ego_id, COUNT(*) AS cnt
      FROM tournament_players tp
      JOIN community_decks cd ON cd.id = tp.deck_id
      WHERE tp.user_id = ?
      GROUP BY cd.alter_ego_id
      ORDER BY cnt DESC
    `).all(user.id);

    // Heuristics: play style based on deck composition
    // Analyze all published decks' card types
    let offensiveCards = 0;
    let defensiveCards = 0;
    let totalCards = 0;

    // Load card data for type analysis
    const cardsJsonPath = join(__dirname, "../../src/data/modelo_cartas.json");
    let cardData = { cards: [] };
    try { cardData = JSON.parse(readFileSync(cardsJsonPath, "utf8")); } catch {}
    const cardIndex = new Map(cardData.cards.map(c => [c.id, c]));

    for (const deck of decks) {
      let mainDeck;
      try { mainDeck = JSON.parse(deck.main_deck); } catch { continue; }
      for (const [cardId, qty] of Object.entries(mainDeck)) {
        const card = cardIndex.get(cardId);
        if (!card) continue;
        totalCards += qty;
        // Offensive: Ação cards or cards with ataque attribute
        if (card.type === "Ação" || (card.attributes && card.attributes.ataque)) {
          offensiveCards += qty;
        }
        // Defensive/Auxiliary: Reação, Tática
        if (card.type === "Reação" || card.type === "Tática") {
          defensiveCards += qty;
        }
      }
    }

    let playStyle = "Equilibrado";
    if (totalCards > 0) {
      const offensiveRatio = offensiveCards / totalCards;
      const defensiveRatio = defensiveCards / totalCards;
      if (offensiveRatio >= 0.6) playStyle = "Agressivo";
      else if (defensiveRatio >= 0.6) playStyle = "Defensivo";
      else if (offensiveRatio >= 0.45) playStyle = "Ofensivo";
      else if (defensiveRatio >= 0.45) playStyle = "Controlador";
    }

    res.json({
      username: user.username,
      bio: user.bio || "",
      avatar_url: user.avatar_url || null,
      created_at: user.created_at,
      stats: {
        total_points: pointsRow?.total_points || 0,
        tournaments_played: tournamentStats?.tournaments_played || 0,
        total_matches: totalMatches,
        wins,
        losses,
        draws,
        winrate,
      },
      heuristics: {
        play_style: playStyle,
        offensive_ratio: totalCards > 0 ? Math.round((offensiveCards / totalCards) * 100) : 0,
        defensive_ratio: totalCards > 0 ? Math.round((defensiveCards / totalCards) * 100) : 0,
        most_played_decks: mostPlayedDecks,
        preferred_alter_egos: colorRows.slice(0, 3),
      },
      decks_published: decks.length,
    });
  } catch (err) {
    console.error("[profile] get error:", err);
    res.status(500).json({ error: "Erro ao buscar perfil." });
  }
});

/**
 * PUT /api/profile — Editar bio (autenticado)
 */
router.put("/", requireAuth, (req, res) => {
  try {
    const { bio } = req.body || {};
    const safeBio = typeof bio === "string" ? bio.slice(0, 500) : "";
    req.db.prepare("UPDATE users SET bio = ? WHERE id = ?").run(safeBio, req.user.id);
    res.json({ message: "Perfil atualizado.", bio: safeBio });
  } catch (err) {
    console.error("[profile] update error:", err);
    res.status(500).json({ error: "Erro ao atualizar perfil." });
  }
});

/**
 * POST /api/profile/avatar — Upload de avatar (autenticado)
 * Validação real de MIME via magic bytes (não confia no Content-Type do cliente)
 */
router.post("/avatar", requireAuth, (req, res) => {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return res.status(400).json({ error: "Envie como multipart/form-data." });
  }

  const chunks = [];
  let size = 0;

  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_AVATAR_SIZE) { req.destroy(); return; }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (size > MAX_AVATAR_SIZE) {
      return res.status(413).json({ error: "Imagem muito grande (max 2MB)." });
    }

    const raw = Buffer.concat(chunks);
    const boundary = contentType.split("boundary=")[1];
    if (!boundary) return res.status(400).json({ error: "Boundary não encontrado." });

    const parts = raw.toString("binary").split("--" + boundary);
    let imageBuffer = null;

    for (const part of parts) {
      if (part.includes("Content-Disposition") && part.includes('name="avatar"')) {
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd === -1) continue;
        const body = part.slice(headerEnd + 4).replace(/\r\n$/, "");
        imageBuffer = Buffer.from(body, "binary");
      }
    }

    if (!imageBuffer || imageBuffer.length < 8) {
      return res.status(400).json({ error: "Nenhuma imagem encontrada no upload." });
    }

    // CRITICAL: Validate actual file content via magic bytes (not Content-Type header)
    const detectedMime = detectMime(imageBuffer);
    if (!detectedMime || !ALLOWED_MIME.has(detectedMime)) {
      return res.status(400).json({ error: "Tipo de arquivo inválido. Apenas JPG, PNG ou WebP reais são aceitos." });
    }

    // Save
    if (!existsSync(AVATAR_DIR)) mkdirSync(AVATAR_DIR, { recursive: true });

    const ext = detectedMime === "image/jpeg" ? ".jpg" : detectedMime === "image/png" ? ".png" : ".webp";
    const filename = `user-${req.user.id}${ext}`;
    const filepath = join(AVATAR_DIR, filename);

    // Remove old avatar if exists (different extension)
    [".jpg", ".png", ".webp"].forEach(e => {
      const old = join(AVATAR_DIR, `user-${req.user.id}${e}`);
      if (existsSync(old) && old !== filepath) {
        try { unlinkSync(old); } catch {}
      }
    });

    writeFileSync(filepath, imageBuffer);
    const avatarUrl = `/assets/avatars/${filename}`;
    req.db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(avatarUrl, req.user.id);

    res.json({ message: "Avatar atualizado!", avatar_url: avatarUrl });
  });

  req.on("error", () => {
    res.status(500).json({ error: "Erro ao processar upload." });
  });
});

export default router;
