import { useState } from "react";

export default function ForumTab({ user, flashToast, onRequestLogin }) {
  return (
    <section className="ab-section">
      <h1 className="ab-section-title">Fórum</h1>
      <p className="ab-section-sub">
        Discuta estratégias, compartilhe dicas e conecte-se com outros jogadores.
      </p>

      <div className="ab-forum-placeholder">
        <div className="ab-forum-placeholder-icon">💬</div>
        <h2 className="ab-forum-placeholder-title">Em breve!</h2>
        <p className="ab-forum-placeholder-text">
          O fórum da comunidade está em desenvolvimento. Aqui você poderá criar
          tópicos, responder discussões e trocar ideias sobre o meta, combos e
          estratégias de deck.
        </p>
        {!user && (
          <button className="ab-btn ab-btn-primary" onClick={onRequestLogin}>
            Faça login para participar
          </button>
        )}
      </div>
    </section>
  );
}
