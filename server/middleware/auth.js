import jwt from "jsonwebtoken";
import { getJwtSecret } from "../secrets.js";

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = "7d";

export { JWT_SECRET, JWT_EXPIRES_IN };

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
    req.user = { id: payload.sub, username: payload.username, role: payload.role || null };
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
      req.user = { id: payload.sub, username: payload.username, role: payload.role || null };
    } catch {
      // Token inválido — ignora
    }
  }
  next();
}
