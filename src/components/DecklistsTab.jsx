import { useState, useEffect, useMemo } from "react";
import { api } from "../lib/api.js";
import { COLOR_HEX } from "../lib/constants.js";
import { DECK_RULES, countEntries, createCardIndex, colorBreakdown, costCurve, attackDefenseAverages, standardDropPile } from "../lib/deckRules.js";
import { useCardData } from "../hooks/useCardData.jsx";

// Índice das cartas atuais (GET /api/cards, com o JSON do build como
// fallback). Calculado uma vez por versão dos dados e compartilhado entre os
// componentes desta aba.
let cachedIndex = { data: null, index: null };
function indexFor(cardData) {
  if (cachedIndex.data !== cardData) {
    cachedIndex = { data: cardData, index: createCardIndex(cardData.cards) };
  }
  return cachedIndex.index;
}

function useCardIndex() {
  const { cardData } = useCardData();
  return useMemo(() => indexFor(cardData), [cardData]);
}

function DeckColorDots({ alterEgoId }) {
  const cardIndex = useCardIndex();
  const ae = cardIndex.get(alterEgoId);
  if (!ae) return null;
  return (
    <span className="ab-dots">
      {ae.colors.map((c) => (
        <span key={c} className="ab-dot" style={{ background: COLOR_HEX[c] }} title={c} />
      ))}
    </span>
  );
}

function DeckCard({ deck, onSelect, isSelected, onCompare, user }) {
  const cardIndex = useCardIndex();
  const ae = cardIndex.get(deck.alter_ego_id);
  const mainCount = countEntries(deck.main_deck || {});
  const sideCount = countEntries(deck.sideboard || {});

  return (
    <div className={`ab-community-card ${isSelected ? "is-selected" : ""}`}>
      <div className="ab-community-card-top">
        <DeckColorDots alterEgoId={deck.alter_ego_id} />
        <span className="ab-community-card-author">por {deck.author}</span>
      </div>
      <div className="ab-community-card-name">{deck.name}</div>
      <div className="ab-community-card-meta">
        <span>{ae?.name || deck.alter_ego_id}</span>
        <span>{mainCount} cartas · side {sideCount}</span>
      </div>
      {deck.description && (
        <p className="ab-community-card-desc">{deck.description}</p>
      )}
      <div className="ab-community-card-actions">
        <button className="ab-btn ab-btn-ghost" onClick={() => onSelect(deck)}>
          Ver detalhes
        </button>
        <button className="ab-btn ab-btn-ghost" onClick={() => onCompare(deck)}>
          Comparar
        </button>
      </div>
    </div>
  );
}

function groupByType(entries, cardIndex) {
  const groups = {};
  Object.entries(entries).forEach(([id, qty]) => {
    const card = cardIndex.get(id);
    if (!card) return;
    if (!groups[card.type]) groups[card.type] = [];
    groups[card.type].push({ card, qty });
  });
  Object.values(groups).forEach((arr) => arr.sort((a, b) => a.card.name.localeCompare(b.card.name)));
  return groups;
}

function CardGroups({ groups }) {
  return ["Ação", "Reação", "Tática"].map((type) =>
    groups[type] ? (
      <div key={type} className="ab-sidebar-group">
        <div className="ab-sidebar-group-title">{type}</div>
        {groups[type].map(({ card, qty }) => (
          <div key={card.id} className="ab-sidebar-row">
            <span className="ab-sidebar-dot" style={{ background: COLOR_HEX[card.colors[0]] }} />
            <span className="ab-sidebar-name">{card.name}</span>
            <span className="ab-sidebar-qty">×{qty}</span>
          </div>
        ))}
      </div>
    ) : null
  );
}

