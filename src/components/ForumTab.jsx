import { useState, useEffect } from "react";
import { api } from "../lib/api.js";

function TimeAgo({ date }) {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return <span>agora</span>;
  if (mins < 60) return <span>{mins}min atrás</span>;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return <span>{hrs}h atrás</span>;
  const days = Math.floor(hrs / 24);
  if (days < 30) return <span>{days}d atrás</span>;
  return <span>{new Date(date).toLocaleDateString("pt-BR")}</span>;
}

/* ============================================================
   CATEGORY LIST VIEW
   ============================================================ */
function CategoryList({ categories, onSelect, loading }) {
  if (loading) return <div className="ab-empty">Carregando categorias…</div>;
  if (categories.length === 0) return <div className="ab-empty">Nenhuma categoria disponível.</div>;

  return (
    <div className="ab-forum-categories">
      {categories.map((cat) => (
        <button
          key={cat.id}
          className="ab-forum-category-card"
          onClick={() => onSelect(cat)}
        >
          <div className="ab-forum-category-name">{cat.name}</div>
          <div className="ab-forum-category-desc">{cat.description}</div>
          <span className="ab-forum-category-count">{cat.topic_count} tópico{cat.topic_count !== 1 ? "s" : ""}</span>
        </button>
      ))}
    </div>
  );
}

/* ============================================================
   TOPIC LIST VIEW
   ============================================================ */
