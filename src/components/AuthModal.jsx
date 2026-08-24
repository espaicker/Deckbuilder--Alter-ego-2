import { useState } from "react";

/**
 * Modal de login/registro.
 * No cadastro, exige e-mail e aceite explicito dos Termos + Politica (LGPD).
 */
export default function AuthModal({ onClose, onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (mode === "register" && !acceptedTerms) {
      setError("Voce precisa ler e aceitar os Termos de Uso e a Politica de Privacidade.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "login") {
        await onLogin(username, password);
      } else {
        await onRegister(username, password, email, acceptedTerms);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ab-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="ab-auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "login" ? "Entrar" : "Criar conta"}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="ab-modal-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>

        <h2 className="ab-auth-title">
          {mode === "login" ? "Entrar" : "Criar conta"}
        </h2>

        <form className="ab-auth-form" onSubmit={handleSubmit}>
          <label className="ab-auth-label">
            Usuário
            <input
              className="ab-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3-20 caracteres"
              minLength={3}
              maxLength={20}
              autoComplete="username"
              required
            />
          </label>

          {mode === "register" && (
            <label className="ab-auth-label">
              E-mail
              <input
                className="ab-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@exemplo.com"
                autoComplete="email"
                required
              />
            </label>
          )}

          <label className="ab-auth-label">
            Senha
            <input
              className="ab-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 6 caracteres"
              minLength={6}
              maxLength={72}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>

          {mode === "register" && (
            <label className="ab-auth-terms">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
              />
              <span>
                Li e aceito os{" "}
                <a href="/termos" target="_blank" rel="noopener noreferrer">Termos de Uso</a>{" "}
                e a{" "}
                <a href="/privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>.
              </span>
            </label>
          )}

          {error && <div className="ab-auth-error">{error}</div>}

          <button
            className="ab-btn ab-btn-primary ab-auth-submit"
            type="submit"
            disabled={submitting || (mode === "register" && !acceptedTerms)}
          >
            {submitting
              ? "Carregando…"
              : mode === "login"
              ? "Entrar"
              : "Criar conta"}
          </button>
        </form>

        <p className="ab-auth-switch">
          {mode === "login" ? (
            <>
              Não tem conta?{" "}
              <button className="ab-link-btn" onClick={() => { setMode("register"); setError(null); }}>
                Criar uma
              </button>
            </>
          ) : (
            <>
              Já tem conta?{" "}
              <button className="ab-link-btn" onClick={() => { setMode("login"); setError(null); }}>
                Entrar
              </button>
            </>
          )}
        </p>
      </section>
    </div>
  );
}
