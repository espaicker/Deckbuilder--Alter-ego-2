import { useState } from "react";
import DecklistsTab from "./DecklistsTab.jsx";
import TournamentsTab from "./TournamentsTab.jsx";
import ForumTab from "./ForumTab.jsx";
import RankingTab from "./RankingTab.jsx";
import ProfilePage from "./ProfilePage.jsx";

const SUBTABS = [
  ["decklists", "Decklists"],
  ["torneios", "Torneios"],
  ["ranking", "Ranking"],
  ["forum", "Fórum"],
];

export default function CommunityPage({ user, alterEgo, mainDeck, dropPile, flashToast, onRequestLogin }) {
  const [subtab, setSubtab] = useState("decklists");
  const [viewingProfile, setViewingProfile] = useState(null);

  if (viewingProfile) {
    return (
      <div className="ab-community-page">
        <ProfilePage
          username={viewingProfile}
          user={user}
          flashToast={flashToast}
          onBack={() => setViewingProfile(null)}
        />
      </div>
    );
  }

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

        {subtab === "ranking" && (
          <RankingTab onViewProfile={(username) => setViewingProfile(username)} />
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
