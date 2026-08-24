import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { escapeHtml } from "../../src/lib/sanitize.js";

const router = Router();

const MAX_TITLE = 160;
const MAX_BODY = 20000;

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Acesso restrito a administradores." });
  }
  next();
}

/**
 * Gera um slug a partir do titulo: minusculo, remove acentos,
 * espacos/nao-alfanumericos viram hifen, colapsa hifens.
 */
function slugify(title) {
  const base = String(title)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "artigo";
}

/**
 * Garante slug unico: se ja existe, adiciona -2, -3, ...
 */
function uniqueSlug(db, title) {
  const base = slugify(title);
  let slug = base;
  let n = 1;
  while (db.prepare("SELECT id FROM articles WHERE slug = ?").get(slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

/* ============================================================
   PUBLICO
   ============================================================ */

/**
 * GET /api/articles — lista so publicados, mais recentes primeiro.
 * Retorna um resumo (primeiros ~200 chars do body ja sanitizado).
 */
router.get("/", (req, res) => {
  try {
    const rows = req.db
      .prepare(
        `SELECT a.id, a.title, a.slug, a.body, a.published_at, COALESCE(u.username, 'admin') AS author
         FROM articles a LEFT JOIN users u ON u.id = a.author_user_id
         WHERE a.published = 1
         ORDER BY a.published_at DESC`
      )
      .all();
    const list = rows.map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      author: a.author,
      published_at: a.published_at,
      excerpt: (a.body || "").slice(0, 200),
    }));
    res.json(list);
  } catch (err) {
    console.error("[articles] list error:", err);
    res.status(500).json({ error: "Erro ao listar artigos." });
  }
});

/**
 * GET /api/articles/:slug — detalhe de um artigo publicado.
 */
router.get("/:slug", (req, res) => {
  try {
    const a = req.db
      .prepare(
        `SELECT a.id, a.title, a.slug, a.body, a.published, a.published_at, a.created_at, COALESCE(u.username, 'admin') AS author
         FROM articles a LEFT JOIN users u ON u.id = a.author_user_id
         WHERE a.slug = ? AND a.published = 1`
      )
      .get(req.params.slug);
    if (!a) return res.status(404).json({ error: "Artigo nao encontrado." });
    res.json(a);
  } catch (err) {
    console.error("[articles] detail error:", err);
    res.status(500).json({ error: "Erro ao buscar artigo." });
  }
});

/* ============================================================
   ADMIN (montado em /api/admin/articles) — so admin escreve.
   ============================================================ */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

/**
 * POST /api/admin/articles — cria rascunho (published = 0).
 */
adminRouter.post("/", (req, res) => {
  try {
    const { title, body } = req.body || {};
    if (!title || typeof title !== "string" || !title.trim() || title.length > MAX_TITLE) {
      return res.status(400).json({ error: `Titulo e obrigatorio (max. ${MAX_TITLE} caracteres).` });
    }
    if (!body || typeof body !== "string" || !body.trim() || body.length > MAX_BODY) {
      return res.status(400).json({ error: "Corpo do artigo e obrigatorio." });
    }
    const cleanTitle = escapeHtml(title.trim());
    const cleanBody = escapeHtml(body.slice(0, MAX_BODY));
    const slug = uniqueSlug(req.db, title.trim());
    const result = req.db
      .prepare(
        `INSERT INTO articles (title, slug, body, published, author_user_id, created_at, published_at)
         VALUES (?, ?, ?, 0, ?, ?, NULL)`
      )
      .run(cleanTitle, slug, cleanBody, req.user.id, Date.now());
    res.status(201).json({ id: result.lastInsertRowid, slug, message: "Rascunho criado." });
  } catch (err) {
    console.error("[articles] create error:", err);
    res.status(500).json({ error: "Erro ao criar artigo." });
  }
});

/**
 * GET /api/admin/articles — lista TODOS (rascunhos + publicados) para o painel.
 */
adminRouter.get("/", (req, res) => {
  try {
    const rows = req.db
      .prepare(
        `SELECT a.id, a.title, a.slug, a.published, a.created_at, a.published_at, COALESCE(u.username, 'admin') AS author
         FROM articles a LEFT JOIN users u ON u.id = a.author_user_id
         ORDER BY a.created_at DESC`
      )
      .all();
    res.json(rows);
  } catch (err) {
    console.error("[articles] admin list error:", err);
    res.status(500).json({ error: "Erro ao listar artigos." });
  }
});

/**
 * GET /api/admin/articles/:id — detalhe (inclui rascunho) para edicao.
 */
adminRouter.get("/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const a = req.db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
    if (!a) return res.status(404).json({ error: "Artigo nao encontrado." });
    res.json(a);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar artigo." });
  }
});

/**
 * PATCH /api/admin/articles/:id — edita titulo/corpo.
 */
adminRouter.patch("/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const a = req.db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
    if (!a) return res.status(404).json({ error: "Artigo nao encontrado." });

    const { title, body } = req.body || {};
    let newTitle = a.title;
    let newSlug = a.slug;
    let newBody = a.body;

    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim() || title.length > MAX_TITLE) {
        return res.status(400).json({ error: "Titulo invalido." });
      }
      newTitle = escapeHtml(title.trim());
      // regenera slug so se o titulo mudou de fato
      const candidate = uniqueSlug(req.db, title.trim());
      // se o novo slug base bater com o atual, mantem
      newSlug = candidate;
    }
    if (body !== undefined) {
      if (typeof body !== "string" || !body.trim() || body.length > MAX_BODY) {
        return res.status(400).json({ error: "Corpo invalido." });
      }
      newBody = escapeHtml(body.slice(0, MAX_BODY));
    }

    req.db.prepare("UPDATE articles SET title = ?, slug = ?, body = ? WHERE id = ?")
      .run(newTitle, newSlug, newBody, id);
    res.json({ id, slug: newSlug, message: "Artigo atualizado." });
  } catch (err) {
    console.error("[articles] update error:", err);
    res.status(500).json({ error: "Erro ao atualizar artigo." });
  }
});

/**
 * POST /api/admin/articles/:id/publish — publica (define published_at = agora).
 */
adminRouter.post("/:id/publish", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const a = req.db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
    if (!a) return res.status(404).json({ error: "Artigo nao encontrado." });
    req.db.prepare("UPDATE articles SET published = 1, published_at = ? WHERE id = ?")
      .run(Date.now(), id);
    res.json({ id, published: true, message: "Artigo publicado." });
  } catch (err) {
    console.error("[articles] publish error:", err);
    res.status(500).json({ error: "Erro ao publicar artigo." });
  }
});

/**
 * POST /api/admin/articles/:id/unpublish — volta para rascunho.
 */
adminRouter.post("/:id/unpublish", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const a = req.db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
    if (!a) return res.status(404).json({ error: "Artigo nao encontrado." });
    req.db.prepare("UPDATE articles SET published = 0, published_at = NULL WHERE id = ?").run(id);
    res.json({ id, published: false, message: "Artigo despublicado." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao despublicar artigo." });
  }
});

/**
 * DELETE /api/admin/articles/:id — apaga.
 */
adminRouter.delete("/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const a = req.db.prepare("SELECT id FROM articles WHERE id = ?").get(id);
    if (!a) return res.status(404).json({ error: "Artigo nao encontrado." });
    req.db.prepare("DELETE FROM articles WHERE id = ?").run(id);
    res.json({ id, message: "Artigo removido." });
  } catch (err) {
    res.status(500).json({ error: "Erro ao remover artigo." });
  }
});

export default router;
