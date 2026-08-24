import { useState, useEffect } from "react";
import { api } from "../lib/api.js";

function formatDate(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleDateString("pt-BR"); } catch { return ""; }
}

/**
 * O body vem ja sanitizado (escapeHtml) do servidor. Renderizamos como
 * texto puro preservando quebras de linha — nunca via dangerouslySetInnerHTML,
 * entao nenhum script executa mesmo se o texto contiver tags escapadas.
 */
function ArticleDetail({ slug, onBack, flashToast }) {
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getArticle(slug)
      .then(setArticle)
      .catch(() => flashToast("Artigo nao encontrado."))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <section className="ab-section"><div className="ab-empty">Carregando…</div></section>;
  if (!article) {
    return (
      <section className="ab-section">
        <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Voltar</button>
        <div className="ab-empty">Artigo nao encontrado.</div>
      </section>
    );
  }

  return (
    <section className="ab-section ab-article-detail">
      <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Voltar para noticias</button>
      <h1 className="ab-section-title">{article.title}</h1>
      <div className="ab-tournament-meta">
        <span>por <strong>{article.author}</strong></span>
        <span>{formatDate(article.published_at)}</span>
      </div>
      <div className="ab-article-body" style={{ whiteSpace: "pre-wrap" }}>{article.body}</div>
    </section>
  );
}

export default function NewsTab({ flashToast }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState(null);

  useEffect(() => {
    loadArticles();
  }, []);

  async function loadArticles() {
    setLoading(true);
    try {
      const data = await api.getArticles();
      setArticles(data);
    } catch (err) {
      flashToast("Erro ao carregar noticias.");
    } finally {
      setLoading(false);
    }
  }

  if (selectedSlug) {
    return <ArticleDetail slug={selectedSlug} onBack={() => setSelectedSlug(null)} flashToast={flashToast} />;
  }

  return (
    <section className="ab-section">
      <h1 className="ab-section-title">Noticias</h1>
      <p className="ab-section-sub">Novidades, lore, avisos de balanceamento e previas de torneio.</p>

      <div className="ab-community-actions">
        <button className="ab-btn ab-btn-ghost" onClick={loadArticles} disabled={loading}>
          {loading ? "Carregando…" : "Atualizar"}
        </button>
      </div>

      {loading && <div className="ab-empty">Carregando noticias…</div>}
      {!loading && articles.length === 0 && (
        <div className="ab-empty">Nenhuma noticia publicada ainda.</div>
      )}

      {!loading && articles.length > 0 && (
        <div className="ab-article-list">
          {articles.map((a) => (
            <div key={a.id} className="ab-article-card" onClick={() => setSelectedSlug(a.slug)}>
              <div className="ab-article-card-title">{a.title}</div>
              <div className="ab-tournament-card-meta">
                <span>por {a.author}</span>
                <span>{formatDate(a.published_at)}</span>
              </div>
              <p className="ab-article-card-excerpt" style={{ whiteSpace: "pre-wrap" }}>{a.excerpt}…</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
