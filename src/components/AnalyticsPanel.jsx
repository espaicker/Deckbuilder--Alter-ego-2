import { useState, useEffect } from "react";
import { api } from "../lib/api.js";

export default function AnalyticsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { loadAnalytics(); }, []);

  async function loadAnalytics() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAnalytics();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="ab-empty">Carregando analytics…</div>;
  if (error) return <div className="ab-auth-error">{error}</div>;
  if (!data) return null;

  const { topCards, archetypeStats, tournamentActivity, overall } = data;

  return (
    <div className="ab-analytics">
      <h3 className="ab-section-title">Analytics de Torneios</h3>

      {/* Overall stats */}
      <div className="ab-admin-stats">
        <div className="ab-admin-stat-card">
          <span className="ab-admin-stat-value">{overall.total_official_tournaments}</span>
          <span className="ab-admin-stat-label">Torneios oficiais</span>
        </div>
        <div className="ab-admin-stat-card">
          <span className="ab-admin-stat-value">{overall.total_finished}</span>
          <span className="ab-admin-stat-label">Finalizados</span>
        </div>
        <div className="ab-admin-stat-card">
          <span className="ab-admin-stat-value">{overall.total_matches_played}</span>
          <span className="ab-admin-stat-label">Partidas jogadas</span>
        </div>
        <div className="ab-admin-stat-card">
          <span className="ab-admin-stat-value">{overall.total_ranked_players}</span>
          <span className="ab-admin-stat-label">Jogadores rankeados</span>
        </div>
      </div>

      {/* Win rate by archetype (Alter Ego) */}
      {archetypeStats.length > 0 && (
        <div className="ab-analytics-section">
          <h4 className="ab-sidebar-group-title">Win Rate por Alter Ego</h4>
          <table className="ab-admin-table">
            <thead>
              <tr><th>Alter Ego</th><th>Decks</th><th>Partidas</th><th>Vitórias</th><th>Win %</th></tr>
            </thead>
            <tbody>
              {archetypeStats.map((a) => (
                <tr key={a.archetype}>
                  <td><code>{a.archetype}</code></td>
                  <td>{a.decks_played}</td>
                  <td>{a.total_matches}</td>
                  <td>{a.wins}</td>
                  <td>
                    <span className="ab-analytics-winrate" style={{ "--wr": `${a.win_rate}%` }}>
                      {a.win_rate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top cards */}
      {topCards.length > 0 && (
        <div className="ab-analytics-section">
          <h4 className="ab-sidebar-group-title">Cartas Mais Presentes em Decks Vencedores</h4>
          <table className="ab-admin-table">
            <thead>
              <tr><th>Carta</th><th>Vezes usada</th><th>Vitórias</th><th>Win %</th></tr>
            </thead>
            <tbody>
              {topCards.map((c) => (
                <tr key={c.card_id}>
                  <td><code>{c.card_id}</code></td>
                  <td>{c.times_used}</td>
                  <td>{c.wins}</td>
                  <td>{c.win_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tournament activity timeline */}
      {tournamentActivity.length > 0 && (
        <div className="ab-analytics-section">
          <h4 className="ab-sidebar-group-title">Atividade mensal</h4>
          <table className="ab-admin-table">
            <thead>
              <tr><th>Mês</th><th>Criados</th><th>Finalizados</th><th>Inscrições</th></tr>
            </thead>
            <tbody>
              {tournamentActivity.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{m.tournaments_created}</td>
                  <td>{m.tournaments_finished}</td>
                  <td>{m.total_registrations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {archetypeStats.length === 0 && topCards.length === 0 && (
        <div className="ab-empty">
          Nenhum dado de torneio oficial finalizado ainda. Crie e finalize um torneio oficial para ver analytics.
        </div>
      )}
    </div>
  );
}
