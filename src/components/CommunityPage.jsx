import { useState } from "react";
import DecklistsTab from "./DecklistsTab.jsx";
import TournamentsTab from "./TournamentsTab.jsx";
import ForumTab from "./ForumTab.jsx";

const SUBTABS = [
  ["decklists", "Decklists"],
  ["torneios", "Torneios"],
  ["forum", "Fórum"],
];

export default function CommunityPage({ user, alterEgo, mainDeck, dropPile, flashToast, onRequestLogin }) {
  const [subtab, setSubtab] = useState("decklists");

  return (
    <div className="ab-community-page">
      <nav className="ab-subtabs">
        {SUBTABS.map(([key, label]) => (
          <button
            key={key}
            className={`ab-subtab ${subtab === key ? "is-active" : ""}`}
            onClick={() => setSubtab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="ab-subtab-content">
        {subtab === "decklists" && (
          <DecklistsTab
            user={user}
            alterEgo={alterEgo}
            mainDeck={mainDeck}
            dropPile={dropPile}
            flashToast={flashToast}
            onRequestLogin={onRequestLogin}
          />
        )}

        {subtab === "torneios" && (
          <TournamentsTab
            user={user}
            flashToast={flashToast}
            onRequestLogin={onRequestLogin}
          />
        )}

        {subtab === "forum" && (
          <ForumTab
            user={user}
            flashToast={flashToast}
            onRequestLogin={onRequestLogin}
          />
        )}
      </div>
    </div>
  );
}
