// Fase A: links compartilhaveis, pre-visualizacao (Open Graph) e meta publico.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCommunityPath, subtabPath, deckPath, tournamentPath, playerPath,
} from "../src/lib/communityRoutes.js";
import { computeTypicalList, buildPublicMeta } from "../server/lib/metaAnalytics.js";
import { renderHtmlWithMeta, resolveSiteUrl, resolveOgMeta, DEFAULT_META } from "../server/lib/ogTags.js";

test("parseCommunityPath le aba e item da URL", () => {
  assert.deepEqual(parseCommunityPath("/comunidade"), { subtab: "decklists", deckId: null, tournamentId: null, username: null });
  assert.equal(parseCommunityPath("/comunidade/meta").subtab, "meta");
  assert.equal(parseCommunityPath("/comunidade/perfil").subtab, "perfil");
  assert.deepEqual(parseCommunityPath("/comunidade/decks/12"), { subtab: "decklists", deckId: 12, tournamentId: null, username: null });
  assert.equal(parseCommunityPath("/comunidade/torneios/7").tournamentId, 7);
  assert.equal(parseCommunityPath("/comunidade/jogadores/Usuario%20removido%20%233").username, "Usuario removido #3");
  // valores invalidos caem no padrao, sem lancar erro
  assert.equal(parseCommunityPath("/comunidade/decks/abc").deckId, null);
  assert.equal(parseCommunityPath("/comunidade/decks/0").deckId, null);
  assert.equal(parseCommunityPath("/comunidade/inexistente").subtab, "decklists");
  assert.equal(parseCommunityPath("/comunidade/jogadores/%E0%A4%A").username, null);
  assert.equal(parseCommunityPath("/catalogo").subtab, "decklists");
});

test("caminhos gerados voltam para o mesmo destino", () => {
  assert.equal(subtabPath("decklists"), "/comunidade");
  assert.equal(subtabPath("torneios"), "/comunidade/torneios");
  assert.equal(parseCommunityPath(deckPath(5)).deckId, 5);
  assert.equal(parseCommunityPath(tournamentPath(9)).tournamentId, 9);
  for (const name of ["ana", "João Silva", "a/b?c#d", "Usuario removido #3"]) {
    assert.equal(parseCommunityPath(playerPath(name)).username, name);
  }
  for (const key of ["noticias", "decklists", "meta", "torneios", "ranking", "forum", "lojas", "perfil"]) {
    assert.equal(parseCommunityPath(subtabPath(key)).subtab, key);
  }
});

const cardIndex = new Map([
  ["AE-1", { id: "AE-1", name: "Herói", type: "Alter Ego", colors: ["Vermelho"] }],
  ["AE-2", { id: "AE-2", name: "Vilã", type: "Alter Ego", colors: ["Verde"] }],
  ["C-1", { id: "C-1", name: "Soco", type: "Ação" }],
  ["C-2", { id: "C-2", name: "Bloqueio", type: "Reação" }],
  ["C-3", { id: "C-3", name: "Rara", type: "Tática" }],
]);

test("computeTypicalList: so cartas em >= 50% dos decks, com quantidade media", () => {
  const list = computeTypicalList([
    { "C-1": 4, "C-2": 2 },
    JSON.stringify({ "C-1": 2, "C-3": 1 }),
    { "C-1": 3, "C-2": 2, "C-3": 0 },
  ], cardIndex);
  assert.deepEqual(list.map((c) => c.card_id), ["C-1", "C-2"]);
  assert.equal(list[0].inclusion, 100);
  assert.equal(list[0].avg_qty, 3);
  assert.equal(list[1].inclusion, 67);
  assert.equal(list[1].name, "Bloqueio");
  assert.deepEqual(computeTypicalList([], cardIndex), []);
  assert.deepEqual(computeTypicalList(["{json quebrado"], cardIndex), []);
});

