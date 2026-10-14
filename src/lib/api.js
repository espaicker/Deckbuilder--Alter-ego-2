/**
 * Cliente HTTP para comunicação com o backend.
 */

const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("deckbuilder:auth_token");
}

export function setToken(token) {
  if (token) {
    localStorage.setItem("deckbuilder:auth_token", token);
  } else {
    localStorage.removeItem("deckbuilder:auth_token");
  }
}

async function request(method, path, body = null) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
  } catch (err) {
    throw new Error("Servidor indisponível. Verifique se o backend está rodando (npm run dev:server).");
  }

  // Tenta parsear JSON — protege contra resposta vazia
  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Resposta inválida do servidor (${res.status}).`);
  }

  if (!res.ok) {
    const error = new Error(data.error || `Erro ${res.status}`);
    if (Array.isArray(data.issues)) error.issues = data.issues;
    throw error;
  }
  return data;
}

async function adminArticleReq(method, path, body = null) {
  const token = localStorage.getItem("deckbuilder:admin_token") || localStorage.getItem("deckbuilder:auth_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : null });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

// Auth
export const api = {
  register: (username, password, email, acceptedTerms) =>
    request("POST", "/auth/register", { username, password, email, accepted_terms: acceptedTerms }),

  login: (username, password) =>
    request("POST", "/auth/login", { username, password }),

  // LGPD (Fase 9): direito de acesso e ao esquecimento
  exportMyData: () => request("GET", "/auth/me/export"),
  deleteMyAccount: (password) => request("DELETE", "/auth/me", { password }),

  // Recuperacao de senha e e-mail da conta
  forgotPassword: (email) => request("POST", "/auth/forgot-password", { email }),
  resetPassword: (token, newPassword) => request("POST", "/auth/reset-password", { token, newPassword }),
  updateEmail: (email, currentPassword) => request("PATCH", "/auth/me/email", { email, currentPassword }),
  // Troca de senha: invalida as outras sessoes e devolve um token novo, que
  // passa a ser o desta sessao.
  changePassword: async (currentPassword, newPassword) => {
    const data = await request("POST", "/auth/change-password", { currentPassword, newPassword });
    if (data.token) setToken(data.token);
    return data;
  },

  // Decks
  getCommunityDecks: () => request("GET", "/decks/community"),

  getMyDecks: () => request("GET", "/decks/me"),

  publishDeck: (deck) => request("POST", "/decks", deck),

  deleteDeck: (id) => request("DELETE", `/decks/${id}`),

  getDeck: (id) => request("GET", `/decks/${id}`),

  // Tournaments
  getTournaments: () => request("GET", "/tournaments"),

  getTournament: (id) => request("GET", `/tournaments/${id}`),

  createTournament: (data) => request("POST", "/tournaments", data),

  registerForTournament: (id, deckId) =>
    request("POST", `/tournaments/${id}/register`, { deck_id: deckId }),

  unregisterFromTournament: (id) =>
    request("DELETE", `/tournaments/${id}/register`),

  dropFromTournament: (id, playerId) =>
    request("POST", `/tournaments/${id}/drop`, playerId ? { player_id: playerId } : {}),

  startTournament: (id) => request("POST", `/tournaments/${id}/start`),

  nextRound: (id) => request("POST", `/tournaments/${id}/next-round`),

  startTopCut: (id) => request("POST", `/tournaments/${id}/start-topcut`),

  reportMatchResult: (tournamentId, matchId, result) =>
    request("POST", `/tournaments/${tournamentId}/matches/${matchId}/report`, { result }),

  overrideMatchResult: (tournamentId, matchId, result, reason) =>
    request("PATCH", `/tournaments/${tournamentId}/matches/${matchId}/override`, { result, reason }),

  cancelTournament: (id) => request("POST", `/tournaments/${id}/cancel`),

  toggleJudge: (userId) => request("POST", `/admin/users/${userId}/toggle-judge`),

  setTournamentRanked: (id, isRanked) => request("PATCH", `/tournaments/${id}/ranked`, { is_ranked: isRanked }),

  // Lojas parceiras (Fase 7)
  createStore: (data) => request("POST", "/stores", data),
  getStores: () => request("GET", "/stores"),
  getMyStores: () => request("GET", "/stores/mine"),
  getPendingStores: () => {
    const token = localStorage.getItem("deckbuilder:admin_token") || localStorage.getItem("deckbuilder:auth_token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch("/api/admin/stores/pending", { headers }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
      return d;
    });
  },
  approveStore: (id) => {
    const token = localStorage.getItem("deckbuilder:admin_token") || localStorage.getItem("deckbuilder:auth_token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`/api/admin/stores/${id}/approve`, { method: "POST", headers }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
      return d;
    });
  },
  rejectStore: (id) => {
    const token = localStorage.getItem("deckbuilder:admin_token") || localStorage.getItem("deckbuilder:auth_token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`/api/admin/stores/${id}/reject`, { method: "POST", headers }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
      return d;
    });
  },

  // Artigos / noticias (Fase 8)
  getArticles: () => request("GET", "/articles"),
  getArticle: (slug) => request("GET", `/articles/${encodeURIComponent(slug)}`),
  adminListArticles: () => adminArticleReq("GET", "/api/admin/articles"),
  adminGetArticle: (id) => adminArticleReq("GET", `/api/admin/articles/${id}`),
  createArticle: (data) => adminArticleReq("POST", "/api/admin/articles", data),
  updateArticle: (id, data) => adminArticleReq("PATCH", `/api/admin/articles/${id}`, data),
  publishArticle: (id) => adminArticleReq("POST", `/api/admin/articles/${id}/publish`),
  unpublishArticle: (id) => adminArticleReq("POST", `/api/admin/articles/${id}/unpublish`),
  deleteArticle: (id) => adminArticleReq("DELETE", `/api/admin/articles/${id}`),

  // Ranking
  getRanking: (page = 1, limit = 50, search = "") => {
    const params = new URLSearchParams({ page, limit });
    if (search) params.set("search", search);
    return request("GET", `/ranking?${params.toString()}`);
  },

  getRankingHistory: (userId) => request("GET", `/ranking/${userId}/history`),

  // Profile
  getProfile: (username) => request("GET", `/profile/${encodeURIComponent(username)}`),

  updateProfile: (bio) => request("PUT", "/profile", { bio }),

  // Analytics (Admin)
  getAnalytics: () => {
    const token = localStorage.getItem("deckbuilder:admin_token") || localStorage.getItem("deckbuilder:auth_token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch("/api/admin/analytics", { headers }).then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); return d; });
  },

  // Forum
  getForumCategories: () => request("GET", "/forum/categories"),
  getForumTopics: (categoryId, page = 1) => request("GET", `/forum/categories/${categoryId}/topics?page=${page}`),
  getForumTopic: (topicId) => request("GET", `/forum/topics/${topicId}`),
  createForumTopic: (categoryId, title, body) => request("POST", `/forum/categories/${categoryId}/topics`, { title, body }),
  createForumReply: (topicId, body) => request("POST", `/forum/topics/${topicId}/replies`, { body }),
  reportForumContent: (data) => request("POST", "/forum/reports", data),
  hideForumTopic: (topicId) => request("POST", `/forum/topics/${topicId}/hide`),
  hideForumReply: (replyId) => request("POST", `/forum/replies/${replyId}/hide`),
  deleteForumTopic: (topicId) => request("DELETE", `/forum/topics/${topicId}`),
  deleteForumReply: (replyId) => request("DELETE", `/forum/replies/${replyId}`),
  lockForumTopic: (topicId) => request("POST", `/forum/topics/${topicId}/lock`),
  pinForumTopic: (topicId) => request("POST", `/forum/topics/${topicId}/pin`),
  getForumReports: () => request("GET", "/forum/reports"),
  resolveForumReport: (reportId, status) => request("PUT", `/forum/reports/${reportId}`, { status }),

  uploadAvatar: async (file) => {
    const formData = new FormData();
    formData.append("avatar", file);
    const token = localStorage.getItem("deckbuilder:auth_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch("/api/profile/avatar", { method: "POST", headers, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  },
};
