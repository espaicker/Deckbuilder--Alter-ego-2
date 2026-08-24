import { useState, useEffect, useCallback } from "react";
import { api, setToken } from "../lib/api.js";

/**
 * Hook de autenticação.
 * Gerencia estado do usuário logado e operações de login/registro/logout.
 * Suporta login de admin separado via /api/admin/login.
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restaura sessão do token salvo
  useEffect(() => {
    const token = localStorage.getItem("deckbuilder:auth_token");
    const savedUser = localStorage.getItem("deckbuilder:auth_user");
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        setToken(null);
        localStorage.removeItem("deckbuilder:auth_user");
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (username, password) => {
    // Tenta login de admin primeiro se username for "admin"
    if (username === "admin") {
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (res.ok && data.token) {
          setToken(data.token);
          const adminUser = { ...data.user, role: "admin" };
          localStorage.setItem("deckbuilder:auth_user", JSON.stringify(adminUser));
          localStorage.setItem("deckbuilder:admin_token", data.token);
          setUser(adminUser);
          return adminUser;
        }
      } catch {
        // Se falhar admin login, tenta login normal abaixo
      }
    }

    // Login normal de jogador
    const data = await api.login(username, password);
    setToken(data.token);
    localStorage.setItem("deckbuilder:auth_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (username, password, email, acceptedTerms) => {
    const data = await api.register(username, password, email, acceptedTerms);
    setToken(data.token);
    localStorage.setItem("deckbuilder:auth_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem("deckbuilder:auth_user");
    localStorage.removeItem("deckbuilder:admin_token");
    setUser(null);
  }, []);

  return { user, loading, login, register, logout };
}
