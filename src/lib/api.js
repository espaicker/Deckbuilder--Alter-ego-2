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

// Auth
export const api = {
  register: (username, password) =>
    request("POST", "/auth/register", { username, password }),

  login: (username, password) =>
    request("POST", "/auth/login", { username, password }),

  getGoogleConfig: () => request("GET", "/auth/google/config"),

  loginWithGoogle: (credential) =>
    request("POST", "/auth/google", { credential }),

  // Decks
  getCommunityDecks: () => request("GET", "/decks/community"),

  getMyDecks: () => request("GET", "/decks/me"),

  publishDeck: (deck) => request("POST", "/decks", deck),

  deleteDeck: (id) => request("DELETE", `/decks/${id}`),

  getDeck: (id) => request("GET", `/decks/${id}`),
};
