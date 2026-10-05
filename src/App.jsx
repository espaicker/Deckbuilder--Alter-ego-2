import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import CARD_DATA from "./data/modelo_cartas.json";
import "./App.css";
import { DECK_RULES, attackDefenseAverages, colorBreakdown, colorsSubset, combinedCopies, costCurve, countEntries, createCardIndex, createExportText, normalizeBuild, normalizeSavedDeckIndex, standardDropPile, typeSubtypeBreakdown, validateDeck } from "./lib/deckRules.js";
import { storage, safeJsonParse } from "./lib/storage.js";
import { escapeHtml, escapeRegExp, safeCardImagePath, truncateString } from "./lib/sanitize.js";
import { COLOR_HEX, SUBTYPE_COLORS, DROP_IMAGE_ID, MAX_DECK_NAME_LENGTH } from "./lib/constants.js";
import { useAuth } from "./hooks/useAuth.js";
import AuthModal from "./components/AuthModal.jsx";
import CommunityPage from "./components/CommunityPage.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import LegalPage from "./components/LegalPage.jsx";
import ResetPasswordPage from "./components/ResetPasswordPage.jsx";
import AnalyticsPanel from "./components/AnalyticsPanel.jsx";

const { mainDeckSize: MAIN_DECK_SIZE, sideboardMaxSize: SIDEBOARD_MAX, dropsPerColor: DROPS_PER_COLOR, maxCopies: MAX_COPIES } = DECK_RULES;

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




/* ============================================================
   HELPERS
   ============================================================ */
function statLine(card) {
  if (card.type === "Alter Ego") {
    const a = card.attributes || {};
    return `VIDA ${a.vida ?? 0}  ·  ATQ ${a.ataque ?? 0}  ·  DEF ${a.defesa ?? 0}`;
  }
  const a = card.attributes || {};
  if (typeof a.ataque === "number") return `ATQ ${a.ataque}`;
  if (typeof a.defesa === "number") return `DEF ${a.defesa}`;
  return null;
}

function highlightKeywords(text, keywords) {
  if (!text) return null;
  if (!keywords || keywords.length === 0) return text;
  const pattern = new RegExp(`(${keywords.map(escapeRegExp).join("|")})`, "g");
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    keywords.includes(part) ? <b key={i} className="ab-keyword">{part}</b> : part
  );
}

function AtomIcon({ size = 14, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6">
      <circle cx="12" cy="12" r="2.1" fill={color} stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)" />
    </svg>
  );
}

