import { Router } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { forumPostLimiter } from "../middleware/rateLimit.js";

const router = Router();

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 5000;
const MAX_REASON_LENGTH = 500;

/**
 * Sanitização XSS — remove tags HTML perigosas, converte em texto seguro.
 * Reutiliza a mesma lógica já usada nos decks (escapeHtml).
 */
function sanitizeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Acesso restrito a administradores." });
  }
  next();
}

/* ============================================================
   CATEGORIAS
   ============================================================ */

router.get("/categories", (req, res) => {
  try {
    const categories = req.db.prepare(`
      SELECT fc.*,
        (SELECT COUNT(*) FROM forum_topics ft WHERE ft.category_id = fc.id AND ft.is_hidden = 0) AS topic_count
      FROM forum_categories fc
      ORDER BY fc.sort_order ASC
    `).all();
    res.json(categories);
  } catch (err) {
    console.error("[forum] categories error:", err);
    res.status(500).json({ error: "Erro ao buscar categorias." });
  }
});

/* ============================================================
   TÓPICOS
   ============================================================ */

router.get("/categories/:categoryId/topics", (req, res) => {
  try {
    const categoryId = parseInt(req.params.categoryId, 10);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const category = req.db.prepare("SELECT * FROM forum_categories WHERE id = ?").get(categoryId);
    if (!category) return res.status(404).json({ error: "Categoria não encontrada." });

    const total = req.db.prepare(
      "SELECT COUNT(*) AS cnt FROM forum_topics WHERE category_id = ? AND is_hidden = 0"
    ).get(categoryId);

    const topics = req.db.prepare(`
      SELECT ft.*, u.username AS author_name
      FROM forum_topics ft
      JOIN users u ON u.id = ft.author_id
      WHERE ft.category_id = ? AND ft.is_hidden = 0
      ORDER BY ft.is_pinned DESC, ft.last_reply_at DESC, ft.created_at DESC
      LIMIT ? OFFSET ?
    `).all(categoryId, limit, offset);

    res.json({
      category,
      topics,
      pagination: { page, limit, total: total?.cnt || 0, totalPages: Math.ceil((total?.cnt || 0) / limit) },
    });
  } catch (err) {
    console.error("[forum] topics list error:", err);
    res.status(500).json({ error: "Erro ao buscar tópicos." });
  }
});

router.post("/categories/:categoryId/topics", requireAuth, forumPostLimiter, (req, res) => {
  try {
    const categoryId = parseInt(req.params.categoryId, 10);
    const category = req.db.prepare("SELECT * FROM forum_categories WHERE id = ?").get(categoryId);
    if (!category) return res.status(404).json({ error: "Categoria não encontrada." });

    const { title, body } = req.body || {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Título é obrigatório." });
    }
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "Corpo do tópico é obrigatório." });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `Título muito longo (máx. ${MAX_TITLE_LENGTH} caracteres).` });
    }
    if (body.length > MAX_BODY_LENGTH) {
      return res.status(400).json({ error: `Corpo muito longo (máx. ${MAX_BODY_LENGTH} caracteres).` });
    }

    // XSS Sanitization
    const safeTitle = sanitizeHtml(title.trim());
    const safeBody = sanitizeHtml(body.trim());

    const result = req.db.prepare(`
      INSERT INTO forum_topics (category_id, author_id, title, body)
      VALUES (?, ?, ?, ?)
    `).run(categoryId, req.user.id, safeTitle, safeBody);

    res.status(201).json({ id: result.lastInsertRowid, message: "Tópico criado!" });
  } catch (err) {
    console.error("[forum] create topic error:", err);
    res.status(500).json({ error: "Erro ao criar tópico." });
  }
});

/* ============================================================
   TÓPICO DETALHE + RESPOSTAS
   ============================================================ */

