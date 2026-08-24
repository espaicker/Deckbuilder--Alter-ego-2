import { useState, useEffect } from "react";
import { api } from "../lib/api.js";

/* ============================================================
   FORMULARIO: CADASTRAR MINHA LOJA
   ============================================================ */
function RegisterStoreForm({ onDone, onCancel, flashToast }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [address, setAddress] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.createStore({
        name: name.trim(),
        city: city.trim(),
        state: state.trim(),
        address: address.trim() || undefined,
        contact_info: contact.trim() || undefined,
      });
      flashToast(res.message || "Solicitacao enviada!");
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="ab-tournament-form" onSubmit={handleSubmit}>
      <h2 className="ab-section-title">Cadastrar minha loja</h2>
      <p className="ab-section-sub">
        Sua loja passara por aprovacao de um administrador antes de aparecer no diretorio publico.
      </p>

      <label className="ab-field">
        <span className="ab-field-label">Nome da loja</span>
        <input className="ab-input" value={name} maxLength={100} required
          onChange={(e) => setName(e.target.value.slice(0, 100))}
          placeholder="Ex: Card Shop Central" />
      </label>

      <label className="ab-field">
        <span className="ab-field-label">Cidade</span>
        <input className="ab-input" value={city} maxLength={80} required
          onChange={(e) => setCity(e.target.value.slice(0, 80))}
          placeholder="Ex: Fortaleza" />
      </label>

      <label className="ab-field">
        <span className="ab-field-label">Estado (UF)</span>
        <input className="ab-input" value={state} maxLength={40} required
          onChange={(e) => setState(e.target.value.slice(0, 40))}
          placeholder="Ex: CE" />
      </label>

      <label className="ab-field">
        <span className="ab-field-label">Endereco (opcional)</span>
        <input className="ab-input" value={address} maxLength={200}
          onChange={(e) => setAddress(e.target.value.slice(0, 200))}
          placeholder="Rua, numero, bairro" />
      </label>

      <label className="ab-field">
        <span className="ab-field-label">Contato publico (opcional)</span>
        <input className="ab-input" value={contact} maxLength={200}
          onChange={(e) => setContact(e.target.value.slice(0, 200))}
          placeholder="Telefone ou e-mail de contato da loja" />
        <span className="ab-tournament-hint">
          Este contato sera exibido publicamente. Nao use seu e-mail pessoal da conta.
        </span>
      </label>

      {error && <div className="ab-auth-error">{error}</div>}

      <div className="ab-publish-actions">
        <button className="ab-btn ab-btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Enviando…" : "Enviar solicitacao"}
        </button>
        <button className="ab-btn ab-btn-ghost" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/* ============================================================
   DIRETORIO PUBLICO DE LOJAS
   ============================================================ */
export default function StoresTab({ user, flashToast, onRequestLogin }) {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | register

  useEffect(() => {
    loadStores();
  }, []);

  async function loadStores() {
    setLoading(true);
    try {
      const data = await api.getStores();
      setStores(data);
    } catch (err) {
      flashToast("Erro ao carregar lojas.");
    } finally {
      setLoading(false);
    }
  }

  if (view === "register") {
    return (
      <section className="ab-section">
        <RegisterStoreForm
          flashToast={flashToast}
          onDone={() => { setView("list"); loadStores(); }}
          onCancel={() => setView("list")}
        />
      </section>
    );
  }

  return (
    <section className="ab-section">
      <h1 className="ab-section-title">Lojas parceiras</h1>
      <p className="ab-section-sub">
        Lojas fisicas parceiras que organizam torneios oficiais da comunidade.
      </p>

      <div className="ab-community-actions">
        {user && (
          <button className="ab-btn ab-btn-primary" onClick={() => setView("register")}>
            Cadastrar minha loja
          </button>
        )}
        {!user && (
          <button className="ab-btn ab-btn-primary" onClick={onRequestLogin}>
            Faca login para cadastrar sua loja
          </button>
        )}
        <button className="ab-btn ab-btn-ghost" onClick={loadStores} disabled={loading}>
          {loading ? "Carregando…" : "Atualizar"}
        </button>
      </div>

      {loading && <div className="ab-empty">Carregando lojas…</div>}

      {!loading && stores.length === 0 && (
        <div className="ab-empty">
          Nenhuma loja parceira cadastrada ainda. Cadastre a sua!
        </div>
      )}

      {!loading && stores.length > 0 && (
        <div className="ab-tournament-grid">
          {stores.map((s) => (
            <div key={s.id} className="ab-tournament-card">
              <div className="ab-tournament-card-name">{s.name}</div>
              <div className="ab-tournament-card-meta">
                <span>{s.city}/{s.state}</span>
                <span>{s.tournament_count} torneio{s.tournament_count !== 1 ? "s" : ""}</span>
              </div>
              {s.address && <div className="ab-tournament-card-meta"><span>{s.address}</span></div>}
              {s.contact_info && <div className="ab-tournament-card-meta"><span>Contato: {s.contact_info}</span></div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
