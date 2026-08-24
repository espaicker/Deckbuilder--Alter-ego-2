import { useState, useEffect } from "react";
import { COLOR_HEX } from "../lib/constants.js";
import AnalyticsPanel from "./AnalyticsPanel.jsx";
import { countEntries } from "../lib/deckRules.js";
import { api } from "../lib/api.js";

const ADMIN_API = "/api/admin";

function getAdminToken() {
  return localStorage.getItem("deckbuilder:admin_token");
}

async function adminReq(method, path, body = null) {
  const headers = { "Content-Type": "application/json" };
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${ADMIN_API}${path}`, { method, headers, body: body ? JSON.stringify(body) : null });
  } catch {
    throw new Error("Servidor indisponível.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function AdminLogin({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function uploadImage(cardId) {
    if (!imageFile) return;
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      const token = getAdminToken();
      const res = await fetch(`/api/admin/cards/${cardId}/image`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      flash("Erro ao enviar imagem: " + err.message);
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem("deckbuilder:admin_token", data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ab-admin-login">
      <h1 className="ab-section-title">Painel Admin</h1>
      <form className="ab-auth-form" onSubmit={handleSubmit}>
        <label className="ab-auth-label">
          Usuário
          <input className="ab-input" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="ab-auth-label">
          Senha
          <input className="ab-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="ab-auth-error">{error}</div>}
        <button className="ab-btn ab-btn-primary" type="submit" disabled={loading}>
          {loading ? "Entrando…" : "Entrar como Admin"}
        </button>
      </form>
    </div>
  );
}

function StatsPanel({ stats }) {
  if (!stats) return null;
  return (
    <div className="ab-admin-stats">
      <div className="ab-admin-stat-card">
        <span className="ab-admin-stat-value">{stats.totalUsers}</span>
        <span className="ab-admin-stat-label">Usuários</span>
      </div>
      <div className="ab-admin-stat-card">
        <span className="ab-admin-stat-value">{stats.totalDecks}</span>
        <span className="ab-admin-stat-label">Decks publicados</span>
      </div>
      {stats.decksByAlterEgo.length > 0 && (
        <div className="ab-admin-stat-card ab-admin-stat-wide">
          <span className="ab-admin-stat-label">Decks por Alter Ego</span>
          <div className="ab-admin-ae-list">
            {stats.decksByAlterEgo.map((d) => (
              <span key={d.alter_ego_id}>{d.alter_ego_id}: {d.count}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UsersTable({ users, onDelete, onToggleJudge, loading }) {
  return (
    <div className="ab-admin-table-wrap">
      <h3 className="ab-sidebar-group-title">Usuários ({users.length})</h3>
      <table className="ab-admin-table">
        <thead>
          <tr><th>ID</th><th>Username</th><th>Criado em</th><th>Juiz</th><th>Ações</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>{u.username}</td>
              <td>{u.created_at}</td>
              <td>{u.is_judge ? "Sim" : "—"}</td>
              <td>
                <button
                  className="ab-btn ab-btn-ghost ab-btn-sm"
                  onClick={() => onToggleJudge(u.id, u.username)}
                  disabled={loading}
                >
                  {u.is_judge ? "Remover juiz" : "Tornar juiz"}
                </button>
                <button
                  className="ab-btn ab-btn-ghost ab-btn-sm ab-btn-danger"
                  onClick={() => onDelete(u.id, u.username)}
                  disabled={loading}
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan={5}>Nenhum usuário.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function DecksTable({ decks, onDelete, loading }) {
  return (
    <div className="ab-admin-table-wrap">
      <h3 className="ab-sidebar-group-title">Decks ({decks.length})</h3>
      <table className="ab-admin-table">
        <thead>
          <tr><th>ID</th><th>Nome</th><th>Alter Ego</th><th>Autor</th><th>Cartas</th><th>Ações</th></tr>
        </thead>
        <tbody>
          {decks.map((d) => (
            <tr key={d.id}>
              <td>{d.id}</td>
              <td>{d.name}</td>
              <td>{d.alter_ego_id}</td>
              <td>{d.author}</td>
              <td>{countEntries(d.main_deck || {})}</td>
              <td>
                <button
                  className="ab-btn ab-btn-ghost ab-btn-sm ab-btn-danger"
                  onClick={() => onDelete(d.id, d.name)}
                  disabled={loading}
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
          {decks.length === 0 && <tr><td colSpan={6}>Nenhum deck publicado.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CardManager({ cards, meta, onReload, flash }) {
  const [showForm, setShowForm] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [filter, setFilter] = useState("");
  const [filterType, setFilterType] = useState("Todos");

  async function handleDelete(id, name) {
    if (!confirm(`Remover carta "${name}"? Isso altera o JSON de cartas.`)) return;
    try {
      await adminReq("DELETE", `/cards/${id}`);
      flash(`Carta "${name}" removida.`);
      onReload();
    } catch (err) { flash(err.message); }
  }

  function handleEdit(card) {
    setEditingCard(card);
    setShowForm(true);
  }

  function handleNewCard() {
    setEditingCard(null);
    setShowForm(true);
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingCard(null);
  }

  const filteredCards = cards.filter((c) => {
    if (filterType !== "Todos" && c.type !== filterType) return false;
    if (filter && !c.name.toLowerCase().includes(filter.toLowerCase()) && !c.id.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  if (showForm && meta) {
    return (
      <CardForm
        meta={meta}
        card={editingCard}
        onClose={handleFormClose}
        onSaved={() => { handleFormClose(); onReload(); }}
        flash={flash}
      />
    );
  }

  return (
    <div className="ab-admin-table-wrap">
      <div className="ab-admin-cards-header">
        <h3 className="ab-sidebar-group-title">Cartas ({cards.length})</h3>
        <button className="ab-btn ab-btn-primary" onClick={handleNewCard}>+ Nova Carta</button>
      </div>
      <div className="ab-admin-cards-filters">
        <input className="ab-input" placeholder="Buscar por nome ou ID…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="ab-input ab-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="Todos">Todos os tipos</option>
          {meta && Object.keys(meta.types).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <table className="ab-admin-table">
        <thead>
          <tr><th>ID</th><th>Nome</th><th>Tipo</th><th>Subtipo</th><th>Cores</th><th>Custo</th><th>Ações</th></tr>
        </thead>
        <tbody>
          {filteredCards.map((c) => (
            <tr key={c.id}>
              <td><code>{c.id}</code></td>
              <td>{c.name}</td>
              <td>{c.type}</td>
              <td>{c.subtype || "—"}</td>
              <td>{c.colors.join(", ")}</td>
              <td>{c.cost ?? "—"}</td>
              <td>
                <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={() => handleEdit(c)}>Editar</button>
                <button className="ab-btn ab-btn-ghost ab-btn-sm ab-btn-danger" onClick={() => handleDelete(c.id, c.name)}>Remover</button>
              </td>
            </tr>
          ))}
          {filteredCards.length === 0 && <tr><td colSpan={7}>Nenhuma carta encontrada.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CardForm({ meta, card, onClose, onSaved, flash }) {
  const isEditing = !!card;
  const [id, setId] = useState(card?.id || "");
  const [name, setName] = useState(card?.name || "");
  const [type, setType] = useState(card?.type || "Ação");
  const [subtype, setSubtype] = useState(card?.subtype || "");
  const [colors, setColors] = useState(card?.colors || []);
  const [cost, setCost] = useState(card?.cost ?? 0);
  const [effect, setEffect] = useState(card?.effect || "");
  const [keywords, setKeywords] = useState(card?.keywords || []);
  const [ataque, setAtaque] = useState(card?.attributes?.ataque ?? "");
  const [defesa, setDefesa] = useState(card?.attributes?.defesa ?? "");
  const [vida, setVida] = useState(card?.attributes?.vida ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const typeInfo = meta.types[type];
  const subtypes = typeInfo?.subtypes || [];
  const hasCost = typeInfo?.has_cost !== false;
  const isMulticolor = typeInfo?.multicolor === true;
  const isAlterEgo = type === "Alter Ego";

  function toggleColor(color) {
    if (colors.includes(color)) {
      setColors(colors.filter((c) => c !== color));
    } else {
      if (!isMulticolor && colors.length >= 1) {
        setColors([color]);
      } else {
        setColors([...colors, color]);
      }
    }
  }

  function toggleKeyword(kw) {
    if (keywords.includes(kw)) {
      setKeywords(keywords.filter((k) => k !== kw));
    } else {
      setKeywords([...keywords, kw]);
    }
  }

  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function uploadImage(cardId) {
    if (!imageFile) return;
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      const token = getAdminToken();
      const res = await fetch(`/api/admin/cards/${cardId}/image`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      flash("Erro ao enviar imagem: " + err.message);
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const attributes = {};
    if (isAlterEgo) {
      attributes.vida = parseInt(vida, 10) || 0;
      attributes.ataque = parseInt(ataque, 10) || 0;
      attributes.defesa = parseInt(defesa, 10) || 0;
    } else {
      if (ataque !== "" && !isNaN(ataque)) attributes.ataque = parseInt(ataque, 10);
      if (defesa !== "" && !isNaN(defesa)) attributes.defesa = parseInt(defesa, 10);
    }

    const payload = {
      id: id.trim(),
      name: name.trim(),
      type,
      subtype: subtype || null,
      colors,
      cost: hasCost ? parseInt(cost, 10) || 0 : null,
      attributes,
      effect: effect.trim() || null,
      keywords,
    };

    try {
      if (isEditing) {
        await adminReq("PUT", `/cards/${card.id}`, payload);
        await uploadImage(card.id);
        flash(`Carta "${payload.name}" atualizada!`);
      } else {
        await adminReq("POST", "/cards", payload);
        await uploadImage(payload.id);
        flash(`Carta "${payload.name}" criada!`);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ab-card-form">
      <button className="ab-btn ab-btn-ghost" onClick={onClose}>← Voltar para lista</button>
      <h3 className="ab-section-title">{isEditing ? `Editar: ${card.name}` : "Nova Carta"}</h3>

      <form className="ab-card-form-grid" onSubmit={handleSubmit}>
        <div className="ab-card-form-row">
          <label className="ab-auth-label">
            ID da carta
            <input className="ab-input" value={id} onChange={(e) => setId(e.target.value)} disabled={isEditing} required placeholder="Ex: ACO-0010" />
          </label>
          <label className="ab-auth-label">
            Nome
            <input className="ab-input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Nome da carta" />
          </label>
        </div>

        <div className="ab-card-form-section">
          <span className="ab-auth-label">Imagem da carta</span>
          <div className="ab-card-form-image-upload">
            {imagePreview && <img src={imagePreview} alt="Preview" className="ab-card-form-image-preview" />}
            {!imagePreview && isEditing && <img src={`/assets/cards/${card.id}.jpg`} alt="Atual" className="ab-card-form-image-preview" onError={(e) => { e.target.style.display = "none"; }} />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect} className="ab-input" />
            <span className="ab-card-form-image-hint">JPG, PNG ou WebP (max 5MB). O nome sera baseado no ID da carta.</span>
          </div>
        </div>

        <div className="ab-card-form-row">
          <label className="ab-auth-label">
            Tipo
            <select className="ab-input ab-select" value={type} onChange={(e) => { setType(e.target.value); setSubtype(""); }}>
              {Object.keys(meta.types).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {subtypes.length > 0 && (
            <label className="ab-auth-label">
              Subtipo
              <select className="ab-input ab-select" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                <option value="">— selecione —</option>
                {subtypes.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </label>
          )}
          {hasCost && (
            <label className="ab-auth-label">
              Custo
              <input className="ab-input" type="number" min="0" max="20" value={cost} onChange={(e) => setCost(e.target.value)} />
            </label>
          )}
        </div>

        <div className="ab-card-form-section">
          <span className="ab-auth-label">Cores {isMulticolor ? "(múltiplas)" : "(uma)"}</span>
          <div className="ab-chip-row">
            {meta.colors.map((color) => (
              <button
                key={color}
                type="button"
                className={`ab-chip ${colors.includes(color) ? "is-active" : ""}`}
                onClick={() => toggleColor(color)}
                style={colors.includes(color) ? { background: COLOR_HEX[color], borderColor: COLOR_HEX[color], color: "#0B0C0F" } : undefined}
              >
                {color}
              </button>
            ))}
          </div>
        </div>

        <div className="ab-card-form-row">
          {isAlterEgo && (
            <>
              <label className="ab-auth-label">Vida<input className="ab-input" type="number" value={vida} onChange={(e) => setVida(e.target.value)} /></label>
              <label className="ab-auth-label">Ataque<input className="ab-input" type="number" value={ataque} onChange={(e) => setAtaque(e.target.value)} /></label>
              <label className="ab-auth-label">Defesa<input className="ab-input" type="number" value={defesa} onChange={(e) => setDefesa(e.target.value)} /></label>
            </>
          )}
          {!isAlterEgo && (
            <>
              <label className="ab-auth-label">Ataque (opcional)<input className="ab-input" type="number" value={ataque} onChange={(e) => setAtaque(e.target.value)} placeholder="—" /></label>
              <label className="ab-auth-label">Defesa (opcional)<input className="ab-input" type="number" value={defesa} onChange={(e) => setDefesa(e.target.value)} placeholder="—" /></label>
            </>
          )}
        </div>

        <label className="ab-auth-label">
          Efeito / Habilidade
          <textarea className="ab-input ab-card-form-effect" value={effect} onChange={(e) => setEffect(e.target.value)} rows={4} placeholder="Texto do efeito da carta…" />
        </label>

        <div className="ab-card-form-section">
          <span className="ab-auth-label">Keywords</span>
          <div className="ab-chip-row">
            {meta.known_keywords.map((kw) => (
              <button
                key={kw}
                type="button"
                className={`ab-chip ab-chip-sm ${keywords.includes(kw) ? "is-active" : ""}`}
                onClick={() => toggleKeyword(kw)}
              >
                {kw}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="ab-auth-error">{error}</div>}

        <div className="ab-publish-actions">
          <button className="ab-btn ab-btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Salvando…" : isEditing ? "Salvar alterações" : "Criar carta"}
          </button>
          <button className="ab-btn ab-btn-ghost" type="button" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

function StoresManager({ stores, onApprove, onReject, loading }) {
  return (
    <div className="ab-admin-table-wrap">
      <h3 className="ab-sidebar-group-title">Lojas pendentes de aprovacao ({stores.length})</h3>
      <table className="ab-admin-table">
        <thead>
          <tr><th>ID</th><th>Nome</th><th>Cidade/UF</th><th>Dono</th><th>Contato</th><th>Acoes</th></tr>
        </thead>
        <tbody>
          {stores.map((s) => (
            <tr key={s.id}>
              <td>{s.id}</td>
              <td>{s.name}</td>
              <td>{s.city}/{s.state}</td>
              <td>{s.owner_username}</td>
              <td>{s.contact_info || "—"}</td>
              <td>
                <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={() => onApprove(s.id, s.name)} disabled={loading}>Aprovar</button>
                <button className="ab-btn ab-btn-ghost ab-btn-sm ab-btn-danger" onClick={() => onReject(s.id, s.name)} disabled={loading}>Rejeitar</button>
              </td>
            </tr>
          ))}
          {stores.length === 0 && <tr><td colSpan={6}>Nenhuma loja pendente.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ArticleEditor({ article, onClose, onSaved, flash }) {
  const isEditing = !!article;
  const [title, setTitle] = useState(article?.title || "");
  const [body, setBody] = useState(article?.body || "");
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isEditing) {
        await api.updateArticle(article.id, { title: title.trim(), body });
        flash("Artigo atualizado.");
      } else {
        await api.createArticle({ title: title.trim(), body });
        flash("Rascunho criado.");
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ab-card-form">
      <button className="ab-btn ab-btn-ghost" onClick={onClose}>← Voltar para lista</button>
      <h3 className="ab-section-title">{isEditing ? `Editar: ${article.title}` : "Novo artigo"}</h3>
      <form className="ab-card-form-grid" onSubmit={handleSubmit}>
        <label className="ab-auth-label">
          Titulo
          <input className="ab-input" value={title} maxLength={160} required
            onChange={(e) => setTitle(e.target.value.slice(0, 160))}
            placeholder="Ex: Balanceamento de marco 2026" />
        </label>
        <label className="ab-auth-label">
          Corpo do artigo
          <textarea className="ab-input ab-card-form-effect" value={body} rows={12} required
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreva o conteudo aqui. HTML sera exibido como texto (sanitizado)." />
        </label>
        <div className="ab-chip-row">
          <button type="button" className={`ab-chip ${showPreview ? "is-active" : ""}`} onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Ocultar preview" : "Mostrar preview"}
          </button>
        </div>
        {showPreview && (
          <div className="ab-article-body" style={{ whiteSpace: "pre-wrap", border: "1px solid #333", padding: "12px", borderRadius: "6px" }}>
            {body || "(vazio)"}
          </div>
        )}
        {error && <div className="ab-auth-error">{error}</div>}
        <div className="ab-publish-actions">
          <button className="ab-btn ab-btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Salvando…" : isEditing ? "Salvar alteracoes" : "Criar rascunho"}
          </button>
          <button className="ab-btn ab-btn-ghost" type="button" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

function ArticlesManager({ flash }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // article object or "new"

  async function load() {
    setLoading(true);
    try {
      const data = await api.adminListArticles();
      setArticles(data);
    } catch (err) { flash(err.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handlePublishToggle(a) {
    try {
      if (a.published) {
        await api.unpublishArticle(a.id);
        flash("Artigo despublicado.");
      } else {
        await api.publishArticle(a.id);
        flash("Artigo publicado.");
      }
      load();
    } catch (err) { flash(err.message); }
  }

  async function handleDelete(a) {
    if (!confirm(`Apagar o artigo "${a.title}"?`)) return;
    try {
      await api.deleteArticle(a.id);
      flash("Artigo removido.");
      load();
    } catch (err) { flash(err.message); }
  }

  async function handleEdit(a) {
    try {
      const full = await api.adminGetArticle(a.id);
      setEditing(full);
    } catch (err) { flash(err.message); }
  }

  if (editing) {
    return (
      <ArticleEditor
        article={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
        flash={flash}
      />
    );
  }

  return (
    <div className="ab-admin-table-wrap">
      <div className="ab-admin-cards-header">
        <h3 className="ab-sidebar-group-title">Artigos / Noticias ({articles.length})</h3>
        <button className="ab-btn ab-btn-primary" onClick={() => setEditing("new")}>+ Novo artigo</button>
      </div>
      <table className="ab-admin-table">
        <thead>
          <tr><th>ID</th><th>Titulo</th><th>Slug</th><th>Status</th><th>Acoes</th></tr>
        </thead>
        <tbody>
          {articles.map((a) => (
            <tr key={a.id}>
              <td>{a.id}</td>
              <td>{a.title}</td>
              <td><code>{a.slug}</code></td>
              <td>{a.published ? "Publicado" : "Rascunho"}</td>
              <td>
                <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={() => handleEdit(a)} disabled={loading}>Editar</button>
                <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={() => handlePublishToggle(a)} disabled={loading}>
                  {a.published ? "Despublicar" : "Publicar"}
                </button>
                <button className="ab-btn ab-btn-ghost ab-btn-sm ab-btn-danger" onClick={() => handleDelete(a)} disabled={loading}>Apagar</button>
              </td>
            </tr>
          ))}
          {articles.length === 0 && <tr><td colSpan={5}>Nenhum artigo ainda.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminPanel({ embedded = false }) {
  const [admin, setAdmin] = useState(embedded ? { username: "admin" } : null);
  const [tab, setTab] = useState("stats");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [decks, setDecks] = useState([]);
  const [cards, setCards] = useState([]);
  const [cardMeta, setCardMeta] = useState(null);
  const [pendingStores, setPendingStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Check existing token
  useEffect(() => {
    const token = getAdminToken();
    if (token) {
      adminReq("GET", "/stats")
        .then((data) => {
          setAdmin({ username: "admin" });
          setStats(data);
        })
        .catch(() => {
          if (!embedded) localStorage.removeItem("deckbuilder:admin_token");
        });
    } else if (embedded) {
      // When embedded, use the main auth token for admin requests
      const mainToken = localStorage.getItem("deckbuilder:auth_token");
      if (mainToken) {
        localStorage.setItem("deckbuilder:admin_token", mainToken);
        adminReq("GET", "/stats")
          .then((data) => setStats(data))
          .catch(() => {});
      }
    }
  }, [embedded]);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function loadStats() {
    try {
      const data = await adminReq("GET", "/stats");
      setStats(data);
    } catch (err) { flash(err.message); }
  }

  async function loadUsers() {
    try {
      const data = await adminReq("GET", "/users");
      setUsers(data);
    } catch (err) { flash(err.message); }
  }

  async function loadDecks() {
    try {
      const data = await adminReq("GET", "/decks");
      setDecks(data);
    } catch (err) { flash(err.message); }
  }

  async function loadCards() {
    try {
      const data = await adminReq("GET", "/cards");
      setCards(data.cards);
      setCardMeta(data.meta);
    } catch (err) { flash(err.message); }
  }

  async function deleteUser(id, name) {
    if (!confirm(`Remover usuário "${name}" e todos os seus decks?`)) return;
    setLoading(true);
    try {
      await adminReq("DELETE", `/users/${id}`);
      flash(`Usuário "${name}" removido.`);
      loadUsers();
      loadStats();
    } catch (err) { flash(err.message); }
    setLoading(false);
  }

  async function toggleJudge(id, name) {
    setLoading(true);
    try {
      const res = await adminReq("POST", `/users/${id}/toggle-judge`);
      flash(res.message);
      loadUsers();
    } catch (err) { flash(err.message); }
    setLoading(false);
  }

  async function deleteDeck(id, name) {
    if (!confirm(`Remover deck "${name}"?`)) return;
    setLoading(true);
    try {
      await adminReq("DELETE", `/decks/${id}`);
      flash(`Deck "${name}" removido.`);
      loadDecks();
      loadStats();
    } catch (err) { flash(err.message); }
    setLoading(false);
  }

  async function loadStores() {
    try {
      const data = await adminReq("GET", "/stores/pending");
      setPendingStores(data);
    } catch (err) { flash(err.message); }
  }

  async function approveStore(id, name) {
    setLoading(true);
    try {
      const res = await adminReq("POST", `/stores/${id}/approve`);
      flash(res.message || `Loja "${name}" aprovada.`);
      loadStores();
    } catch (err) { flash(err.message); }
    setLoading(false);
  }

  async function rejectStore(id, name) {
    if (!confirm(`Rejeitar (apagar) a solicitacao da loja "${name}"?`)) return;
    setLoading(true);
    try {
      const res = await adminReq("POST", `/stores/${id}/reject`);
      flash(res.message || `Loja "${name}" rejeitada.`);
      loadStores();
    } catch (err) { flash(err.message); }
    setLoading(false);
  }

  function handleLogin(user) {
    setAdmin(user);
    loadStats();
  }

  function handleLogout() {
    localStorage.removeItem("deckbuilder:admin_token");
    setAdmin(null);
    setStats(null);
  }

  function switchTab(t) {
    setTab(t);
    if (t === "stats") loadStats();
    if (t === "users") loadUsers();
    if (t === "decks") loadDecks();
    if (t === "cards") loadCards();
    if (t === "lojas") loadStores();
  }

  if (!admin) {
    if (embedded) return null;
    return (
      <div className="ab-app ab-admin-page">
        <AdminLogin onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className={embedded ? "ab-admin-embedded" : "ab-app ab-admin-page"}>
      {toast && <div className="ab-toast">{toast}</div>}

      {!embedded && (
        <header className="ab-admin-header">
          <h1 className="ab-logo-title">PAINEL ADMIN</h1>
          <span className="ab-hud-username">Logado como admin</span>
          <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={handleLogout}>Sair</button>
        </header>
      )}

      <nav className="ab-tabs">
        <button className={`ab-tab ${tab === "stats" ? "is-active" : ""}`} onClick={() => switchTab("stats")}>Estatísticas</button>
        <button className={`ab-tab ${tab === "users" ? "is-active" : ""}`} onClick={() => switchTab("users")}>Usuários</button>
        <button className={`ab-tab ${tab === "decks" ? "is-active" : ""}`} onClick={() => switchTab("decks")}>Decks</button>
        <button className={`ab-tab ${tab === "cards" ? "is-active" : ""}`} onClick={() => switchTab("cards")}>Cartas</button>
        <button className={`ab-tab ${tab === "lojas" ? "is-active" : ""}`} onClick={() => switchTab("lojas")}>Lojas</button>
        <button className={`ab-tab ${tab === "noticias" ? "is-active" : ""}`} onClick={() => switchTab("noticias")}>Notícias</button>
        <button className={`ab-tab ${tab === "analytics" ? "is-active" : ""}`} onClick={() => switchTab("analytics")}>Analytics</button>
      </nav>

      <main className="ab-main ab-admin-main">
        {tab === "stats" && <StatsPanel stats={stats} />}
        {tab === "users" && <UsersTable users={users} onDelete={deleteUser} onToggleJudge={toggleJudge} loading={loading} />}
        {tab === "decks" && <DecksTable decks={decks} onDelete={deleteDeck} loading={loading} />}
        {tab === "cards" && <CardManager cards={cards} meta={cardMeta} onReload={loadCards} flash={flash} />}
        {tab === "lojas" && <StoresManager stores={pendingStores} onApprove={approveStore} onReject={rejectStore} loading={loading} />}
        {tab === "noticias" && <ArticlesManager flash={flash} />}
        {tab === "analytics" && <AnalyticsPanel />}
      </main>
    </div>
  );
}
