import { useState } from "react";
import DecklistsTab from "./DecklistsTab.jsx";
import TournamentsTab from "./TournamentsTab.jsx";
import ForumTab from "./ForumTab.jsx";
import RankingTab from "./RankingTab.jsx";
import ProfilePage from "./ProfilePage.jsx";
import StoresTab from "./StoresTab.jsx";
import NewsTab from "./NewsTab.jsx";

const SUBTABS = [
  ["noticias", "Notícias"],
  ["decklists", "Decklists"],
  ["torneios", "Torneios"],
  ["ranking", "Ranking"],
  ["forum", "Fórum"],
  ["lojas", "Lojas"],
];

export default function CommunityPage({ user, alterEgo, mainDeck, sideboard, flashToast, onRequestLogin, initialSubtab }) {
  const [subtab, setSubtab] = useState(initialSubtab || "decklists");
  // A conta de admin (id 0) nao tem perfil de jogador.
  const subtabs = user && user.role !== "admin" ? [...SUBTABS, ["perfil", "Meu perfil"]] : SUBTABS;
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
        {subtabs.map(([key, label]) => (
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
        {subtab === "noticias" && (
          <NewsTab flashToast={flashToast} />
        )}

        {subtab === "decklists" && (
          <DecklistsTab
            user={user}
            alterEgo={alterEgo}
            mainDeck={mainDeck}
            sideboard={sideboard}
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

        {subtab === "perfil" && user && (
          <ProfilePage
            username={user.username}
            user={user}
            flashToast={flashToast}
            onBack={() => setSubtab("decklists")}
          />
        )}

        {subtab === "lojas" && (
          <StoresTab
            user={user}
            flashToast={flashToast}
            onRequestLogin={onRequestLogin}
          />
        )}
      </div>
    </div>
  );
}
