import jwt from "jsonwebtoken";
import { getJwtSecret } from "../secrets.js";

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = "7d";
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export { JWT_SECRET, JWT_EXPIRES_IN };

export function publicUserFromPayload(payload) {
  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role || "player",
    email: payload.email || null,
    avatar_url: payload.avatar_url || "",
  };
}

export function signUserToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role || "player",
      email: user.email || null,
      avatar_url: user.avatar_url || "",
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Middleware que exige autenticação via Bearer token.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido." });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = publicUserFromPayload(payload);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
}

/**
 * Middleware opcional — popula req.user se token presente, mas não bloqueia.
 */
export function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      req.user = publicUserFromPayload(payload);
    } catch {
      // Token inválido — ignora
    }
  }
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!ADMIN_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: "Acesso restrito a administradores." });
    }
    next();
  });
}

export function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Acesso restrito ao administrador principal." });
    }
    next();
  });
}
