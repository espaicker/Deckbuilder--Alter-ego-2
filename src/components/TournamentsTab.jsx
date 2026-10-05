import { useState, useEffect, useMemo } from "react";
import { api } from "../lib/api.js";

const FORMAT_LABELS = {
  swiss: "Suíço",
  swiss_topcut: "Suíço + Mata-mata",
  single_elim: "Eliminação simples",
};

const STATUS_LABELS = {
  inscricao: "Inscrições abertas",
  em_andamento: "Em andamento",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

const STATUS_CLASS = {
  inscricao: "is-open",
  em_andamento: "is-active",
  finalizado: "is-done",
  cancelado: "is-cancelled",
};

/* ============================================================
   CREATE TOURNAMENT FORM
   ============================================================ */
function CreateTournamentForm({ user, onCreated, onCancel }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState("swiss");
  const [topCutSize, setTopCutSize] = useState(8);
  const [maxPlayers, setMaxPlayers] = useState("");
  const [storeId, setStoreId] = useState("");
  const [isOfficial, setIsOfficial] = useState(false);
  const [myStores, setMyStores] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getMyStores()
      .then((rows) => setMyStores((rows || []).filter((s) => s.approved)))
      .catch(() => setMyStores([]));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = {
        name: name.trim(),
        description: description.trim(),
        format,
        top_cut_size: format === "swiss_topcut" ? topCutSize : undefined,
        max_players: maxPlayers ? parseInt(maxPlayers, 10) : undefined,
        store_id: storeId ? parseInt(storeId, 10) : undefined,
        is_official: user?.role === "admin" ? isOfficial : undefined,
      };
      await api.createTournament(data);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="ab-tournament-form" onSubmit={handleSubmit}>
      <h2 className="ab-section-title">Criar Torneio</h2>

      <label className="ab-field">
        <span className="ab-field-label">Nome do torneio</span>
        <input
          className="ab-input"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 80))}
          maxLength={80}
          placeholder="Ex: Torneio Semanal #1"
          required
        />
      </label>

      <label className="ab-field">
        <span className="ab-field-label">Descrição (opcional)</span>
        <textarea
          className="ab-input ab-publish-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={3}
          placeholder="Regras extras, horário, prêmios..."
        />
      </label>

      <label className="ab-field">
        <span className="ab-field-label">Formato</span>
        <select
          className="ab-input ab-select"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          <option value="swiss">Suíço</option>
          <option value="swiss_topcut">Suíço + Mata-mata</option>
          <option value="single_elim">Eliminação simples</option>
        </select>
      </label>

      {format === "swiss_topcut" && (
        <label className="ab-field">
          <span className="ab-field-label">Tamanho do corte (top cut)</span>
          <select
            className="ab-input ab-select"
            value={topCutSize}
            onChange={(e) => setTopCutSize(parseInt(e.target.value, 10))}
          >
            <option value={2}>Top 2</option>
            <option value={4}>Top 4</option>
            <option value={8}>Top 8</option>
            <option value={16}>Top 16</option>
          </select>
        </label>
      )}

      <label className="ab-field">
        <span className="ab-field-label">Máximo de jogadores (opcional)</span>
        <input
          className="ab-input"
          type="number"
          min="2"
          max="512"
          value={maxPlayers}
          onChange={(e) => setMaxPlayers(e.target.value)}
          placeholder="Sem limite"
        />
      </label>

      {user?.role === "admin" && (
        <label className="ab-auth-terms">
          <input type="checkbox" checked={isOfficial} onChange={(e) => setIsOfficial(e.target.checked)} />
          <span>Torneio oficial (os resultados contam para o ranking)</span>
        </label>
      )}

      {myStores.length > 0 && (
        <label className="ab-field">
          <span className="ab-field-label">Vincular a uma loja parceira (opcional)</span>
          <select
            className="ab-input ab-select"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="">— Nenhuma loja —</option>
            {myStores.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.city}/{s.state})</option>
            ))}
          </select>
        </label>
      )}

      {error && <div className="ab-auth-error">{error}</div>}

      <div className="ab-publish-actions">
        <button className="ab-btn ab-btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Criando…" : "Criar torneio"}
        </button>
        <button className="ab-btn ab-btn-ghost" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/* ============================================================
   TOURNAMENT DETAIL VIEW
   ============================================================ */
