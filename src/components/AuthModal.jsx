import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

/**
 * Modal de login/registro.
 */
export default function AuthModal({ onClose, onLogin, onRegister, onGoogleLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const googleButtonRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.getGoogleConfig()
      .then((config) => {
        if (!cancelled) setGoogleClientId(config.clientId || "");
      })
      .catch(() => {
        if (!cancelled) setGoogleClientId("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!googleClientId) return undefined;
    if (window.google?.accounts?.id) {
      setGoogleReady(true);
      return undefined;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleReady(true);
    script.onerror = () => setError("Não foi possível carregar o login do Google.");
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [googleClientId]);

  useEffect(() => {
    if (!googleReady || !googleClientId || !googleButtonRef.current || !window.google?.accounts?.id) return;
    googleButtonRef.current.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response) => {
        setError(null);
        setSubmitting(true);
        try {
          await onGoogleLogin(response.credential);
          onClose();
        } catch (err) {
          setError(err.message);
        } finally {
          setSubmitting(false);
        }
      },
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "filled_black",
      size: "large",
      text: mode === "login" ? "signin_with" : "signup_with",
      shape: "rectangular",
      width: 320,
    });
  }, [googleReady, googleClientId, mode, onClose, onGoogleLogin]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await onLogin(username, password);
      } else {
        await onRegister(username, password);
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

        <div className="ab-google-login">
          {googleClientId ? (
            <div ref={googleButtonRef} className="ab-google-button" />
          ) : (
            <span className="ab-google-unavailable">Login Google não configurado.</span>
          )}
        </div>

        <div className="ab-auth-divider">ou</div>

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

          {error && <div className="ab-auth-error">{error}</div>}

          <button
            className="ab-btn ab-btn-primary ab-auth-submit"
            type="submit"
            disabled={submitting}
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