function DeckDetails({ deck, onClose, onCompare }) {
  const cardIndex = useCardIndex();
  const ae = cardIndex.get(deck.alter_ego_id);
  const mainDeck = deck.main_deck || {};
  const sideboard = deck.sideboard || {};
  // Drops são sempre o padrão do Alter Ego (10 de cada cor).
  const dropPile = ae ? standardDropPile(ae) : deck.drop_pile || {};
  const mainCount = countEntries(mainDeck);
  const sideCount = countEntries(sideboard);
  const dropCount = countEntries(dropPile);
  const cost = costCurve(mainDeck, cardIndex);
  const combat = attackDefenseAverages(mainDeck, cardIndex);

  const groups = groupByType(mainDeck, cardIndex);
  const sideGroups = groupByType(sideboard, cardIndex);

  return (
    <div className="ab-community-detail">
      <button className="ab-btn ab-btn-ghost" onClick={onClose}>← Voltar</button>
      <div className="ab-community-detail-header">
        <DeckColorDots alterEgoId={deck.alter_ego_id} />
        <h2>{deck.name}</h2>
        <span className="ab-community-card-author">por {deck.author}</span>
      </div>
      <div className="ab-community-detail-meta">
        <span>Alter Ego: <strong>{ae?.name || deck.alter_ego_id}</strong></span>
        <span>Deck: {mainCount}/{DECK_RULES.mainDeckSize}</span>
        <span>Sideboard: {sideCount}/{DECK_RULES.sideboardMaxSize}</span>
        <span>Drops: {dropCount} (fixo)</span>
      </div>
      {deck.description && <p className="ab-community-card-desc">{deck.description}</p>}

      <div className="ab-community-stats">
        <div className="ab-community-stat">
          <span className="ab-meter-label">ATQ médio</span>
          <span className="ab-combat-value">{combat.avgAttack?.toFixed(1) || "—"}</span>
        </div>
        <div className="ab-community-stat">
          <span className="ab-meter-label">DEF médio</span>
          <span className="ab-combat-value">{combat.avgDefense?.toFixed(1) || "—"}</span>
        </div>
        <div className="ab-community-stat">
          <span className="ab-meter-label">Custo máx</span>
          <span className="ab-combat-value">{cost.maxCost || "—"}</span>
        </div>
      </div>

      <CardGroups groups={groups} />

      {sideCount > 0 && (
        <div className="ab-community-detail-side">
          <div className="ab-sidebar-title ab-sidebar-title-spaced">Sideboard ({sideCount})</div>
          <CardGroups groups={sideGroups} />
        </div>
      )}

      <div className="ab-community-detail-drops">
        <div className="ab-sidebar-group-title">Drops</div>
        {Object.entries(dropPile).map(([color, qty]) => (
          <div key={color} className="ab-sidebar-row">
            <span className="ab-sidebar-dot" style={{ background: COLOR_HEX[color] }} />
            <span className="ab-sidebar-name">Drop {color}</span>
            <span className="ab-sidebar-qty">×{qty}</span>
          </div>
        ))}
      </div>

      <button className="ab-btn ab-btn-primary" onClick={() => onCompare(deck)}>
        Comparar com outro deck
      </button>
    </div>
  );
}

