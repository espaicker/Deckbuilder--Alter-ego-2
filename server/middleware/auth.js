import jwt from "jsonwebtoken";
import { getJwtSecret } from "../secrets.js";

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = "7d";

export { JWT_SECRET, JWT_EXPIRES_IN };

/**
 * Emite o token de sessão de um jogador. A claim "tv" guarda a versão da
 * sessão (users.token_version): trocar/redefinir a senha ou excluir a conta
 * incrementa a versão e invalida todos os tokens emitidos antes.
 */
export function signUserToken({ id, username, token_version }) {
  return jwt.sign({ sub: id, username, tv: token_version ?? 0 }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Confere se o payload (já verificado) ainda representa uma sessão válida.
 * - Admin (sub 0, sem linha em users) é aceito sem consulta.
 * - Jogador: a conta precisa existir e (tv ?? 0) === token_version atual.
 * Retorna o req.user ({ id, username, role }) ou null se a sessão foi revogada.
 */
export function resolveSessionUser(payload, db) {
  const user = { id: payload.sub, username: payload.username, role: payload.role || null };
  if (payload.role === "admin") return user;
  if (!db) return null;
  const row = db.prepare("SELECT token_version FROM users WHERE id = ?").get(payload.sub);
  if (!row) return null;
  if ((payload.tv ?? 0) !== (row.token_version ?? 0)) return null;
  return user;
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
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }

  let user = null;
  try {
    user = resolveSessionUser(payload, req.db);
  } catch (err) {
    console.error("[auth] Falha ao validar a sessão:", err?.message || err);
  }
  if (!user) {
    return res.status(401).json({ error: "Sua sessão expirou. Faça login novamente.", code: "SESSION_REVOKED" });
  }
  req.user = user;
  next();
}

/**
 * Middleware opcional — popula req.user se token presente e válido, mas não
 * bloqueia. Token inválido, expirado ou revogado segue como anônimo.
 */
export function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      const user = resolveSessionUser(payload, req.db);
      if (user) req.user = user;
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