test("buildPublicMeta: participacao por Alter Ego e taxa de vitoria de torneios", () => {
  const meta = buildPublicMeta({
    communityDecks: [
      { alter_ego_id: "AE-1", main_deck: { "C-1": 4 } },
      { alter_ego_id: "AE-1", main_deck: JSON.stringify({ "C-1": 4, "C-2": 1 }) },
      { alter_ego_id: "AE-2", main_deck: { "C-2": 4 } },
    ],
    deckParticipations: [
      { mainDeck: { "C-1": 4 }, alterEgoId: "AE-1", wins: 3, losses: 1, draws: 0 },
    ],
    cardIndex,
    now: 123,
  });
  assert.equal(meta.generated_at, 123);
  assert.equal(meta.total_decks, 3);
  assert.equal(meta.tournament_entries, 1);
  const [first, second] = meta.archetypes;
  assert.equal(first.alter_ego_id, "AE-1");
  assert.equal(first.name, "Herói");
  assert.deepEqual(first.colors, ["Vermelho"]);
  assert.equal(first.decks, 2);
  assert.equal(first.percent, 67);
  assert.equal(first.win_rate, 75);
  assert.equal(first.low_sample, true);
  assert.equal(second.alter_ego_id, "AE-2");
  assert.equal(second.win_rate, null, "sem torneios, taxa de vitoria fica vazia");
  // C-1 e C-2 estao em 2 de 3 decks: empate desfeito pelo nome.
  assert.deepEqual(meta.top_cards.map((c) => c.card_id), ["C-2", "C-1"]);
  assert.equal(meta.top_cards[1].percent, 67);
  assert.equal(meta.top_cards[1].win_rate, 75);
  assert.equal(meta.top_cards[0].win_rate, null);

  const empty = buildPublicMeta({ cardIndex });
  assert.equal(empty.total_decks, 0);
  assert.deepEqual(empty.archetypes, []);
  assert.deepEqual(empty.top_cards, []);
});

const HTML = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Forja de Alter Egos — Deck Builder</title>
    <meta name="description" content="padrao" />
    <meta property="og:title" content="padrao" />
  </head>
  <body><div id="root"></div></body>
</html>`;

test("renderHtmlWithMeta troca titulo e tags, escapando o conteudo", () => {
  const out = renderHtmlWithMeta(HTML, {
    title: `Deck "</title><script>alert(1)</script>`,
    description: "Desc & <b>negrito</b> $& $1",
    image: "/assets/cards/AE-1.jpg",
    type: "article",
  }, { siteUrl: "https://forja.example", pathname: "/comunidade/decks/1" });

  assert.ok(!out.includes("<script>"), "conteudo do banco nao pode virar HTML");
  assert.match(out, /<title>Deck &quot;&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; \| Forja de Alter Egos<\/title>/);
  assert.match(out, /<meta property="og:description" content="Desc &amp; &lt;b&gt;negrito&lt;\/b&gt; \$&amp; \$1" \/>/);
  assert.match(out, /<meta property="og:image" content="https:\/\/forja\.example\/assets\/cards\/AE-1\.jpg" \/>/);
  assert.match(out, /<meta property="og:url" content="https:\/\/forja\.example\/comunidade\/decks\/1" \/>/);
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.equal((out.match(/name="description"/g) || []).length, 1, "tag padrao removida, sem duplicar");
  assert.equal((out.match(/property="og:title"/g) || []).length, 1);
  assert.ok(out.includes('<div id="root"></div>'));
});

test("renderHtmlWithMeta sem SITE_URL omite og:url e og:image (exigem URL absoluta)", () => {
  const out = renderHtmlWithMeta(HTML, DEFAULT_META, { siteUrl: null, pathname: "/" });
  assert.ok(!out.includes("og:url"));
  assert.ok(!out.includes("og:image"));
  assert.match(out, /<title>Forja de Alter Egos — Deck Builder<\/title>/);
  assert.match(out, /twitter:card" content="summary"/);
});

test("resolveSiteUrl usa SITE_URL, depois RENDER_EXTERNAL_URL, e ignora valores invalidos", () => {
  assert.equal(resolveSiteUrl({ SITE_URL: "https://forja.example/caminho/" }), "https://forja.example");
  assert.equal(resolveSiteUrl({ RENDER_EXTERNAL_URL: "https://forja.onrender.com" }), "https://forja.onrender.com");
  assert.equal(resolveSiteUrl({ SITE_URL: "nao e url", RENDER_EXTERNAL_URL: "https://b.example" }), "https://b.example");
  assert.equal(resolveSiteUrl({ SITE_URL: "javascript:alert(1)" }), null);
  assert.equal(resolveSiteUrl({}), null);
});

test("resolveOgMeta: caminho desconhecido, recurso inexistente ou erro no banco usam o padrao", () => {
  const fakeDb = { prepare: () => ({ get: () => undefined }) };
  assert.equal(resolveOgMeta("/catalogo", { db: fakeDb }), DEFAULT_META);
  assert.equal(resolveOgMeta("/comunidade/decks/99", { db: fakeDb }), DEFAULT_META);
  assert.equal(resolveOgMeta("/comunidade/jogadores/%E0%A4%A", { db: fakeDb }), DEFAULT_META);
  const brokenDb = { prepare: () => { throw new Error("falha"); } };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(resolveOgMeta("/comunidade/torneios/1", { db: brokenDb }), DEFAULT_META);
  } finally {
    console.error = originalError;
  }
  assert.match(resolveOgMeta("/comunidade/meta/").title, /Metagame/);
});