function CardArt({ id, className }) {
  const [broken, setBroken] = useState(false);
  const src = safeCardImagePath(id);
  if (broken || !src) {
    return <div className={`${className} ab-art-fallback`} aria-hidden="true" />;
  }
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

function formatColorPercentages(counts, total, colorOrder) {
  if (!total) return "sem cartas ainda";
  return colorOrder
    .filter((color) => counts[color])
    .map((color) => `${color} ${Math.round((counts[color] / total) * 100)}%`)
    .join(" · ");
}

function ColorMeterFill({ counts, total, capacity, colorOrder }) {
  const filledPct = total > 0 ? Math.min(100, (total / capacity) * 100) : 0;
  return (
    <div className="ab-meter-fill-wrap" style={{ width: `${filledPct}%` }}>
      {colorOrder.map((color) => {
        const count = counts[color];
        if (!count) return null;
        return (
          <div
            key={color}
            className="ab-meter-fill-seg"
            style={{ width: `${(count / total) * 100}%`, background: COLOR_HEX[color] }}
          />
        );
      })}
    </div>
  );
}

function ColorDonut({ counts, total, colorOrder, size = 108 }) {
  const strokeWidth = 15;
  const radius = size / 2 - strokeWidth / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = total > 0 ? colorOrder.filter((color) => counts[color]) : [];
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ab-donut" role="img" aria-label="Distribuição de cores">
      <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--hair)" strokeWidth={strokeWidth} />
      {segments.map((color) => {
        const value = counts[color];
        const dash = (value / total) * circumference;
        const segment = (
          <circle
            key={color}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={COLOR_HEX[color]}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${center} ${center})`}
          />
        );
        offset += dash;
        return segment;
      })}
      <text x={center} y={center} textAnchor="middle" dominantBaseline="central" className="ab-donut-total">
        {total}
      </text>
    </svg>
  );
}

function CostCurveChart({ counts, maxCost }) {
  if (maxCost <= 0 && Object.keys(counts).length === 0) {
    return <p className="ab-chart-empty">Sem cartas com custo no deck ainda.</p>;
  }
  const costs = Array.from({ length: maxCost + 1 }, (_, i) => i);
  const maxCount = Math.max(1, ...costs.map((c) => counts[c] || 0));
  return (
    <div className="ab-cost-curve">
      {costs.map((cost) => {
        const count = counts[cost] || 0;
        return (
          <div key={cost} className="ab-cost-bar-col">
            <span className="ab-cost-bar-count">{count || ""}</span>
            <div className="ab-cost-bar-track">
              <div
                className="ab-cost-bar-fill"
                style={{ height: `${(count / maxCount) * 100}%` }}
              />
            </div>
            <span className="ab-cost-bar-label">{cost}</span>
          </div>
        );
      })}
    </div>
  );
}

function TypeSubtypeChart({ breakdown }) {
  const types = ["Ação", "Reação", "Tática"].filter((type) => breakdown[type]);
  if (types.length === 0) {
    return <p className="ab-chart-empty">Sem cartas no deck ainda.</p>;
  }
  return (
    <div className="ab-type-chart">
      {types.map((type) => {
        const subtypes = breakdown[type];
        const typeTotal = Object.values(subtypes).reduce((a, b) => a + b, 0);
        return (
          <div key={type} className="ab-type-chart-row">
            <div className="ab-type-chart-heading">
              <span>{type}</span>
              <b>{typeTotal}</b>
            </div>
            <div className="ab-type-chart-bar">
              {Object.entries(subtypes).map(([subtype, count]) => (
                <div
                  key={subtype}
                  className="ab-type-chart-seg"
                  style={{ width: `${(count / typeTotal) * 100}%`, background: SUBTYPE_COLORS[subtype] || "#8B8F99" }}
                  title={`${subtype}: ${count}`}
                />
              ))}
            </div>
            <span className="ab-type-chart-legend">
              {Object.entries(subtypes)
                .map(([subtype, count]) => `${subtype} ${count}`)
                .join(" · ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ColorDots({ colors }) {
  return (
    <span className="ab-dots">
      {colors.map((c) => (
        <span key={c} className="ab-dot" style={{ background: COLOR_HEX[c] }} title={c} />
      ))}
    </span>
  );
}

/* ============================================================
   APP
   ============================================================ */
function CardPreviewModal({ card, onClose }) {
  const imgSrc = safeCardImagePath(card.id);
  return (
    <div className="ab-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="ab-card-modal" role="dialog" aria-modal="true" aria-label={`Visualização de ${card.name}`} onClick={(event) => event.stopPropagation()}>
        <button className="ab-modal-close" onClick={onClose} aria-label="Fechar visualização">×</button>
        {imgSrc
          ? <img className="ab-card-modal-art" src={imgSrc} alt={`Carta ${card.name}`} />
          : <div className="ab-card-modal-art ab-art-fallback" />
        }
        <div className="ab-card-modal-info">
          <div className="ab-ae-id">{card.id}</div>
          <h2>{card.name}</h2>
          <div className="ab-card-type">{card.type} · {card.subtype}</div>
          <div className="ab-card-stat">{statLine(card) || `CUSTO ${card.cost}`}</div>
          {card.effect && <p>{highlightKeywords(card.effect, card.keywords)}</p>}
        </div>
      </section>
    </div>
  );
}
export default function DeckBuilder() {
  const navigate = useNavigate();
  const location = useLocation();

  // Route → Tab mapping
  const getTabFromPath = useCallback((path) => {
    if (path === "/" || path === "") return "inicio";
    if (path === "/privacidade") return "privacidade";
    if (path === "/termos") return "termos";
    if (path === "/resetar-senha") return "resetar";
    if (path === "/deck/montar") return "deck";
    // /deck/drops existia quando os Drops eram escolhidos; links antigos vão pro resumo.
    if (path === "/deck/drops") return "resumo";
    if (path === "/deck/resumo") return "resumo";
    if (path === "/deck/alterego" || path === "/deck" || path.startsWith("/deck")) return "alterego";
    if (path === "/catalogo") return "catalogo";
    if (path.startsWith("/comunidade")) return "comunidade";
    if (path.startsWith("/admin")) return "admin";
    return "inicio";
  }, []);

  const getPathFromTab = useCallback((t) => {
    switch (t) {
      case "inicio": return "/";
      case "alterego": return "/deck/alterego";
      case "deck": return "/deck/montar";
      case "resumo": return "/deck/resumo";
      case "catalogo": return "/catalogo";
      case "comunidade": return "/comunidade";
      case "admin": return "/admin";
      case "privacidade": return "/privacidade";
      case "termos": return "/termos";
      default: return "/";
    }
  }, []);

  const [tab, setTabInternal] = useState(() => getTabFromPath(location.pathname));

  // Sync tab with URL
  function setTab(newTab) {
    setTabInternal(newTab);
    const path = getPathFromTab(newTab);
    if (location.pathname !== path) {
      navigate(path, { replace: false });
    }
  }

  // Sync URL changes (back/forward) with tab
  useEffect(() => {
    const tabFromUrl = getTabFromPath(location.pathname);
    setTabInternal(tabFromUrl);
  }, [location.pathname, getTabFromPath]);
  const [alterEgoId, setAlterEgoId] = useState(null);
  const [mainDeck, setMainDeck] = useState({});
  const [sideboard, setSideboard] = useState({});
  // Para onde vão as cartas clicadas na tela de montagem: "main" ou "side".
  const [addTarget, setAddTarget] = useState("main");
  const [filterType, setFilterType] = useState("Todos");
  const [filterSubtype, setFilterSubtype] = useState("Todos");
  const [filterColor, setFilterColor] = useState("Todas");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [savedDecks, setSavedDecks] = useState([]);
  const [deckName, setDeckName] = useState("");
  const [toast, setToast] = useState(null);
  const [ready, setReady] = useState(false);
  const [previewCard, setPreviewCard] = useState(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogColor, setCatalogColor] = useState("Todas");
  const [catalogType, setCatalogType] = useState("Todos");
  const [catalogSubtype, setCatalogSubtype] = useState("Todos");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user, login, register, logout } = useAuth();
  const cardIndex = useMemo(() => createCardIndex(CARD_DATA.cards), []);

  const alterEgos = useMemo(
    () => CARD_DATA.cards.filter((c) => c.type === "Alter Ego"),
    []
  );
  const alterEgo = useMemo(
    () => CARD_DATA.cards.find((c) => c.id === alterEgoId) || null,
    [alterEgoId]
  );
  const allowedColors = alterEgo ? alterEgo.colors : [];

  const poolCards = useMemo(() => {
    if (!alterEgo) return [];
    return CARD_DATA.cards.filter(
      (c) =>
        c.type !== "Alter Ego" &&
        c.type !== "Drop" &&
        colorsSubset(c.colors, allowedColors)
    );
  }, [alterEgo]);

  const availableSubtypes = useMemo(() => {
    if (filterType === "Todos") return [];
    return CARD_DATA.types[filterType]?.subtypes || [];
  }, [filterType]);

  const filteredPool = useMemo(() => {
    return poolCards.filter((c) => {
      if (filterType !== "Todos" && c.type !== filterType) return false;
      if (filterSubtype !== "Todos" && c.subtype !== filterSubtype) return false;
      if (filterColor !== "Todas" && !c.colors.includes(filterColor)) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [poolCards, filterType, filterSubtype, filterColor, search]);

  const mainDeckCount = useMemo(
    () => countEntries(mainDeck),
    [mainDeck]
  );
  const sideboardCount = useMemo(
    () => countEntries(sideboard),
    [sideboard]
  );
  // Drops não são escolhidos: sempre 10 de cada cor do Alter Ego.
  const dropPile = useMemo(() => standardDropPile(alterEgo), [alterEgo]);
  const dropCount = useMemo(() => countEntries(dropPile), [dropPile]);

  const toastTimer = useRef(null);
  function flashToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  function chooseAlterEgo(id) {
    if (id === alterEgoId) {
      setTab("deck");
      return;
    }
    const hasCards = countEntries(mainDeck) + countEntries(sideboard) > 0;
    if (hasCards && !window.confirm("Trocar de Alter Ego remove as cartas do deck e do sideboard atuais. Salve o deck antes se quiser guardá-lo. Continuar?")) {
      return;
    }
    setAlterEgoId(id);
    setMainDeck({});
    setSideboard({});
    setAddTarget("main");
    setFilterType("Todos");
    setFilterSubtype("Todos");
    setFilterColor("Todas");
    setTab("deck");
  }

  // O limite de cópias vale para deck + sideboard somados.
  function addCard(card, target = addTarget) {
    if (combinedCopies(mainDeck, sideboard, card.id) >= MAX_COPIES) {
      flashToast(`Máximo de ${MAX_COPIES} cópias de "${card.name}" (deck + sideboard).`);
      return;
    }
    if (target === "side" && sideboardCount >= SIDEBOARD_MAX) {
      flashToast(`O sideboard já tem ${SIDEBOARD_MAX} cartas.`);
      return;
    }
    const setter = target === "side" ? setSideboard : setMainDeck;
    setter((prev) => ({ ...prev, [card.id]: (prev[card.id] || 0) + 1 }));
  }

  function removeCard(cardId, target = addTarget) {
    const setter = target === "side" ? setSideboard : setMainDeck;
    setter((prev) => {
      const cur = prev[cardId] || 0;
      if (cur <= 0) return prev;
      const next = { ...prev, [cardId]: cur - 1 };
      if (next[cardId] === 0) delete next[cardId];
      return next;
    });
  }

  useEffect(() => {
    if (!previewCard) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPreviewCard(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewCard]);
  /* --- persistência --- */
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("current_build");
        if (res && res.value) {
          const parsed = safeJsonParse(res.value);
          if (parsed) {
            const build = normalizeBuild(parsed, cardIndex);
            setAlterEgoId(build.alterEgoId);
            setMainDeck(build.mainDeck);
            setSideboard(build.sideboard);
          }
        }
      } catch (e) {
        if (e?.message !== "not found") {
          console.warn("[storage] Erro ao carregar build:", e?.message);
        }
      }
      try {
        const idx = await storage.get("saved_decks_index");
        if (idx && idx.value) {
          const parsed = safeJsonParse(idx.value);
          if (parsed) setSavedDecks(normalizeSavedDeckIndex(parsed));
        }
      } catch (e) {
        if (e?.message !== "not found") {
          console.warn("[storage] Erro ao carregar índice:", e?.message);
        }
      }
      setReady(true);
    })();
  }, [cardIndex]);

  useEffect(() => {
    if (!ready) return;
    const payload = JSON.stringify({ alterEgoId, mainDeck, sideboard });
    storage.set("current_build", payload).catch((e) => {
      console.warn("[storage] Falha ao salvar build:", e?.message);
    });
  }, [alterEgoId, mainDeck, sideboard, ready]);

  async function saveNamedDeck() {
    if (!alterEgo) {
      flashToast("Escolha um Alter Ego antes de salvar.");
      return;
    }
    const rawName = deckName.trim();
    const name = truncateString(rawName, MAX_DECK_NAME_LENGTH) ||
      `${alterEgo.name} — ${new Date().toLocaleDateString("pt-BR")}`;
    const key = `deck:${Date.now()}`;
    const record = { key, name, alterEgoId, mainDeck, sideboard, savedAt: Date.now() };
    try {
      await storage.set(key, JSON.stringify(record));
      const newIndex = [...savedDecks, { key, name, savedAt: record.savedAt }];
      await storage.set("saved_decks_index", JSON.stringify(newIndex));
      setSavedDecks(newIndex);
      setDeckName("");
      flashToast("Deck salvo.");
    } catch (e) {
      flashToast(e?.message || "Erro ao salvar o deck.");
    }
  }

  async function loadNamedDeck(key) {
    const hasCards = countEntries(mainDeck) + countEntries(sideboard) > 0;
    if (hasCards && !window.confirm("Carregar este deck substitui o deck que está montado agora. Continuar?")) return;
    try {
      const res = await storage.get(key);
      if (res && res.value) {
        const record = safeJsonParse(res.value);
        if (!record) throw new Error("Dados corrompidos");
        const build = normalizeBuild(record, cardIndex);
        if (!build.alterEgoId) throw new Error("Deck salvo inválido");
        setAlterEgoId(build.alterEgoId);
        setMainDeck(build.mainDeck);
        setSideboard(build.sideboard);
        setTab("deck");
        flashToast(`"${truncateString(record.name || "", 40)}" carregado.`);
      }
    } catch (e) {
      console.warn("[storage] Erro ao carregar deck:", e?.message);
      flashToast("Erro ao carregar o deck.");
    }
  }

  async function deleteNamedDeck(key) {
    if (!window.confirm("Remover este deck salvo? Isso não pode ser desfeito.")) return;
    try {
      await storage.delete(key);
    } catch (e) {
      console.warn("[storage] Erro ao deletar deck:", e?.message);
    }
    const newIndex = savedDecks.filter((d) => d.key !== key);
    try {
      await storage.set("saved_decks_index", JSON.stringify(newIndex));
    } catch (e) {
      console.warn("[storage] Erro ao atualizar índice:", e?.message);
    }
    setSavedDecks(newIndex);
    flashToast("Deck removido.");
  }

  const issues = useMemo(
    () => validateDeck({ alterEgo, mainDeck, sideboard, cardIndex }),
    [alterEgo, mainDeck, sideboard, cardIndex]
  );

  const isLegal = issues.length === 0;

  const deckByType = useMemo(() => groupByType(mainDeck, cardIndex), [mainDeck, cardIndex]);
  const sideboardByType = useMemo(() => groupByType(sideboard, cardIndex), [sideboard, cardIndex]);
  const sideboardColorStats = useMemo(() => colorBreakdown(sideboard, {}, cardIndex), [sideboard, cardIndex]);

  const exportText = useMemo(
    () => createExportText({ alterEgo, mainDeck, sideboard, cardIndex }),
    [alterEgo, mainDeck, sideboard, cardIndex]
  );

  const colorStats = useMemo(
    () => colorBreakdown(mainDeck, dropPile, cardIndex),
    [mainDeck, dropPile, cardIndex]
  );

  const costStats = useMemo(() => costCurve(mainDeck, cardIndex), [mainDeck, cardIndex]);
  const typeStats = useMemo(() => typeSubtypeBreakdown(mainDeck, cardIndex), [mainDeck, cardIndex]);
  const combatStats = useMemo(() => attackDefenseAverages(mainDeck, cardIndex), [mainDeck, cardIndex]);

  const catalogSubtypes = useMemo(() => {
    if (catalogType === "Todos") return [];
    return CARD_DATA.types[catalogType]?.subtypes || [];
  }, [catalogType]);

  const filteredCatalog = useMemo(() => {
    return CARD_DATA.cards.filter((c) => {
      if (catalogColor !== "Todas" && !c.colors.includes(catalogColor)) return false;
      if (catalogType !== "Todos" && c.type !== catalogType) return false;
      if (catalogSubtype !== "Todos" && c.subtype !== catalogSubtype) return false;
      if (catalogSearch && !c.name.toLowerCase().includes(catalogSearch.toLowerCase())) return false;
      return true;
    });
  }, [catalogColor, catalogType, catalogSubtype, catalogSearch]);

  function printProxyPdf(withMargins = true) {
    if (!alterEgo) return;

    const imgUrl = (id) => {
      const safePath = safeCardImagePath(id);
      if (!safePath) return "";
      return new URL(safePath, window.location.href).href;
    };

    // Fila de impressão: Alter Ego, depois deck (ordenado por nome), depois drops
    const deckEntries = Object.entries(mainDeck)
      .map(([id, quantity]) => ({ id, quantity, card: cardIndex.get(id) }))
      .filter((entry) => entry.card && entry.quantity > 0)
      .sort((a, b) => a.card.name.localeCompare(b.card.name));
    const sideEntries = Object.entries(sideboard)
      .map(([id, quantity]) => ({ id, quantity, card: cardIndex.get(id) }))
      .filter((entry) => entry.card && entry.quantity > 0)
      .sort((a, b) => a.card.name.localeCompare(b.card.name));
    const dropEntries = Object.entries(dropPile).filter(([, quantity]) => quantity > 0);
    const toItems = (entries) => entries.flatMap(({ card, quantity }) =>
      Array.from({ length: quantity }, () => ({ id: card.id, name: card.name, img: imgUrl(card.id) }))
    );

    // Fila: Alter Ego, deck, sideboard e os Drops padrão (10 de cada cor).
    const printItems = [
      { id: alterEgo.id, name: alterEgo.name, img: imgUrl(alterEgo.id) },
      ...toItems(deckEntries),
      ...toItems(sideEntries),
      ...dropEntries.flatMap(([color, quantity]) =>
        Array.from({ length: quantity }, () => ({ id: DROP_IMAGE_ID[color], name: `Drop ${color}`, img: imgUrl(DROP_IMAGE_ID[color]) }))
      ),
    ];

    if (printItems.length === 0) {
      flashToast("Adicione cartas ao deck antes de gerar os proxies.");
      return;
    }

    const popup = window.open("", "_blank");
    if (!popup) {
      flashToast("Permita pop-ups para gerar o PDF de proxies.");
      return;
    }

    const dateStr = new Date().toLocaleDateString("pt-BR");
    const perPage = 9;
    const cardPageCount = Math.ceil(printItems.length / perPage);
    const totalPages = cardPageCount + 1; // +1 pela página de conferência

    const footer = (pageLabel) =>
      `<footer class="proxy-footer">${escapeHtml(alterEgo.name)} · ${dateStr} · ${pageLabel}</footer>`;

    const cell = (item) => withMargins
      ? `<div class="proxy-cell">
           <i class="crop crop-tl"></i><i class="crop crop-tr"></i><i class="crop crop-bl"></i><i class="crop crop-br"></i>
           <article class="proxy-card"><img src="${item.img}" alt="${escapeHtml(item.name)}"></article>
         </div>`
      : `<div class="proxy-cell">
           <article class="proxy-card"><img src="${item.img}" alt="${escapeHtml(item.name)}"></article>
         </div>`;

    const cardPages = Array.from({ length: cardPageCount }, (_, index) => {
      const pageItems = printItems.slice(index * perPage, index * perPage + perPage);
      return `<section class="proxy-page">
                <div class="proxy-grid">${pageItems.map(cell).join("")}</div>
                ${footer(`página ${index + 2} de ${totalPages}`)}
              </section>`;
    }).join("");

    const checklistRows = (label, rows) =>
      rows.length === 0
        ? ""
        : `<h3>${label}</h3><ul class="checklist-list">${rows.join("")}</ul>`;

    const checklistPage = `
      <section class="proxy-page proxy-checklist">
        <h1>Lista de impressão</h1>
        <div class="checklist-alterego">
          <span class="checklist-colors">${alterEgo.colors
            .map((c) => `<i class="swatch" style="background:${COLOR_HEX[c]}"></i>`)
            .join("")}</span>
          <strong>${escapeHtml(alterEgo.name)}</strong>
          <span class="checklist-muted">(${escapeHtml(alterEgo.id)})</span>
        </div>
        <div class="checklist-columns">
          ${checklistRows(
            `Deck (${mainDeckCount}/${MAIN_DECK_SIZE})`,
            deckEntries.map((e) => `<li><span>${e.quantity}×</span> ${escapeHtml(e.card.name)}</li>`)
          )}
          ${checklistRows(
            `Sideboard (${sideboardCount}/${SIDEBOARD_MAX})`,
            sideEntries.map((e) => `<li><span>${e.quantity}×</span> ${escapeHtml(e.card.name)}</li>`)
          )}
          ${checklistRows(
            `Drops (${dropCount})`,
            dropEntries.map(([color, quantity]) => `<li><span>${quantity}×</span> Drop ${escapeHtml(color)}</li>`)
          )}
        </div>
        <p class="checklist-note">${withMargins ? "Confira essa lista com o que foi impresso antes de recortar. As marcas nos cantos de cada carta indicam onde cortar." : "Confira essa lista com o que foi impresso antes de recortar."}</p>
        ${footer("página 1 de " + totalPages)}
      </section>`;

    // Layout com margem: gap entre cartas + crop marks para guiar o corte
    // Layout sem margem: cartas coladas sem espaçamento (bloco único)
    const gridStyle = withMargins
      ? `.proxy-grid { display: grid; grid-template-columns: repeat(3, 63mm); grid-auto-rows: 88mm; gap: 4.5mm; }`
      : `.proxy-grid { display: grid; grid-template-columns: repeat(3, 63mm); grid-auto-rows: 88mm; gap: 0; }`;

    const cellStyle = withMargins
      ? `.proxy-cell { position: relative; width: 63mm; height: 88mm; }`
      : `.proxy-cell { position: relative; width: 63mm; height: 88mm; }`;

    const cropStyles = withMargins
      ? `
      .crop { position: absolute; width: 3mm; height: 3mm; border: 0 solid #9a9a9a; }
      .crop-tl { top: -2.2mm; left: -2.2mm; border-top-width: .2mm; border-left-width: .2mm; }
      .crop-tr { top: -2.2mm; right: -2.2mm; border-top-width: .2mm; border-right-width: .2mm; }
      .crop-bl { bottom: -2.2mm; left: -2.2mm; border-bottom-width: .2mm; border-left-width: .2mm; }
      .crop-br { bottom: -2.2mm; right: -2.2mm; border-bottom-width: .2mm; border-right-width: .2mm; }`
      : `.crop { display: none; }`;

    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Proxies - ${escapeHtml(alterEgo.name)}</title><style>
      @page { size: A4 portrait; margin: 6mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; }
      .proxy-page { position: relative; width: 198mm; height: 285mm; break-after: page; page-break-after: always; }
      .proxy-page:last-child { break-after: auto; page-break-after: auto; }
      ${gridStyle}
      ${cellStyle}
      .proxy-card { width: 100%; height: 100%; overflow: hidden; background: #fff; }
      .proxy-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
      ${cropStyles}
      .proxy-footer { position: absolute; left: 0; right: 0; bottom: 0; text-align: center; font-size: 2.6mm; color: #999; padding-top: 1.5mm; border-top: .15mm solid #ddd; }
      .proxy-checklist h1 { font-size: 7mm; margin: 0 0 4mm 0; }
      .checklist-alterego { display: flex; align-items: center; gap: 2mm; margin-bottom: 6mm; font-size: 4mm; }
      .checklist-colors { display: flex; gap: 1mm; }
      .swatch { display: inline-block; width: 3.2mm; height: 3.2mm; border-radius: 50%; }
      .checklist-muted { color: #888; }
      .checklist-columns { columns: 2; column-gap: 8mm; font-size: 3.4mm; line-height: 1.7; }
      .checklist-columns h3 { font-size: 3.6mm; text-transform: uppercase; letter-spacing: .3mm; color: #666; break-after: avoid; margin: 3mm 0 1.5mm 0; }
      .checklist-list { list-style: none; margin: 0 0 3mm 0; padding: 0; break-inside: avoid; }
      .checklist-list li span { display: inline-block; width: 8mm; color: #666; font-variant-numeric: tabular-nums; }
      .checklist-note { position: absolute; bottom: 12mm; left: 0; right: 0; font-size: 3mm; color: #999; }
      @media screen {
        body { padding: 8mm; background: #ddd; }
        .proxy-page { margin: 0 auto 8mm; background: #fff; box-shadow: 0 2px 10px #777; }
      }
    </style></head><body>${checklistPage}${cardPages}<script>window.addEventListener('load',()=>Promise.all([...document.images].map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=image.onerror=resolve}))).then(()=>setTimeout(()=>window.print(),150)))<\/script></body></html>`);
    popup.document.close();
  }
  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportText);
      flashToast("Lista copiada.");
    } catch (e) {
      flashToast("Não foi possível copiar.");
    }
  }

  if (!ready) {
    return (
      <div className="ab-app ab-loading">
        
        <AtomIcon size={28} />
        <span>Carregando arsenal…</span>
      </div>
    );
  }

  const accent = allowedColors[0] ? COLOR_HEX[allowedColors[0]] : "#C9CDD6";
  const accent2 = allowedColors[1] ? COLOR_HEX[allowedColors[1]] : accent;

  return (
    <div
      className="ab-app"
      style={{ "--accent": accent, "--accent2": accent2 }}
    >
      

      {toast && <div className="ab-toast" role="status" aria-live="polite">{toast}</div>}
      {previewCard && <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onLogin={login}
          onRegister={register}
        />
      )}

      <header className="ab-hud">
        <div className="ab-hud-top">
          <div className="ab-logo">
            <span className="ab-logo-mark">
              <AtomIcon size={20} color="var(--accent)" />
            </span>
            <div>
              <div className="ab-logo-title">FORJA DE ALTER EGOS</div>
              <div className="ab-logo-sub">construtor de deck</div>
            </div>
          </div>

          {alterEgo && (
            <div className="ab-hud-alterego">
              <ColorDots colors={alterEgo.colors} />
              <span className="ab-hud-alterego-name">{alterEgo.name}</span>
            </div>
          )}

          <div className="ab-hud-auth">
            {user ? (
              <>
                {user.role === "admin" ? (
                  <span className="ab-hud-username">{user.username}</span>
                ) : (
                  <button
                    className="ab-hud-username ab-hud-username-btn"
                    onClick={() => navigate("/comunidade/perfil")}
                    title="Ver meu perfil e meus dados"
                  >
                    {user.username}
                  </button>
                )}
                <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={logout}>Sair</button>
              </>
            ) : (
              <button className="ab-btn ab-btn-ghost ab-btn-sm" onClick={() => setShowAuthModal(true)}>
                Entrar
              </button>
            )}
          </div>

          <div className="ab-hud-meters">
            <div
              className="ab-meter"
              title={`Deck: ${mainDeckCount}/${MAIN_DECK_SIZE} — ${formatColorPercentages(colorStats.deckCounts, colorStats.deckTotal, CARD_DATA.colors)}`}
            >
              <span className="ab-meter-label">DECK</span>
              <div className="ab-meter-track">
                <ColorMeterFill
                  counts={colorStats.deckCounts}
                  total={colorStats.deckTotal}
                  capacity={MAIN_DECK_SIZE}
                  colorOrder={CARD_DATA.colors}
                />
              </div>
              <span className={`ab-meter-value ${mainDeckCount > MAIN_DECK_SIZE ? "is-over" : ""}`}>
                {mainDeckCount}/{MAIN_DECK_SIZE}
              </span>
            </div>
            <div
              className="ab-meter"
              title={`Sideboard: ${sideboardCount}/${SIDEBOARD_MAX} — ${formatColorPercentages(sideboardColorStats.deckCounts, sideboardColorStats.deckTotal, CARD_DATA.colors)}`}
            >
              <span className="ab-meter-label">SIDE</span>
              <div className="ab-meter-track">
                <ColorMeterFill
                  counts={sideboardColorStats.deckCounts}
                  total={sideboardColorStats.deckTotal}
                  capacity={SIDEBOARD_MAX}
                  colorOrder={CARD_DATA.colors}
                />
              </div>
              <span className={`ab-meter-value ${sideboardCount > SIDEBOARD_MAX ? "is-over" : ""}`}>
                {sideboardCount}/{SIDEBOARD_MAX}
              </span>
            </div>
          </div>
        </div>

        <nav className="ab-tabs">
          {[
            ["inicio", "Início"],
            ["construcao", "Construção de Deck"],
            ["comunidade", "Comunidade"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`ab-tab ${tab === key || (key === "construcao" && ["alterego", "deck", "resumo"].includes(tab)) ? "is-active" : ""}`}
              onClick={() => setTab(key === "construcao" ? "alterego" : key)}
            >
              {label}
            </button>
          ))}
          {user?.role === "admin" && (
            <button
              className={`ab-tab ab-tab-admin ${tab === "admin" ? "is-active" : ""}`}
              onClick={() => setTab("admin")}
            >
              Admin
            </button>
          )}
        </nav>

        {["alterego", "deck", "resumo"].includes(tab) && (
          <nav className="ab-subtabs">
            {[
              ["alterego", "1 · Alter Ego"],
              ["deck", "2 · Deck e Sideboard"],
              ["resumo", "3 · Resumo"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={`ab-subtab ${tab === key ? "is-active" : ""}`}
                onClick={() => setTab(key)}
                disabled={key !== "alterego" && !alterEgo}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="ab-main">
        {tab === "inicio" && (
          <section className="ab-homepage">
            <div className="ab-homepage-content">
              <span className="ab-homepage-icon">
                <AtomIcon size={40} color="var(--accent)" />
              </span>
              <h1 className="ab-homepage-title">ALTER EGO</h1>
              <p className="ab-homepage-subtitle">Busque cartas ou inicie a criação de um deck.</p>
              <div className="ab-homepage-search">
                <input
                  className="ab-input ab-homepage-input"
                  placeholder="Pesquisar carta..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && catalogSearch.trim()) {
                      setTab("catalogo");
                    }
                  }}
                />
              </div>
              <button
                className="ab-link-btn ab-homepage-advanced"
                onClick={() => setTab("catalogo")}
              >
                Busca avançada →
              </button>
            </div>
          </section>
        )}

        {tab === "catalogo" && (
          <section className="ab-section">
            <h1 className="ab-section-title">Buscar Cartas</h1>
            <p className="ab-section-sub">
              Explore todas as cartas do jogo antes de montar seu deck — útil
              pra conferir o texto e a arte de qualquer carta.
            </p>
            <div className="ab-filters">
              <input
                className="ab-input"
                placeholder="Buscar carta…"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
              />
              <div className="ab-chip-row">
                <button
                  className={`ab-chip ${catalogColor === "Todas" ? "is-active" : ""}`}
                  onClick={() => setCatalogColor("Todas")}
                >
                  Todas as cores
                </button>
                {CARD_DATA.colors.map((color) => (
                  <button
                    key={color}
                    className={`ab-chip ${catalogColor === color ? "is-active" : ""}`}
                    onClick={() => setCatalogColor(color)}
                    style={catalogColor === color ? { background: COLOR_HEX[color], borderColor: COLOR_HEX[color], color: "#0B0C0F" } : undefined}
                  >
                    {color}
                  </button>
                ))}
              </div>
              <div className="ab-chip-row">
                <button
                  className={`ab-chip ${catalogType === "Todos" ? "is-active" : ""}`}
                  onClick={() => { setCatalogType("Todos"); setCatalogSubtype("Todos"); }}
                >
                  Todos os tipos
                </button>
                {["Alter Ego", "Ação", "Reação", "Tática", "Drop"].map((t) => (
                  <button
                    key={t}
                    className={`ab-chip ${catalogType === t ? "is-active" : ""}`}
                    onClick={() => { setCatalogType(t); setCatalogSubtype("Todos"); }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {catalogSubtypes.length > 0 && (
                <div className="ab-chip-row">
                  <button
                    className={`ab-chip ab-chip-sm ${catalogSubtype === "Todos" ? "is-active" : ""}`}
                    onClick={() => setCatalogSubtype("Todos")}
                  >
                    todas
                  </button>
                  {catalogSubtypes.map((st) => (
                    <button
                      key={st}
                      className={`ab-chip ab-chip-sm ${catalogSubtype === st ? "is-active" : ""}`}
                      onClick={() => setCatalogSubtype(st)}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="ab-card-grid">
              {filteredCatalog.length === 0 && (
                <div className="ab-empty">Nenhuma carta encontrada com esse filtro.</div>
              )}
              {filteredCatalog.map((card) => (
                <div
                  key={card.id}
                  className="ab-card"
                  style={{ "--edge": COLOR_HEX[card.colors[0]] }}
                >
                  <div className="ab-card-head" onClick={() => setPreviewCard(card)}>
                    <CardArt id={card.id} className="ab-card-thumb" />
                    <div className="ab-card-cost">
                      <AtomIcon size={13} />
                      <span>{card.cost ?? "—"}</span>
                    </div>
                    <div className="ab-card-titles">
                      <div className="ab-card-name">{card.name}</div>
                      <div className="ab-card-type">
                        {card.type}
                        {card.subtype ? ` · ${card.subtype}` : ""}
                      </div>
                    </div>
                    <ColorDots colors={card.colors} />
                  </div>
                  {statLine(card) && <div className="ab-card-stat">{statLine(card)}</div>}
                  <div className="ab-card-controls">
                    <button className="ab-preview-btn" onClick={() => setPreviewCard(card)}>
                      Ver carta
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "alterego" && (
          <section className="ab-section">
            <h1 className="ab-section-title">Escolha seu Alter Ego</h1>
            <p className="ab-section-sub">
              Ele define as cores permitidas no seu deck e não ocupa espaço nele.
            </p>
            <div className="ab-ae-grid">
              {alterEgos.map((ae) => (
                <button
                  key={ae.id}
                  className={`ab-ae-card ${alterEgoId === ae.id ? "is-selected" : ""}`}
                  style={{
                    "--c1": COLOR_HEX[ae.colors[0]],
                    "--c2": COLOR_HEX[ae.colors[1] || ae.colors[0]],
                  }}
                  onClick={() => chooseAlterEgo(ae.id)}
                >
                  <div className="ab-ae-card-top">
                    <ColorDots colors={ae.colors} />
                    <span className="ab-ae-id">{ae.id}</span>
                  </div>
                  <CardArt id={ae.id} className="ab-ae-art" />
                  <div className="ab-ae-name">{ae.name}</div>
                  <div className="ab-ae-stats">
                    <span>VIDA {ae.attributes.vida}</span>
                    <span>ATQ {ae.attributes.ataque}</span>
                    <span>DEF {ae.attributes.defesa}</span>
                  </div>
                  <div
                    className="ab-ae-effect-wrap"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedId(expandedId === ae.id ? null : ae.id);
                    }}
                  >
                    <div
                      className={`ab-ae-effect ${expandedId === ae.id ? "is-expanded" : ""}`}
                    >
                      {ae.effect}
                    </div>
                    <span className="ab-ae-effect-toggle">
                      {expandedId === ae.id ? "mostrar menos ▲" : "mostrar mais ▼"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === "deck" && !alterEgo && (
          <EmptyGuard onGo={() => setTab("alterego")} />
        )}

        {tab === "deck" && alterEgo && (
          <section className="ab-section ab-deck-layout">
            <div className="ab-deck-main">
              <div className="ab-filters">
                <input
                  className="ab-input"
                  placeholder="Buscar carta…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="ab-chip-row">
                  <button
                    className={`ab-chip ${filterType === "Todos" ? "is-active" : ""}`}
                    onClick={() => { setFilterType("Todos"); setFilterSubtype("Todos"); }}
                  >
                    Todos
                  </button>
                  {["Ação", "Reação", "Tática"].map((t) => (
                    <button
                      key={t}
                      className={`ab-chip ${filterType === t ? "is-active" : ""}`}
                      onClick={() => { setFilterType(t); setFilterSubtype("Todos"); }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {allowedColors.length > 1 && (
                  <div className="ab-chip-row">
                    <button
                      className={`ab-chip ab-chip-sm ${filterColor === "Todas" ? "is-active" : ""}`}
                      onClick={() => setFilterColor("Todas")}
                    >
                      todas as cores
                    </button>
                    {allowedColors.map((color) => (
                      <button
                        key={color}
                        className={`ab-chip ab-chip-sm ${filterColor === color ? "is-active" : ""}`}
                        onClick={() => setFilterColor(color)}
                        style={filterColor === color ? { background: COLOR_HEX[color], borderColor: COLOR_HEX[color], color: "#0B0C0F" } : undefined}
                      >
                        {color}
                      </button>
                    ))}
                  </div>
                )}
                {availableSubtypes.length > 0 && (
                  <div className="ab-chip-row">
                    <button
                      className={`ab-chip ab-chip-sm ${filterSubtype === "Todos" ? "is-active" : ""}`}
                      onClick={() => setFilterSubtype("Todos")}
                    >
                      todas
                    </button>
                    {availableSubtypes.map((st) => (
                      <button
                        key={st}
                        className={`ab-chip ab-chip-sm ${filterSubtype === st ? "is-active" : ""}`}
                        onClick={() => setFilterSubtype(st)}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="ab-add-target" role="group" aria-label="Adicionar cartas em">
                <span className="ab-add-target-label">Adicionar em:</span>
                <button
                  className={`ab-chip ${addTarget === "main" ? "is-active" : ""}`}
                  onClick={() => setAddTarget("main")}
                  aria-pressed={addTarget === "main"}
                >
                  Deck principal ({mainDeckCount}/{MAIN_DECK_SIZE})
                </button>
                <button
                  className={`ab-chip ${addTarget === "side" ? "is-active" : ""}`}
                  onClick={() => setAddTarget("side")}
                  aria-pressed={addTarget === "side"}
                >
                  Sideboard ({sideboardCount}/{SIDEBOARD_MAX})
                </button>
              </div>

              <div className="ab-card-img-grid">
                {filteredPool.length === 0 && (
                  <div className="ab-empty">Nenhuma carta encontrada com esse filtro.</div>
                )}
                {filteredPool.map((card) => {
                  const mainQty = mainDeck[card.id] || 0;
                  const sideQty = sideboard[card.id] || 0;
                  const targetQty = addTarget === "side" ? sideQty : mainQty;
                  const atCopyLimit = mainQty + sideQty >= MAX_COPIES;
                  const sideFull = addTarget === "side" && sideboardCount >= SIDEBOARD_MAX;
                  return (
                    <div key={card.id} className={`ab-card-img-item ${mainQty + sideQty > 0 ? "has-qty" : ""}`}>
                      <div
                        className="ab-card-img-wrap"
                        style={{ "--edge": COLOR_HEX[card.colors[0]] }}
                        onClick={() => setPreviewCard(card)}
                      >
                        <CardArt id={card.id} className="ab-card-img-full" />
                        {mainQty > 0 && <span className="ab-card-img-badge" title="No deck principal">×{mainQty}</span>}
                        {sideQty > 0 && <span className="ab-card-img-badge ab-card-img-badge-side" title="No sideboard">S{sideQty}</span>}
                        <div className="ab-card-img-overlay">
                          <button
                            className="ab-overlay-btn ab-overlay-minus"
                            onClick={(e) => { e.stopPropagation(); removeCard(card.id); }}
                            disabled={targetQty === 0}
                            aria-label={`Remover ${card.name} do ${addTarget === "side" ? "sideboard" : "deck"}`}
                          >
                            −
                          </button>
                          <button
                            className="ab-overlay-btn ab-overlay-plus"
                            onClick={(e) => { e.stopPropagation(); addCard(card); }}
                            disabled={atCopyLimit || sideFull}
                            aria-label={`Adicionar ${card.name} ao ${addTarget === "side" ? "sideboard" : "deck"}`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="ab-jump-to-deck"
              onClick={() => document.getElementById("ab-deck-sidebar")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Ver meu deck · {mainDeckCount}/{MAIN_DECK_SIZE} · side {sideboardCount}
            </button>

            <aside className="ab-sidebar" id="ab-deck-sidebar">
              <div className="ab-sidebar-title">Seu deck</div>
              <div className={`ab-sidebar-count ${mainDeckCount > MAIN_DECK_SIZE ? "is-over" : ""}`}>
                {mainDeckCount} / {MAIN_DECK_SIZE}
              </div>
              {mainDeckCount > MAIN_DECK_SIZE && (
                <div className="ab-sidebar-warning">
                  ⚠ Limite excedido! Remova {mainDeckCount - MAIN_DECK_SIZE} carta{mainDeckCount - MAIN_DECK_SIZE > 1 ? "s" : ""} para validar o deck.
                </div>
              )}
              {Object.keys(mainDeck).length === 0 && (
                <div className="ab-empty">Ainda sem cartas. Clique em “+” nas cartas ao lado.</div>
              )}
              {["Ação", "Reação", "Tática"].map((type) =>
                deckByType[type] ? (
                  <div key={type} className="ab-sidebar-group">
                    <div className="ab-sidebar-group-title">{type}</div>
                    {deckByType[type].map(({ card, qty }) => (
                      <div key={card.id} className="ab-sidebar-row">
                        <span
                          className="ab-sidebar-dot"
                          style={{ background: COLOR_HEX[card.colors[0]] }}
                        />
                        <span className="ab-sidebar-name">{card.name}</span>
                        <span className="ab-sidebar-qty">×{qty}</span>
                        <button className="ab-sidebar-remove" onClick={() => removeCard(card.id, "main")} aria-label={`Remover ${card.name} do deck`}>
                          −
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null
              )}

              <div className="ab-sidebar-title ab-sidebar-title-spaced">Sideboard</div>
              <div className={`ab-sidebar-count ${sideboardCount > SIDEBOARD_MAX ? "is-over" : ""}`}>
                {sideboardCount} / {SIDEBOARD_MAX}
              </div>
              {sideboardCount === 0 && (
                <div className="ab-empty">Opcional. Escolha “Sideboard” acima para adicionar até {SIDEBOARD_MAX} cartas de troca.</div>
              )}
              {["Ação", "Reação", "Tática"].map((type) =>
                sideboardByType[type] ? (
                  <div key={type} className="ab-sidebar-group">
                    <div className="ab-sidebar-group-title">{type}</div>
                    {sideboardByType[type].map(({ card, qty }) => (
                      <div key={card.id} className="ab-sidebar-row">
                        <span className="ab-sidebar-dot" style={{ background: COLOR_HEX[card.colors[0]] }} />
                        <span className="ab-sidebar-name">{card.name}</span>
                        <span className="ab-sidebar-qty">×{qty}</span>
                        <button className="ab-sidebar-remove" onClick={() => removeCard(card.id, "side")} aria-label={`Remover ${card.name} do sideboard`}>
                          −
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null
              )}

              <div className="ab-sidebar-title ab-sidebar-title-spaced">Drops</div>
              <p className="ab-sidebar-note">
                Fixo: {DROPS_PER_COLOR} de cada cor do Alter Ego. Você monta a combinação na hora da partida.
              </p>
              {Object.entries(dropPile).map(([color, qty]) => (
                <div key={color} className="ab-sidebar-row">
                  <span className="ab-sidebar-dot" style={{ background: COLOR_HEX[color] }} />
                  <span className="ab-sidebar-name">Drop {color}</span>
                  <span className="ab-sidebar-qty">×{qty}</span>
                </div>
              ))}
            </aside>
          </section>
        )}

        {tab === "resumo" && (
          <section className="ab-section">
            <h1 className="ab-section-title">Resumo do deck</h1>

            <div className={`ab-status ${isLegal ? "is-ok" : "is-bad"}`}>
              {isLegal ? "✓ Deck válido para jogar" : "Pendências:"}
              {!isLegal && (
                <ul>
                  {issues.map((iss, i) => (
                    <li key={i}>{iss}</li>
                  ))}
                </ul>
              )}
            </div>

            {alterEgo && (
              <div className="ab-color-breakdown">
                <div className="ab-sidebar-group-title">Distribuição de cores</div>
                {[
                  { label: "Deck", counts: colorStats.deckCounts, total: colorStats.deckTotal },
                  { label: "Sideboard", counts: sideboardColorStats.deckCounts, total: sideboardColorStats.deckTotal },
                  { label: "Drops (fixo)", counts: colorStats.dropCounts, total: colorStats.dropTotal },
                ].map(({ label, counts, total }) => (
                  <div key={label} className="ab-color-breakdown-row">
                    <span className="ab-color-breakdown-label">{label}</span>
                    <div className="ab-color-breakdown-bar">
                      <ColorMeterFill
                        counts={counts}
                        total={total}
                        capacity={total || 1}
                        colorOrder={CARD_DATA.colors}
                      />
                    </div>
                    <span className="ab-color-breakdown-legend">
                      {total === 0
                        ? "sem cartas ainda"
                        : allowedColors
                            .filter((color) => counts[color])
                            .map(
                              (color) =>
                                `${color} ${Math.round((counts[color] / total) * 100)}% (${counts[color]})`
                            )
                            .join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {alterEgo && mainDeckCount > 0 && (
              <div className="ab-stats-grid">
                <div className="ab-stats-card">
                  <div className="ab-sidebar-group-title">Cores do deck</div>
                  <div className="ab-stats-card-body ab-stats-card-donut">
                    <ColorDonut counts={colorStats.deckCounts} total={colorStats.deckTotal} colorOrder={CARD_DATA.colors} />
                    <ul className="ab-donut-legend">
                      {CARD_DATA.colors
                        .filter((color) => colorStats.deckCounts[color])
                        .map((color) => (
                          <li key={color}>
                            <i className="ab-sidebar-dot" style={{ background: COLOR_HEX[color] }} />
                            {color} — {Math.round((colorStats.deckCounts[color] / colorStats.deckTotal) * 100)}%
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>

                <div className="ab-stats-card">
                  <div className="ab-sidebar-group-title">Curva de custo</div>
                  <div className="ab-stats-card-body">
                    <CostCurveChart counts={costStats.counts} maxCost={costStats.maxCost} />
                  </div>
                </div>

                <div className="ab-stats-card">
                  <div className="ab-sidebar-group-title">Composição por tipo</div>
                  <div className="ab-stats-card-body">
                    <TypeSubtypeChart breakdown={typeStats.breakdown} />
                  </div>
                </div>

                <div className="ab-stats-card">
                  <div className="ab-sidebar-group-title">Combate</div>
                  <div className="ab-stats-card-body ab-combat-stats">
                    <div>
                      <span className="ab-combat-value">
                        {combatStats.avgAttack === null ? "—" : combatStats.avgAttack.toFixed(1)}
                      </span>
                      <span className="ab-combat-label">ATQ médio ({combatStats.attackCount} cartas)</span>
                    </div>
                    <div>
                      <span className="ab-combat-value">
                        {combatStats.avgDefense === null ? "—" : combatStats.avgDefense.toFixed(1)}
                      </span>
                      <span className="ab-combat-label">DEF médio ({combatStats.defenseCount} cartas)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {alterEgo && (
              <div className="ab-save-row">
                <input
                  className="ab-input"
                  placeholder="Nome do deck (opcional)"
                  value={deckName}
                  onChange={(e) => setDeckName(truncateString(e.target.value, MAX_DECK_NAME_LENGTH))}
                  maxLength={MAX_DECK_NAME_LENGTH}
                />
                <button className="ab-btn ab-btn-primary" onClick={saveNamedDeck} disabled={mainDeckCount > MAIN_DECK_SIZE}>
                  Salvar deck
                </button>
              </div>
            )}

            {savedDecks.length > 0 && (
              <div className="ab-saved-list">
                <div className="ab-sidebar-group-title">Decks salvos</div>
                {savedDecks.map((d) => (
                  <div key={d.key} className="ab-saved-row">
                    <span>{d.name}</span>
                    <div className="ab-saved-actions">
                      <button className="ab-btn ab-btn-ghost" onClick={() => loadNamedDeck(d.key)}>
                        Carregar
                      </button>
                      <button className="ab-btn ab-btn-ghost" onClick={() => deleteNamedDeck(d.key)}>
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {alterEgo && (
              <div className="ab-export">
                <div className="ab-sidebar-group-title">Exportar lista</div>
                <textarea className="ab-export-box" readOnly value={exportText} />
                <button className="ab-btn ab-btn-primary" onClick={() => printProxyPdf(true)} disabled={mainDeckCount > MAIN_DECK_SIZE}>PDF com margem de corte</button>
                <button className="ab-btn ab-btn-primary" onClick={() => printProxyPdf(false)} disabled={mainDeckCount > MAIN_DECK_SIZE}>PDF sem margem (bloco)</button>
                <button className="ab-btn ab-btn-ghost" onClick={copyExport}>
                  Copiar lista
                </button>
              </div>
            )}
          </section>
        )}

        {tab === "comunidade" && (
          <CommunityPage
            key={location.pathname}
            initialSubtab={location.pathname === "/comunidade/perfil" ? "perfil" : undefined}
            user={user}
            alterEgo={alterEgo}
            mainDeck={mainDeck}
            sideboard={sideboard}
            flashToast={flashToast}
            onRequestLogin={() => setShowAuthModal(true)}
          />
        )}

        {tab === "admin" && user?.role === "admin" && (
          <AdminPanel embedded />
        )}

        {tab === "privacidade" && (
          <LegalPage variant="privacy" onBack={() => setTab("inicio")} />
        )}

        {tab === "termos" && (
          <LegalPage variant="terms" onBack={() => setTab("inicio")} />
        )}

        {tab === "resetar" && (
          <ResetPasswordPage
            token={new URLSearchParams(location.search).get("token")}
            onDone={() => setTab("inicio")}
            onRequestLogin={() => setShowAuthModal(true)}
          />
        )}
      </main>

      <footer className="ab-footer">
        <span className="ab-footer-brand">Forja de Alter Egos</span>
        <nav className="ab-footer-links">
          <button className="ab-link-btn" onClick={() => setTab("privacidade")}>Política de Privacidade</button>
          <span aria-hidden="true">·</span>
          <button className="ab-link-btn" onClick={() => setTab("termos")}>Termos de Uso</button>
        </nav>
      </footer>
    </div>
  );
}

function EmptyGuard({ onGo }) {
  return (
    <div className="ab-section">
      <div className="ab-empty ab-empty-big">
        Escolha um Alter Ego primeiro.
        <button className="ab-btn ab-btn-primary" onClick={onGo}>
          Ir para Alter Ego
        </button>
      </div>
    </div>
  );
}