function TournamentDetail({ tournamentId, user, flashToast, onBack, onRequestLogin }) {
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [myDecks, setMyDecks] = useState([]);
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [registering, setRegistering] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // track which action is in progress
  const [reportingMatchId, setReportingMatchId] = useState(null);

  useEffect(() => {
    loadTournament();
  }, [tournamentId]);

  useEffect(() => {
    if (user) {
      api.getMyDecks().then(setMyDecks).catch(() => setMyDecks([]));
    }
  }, [user]);

  async function loadTournament() {
    setLoading(true);
    try {
      const data = await api.getTournament(tournamentId);
      setTournament(data);
    } catch (err) {
      flashToast("Erro ao carregar torneio.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    if (!selectedDeckId) {
      flashToast("Selecione um deck para se inscrever.");
      return;
    }
    setRegistering(true);
    try {
      await api.registerForTournament(tournamentId, parseInt(selectedDeckId, 10));
      flashToast("Inscrição confirmada!");
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setRegistering(false);
    }
  }

  async function handleUnregister() {
    setActionLoading("unregister");
    try {
      await api.unregisterFromTournament(tournamentId);
      flashToast("Inscrição cancelada.");
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDrop() {
    setActionLoading("drop");
    try {
      await api.dropFromTournament(tournamentId);
      flashToast("Drop registrado.");
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStart() {
    setActionLoading("start");
    try {
      await api.startTournament(tournamentId);
      flashToast("Torneio iniciado!");
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleNextRound() {
    setActionLoading("nextRound");
    try {
      const res = await api.nextRound(tournamentId);
      flashToast(res.message);
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStartTopCut() {
    setActionLoading("topcut");
    try {
      const res = await api.startTopCut(tournamentId);
      flashToast(res.message);
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancel() {
    setActionLoading("cancel");
    try {
      await api.cancelTournament(tournamentId);
      flashToast("Torneio cancelado.");
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleToggleOfficial() {
    setActionLoading("official");
    try {
      const res = await api.setTournamentRanked(tournamentId, !tournament.is_official);
      flashToast(res.message);
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleOverrideResult(matchId) {
    const result = window.prompt("Novo resultado? Digite: player1, player2 ou draw");
    if (!result || !["player1", "player2", "draw"].includes(result)) {
      if (result !== null) flashToast("Resultado invalido. Use player1, player2 ou draw.");
      return;
    }
    const reason = window.prompt("Motivo da correcao (opcional):") || "";
    try {
      await api.overrideMatchResult(tournamentId, matchId, result, reason);
      flashToast("Resultado corrigido pelo juiz.");
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    }
  }

  async function handleReportResult(matchId, result) {
    setReportingMatchId(matchId);
    try {
      await api.reportMatchResult(tournamentId, matchId, result);
      flashToast("Resultado registrado.");
      loadTournament();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setReportingMatchId(null);
    }
  }

  if (loading) {
    return (
      <section className="ab-section">
        <div className="ab-empty">Carregando torneio…</div>
      </section>
    );
  }

  if (!tournament) {
    return (
      <section className="ab-section">
        <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Voltar</button>
        <div className="ab-empty">Torneio não encontrado.</div>
      </section>
    );
  }

  const t = tournament;
  const isOrganizer = t.isOrganizer || t.isAdmin;
  const isRegistered = !!t.myRegistration;
  const canRegister = t.status === "inscricao" && user && !isRegistered;
  const canUnregister = t.status === "inscricao" && isRegistered;
  const canDrop = t.status === "em_andamento" && isRegistered && !t.myRegistration?.dropped;

  // Group matches by round
  const roundsMap = {};
  (t.matches || []).forEach((m) => {
    const key = `${m.stage}-${m.roundNumber}`;
    if (!roundsMap[key]) roundsMap[key] = { stage: m.stage, roundNumber: m.roundNumber, matches: [] };
    roundsMap[key].matches.push(m);
  });
  const roundsList = Object.values(roundsMap).sort((a, b) => a.roundNumber - b.roundNumber);

  return (
    <section className="ab-section ab-tournament-detail">
      <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Voltar</button>

      <div className="ab-tournament-detail-header">
        <h2 className="ab-section-title">{t.name}</h2>
        <span className={`ab-tournament-status ${STATUS_CLASS[t.status]}`}>
          {STATUS_LABELS[t.status]}
        </span>
      </div>

      <div className="ab-tournament-meta">
        <span>Organizador: <strong>{t.organizer_username}</strong></span>
        {t.is_official ? <span className="ab-tournament-official">★ Oficial (vale para o ranking)</span> : null}
        <span>Formato: <strong>{FORMAT_LABELS[t.format]}</strong></span>
        {t.store_name && <span>Loja: <strong>{t.store_name}</strong> ({t.store_city}/{t.store_state})</span>}
        {t.max_players && <span>Máx. jogadores: <strong>{t.max_players}</strong></span>}
        <span>Inscritos: <strong>{t.players?.length || 0}</strong></span>
        {t.round_count && <span>Rodadas: <strong>{t.current_round || 0}/{t.round_count}</strong></span>}
      </div>

      {t.description && <p className="ab-tournament-desc">{t.description}</p>}

      {/* Registration section */}
      {t.status === "inscricao" && (
        <div className="ab-tournament-register-section">
          {!user && (
            <button className="ab-btn ab-btn-primary" onClick={onRequestLogin}>
              Faça login para se inscrever
            </button>
          )}

          {canRegister && (
            <div className="ab-tournament-register-form">
              <span className="ab-field-label">Escolha seu deck (publicado na comunidade):</span>
              <div className="ab-tournament-register-row">
                <select
                  className="ab-input ab-select"
                  value={selectedDeckId}
                  onChange={(e) => setSelectedDeckId(e.target.value)}
                >
                  <option value="">— Selecione um deck —</option>
                  {myDecks.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <button
                  className="ab-btn ab-btn-primary"
                  onClick={handleRegister}
                  disabled={registering || !selectedDeckId}
                >
                  {registering ? "Inscrevendo…" : "Inscrever-se"}
                </button>
              </div>
              {myDecks.length === 0 && (
                <p className="ab-tournament-hint">
                  Você precisa ter pelo menos um deck publicado na comunidade para se inscrever.
                </p>
              )}
            </div>
          )}

          {canUnregister && (
            <div className="ab-tournament-registered">
              <span className="ab-tournament-registered-badge">✓ Você está inscrito</span>
              <button className="ab-btn ab-btn-ghost" onClick={handleUnregister} disabled={!!actionLoading}>
                {actionLoading === "unregister" ? "Cancelando…" : "Cancelar inscrição"}
              </button>
            </div>
          )}
        </div>
      )}

      {canDrop && (
        <div className="ab-tournament-registered">
          <span className="ab-tournament-registered-badge">✓ Você está participando</span>
          <button className="ab-btn ab-btn-ghost" onClick={handleDrop} disabled={!!actionLoading}>
            {actionLoading === "drop" ? "Saindo…" : "Dar drop (desistir)"}
          </button>
        </div>
      )}

      {/* Organizer controls */}
      {isOrganizer && (
        <div className="ab-tournament-organizer">
          <div className="ab-sidebar-group-title">Controles do organizador</div>
          <div className="ab-tournament-organizer-actions">
            {t.isAdmin && t.status === "inscricao" && (
              <button className="ab-btn ab-btn-ghost" onClick={handleToggleOfficial} disabled={!!actionLoading}>
                {t.is_official ? "Desmarcar como oficial" : "Marcar como oficial (ranking)"}
              </button>
            )}
            {t.status === "inscricao" && (
              <>
                <button className="ab-btn ab-btn-primary" onClick={handleStart} disabled={!!actionLoading}>
                  {actionLoading === "start" ? "Iniciando…" : "Iniciar torneio"}
                </button>
                <button className="ab-btn ab-btn-ghost" onClick={handleCancel} disabled={!!actionLoading}>
                  {actionLoading === "cancel" ? "Cancelando…" : "Cancelar torneio"}
                </button>
              </>
            )}
            {t.status === "em_andamento" && (
              <>
                <button className="ab-btn ab-btn-primary" onClick={handleNextRound} disabled={!!actionLoading}>
                  {actionLoading === "nextRound" ? "Gerando…" : "Próxima rodada"}
                </button>
                {t.format === "swiss_topcut" && t.current_round >= t.round_count && (
                  <button className="ab-btn ab-btn-accent" onClick={handleStartTopCut} disabled={!!actionLoading}>
                    {actionLoading === "topcut" ? "Avançando…" : "Avançar para mata-mata"}
                  </button>
                )}
                <button className="ab-btn ab-btn-ghost" onClick={handleCancel} disabled={!!actionLoading}>
                  {actionLoading === "cancel" ? "Cancelando…" : "Cancelar torneio"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Players list */}
      {t.players && t.players.length > 0 && (
        <div className="ab-tournament-players">
          <div className="ab-sidebar-group-title">Jogadores inscritos ({t.players.length})</div>
          <div className="ab-tournament-players-list">
            {t.players.map((p) => (
              <div key={p.id} className={`ab-tournament-player ${p.dropped ? "is-dropped" : ""}`}>
                <span className="ab-tournament-player-name">{p.username}</span>
                <span className="ab-tournament-player-deck">{p.deck_name}</span>
                {p.dropped ? <span className="ab-tournament-player-dropped">drop</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Standings */}
      {t.standings && t.standings.length > 0 && t.status !== "inscricao" && (
        <div className="ab-tournament-standings">
          <div className="ab-sidebar-group-title">Classificação</div>
          <table className="ab-tournament-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Jogador</th>
                <th>Pts</th>
                <th>V</th>
                <th>E</th>
                <th>D</th>
                <th>OMW%</th>
              </tr>
            </thead>
            <tbody>
              {t.standings.map((s, i) => (
                <tr key={s.playerId}>
                  <td>{i + 1}</td>
                  <td>{s.username}</td>
                  <td><strong>{s.matchPoints}</strong></td>
                  <td>{s.wins}</td>
                  <td>{s.draws}</td>
                  <td>{s.losses}</td>
                  <td>{(s.omw * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Rounds / Matches */}
      {roundsList.length > 0 && (
        <div className="ab-tournament-rounds">
          <div className="ab-sidebar-group-title">Rodadas</div>
          {roundsList.map((round) => (
            <div key={`${round.stage}-${round.roundNumber}`} className="ab-tournament-round">
              <h4 className="ab-tournament-round-title">
                {round.stage === "topcut" ? "Mata-mata" : "Suíço"} — Rodada {round.roundNumber}
              </h4>
              <div className="ab-tournament-matches">
                {round.matches.map((m) => (
                  <div key={m.id} className="ab-tournament-match">
                    <div className="ab-tournament-match-players">
                      <span className={m.result === "player1" ? "is-winner" : ""}>
                        {m.player1Name || "BYE"}
                      </span>
                      <span className="ab-tournament-match-vs">vs</span>
                      <span className={m.result === "player2" ? "is-winner" : ""}>
                        {m.player2Name || "BYE"}
                      </span>
                    </div>
                    <div className="ab-tournament-match-result">
                      {m.result === "pending" && (
                        <>
                          {user && (isOrganizer || isPlayerInMatch(m, t.myRegistration)) && (
                            <div className="ab-tournament-match-report">
                              <button
                                className="ab-btn ab-btn-ghost ab-btn-sm"
                                onClick={() => handleReportResult(m.id, "player1")}
                              >
                                {m.player1Name} venceu
                              </button>
                              <button
                                className="ab-btn ab-btn-ghost ab-btn-sm"
                                onClick={() => handleReportResult(m.id, "player2")}
                              >
                                {m.player2Name} venceu
                              </button>
                              <button
                                className="ab-btn ab-btn-ghost ab-btn-sm"
                                onClick={() => handleReportResult(m.id, "draw")}
                              >
                                Empate
                              </button>
                            </div>
                          )}
                          {!(user && (isOrganizer || isPlayerInMatch(m, t.myRegistration))) && (
                            <span className="ab-tournament-match-pending">Aguardando resultado</span>
                          )}
                        </>
                      )}
                      {m.result === "player1" && <span className="ab-tournament-match-done">{m.player1Name} venceu</span>}
                      {m.result === "player2" && <span className="ab-tournament-match-done">{m.player2Name} venceu</span>}
                      {m.result === "draw" && <span className="ab-tournament-match-done">Empate</span>}
                      {m.result === "bye" && <span className="ab-tournament-match-done">BYE</span>}
                      {t.isJudge && !isOrganizer && !isPlayerInMatch(m, t.myRegistration) && m.result !== "pending" && m.result !== "bye" && (
                        <button
                          className="ab-btn ab-btn-ghost ab-btn-sm ab-tournament-judge-btn"
                          onClick={() => handleOverrideResult(m.id)}
                          title="Corrigir resultado (juiz)"
                        >
                          Corrigir resultado
                        </button>
                      )}
                      {m.override_reason && (
                        <span className="ab-tournament-override-note">Corrigido: {m.override_reason}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function isPlayerInMatch(match, myRegistration) {
  if (!myRegistration) return false;
  return match.player1Id === myRegistration.id || match.player2Id === myRegistration.id;
}

/* ============================================================
   TOURNAMENT LIST (main view)
   ============================================================ */
export default function TournamentsTab({ user, flashToast, onRequestLogin }) {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | create | detail
  const [selectedId, setSelectedId] = useState(null);
  const [filterStatus, setFilterStatus] = useState("todos");

  useEffect(() => {
    loadTournaments();
  }, []);

  async function loadTournaments() {
    setLoading(true);
    try {
      const data = await api.getTournaments();
      setTournaments(data);
    } catch (err) {
      flashToast("Erro ao carregar torneios.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (filterStatus === "todos") return tournaments;
    return tournaments.filter((t) => t.status === filterStatus);
  }, [tournaments, filterStatus]);

  if (view === "create") {
    return (
      <section className="ab-section">
        <CreateTournamentForm
          user={user}
          onCreated={() => {
            flashToast("Torneio criado!");
            setView("list");
            loadTournaments();
          }}
          onCancel={() => setView("list")}
        />
      </section>
    );
  }

  if (view === "detail" && selectedId) {
    return (
      <TournamentDetail
        tournamentId={selectedId}
        user={user}
        flashToast={flashToast}
        onBack={() => { setView("list"); loadTournaments(); }}
        onRequestLogin={onRequestLogin}
      />
    );
  }

  return (
    <section className="ab-section">
      <h1 className="ab-section-title">Torneios</h1>
      <p className="ab-section-sub">
        Participe de torneios da comunidade ou crie o seu próprio.
      </p>

      <div className="ab-community-actions">
        {user && (
          <button className="ab-btn ab-btn-primary" onClick={() => setView("create")}>
            Criar torneio
          </button>
        )}
        {!user && (
          <button className="ab-btn ab-btn-primary" onClick={onRequestLogin}>
            Faça login para criar/inscrever
          </button>
        )}
        <button className="ab-btn ab-btn-ghost" onClick={loadTournaments} disabled={loading}>
          {loading ? "Carregando…" : "Atualizar"}
        </button>
      </div>

      <div className="ab-chip-row">
        {[
          ["todos", "Todos"],
          ["inscricao", "Inscrições abertas"],
          ["em_andamento", "Em andamento"],
          ["finalizado", "Finalizados"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`ab-chip ${filterStatus === key ? "is-active" : ""}`}
            onClick={() => setFilterStatus(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="ab-empty">Carregando torneios…</div>}

      {!loading && filtered.length === 0 && (
        <div className="ab-empty">
          Nenhum torneio encontrado. {filterStatus !== "todos" ? "Tente outro filtro." : "Seja o primeiro a criar um!"}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="ab-tournament-grid">
          {filtered.map((t) => (
            <div
              key={t.id}
              className="ab-tournament-card"
              onClick={() => { setSelectedId(t.id); setView("detail"); }}
            >
              <div className="ab-tournament-card-top">
                <span className={`ab-tournament-status ${STATUS_CLASS[t.status]}`}>
                  {STATUS_LABELS[t.status]}
                </span>
                <span className="ab-tournament-card-format">
                  {FORMAT_LABELS[t.format]}
                </span>
                {t.is_official ? <span className="ab-tournament-official">★ Oficial</span> : null}
              </div>
              <div className="ab-tournament-card-name">{t.name}</div>
              <div className="ab-tournament-card-meta">
                <span>por {t.organizer_username}</span>
                <span>{t.player_count} jogador{t.player_count !== 1 ? "es" : ""}</span>
                {t.max_players && <span>máx. {t.max_players}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