function CompareView({ deckA, deckB, onClose, allDecks }) {
  const cardIndex = useCardIndex();
  const [selectedB, setSelectedB] = useState(deckB);

  const statsA = useMemo(() => {
    if (!deckA) return null;
    const md = deckA.main_deck || {};
    const dp = deckA.drop_pile || {};
    return {
      mainCount: countEntries(md),
      sideCount: countEntries(deckA.sideboard || {}),
      colors: colorBreakdown(md, dp, cardIndex),
      cost: costCurve(md, cardIndex),
      combat: attackDefenseAverages(md, cardIndex),
      ae: cardIndex.get(deckA.alter_ego_id),
    };
  }, [deckA, cardIndex]);

  const statsB = useMemo(() => {
    if (!selectedB) return null;
    const md = selectedB.main_deck || {};
    const dp = selectedB.drop_pile || {};
    return {
      mainCount: countEntries(md),
      sideCount: countEntries(selectedB.sideboard || {}),
      colors: colorBreakdown(md, dp, cardIndex),
      cost: costCurve(md, cardIndex),
      combat: attackDefenseAverages(md, cardIndex),
      ae: cardIndex.get(selectedB.alter_ego_id),
    };
  }, [selectedB, cardIndex]);

  const otherDecks = allDecks.filter((d) => d.id !== deckA?.id);

  return (
    <div className="ab-compare">
      <button className="ab-btn ab-btn-ghost" onClick={onClose}>← Voltar</button>
      <h2 className="ab-section-title">Comparação de Decks</h2>

      {!selectedB && (
        <div className="ab-compare-picker">
          <p className="ab-section-sub">Escolha um deck para comparar com "{deckA.name}":</p>
          <div className="ab-community-grid">
            {otherDecks.map((d) => (
              <button
                key={d.id}
                className="ab-community-card ab-compare-pick-card"
                onClick={() => setSelectedB(d)}
              >
                <DeckColorDots alterEgoId={d.alter_ego_id} />
                <div className="ab-community-card-name">{d.name}</div>
                <span className="ab-community-card-author">por {d.author}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedB && statsA && statsB && (
        <div className="ab-compare-table">
          <div className="ab-compare-header">
            <div className="ab-compare-col">
              <DeckColorDots alterEgoId={deckA.alter_ego_id} />
              <strong>{deckA.name}</strong>
              <span className="ab-community-card-author">{deckA.author}</span>
            </div>
            <div className="ab-compare-vs">VS</div>
            <div className="ab-compare-col">
              <DeckColorDots alterEgoId={selectedB.alter_ego_id} />
              <strong>{selectedB.name}</strong>
              <span className="ab-community-card-author">{selectedB.author}</span>
            </div>
          </div>

          <CompareRow label="Alter Ego" a={statsA.ae?.name || "?"} b={statsB.ae?.name || "?"} />
          <CompareRow label="Cartas" a={statsA.mainCount} b={statsB.mainCount} />
          <CompareRow label="Sideboard" a={statsA.sideCount} b={statsB.sideCount} />
          <CompareRow
            label="ATQ médio"
            a={statsA.combat.avgAttack?.toFixed(1) || "—"}
            b={statsB.combat.avgAttack?.toFixed(1) || "—"}
            highlight
          />
          <CompareRow
            label="DEF médio"
            a={statsA.combat.avgDefense?.toFixed(1) || "—"}
            b={statsB.combat.avgDefense?.toFixed(1) || "—"}
            highlight
          />
          <CompareRow
            label="Custo máximo"
            a={statsA.cost.maxCost || 0}
            b={statsB.cost.maxCost || 0}
          />
          <CompareRow
            label="Cartas ATQ"
            a={statsA.combat.attackCount}
            b={statsB.combat.attackCount}
          />
          <CompareRow
            label="Cartas DEF"
            a={statsA.combat.defenseCount}
            b={statsB.combat.defenseCount}
          />

          <button
            className="ab-btn ab-btn-ghost"
            onClick={() => setSelectedB(null)}
            style={{ marginTop: 16 }}
          >
            Trocar deck para comparar
          </button>
        </div>
      )}
    </div>
  );
}

function CompareRow({ label, a, b, highlight }) {
  const numA = parseFloat(a);
  const numB = parseFloat(b);
  const aWins = !isNaN(numA) && !isNaN(numB) && numA > numB;
  const bWins = !isNaN(numA) && !isNaN(numB) && numB > numA;

  return (
    <div className="ab-compare-row">
      <span className={`ab-compare-val ${highlight && aWins ? "is-better" : ""}`}>{a}</span>
      <span className="ab-compare-label">{label}</span>
      <span className={`ab-compare-val ${highlight && bWins ? "is-better" : ""}`}>{b}</span>
    </div>
  );
}

function PublishForm({ alterEgo, mainDeck, sideboard, onPublish, onCancel }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [issues, setIssues] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!alterEgo) return;
    setError(null);
    setIssues(null);
    setSubmitting(true);
    try {
      await onPublish({
        name: name.trim() || `${alterEgo.name} — ${new Date().toLocaleDateString("pt-BR")}`,
        alter_ego_id: alterEgo.id,
        main_deck: mainDeck,
        sideboard: sideboard || {},
        description: description.trim(),
      });
    } catch (err) {
      setError(err.message);
      setIssues(Array.isArray(err.issues) ? err.issues : null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="ab-publish-form" onSubmit={handleSubmit}>
      <h3 className="ab-sidebar-group-title">Publicar deck na comunidade</h3>
      <input
        className="ab-input"
        placeholder="Nome do deck"
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 80))}
        maxLength={80}
      />
      <textarea
        className="ab-input ab-publish-desc"
        placeholder="Descrição (estratégia, combos, dicas…)"
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, 500))}
        maxLength={500}
        rows={3}
      />
      {error && (
        <div className="ab-auth-error">
          {error}
          {issues && issues.length > 0 && (
            <ul className="ab-publish-issues">
              {issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="ab-publish-actions">
        <button className="ab-btn ab-btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Publicando…" : "Publicar"}
        </button>
        <button className="ab-btn ab-btn-ghost" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function CommunityTab({ user, alterEgo, mainDeck, sideboard, flashToast, onRequestLogin }) {
  const cardIndex = useCardIndex();
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | detail | compare | publish
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [compareDeckA, setCompareDeckA] = useState(null);

  useEffect(() => {
    loadDecks();
  }, []);

  async function loadDecks() {
    setLoading(true);
    try {
      const data = await api.getCommunityDecks();
      setDecks(data);
    } catch (err) {
      console.warn("[community] Erro ao carregar decks:", err.message);
      flashToast("Erro ao carregar decks da comunidade.");
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(deck) {
    setSelectedDeck(deck);
    setView("detail");
  }

  function handleCompare(deck) {
    setCompareDeckA(deck);
    setView("compare");
  }

  async function handlePublish(deckData) {
    await api.publishDeck(deckData);
    flashToast("Deck publicado na comunidade!");
    setView("list");
    loadDecks();
  }

  async function handleDelete(id) {
    try {
      await api.deleteDeck(id);
      flashToast("Deck removido.");
      loadDecks();
      setView("list");
    } catch (err) {
      flashToast(err.message);
    }
  }

  if (view === "detail" && selectedDeck) {
    return (
      <section className="ab-section">
        <DeckDetails
          deck={selectedDeck}
          onClose={() => setView("list")}
          onCompare={handleCompare}
        />
        {user && selectedDeck.is_mine && (
          <button
            className="ab-btn ab-btn-ghost ab-delete-btn"
            onClick={() => handleDelete(selectedDeck.id)}
          >
            Remover meu deck
          </button>
        )}
      </section>
    );
  }

  if (view === "compare" && compareDeckA) {
    return (
      <section className="ab-section">
        <CompareView
          deckA={compareDeckA}
          deckB={null}
          onClose={() => setView("list")}
          allDecks={decks}
        />
      </section>
    );
  }

  if (view === "publish") {
    return (
      <section className="ab-section">
        <PublishForm
          alterEgo={alterEgo ? cardIndex.get(alterEgo.id || alterEgo) : null}
          mainDeck={mainDeck}
          sideboard={sideboard}
          onPublish={handlePublish}
          onCancel={() => setView("list")}
        />
      </section>
    );
  }

  return (
    <section className="ab-section">
      <h1 className="ab-section-title">Comunidade</h1>
      <p className="ab-section-sub">
        Decks publicados por jogadores. Compare estratégias e inspire-se!
      </p>

      <div className="ab-community-actions">
        {user && user.role !== "admin" && alterEgo && (
          <button className="ab-btn ab-btn-primary" onClick={() => setView("publish")}>
            Publicar meu deck
          </button>
        )}
        {!user && (
          <button className="ab-btn ab-btn-primary" onClick={onRequestLogin}>
            Faça login para publicar
          </button>
        )}
        <button className="ab-btn ab-btn-ghost" onClick={loadDecks} disabled={loading}>
          {loading ? "Carregando…" : "Atualizar"}
        </button>
      </div>

      {loading && <div className="ab-empty">Carregando decks…</div>}

      {!loading && decks.length === 0 && (
        <div className="ab-empty">
          Nenhum deck publicado ainda. Seja o primeiro!
        </div>
      )}

      {!loading && decks.length > 0 && (
        <div className="ab-community-grid">
          {decks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              onSelect={handleSelect}
              onCompare={handleCompare}
              isSelected={false}
              user={user}
            />
          ))}
        </div>
      )}
    </section>
  );
}