router.get("/topics/:topicId", (req, res) => {
  try {
    const topicId = parseInt(req.params.topicId, 10);
    const topic = req.db.prepare(`
      SELECT ft.*, u.username AS author_name
      FROM forum_topics ft
      JOIN users u ON u.id = ft.author_id
      WHERE ft.id = ?
    `).get(topicId);

    if (!topic) return res.status(404).json({ error: "Tópico não encontrado." });
    if (topic.is_hidden) return res.status(404).json({ error: "Tópico não encontrado." });

    const replies = req.db.prepare(`
      SELECT fr.*, u.username AS author_name
      FROM forum_replies fr
      JOIN users u ON u.id = fr.author_id
      WHERE fr.topic_id = ? AND fr.is_hidden = 0
      ORDER BY fr.created_at ASC
    `).all(topicId);

    res.json({ topic, replies });
  } catch (err) {
    console.error("[forum] topic detail error:", err);
    res.status(500).json({ error: "Erro ao buscar tópico." });
  }
});

router.post("/topics/:topicId/replies", requireAuth, forumPostLimiter, (req, res) => {
  try {
    const topicId = parseInt(req.params.topicId, 10);
    const topic = req.db.prepare("SELECT * FROM forum_topics WHERE id = ? AND is_hidden = 0").get(topicId);
    if (!topic) return res.status(404).json({ error: "Tópico não encontrado." });
    if (topic.is_locked) {
      return res.status(403).json({ error: "Este tópico está trancado e não aceita novas respostas." });
    }

    const { body } = req.body || {};
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "Corpo da resposta é obrigatório." });
    }
    if (body.length > MAX_BODY_LENGTH) {
      return res.status(400).json({ error: `Resposta muito longa (máx. ${MAX_BODY_LENGTH} caracteres).` });
    }

    const safeBody = sanitizeHtml(body.trim());

    const result = req.db.prepare(`
      INSERT INTO forum_replies (topic_id, author_id, body) VALUES (?, ?, ?)
    `).run(topicId, req.user.id, safeBody);

    // Update topic reply count and last_reply_at
    req.db.prepare(`
      UPDATE forum_topics SET reply_count = reply_count + 1, last_reply_at = datetime('now') WHERE id = ?
    `).run(topicId);

    res.status(201).json({ id: result.lastInsertRowid, message: "Resposta publicada!" });
  } catch (err) {
    console.error("[forum] create reply error:", err);
    res.status(500).json({ error: "Erro ao publicar resposta." });
  }
});

/* ============================================================
   DENÚNCIAS (qualquer user logado)
   ============================================================ */

router.post("/reports", requireAuth, (req, res) => {
  try {
    const { topic_id, reply_id, reason } = req.body || {};
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ error: "Motivo da denúncia é obrigatório." });
    }
    if (!topic_id && !reply_id) {
      return res.status(400).json({ error: "Informe o tópico ou resposta a denunciar." });
    }

    const safeReason = sanitizeHtml(reason.trim().slice(0, MAX_REASON_LENGTH));

    req.db.prepare(`
      INSERT INTO forum_reports (reporter_id, topic_id, reply_id, reason) VALUES (?, ?, ?, ?)
    `).run(req.user.id, topic_id || null, reply_id || null, safeReason);

    res.status(201).json({ message: "Denúncia registrada. Obrigado!" });
  } catch (err) {
    console.error("[forum] report error:", err);
    res.status(500).json({ error: "Erro ao registrar denúncia." });
  }
});

/* ============================================================
   MODERAÇÃO (admin only)
   ============================================================ */

router.get("/reports", requireAuth, requireAdmin, (req, res) => {
  try {
    const reports = req.db.prepare(`
      SELECT fr.*, u.username AS reporter_name,
        ft.title AS topic_title,
        freply.body AS reply_body
      FROM forum_reports fr
      JOIN users u ON u.id = fr.reporter_id
      LEFT JOIN forum_topics ft ON ft.id = fr.topic_id
      LEFT JOIN forum_replies freply ON freply.id = fr.reply_id
      ORDER BY fr.created_at DESC
      LIMIT 100
    `).all();
    res.json(reports);
  } catch (err) {
    console.error("[forum] reports list error:", err);
    res.status(500).json({ error: "Erro ao buscar denúncias." });
  }
});

