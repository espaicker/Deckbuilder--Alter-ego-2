import { useLocation, useNavigate } from "react-router-dom";
import DecklistsTab from "./DecklistsTab.jsx";
import TournamentsTab from "./TournamentsTab.jsx";
import ForumTab from "./ForumTab.jsx";
import RankingTab from "./RankingTab.jsx";
import ProfilePage from "./ProfilePage.jsx";
import StoresTab from "./StoresTab.jsx";
import NewsTab from "./NewsTab.jsx";
import MetaTab from "./MetaTab.jsx";
import {
  parseCommunityPath, subtabPath, deckPath, tournamentPath, playerPath,
} from "../lib/communityRoutes.js";

const SUBTABS = [
  ["noticias", "Notícias"],
  ["decklists", "Decklists"],
  ["meta", "Meta"],
  ["torneios", "Torneios"],
  ["ranking", "Ranking"],
  ["forum", "Fórum"],
  ["lojas", "Lojas"],
];

// A aba e o item aberto (deck, torneio, jogador) vem da URL, para que cada
// tela tenha um link proprio que pode ser compartilhado.
export default function CommunityPage({ user, alterEgo, mainDeck, sideboard, flashToast, onRequestLogin }) {
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseCommunityPath(location.pathname);
  const { subtab } = route;

  // A conta de admin (id 0) nao tem perfil de jogador.
  const subtabs = user && user.role !== "admin" ? [...SUBTABS, ["perfil", "Meu perfil"]] : SUBTABS;
  const go = (path) => navigate(path);
  const openProfile = (username) => go(playerPath(username));

  if (route.username) {
    return (
      <div className="ab-community-page">
        <ProfilePage
          username={route.username}
          user={user}
          flashToast={flashToast}
          onBack={() => go(subtabPath("ranking"))}
        />
      </div>
    );
  }

  return (
    <div className="ab-community-page">
      <nav className="ab-subtabs" aria-label="Seções da comunidade">
        {subtabs.map(([key, label]) => (
          <button
            key={key}
            className={`ab-subtab ${subtab === key ? "is-active" : ""}`}
            aria-current={subtab === key ? "page" : undefined}
            onClick={() => go(subtabPath(key))}
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
            deckId={route.deckId}
            onOpenDeck={(id) => go(deckPath(id))}
            onCloseDeck={() => go(subtabPath("decklists"))}
            onViewProfile={openProfile}
          />
        )}

        {subtab === "meta" && (
          <MetaTab flashToast={flashToast} />
        )}

        {subtab === "torneios" && (
          <TournamentsTab
            user={user}
            flashToast={flashToast}
            onRequestLogin={onRequestLogin}
            tournamentId={route.tournamentId}
            onOpenTournament={(id) => go(tournamentPath(id))}
            onCloseTournament={() => go(subtabPath("torneios"))}
          />
        )}

        {subtab === "ranking" && (
          <RankingTab onViewProfile={openProfile} />
        )}

        {subtab === "forum" && (
          <ForumTab
            user={user}
            flashToast={flashToast}
            onRequestLogin={onRequestLogin}
          />
        )}

        {subtab === "perfil" && user && user.role !== "admin" && (
          <ProfilePage
            username={user.username}
            user={user}
            flashToast={flashToast}
            onBack={() => go(subtabPath("decklists"))}
          />
        )}

        {subtab === "perfil" && !user && (
          <section className="ab-section">
            <div className="ab-empty">
              Entre na sua conta para ver o seu perfil.{" "}
              <button className="ab-btn ab-btn-primary" onClick={onRequestLogin}>Entrar</button>
            </div>
          </section>
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
