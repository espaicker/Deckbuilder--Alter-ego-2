import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { COLOR_HEX } from "../lib/constants.js";
import { subtabPath } from "../lib/communityRoutes.js";
import { shareLink } from "../lib/share.js";

function ColorDots({ colors }) {
  if (!colors || colors.length === 0) return null;
  return (
    <span className="ab-dots" aria-hidden="true">
      {colors.map((c) => (
        <span key={c} className="ab-dot" style={{ background: COLOR_HEX[c] }} title={c} />
      ))}
    </span>
  );
}

function WinRate({ value, lowSample }) {
  if (value === null || value === undefined) return <span className="ab-meta-muted">—</span>;
  return (
    <span>
      {value}%
      {lowSample && <span className="ab-meta-low" title="Menos de 10 partidas: número ainda pouco confiável"> amostra pequena</span>}
    </span>
  );
}

function ArchetypeRow({ a, open, onToggle }) {
  const listId = `ab-meta-list-${a.alter_ego_id}`;
  return (
    <li className="ab-meta-row">
      <button
        className="ab-meta-row-head"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
      >
        <span className="ab-meta-name">
          <ColorDots colors={a.colors} />
          <strong>{a.name}</strong>
        </span>
        <span className="ab-meta-bar" aria-hidden="true">
          <span className="ab-meta-bar-fill" style={{ width: `${Math.max(2, a.percent)}%` }} />
        </span>
        <span className="ab-meta-num">{a.percent}%</span>
        <span className="ab-meta-num">{a.decks} deck{a.decks === 1 ? "" : "s"}</span>
        <span className="ab-meta-num"><WinRate value={a.win_rate} lowSample={a.low_sample} /></span>
      </button>
      {open && (
        <div id={listId} className="ab-meta-typical">
          {a.games > 0 && (
            <p className="ab-meta-muted">
              Em torneios: {a.tournament_entries} participação{a.tournament_entries === 1 ? "" : "ões"},{" "}
              {a.wins}V / {a.losses}D / {a.draws}E.
            </p>
          )}
          {a.typical_list.length === 0 ? (
            <p className="ab-meta-muted">Nenhuma carta aparece em pelo menos metade dos decks deste Alter Ego.</p>
          ) : (
            <>
              <div className="ab-sidebar-group-title">Lista típica (cartas em 50% ou mais dos decks)</div>
              {a.typical_list.map((c) => (
                <div key={c.card_id} className="ab-sidebar-row">
                  <span className="ab-sidebar-name">{c.name}</span>
                  <span className="ab-meta-muted">{c.inclusion}% dos decks</span>
                  <span className="ab-sidebar-qty">×{c.avg_qty}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </li>
  );
}

export default function MetaTab({ flashToast }) {
  const [officialOnly, setOfficialOnly] = useState(false);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getMeta(officialOnly)
      .then((data) => { if (!cancelled) setMeta(data); })
      .catch((err) => { if (!cancelled) setError(err.message || "Erro ao carregar o metagame."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [officialOnly]);

  return (
    <section className="ab-section">
      <div className="ab-detail-toolbar">
        <h1 className="ab-section-title">Metagame</h1>
        <button
          className="ab-btn ab-btn-ghost"
          onClick={() => shareLink(subtabPath("meta"), "Metagame — Forja de Alter Egos", flashToast)}
        >
          Compartilhar link
        </button>
      </div>
      <p className="ab-section-sub">
        Quanto cada Alter Ego aparece nos decks publicados e como ele se sai em torneios finalizados.
        Toque em um Alter Ego para ver a lista típica.
      </p>

      <div className="ab-chip-row" role="group" aria-label="Torneios considerados na taxa de vitória">
        <button className={`ab-chip ${!officialOnly ? "is-active" : ""}`} onClick={() => setOfficialOnly(false)}>
          Todos os torneios
        </button>
        <button className={`ab-chip ${officialOnly ? "is-active" : ""}`} onClick={() => setOfficialOnly(true)}>
          Só oficiais
        </button>
      </div>

      {loading && <div className="ab-empty">Carregando metagame…</div>}
      {!loading && error && <div className="ab-empty">{error}</div>}

      {!loading && !error && meta && meta.total_decks === 0 && (
        <div className="ab-empty">Ainda não há decks publicados para calcular o metagame.</div>
      )}

      {!loading && !error && meta && meta.total_decks > 0 && (
        <>
          <p className="ab-meta-muted">
            {meta.total_decks} deck{meta.total_decks === 1 ? "" : "s"} publicado{meta.total_decks === 1 ? "" : "s"} ·{" "}
            {meta.tournament_entries} participaç{meta.tournament_entries === 1 ? "ão" : "ões"} em torneios finalizados
          </p>

          <div className="ab-meta-row-head ab-meta-header" aria-hidden="true">
            <span className="ab-meta-name">Alter Ego</span>
            <span className="ab-meta-bar" />
            <span className="ab-meta-num">Meta</span>
            <span className="ab-meta-num">Decks</span>
            <span className="ab-meta-num">Vitórias</span>
          </div>
          <ul className="ab-meta-list">
            {meta.archetypes.map((a) => (
              <ArchetypeRow
                key={a.alter_ego_id}
                a={a}
                open={openId === a.alter_ego_id}
                onToggle={() => setOpenId(openId === a.alter_ego_id ? null : a.alter_ego_id)}
              />
            ))}
          </ul>

          {meta.top_cards.length > 0 && (
            <div className="ab-meta-cards">
              <h2 className="ab-sidebar-title ab-sidebar-title-spaced">Cartas mais usadas</h2>
              {meta.top_cards.map((c) => (
                <div key={c.card_id} className="ab-sidebar-row">
                  <span className="ab-sidebar-name">{c.name}</span>
                  <span className="ab-meta-muted">{c.percent}% dos decks</span>
                  <span className="ab-sidebar-qty"><WinRate value={c.win_rate} lowSample={c.low_sample} /></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