router.put("/reports/:reportId", requireAuth, requireAdmin, (req, res) => {
  try {
    const { status } = req.body || {};
    if (!["resolvido", "rejeitado"].includes(status)) {
      return res.status(400).json({ error: "Status inválido." });
    }
    req.db.prepare("UPDATE forum_reports SET status = ? WHERE id = ?").run(status, req.params.reportId);
    res.json({ message: "Denúncia atualizada." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar denúncia." });
  }
});

router.post("/topics/:topicId/hide", requireAuth, requireAdmin, (req, res) => {
  try {
    req.db.prepare("UPDATE forum_topics SET is_hidden = 1 WHERE id = ?").run(req.params.topicId);
    res.json({ message: "Tópico ocultado." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao ocultar tópico." });
  }
});

router.post("/topics/:topicId/lock", requireAuth, requireAdmin, (req, res) => {
  try {
    const topic = req.db.prepare("SELECT is_locked FROM forum_topics WHERE id = ?").get(req.params.topicId);
    if (!topic) return res.status(404).json({ error: "Tópico não encontrado." });
    const newValue = topic.is_locked ? 0 : 1;
    req.db.prepare("UPDATE forum_topics SET is_locked = ? WHERE id = ?").run(newValue, req.params.topicId);
    res.json({ message: newValue ? "Tópico trancado." : "Tópico destrancado.", is_locked: newValue });
  } catch (err) {
    res.status(500).json({ error: "Erro ao trancar tópico." });
  }
});

router.post("/topics/:topicId/pin", requireAuth, requireAdmin, (req, res) => {
  try {
    const topic = req.db.prepare("SELECT is_pinned FROM forum_topics WHERE id = ?").get(req.params.topicId);
    if (!topic) return res.status(404).json({ error: "Tópico não encontrado." });
    const newValue = topic.is_pinned ? 0 : 1;
    req.db.prepare("UPDATE forum_topics SET is_pinned = ? WHERE id = ?").run(newValue, req.params.topicId);
    res.json({ message: newValue ? "Tópico fixado." : "Tópico desfixado.", is_pinned: newValue });
  } catch (err) {
    res.status(500).json({ error: "Erro ao fixar tópico." });
  }
});

router.delete("/topics/:topicId", requireAuth, requireAdmin, (req, res) => {
  try {
    req.db.prepare("DELETE FROM forum_replies WHERE topic_id = ?").run(req.params.topicId);
    req.db.prepare("DELETE FROM forum_topics WHERE id = ?").run(req.params.topicId);
    res.json({ message: "Tópico excluído permanentemente." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir tópico." });
  }
});

router.post("/replies/:replyId/hide", requireAuth, requireAdmin, (req, res) => {
  try {
    req.db.prepare("UPDATE forum_replies SET is_hidden = 1 WHERE id = ?").run(req.params.replyId);
    req.db.prepare(`
      UPDATE forum_topics SET reply_count = reply_count - 1
      WHERE id = (SELECT topic_id FROM forum_replies WHERE id = ?)
    `).run(req.params.replyId);
    res.json({ message: "Resposta ocultada." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao ocultar resposta." });
  }
});

router.delete("/replies/:replyId", requireAuth, requireAdmin, (req, res) => {
  try {
    const reply = req.db.prepare("SELECT topic_id FROM forum_replies WHERE id = ?").get(req.params.replyId);
    req.db.prepare("DELETE FROM forum_replies WHERE id = ?").run(req.params.replyId);
    if (reply) {
      req.db.prepare("UPDATE forum_topics SET reply_count = reply_count - 1 WHERE id = ?").run(reply.topic_id);
    }
    res.json({ message: "Resposta excluída." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir resposta." });
  }
});

export default router;
