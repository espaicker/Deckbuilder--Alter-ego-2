import { useState, useEffect } from "react";
import { api } from "../lib/api.js";

export default function RankingTab() {
  const [ranking, setRanking] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0 });
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    loadRanking();
  }, [page, search]);

  async function loadRanking() {
    setLoading(true);
    try {
      const data = await api.getRanking(page, 50, search);
      setRanking(data.ranking);
      setPagination(data.pagination);
    } catch (err) {
      console.warn("[ranking] Erro:", err.message);
    } finally {
      setLoading(false);
    }
  }

  async function viewHistory(player) {
    setSelectedPlayer(player);
    setHistoryLoading(true);
    try {
      const data = await api.getRankingHistory(player.user_id);
      setHistory(data);
    } catch (err) {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setPage(1);
  }

  if (selectedPlayer) {
    return (
      <section className="ab-section">
        <button className="ab-btn ab-btn-ghost" onClick={() => setSelectedPlayer(null)}>
          ← Voltar ao ranking
        </button>
        <h2 className="ab-section-title">Histórico de {selectedPlayer.username}</h2>
        <div className="ab-ranking-player-stats">
          <div className="ab-community-stat">
            <span className="ab-meter-label">Total de Pontos</span>
            <span className="ab-combat-value">{selectedPlayer.total_points}</span>
          </div>
          <div className="ab-community-stat">
            <span className="ab-meter-label">Torneios</span>
            <span className="ab-combat-value">{selectedPlayer.tournaments_played}</span>
          </div>
          <div className="ab-community-stat">
            <span className="ab-meter-label">Winrate</span>
            <span className="ab-combat-value">{selectedPlayer.winrate}%</span>
          </div>
        </div>

        {historyLoading && <div className="ab-empty">Carregando histórico…</div>}

        {!historyLoading && history.length === 0 && (
          <div className="ab-empty">Nenhum registro de pontuação encontrado.</div>
        )}

        {!historyLoading && history.length > 0 && (
          <table className="ab-tournament-table">
            <thead>
              <tr>
                <th>Torneio</th>
                <th>Pontos</th>
                <th>Motivo</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.tournament_name}</td>
                  <td><strong>+{h.points_awarded}</strong></td>
                  <td>{h.reason}</td>
                  <td>{new Date(h.created_at).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  return (
    <section className="ab-section">
      <h1 className="ab-section-title">Ranking Global</h1>
      <p className="ab-section-sub">
        Classificação baseada em torneios oficiais. Vitória = +3pts, Empate = +1pt, Campeão = +10pts.
      </p>

      <form className="ab-ranking-search" onSubmit={handleSearch}>
        <input
          className="ab-input"
          placeholder="Buscar jogador…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button className="ab-btn ab-btn-primary" type="submit">Buscar</button>
        {search && (
          <button className="ab-btn ab-btn-ghost" type="button" onClick={clearSearch}>
            Limpar
          </button>
        )}
      </form>

      {loading && <div className="ab-empty">Carregando ranking…</div>}

      {!loading && ranking.length === 0 && (
        <div className="ab-empty">
          {search
            ? `Nenhum jogador encontrado com "${search}".`
            : "Nenhum jogador pontuou ainda. Participe de torneios oficiais!"}
        </div>
      )}

      {!loading && ranking.length > 0 && (
        <>
          <table className="ab-tournament-table ab-ranking-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Jogador</th>
                <th>Pontos</th>
                <th>Torneios</th>
                <th>Winrate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r) => (
                <tr key={r.user_id} className={r.position <= 3 ? "ab-ranking-top" : ""}>
                  <td>
                    <span className={`ab-ranking-pos ${r.position === 1 ? "is-gold" : r.position === 2 ? "is-silver" : r.position === 3 ? "is-bronze" : ""}`}>
                      {r.position}
                    </span>
                  </td>
                  <td><strong>{r.username}</strong></td>
                  <td>{r.total_points}</td>
                  <td>{r.tournaments_played}</td>
                  <td>{r.winrate}%</td>
                  <td>
                    <button
                      className="ab-btn ab-btn-ghost ab-btn-sm"
                      onClick={() => viewHistory(r)}
                    >
                      Histórico
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pagination.totalPages > 1 && (
            <div className="ab-ranking-pagination">
              <button
                className="ab-btn ab-btn-ghost ab-btn-sm"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
              >
                ← Anterior
              </button>
              <span className="ab-ranking-page-info">
                Página {page} de {pagination.totalPages}
              </span>
              <button
                className="ab-btn ab-btn-ghost ab-btn-sm"
                onClick={() => setPage(page + 1)}
                disabled={page >= pagination.totalPages}
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
