import { useState } from "react";
import { api } from "../lib/api.js";

/**
 * Pagina aberta pelo link do e-mail de recuperacao (/resetar-senha?token=...).
 * O token vem da URL; o servidor valida validade, expiracao e uso unico.
 */
export default function ResetPasswordPage({ token, onDone, onRequestLogin }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <section className="ab-section ab-reset-page">
        <h1 className="ab-section-title">Redefinir senha</h1>
        <p className="ab-section-sub">Link inválido. Peça um novo link em “Entrar” → “Esqueci minha senha”.</p>
        <button className="ab-btn ab-btn-primary" onClick={onDone}>Voltar ao início</button>
      </section>
    );
  }

  if (success) {
    return (
      <section className="ab-section ab-reset-page">
        <h1 className="ab-section-title">Senha redefinida</h1>
        <p className="ab-section-sub">Pronto. Agora é só entrar com a nova senha.</p>
        <button className="ab-btn ab-btn-primary" onClick={onRequestLogin}>Entrar</button>
      </section>
    );
  }

  return (
    <section className="ab-section ab-reset-page">
      <h1 className="ab-section-title">Redefinir senha</h1>
      <p className="ab-section-sub">Escolha uma nova senha para a sua conta. O link vale por 1 hora e só pode ser usado uma vez.</p>
      <form className="ab-auth-form" onSubmit={handleSubmit}>
        <label className="ab-auth-label">
          Nova senha
          <input
            className="ab-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            maxLength={72}
            autoComplete="new-password"
            required
          />
        </label>
        <label className="ab-auth-label">
          Confirme a nova senha
          <input
            className="ab-input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={6}
            maxLength={72}
            autoComplete="new-password"
            required
          />
        </label>
        {error && <div className="ab-auth-error" role="alert">{error}</div>}
        <button className="ab-btn ab-btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Salvando…" : "Redefinir senha"}
        </button>
      </form>
    </section>
  );
}
