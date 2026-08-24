import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import { AccountDataSettings } from "./LegalPage.jsx";

const STYLE_CLASS = {
  "Agressivo": "is-agressivo",
  "Defensivo": "is-defensivo",
  "Controlador": "is-controlador",
  "Ofensivo": "is-agressivo",
  "Equilibrado": "",
};

export default function ProfilePage({ username, user, flashToast, onBack }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const isOwnProfile = user && user.username === username;

  useEffect(() => {
    loadProfile();
  }, [username]);

  async function loadProfile() {
    setLoading(true);
    try {
      const data = await api.getProfile(username);
      setProfile(data);
      setBio(data.bio || "");
    } catch (err) {
      flashToast("Erro ao carregar perfil.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveBio() {
    setSaving(true);
    try {
      await api.updateProfile(bio);
      flashToast("Perfil atualizado!");
      setEditing(false);
      loadProfile();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      await api.uploadAvatar(file);
      flashToast("Avatar atualizado!");
      loadProfile();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  if (loading) {
    return (
      <section className="ab-section">
        <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Voltar</button>
        <div className="ab-empty">Carregando perfil…</div>
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="ab-section">
        <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Voltar</button>
        <div className="ab-empty">Usuário não encontrado.</div>
      </section>
    );
  }

  const p = profile;
  const s = p.stats;
  const h = p.heuristics;

  return (
    <section className="ab-section">
      <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Voltar</button>

      {/* Header */}
      <div className="ab-profile-header">
        {p.avatar_url ? (
          <img src={p.avatar_url} alt={p.username} className="ab-profile-avatar" />
        ) : (
          <div className="ab-profile-avatar-placeholder">
            {p.username[0].toUpperCase()}
          </div>
        )}
        <div className="ab-profile-info">
          <h2 className="ab-profile-username">{p.username}</h2>
          <span className="ab-profile-joined">
            Membro desde {new Date(p.created_at).toLocaleDateString("pt-BR")}
          </span>
          {p.bio && <p className="ab-profile-bio">{p.bio}</p>}
          {h.play_style && (
            <span className={`ab-profile-style ${STYLE_CLASS[h.play_style] || ""}`}>
              {h.play_style}
            </span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="ab-profile-stats">
        <div className="ab-profile-stat-card">
          <span className="ab-profile-stat-value">{s.total_points}</span>
          <span className="ab-profile-stat-label">Pontos</span>
        </div>
        <div className="ab-profile-stat-card">
          <span className="ab-profile-stat-value">{s.tournaments_played}</span>
          <span className="ab-profile-stat-label">Torneios</span>
        </div>
        <div className="ab-profile-stat-card">
          <span className="ab-profile-stat-value">{s.winrate}%</span>
          <span className="ab-profile-stat-label">Winrate</span>
        </div>
        <div className="ab-profile-stat-card">
          <span className="ab-profile-stat-value">{s.wins}</span>
          <span className="ab-profile-stat-label">Vitórias</span>
        </div>
        <div className="ab-profile-stat-card">
          <span className="ab-profile-stat-value">{s.losses}</span>
          <span className="ab-profile-stat-label">Derrotas</span>
        </div>
        <div className="ab-profile-stat-card">
          <span className="ab-profile-stat-value">{s.draws}</span>
          <span className="ab-profile-stat-label">Empates</span>
        </div>
      </div>

      {/* Play style breakdown */}
      <div className="ab-sidebar-group">
        <div className="ab-sidebar-group-title">Composição de deck</div>
        <div style={{ marginTop: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Ofensivo: {h.offensive_ratio}% · Defensivo: {h.defensive_ratio}%
          </span>
          <div className="ab-profile-bar">
            <div
              className="ab-profile-bar-fill"
              style={{ width: `${h.offensive_ratio}%`, background: "var(--red)" }}
            />
          </div>
        </div>
      </div>

      {/* Most played decks */}
      {h.most_played_decks && h.most_played_decks.length > 0 && (
        <div className="ab-sidebar-group" style={{ marginTop: 16 }}>
          <div className="ab-sidebar-group-title">Decks mais jogados</div>
          {h.most_played_decks.map((d, i) => (
            <div key={i} className="ab-sidebar-row">
              <span className="ab-sidebar-name">{d.name}</span>
              <span className="ab-sidebar-qty">×{d.times_used}</span>
            </div>
          ))}
        </div>
      )}

      {/* Preferred alter egos */}
      {h.preferred_alter_egos && h.preferred_alter_egos.length > 0 && (
        <div className="ab-sidebar-group" style={{ marginTop: 16 }}>
          <div className="ab-sidebar-group-title">Alter Egos preferidos</div>
          {h.preferred_alter_egos.map((ae, i) => (
            <div key={i} className="ab-sidebar-row">
              <span className="ab-sidebar-name">{ae.alter_ego_id}</span>
              <span className="ab-sidebar-qty">×{ae.cnt}</span>
            </div>
          ))}
        </div>
      )}

      {/* Edit own profile */}
      {isOwnProfile && !editing && (
        <button className="ab-btn ab-btn-ghost" style={{ marginTop: 20 }} onClick={() => setEditing(true)}>
          Editar perfil
        </button>
      )}

      {isOwnProfile && editing && (
        <div className="ab-profile-edit">
          <div className="ab-sidebar-group-title">Editar perfil</div>

          <div className="ab-profile-edit-avatar">
            {p.avatar_url ? (
              <img src={p.avatar_url} alt="" className="ab-profile-avatar" style={{ width: 50, height: 50 }} />
            ) : (
              <div className="ab-profile-avatar-placeholder" style={{ width: 50, height: 50, fontSize: 20 }}>
                {p.username[0].toUpperCase()}
              </div>
            )}
            <label className="ab-btn ab-btn-ghost ab-btn-sm" style={{ cursor: "pointer" }}>
              {uploadingAvatar ? "Enviando…" : "Trocar avatar"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarUpload}
                style={{ display: "none" }}
                disabled={uploadingAvatar}
              />
            </label>
          </div>

          <label className="ab-auth-label">
            Bio
            <textarea
              className="ab-input ab-publish-desc"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={3}
              placeholder="Conte algo sobre você…"
            />
          </label>

          <div className="ab-publish-actions">
            <button className="ab-btn ab-btn-primary" onClick={handleSaveBio} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
            <button className="ab-btn ab-btn-ghost" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* LGPD: exportar / apagar dados (so no proprio perfil) */}
      {isOwnProfile && (
        <div className="ab-sidebar-group" style={{ marginTop: 20 }}>
          <AccountDataSettings
            user={user}
            flashToast={flashToast}
            onDeleted={() => {
              localStorage.removeItem("deckbuilder:auth_token");
              localStorage.removeItem("deckbuilder:auth_user");
              localStorage.removeItem("deckbuilder:admin_token");
              window.location.href = "/";
            }}
          />
        </div>
      )}

      {/* Published decks count */}
      <div style={{ marginTop: 20, fontSize: 13, color: "var(--text-muted)" }}>
        {p.decks_published} deck{p.decks_published !== 1 ? "s" : ""} publicado{p.decks_published !== 1 ? "s" : ""}
      </div>
    </section>
  );
}