function TopicList({ category, user, flashToast, onSelectTopic, onBack, onRequestLogin }) {
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadTopics(); }, [page]);

  async function loadTopics() {
    setLoading(true);
    try {
      const data = await api.getForumTopics(category.id, page);
      setTopics(data.topics);
      setPagination(data.pagination);
    } catch (err) {
      flashToast("Erro ao carregar tópicos.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      await api.createForumTopic(category.id, title, body);
      flashToast("Tópico criado!");
      setTitle("");
      setBody("");
      setShowForm(false);
      loadTopics();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Categorias</button>
      <h2 className="ab-section-title" style={{ marginTop: 12 }}>{category.name}</h2>
      <p className="ab-section-sub">{category.description}</p>

      <div className="ab-community-actions">
        {user && (
          <button className="ab-btn ab-btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancelar" : "+ Novo tópico"}
          </button>
        )}
        {!user && (
          <button className="ab-btn ab-btn-primary" onClick={onRequestLogin}>
            Faça login para postar
          </button>
        )}
      </div>

      {showForm && (
        <form className="ab-forum-new-topic" onSubmit={handleCreate}>
          <input
            className="ab-input"
            placeholder="Título do tópico"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            maxLength={120}
            required
          />
          <textarea
            className="ab-input ab-publish-desc"
            placeholder="Escreva seu tópico…"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 5000))}
            maxLength={5000}
            rows={5}
            required
          />
          <button className="ab-btn ab-btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Publicando…" : "Publicar tópico"}
          </button>
        </form>
      )}

      {loading && <div className="ab-empty">Carregando tópicos…</div>}

      {!loading && topics.length === 0 && (
        <div className="ab-empty">Nenhum tópico nesta categoria. Seja o primeiro!</div>
      )}

      {!loading && topics.length > 0 && (
        <div className="ab-forum-topic-list">
          {topics.map((t) => (
            <button key={t.id} className="ab-forum-topic-row" onClick={() => onSelectTopic(t)}>
              <div className="ab-forum-topic-title">
                {t.is_pinned ? <span className="ab-forum-pin">📌</span> : null}
                {t.is_locked ? <span className="ab-forum-lock">🔒</span> : null}
                {t.title}
              </div>
              <div className="ab-forum-topic-meta">
                <span>por {t.author_name}</span>
                <span>{t.reply_count} resposta{t.reply_count !== 1 ? "s" : ""}</span>
                <TimeAgo date={t.last_reply_at || t.created_at} />
              </div>
            </button>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="ab-ranking-pagination">
          <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>← Anterior</button>
          <span className="ab-ranking-page-info">Página {page} de {pagination.totalPages}</span>
          <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={() => setPage(page + 1)} disabled={page >= pagination.totalPages}>Próxima →</button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TOPIC DETAIL VIEW (with replies)
   ============================================================ */
function TopicDetail({ topicId, user, flashToast, onBack, onRequestLogin }) {
  const [topic, setTopic] = useState(null);
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reporting, setReporting] = useState(null); // {type, id}
  const [reportReason, setReportReason] = useState("");

  const isAdmin = user && user.role === "admin";

  useEffect(() => { loadTopic(); }, [topicId]);

  async function loadTopic() {
    setLoading(true);
    try {
      const data = await api.getForumTopic(topicId);
      setTopic(data.topic);
      setReplies(data.replies);
    } catch (err) {
      flashToast("Erro ao carregar tópico.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReply(e) {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setSubmitting(true);
    try {
      await api.createForumReply(topicId, replyBody);
      setReplyBody("");
      flashToast("Resposta publicada!");
      loadTopic();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReport(e) {
    e.preventDefault();
    if (!reportReason.trim()) return;
    try {
      await api.reportForumContent({
        topic_id: reporting.type === "topic" ? reporting.id : undefined,
        reply_id: reporting.type === "reply" ? reporting.id : undefined,
        reason: reportReason,
      });
      flashToast("Denúncia enviada!");
      setReporting(null);
      setReportReason("");
    } catch (err) {
      flashToast(err.message);
    }
  }

  async function handleHideTopic() {
    try { await api.hideForumTopic(topicId); flashToast("Tópico ocultado."); onBack(); } catch (err) { flashToast(err.message); }
  }
  async function handleLockTopic() {
    try { const r = await api.lockForumTopic(topicId); flashToast(r.message); loadTopic(); } catch (err) { flashToast(err.message); }
  }
  async function handlePinTopic() {
    try { const r = await api.pinForumTopic(topicId); flashToast(r.message); loadTopic(); } catch (err) { flashToast(err.message); }
  }
  async function handleDeleteTopic() {
    try { await api.deleteForumTopic(topicId); flashToast("Tópico excluído."); onBack(); } catch (err) { flashToast(err.message); }
  }
  async function handleHideReply(replyId) {
    try { await api.hideForumReply(replyId); flashToast("Resposta ocultada."); loadTopic(); } catch (err) { flashToast(err.message); }
  }

  if (loading) return <div className="ab-empty">Carregando…</div>;
  if (!topic) return <div className="ab-empty">Tópico não encontrado.</div>;

  return (
    <div className="ab-forum-topic-detail">
      <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Voltar</button>

      <div className="ab-forum-topic-header">
        <h2 className="ab-section-title">{topic.title}</h2>
        <div className="ab-forum-topic-meta">
          <span>por <strong>{topic.author_name}</strong></span>
          <TimeAgo date={topic.created_at} />
          {topic.is_locked ? <span className="ab-forum-lock">🔒 Trancado</span> : null}
          {topic.is_pinned ? <span className="ab-forum-pin">📌 Fixado</span> : null}
        </div>
      </div>

      <div className="ab-forum-post-body">{topic.body}</div>

      {/* Topic actions */}
      <div className="ab-forum-actions">
        {user && (
          <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={() => setReporting({ type: "topic", id: topic.id })}>
            Denunciar
          </button>
        )}
        {isAdmin && (
          <>
            <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={handlePinTopic}>
              {topic.is_pinned ? "Desfixar" : "Fixar"}
            </button>
            <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={handleLockTopic}>
              {topic.is_locked ? "Destrancar" : "Trancar"}
            </button>
            <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={handleHideTopic}>Ocultar</button>
            <button className="ab-btn ab-btn-ghost ab-btn-sm ab-btn-danger" onClick={handleDeleteTopic}>Excluir</button>
          </>
        )}
      </div>

      {/* Replies */}
      <div className="ab-forum-replies">
        <div className="ab-sidebar-group-title">{replies.length} resposta{replies.length !== 1 ? "s" : ""}</div>
        {replies.map((r) => (
          <div key={r.id} className="ab-forum-reply">
            <div className="ab-forum-reply-header">
              <strong>{r.author_name}</strong>
              <TimeAgo date={r.created_at} />
            </div>
            <div className="ab-forum-post-body">{r.body}</div>
            <div className="ab-forum-actions">
              {user && (
                <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={() => setReporting({ type: "reply", id: r.id })}>
                  Denunciar
                </button>
              )}
              {isAdmin && (
                <button className="ab-btn ab-btn-ghost ab-btn-sm ab-btn-danger" onClick={() => handleHideReply(r.id)}>
                  Ocultar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Report modal */}
      {reporting && (
        <form className="ab-forum-report-form" onSubmit={handleReport}>
          <div className="ab-sidebar-group-title">Denunciar conteúdo</div>
          <textarea
            className="ab-input ab-publish-desc"
            placeholder="Descreva o motivo da denúncia…"
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value.slice(0, 500))}
            rows={3}
            required
          />
          <div className="ab-publish-actions">
            <button className="ab-btn ab-btn-primary" type="submit">Enviar denúncia</button>
            <button className="ab-btn ab-btn-ghost" type="button" onClick={() => setReporting(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {/* Reply form */}
      {!topic.is_locked && user && (
        <form className="ab-forum-reply-form" onSubmit={handleReply}>
          <textarea
            className="ab-input ab-publish-desc"
            placeholder="Escreva sua resposta…"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value.slice(0, 5000))}
            maxLength={5000}
            rows={4}
            required
          />
          <button className="ab-btn ab-btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Enviando…" : "Responder"}
          </button>
        </form>
      )}

      {!topic.is_locked && !user && (
        <button className="ab-btn ab-btn-primary" onClick={onRequestLogin}>Faça login para responder</button>
      )}

      {topic.is_locked && (
        <div className="ab-empty" style={{ marginTop: 16 }}>🔒 Este tópico está trancado.</div>
      )}
    </div>
  );
}

/* ============================================================
   MAIN FORUM TAB
   ============================================================ */
export default function ForumTab({ user, flashToast, onRequestLogin }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("categories"); // categories | topics | topic
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedTopicId, setSelectedTopicId] = useState(null);

  useEffect(() => { loadCategories(); }, []);

  async function loadCategories() {
    setLoading(true);
    try {
      const data = await api.getForumCategories();
      setCategories(data);
    } catch (err) {
      flashToast("Erro ao carregar fórum.");
    } finally {
      setLoading(false);
    }
  }

  if (view === "topic" && selectedTopicId) {
    return (
      <section className="ab-section">
        <TopicDetail
          topicId={selectedTopicId}
          user={user}
          flashToast={flashToast}
          onBack={() => setView("topics")}
          onRequestLogin={onRequestLogin}
        />
      </section>
    );
  }

  if (view === "topics" && selectedCategory) {
    return (
      <section className="ab-section">
        <TopicList
          category={selectedCategory}
          user={user}
          flashToast={flashToast}
          onSelectTopic={(t) => { setSelectedTopicId(t.id); setView("topic"); }}
          onBack={() => { setView("categories"); loadCategories(); }}
          onRequestLogin={onRequestLogin}
        />
      </section>
    );
  }

  return (
    <section className="ab-section">
      <h1 className="ab-section-title">Fórum</h1>
      <p className="ab-section-sub">
        Discuta estratégias, compartilhe dicas e conecte-se com outros jogadores.
      </p>
      <CategoryList
        categories={categories}
        onSelect={(cat) => { setSelectedCategory(cat); setView("topics"); }}
        loading={loading}
      />
    </section>
  );
}
