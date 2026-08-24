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

/**
 * Verifica se o usuario e juiz (consultando o banco em tempo real, pois o
 * papel pode ser concedido/removido a qualquer momento — nao fica no JWT).
 * Admin sempre passa. Deve rodar depois de requireAuth.
 */
export function requireJudgeOrAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Token nao fornecido." });
  if (req.user.role === "admin") return next();
  try {
    const row = req.db.prepare("SELECT is_judge FROM users WHERE id = ?").get(req.user.id);
    if (row && row.is_judge) {
      req.user.isJudge = true;
      return next();
    }
  } catch (e) { /* ignore */ }
  return res.status(403).json({ error: "Apenas juizes ou administradores podem fazer isso." });
}
