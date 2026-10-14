import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { requireAuth, signUserToken } from "../middleware/auth.js";
import {
  loginLimiter, registerLimiter, passwordResetLimiter, accountDeletionLimiter, passwordChangeLimiter,
} from "../middleware/rateLimit.js";
import { sendEmail } from "../lib/email.js";
import { passwordResetEmail, passwordChangedEmail } from "../lib/emailTemplates.js";

const router = Router();

// Validacao basica
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72; // limite do bcrypt
const RESERVED_USERNAMES = new Set(["admin", "administrator", "administrador", "root", "system"]);

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
// URL publica do site para os links dos e-mails. Nunca vem do cabecalho Host da
// requisicao (isso permitiria envenenar o link). No Render, RENDER_EXTERNAL_URL
// e definido automaticamente.
const SITE_URL = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:5173").replace(/\/+$/, "");

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

router.post("/register", registerLimiter, async (req, res) => {
  try {
    const { username, password, email, accepted_terms } = req.body || {};

    if (!username || !USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: "Nome de usuário deve ter 3-20 caracteres (letras, números, _ ou -).",
      });
    }
    if (RESERVED_USERNAMES.has(username.toLowerCase())) {
      return res.status(409).json({ error: "Esse nome de usuário é reservado." });
    }
    if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "E-mail inválido." });
    }
    const normalizedEmail = email.trim().toLowerCase();
    // LGPD (Fase 9): consentimento explicito e obrigatorio para cadastro.
    if (accepted_terms !== true) {
      return res.status(400).json({ error: "Voce precisa ler e aceitar os Termos de Uso e a Politica de Privacidade." });
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Senha deve ter entre ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caracteres.`,
      });
    }

    const existing = req.db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) {
      return res.status(409).json({ error: "Nome de usuário já está em uso." });
    }

    const existingEmail = req.db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(normalizedEmail);
    if (existingEmail) {
      return res.status(409).json({ error: "Esse e-mail já está cadastrado." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = Date.now();
    const result = req.db.prepare(
      "INSERT INTO users (username, password_hash, email, terms_accepted_at) VALUES (?, ?, ?, ?)"
    ).run(username, passwordHash, normalizedEmail, now);

    const token = signUserToken({ id: result.lastInsertRowid, username, token_version: 0 });

    res.status(201).json({
      token,
      user: { id: result.lastInsertRowid, username },
    });
  } catch (err) {
    console.error("[auth] register error:", err);
    res.status(500).json({ error: "Erro interno ao registrar." });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Usuário e senha são obrigatórios." });
    }

    const user = req.db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user) {
      return res.status(401).json({ error: "Usuário ou senha incorretos." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Usuário ou senha incorretos." });
    }

    const token = signUserToken(user);

    res.json({
      token,
      user: { id: user.id, username: user.username },
    });
  } catch (err) {
    console.error("[auth] login error:", err);
    res.status(500).json({ error: "Erro interno ao fazer login." });
  }
});

// PATCH /api/auth/me/email — atualiza o proprio e-mail (exige senha atual)
router.patch("/me/email", requireAuth, async (req, res) => {
  try {
    const { email, currentPassword } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "E-mail inválido." });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!currentPassword) {
      return res.status(400).json({ error: "Confirme com sua senha atual." });
    }

    const user = req.db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Senha atual incorreta." });

    const existingEmail = req.db.prepare("SELECT id FROM users WHERE LOWER(email) = ? AND id != ?").get(normalizedEmail, user.id);
    if (existingEmail) return res.status(409).json({ error: "Esse e-mail já está cadastrado." });

    req.db.prepare("UPDATE users SET email = ? WHERE id = ?").run(normalizedEmail, user.id);
    res.json({ message: "E-mail atualizado." });
  } catch (err) {
    console.error("[auth] update email error:", err);
    res.status(500).json({ error: "Erro ao atualizar e-mail." });
  }
});

// POST /api/auth/forgot-password — sempre responde sucesso generico
router.post("/forgot-password", passwordResetLimiter, async (req, res) => {
  const GENERIC = { message: "Se esse e-mail existir, enviamos um link de recuperação." };
  try {
    const { email } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return res.json(GENERIC); // nao vaza se e-mail e valido ou nao
    }

    const user = req.db.prepare("SELECT id, username, email FROM users WHERE LOWER(email) = ?").get(email.trim().toLowerCase());
    if (!user) {
      return res.json(GENERIC); // nao vaza que o e-mail nao existe
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const now = Date.now();
    const expiresAt = now + RESET_TOKEN_TTL_MS;

    req.db.prepare(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)"
    ).run(user.id, tokenHash, expiresAt, now);

    const link = `${SITE_URL}/resetar-senha?token=${rawToken}`;
    const message = passwordResetEmail({ username: user.username, link, ttlMinutes: RESET_TOKEN_TTL_MS / 60000 });
    // Sem await: se esperasse o provedor de e-mail, a resposta demoraria mais
    // quando o e-mail existe, e isso revelaria quais e-mails tem conta.
    sendEmail({ to: user.email, subject: message.subject, body: message.text, html: message.html })
      .catch(() => console.error("[auth] falha ao enviar e-mail de recuperacao"));

    res.json(GENERIC);
  } catch (err) {
    console.error("[auth] forgot-password error");
    res.json(GENERIC); // mesmo em erro, resposta generica
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", passwordResetLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Token inválido." });
    }
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Senha deve ter entre ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caracteres.`,
      });
    }

    const tokenHash = hashToken(token);
    const row = req.db.prepare(
      "SELECT * FROM password_reset_tokens WHERE token_hash = ?"
    ).get(tokenHash);

    if (!row) return res.status(400).json({ error: "Token inválido ou expirado." });
    if (row.used) return res.status(400).json({ error: "Este link já foi usado." });
    if (Date.now() > row.expires_at) return res.status(400).json({ error: "Este link expirou." });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    // token_version + 1: invalida todas as sessoes abertas antes da redefinicao.
    req.db.prepare(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?"
    ).run(passwordHash, row.user_id);
    // Invalida este e qualquer outro link pendente do mesmo usuario.
    req.db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE user_id = ?").run(row.user_id);

    // Aviso de seguranca: avisa o dono da conta que a senha mudou.
    const owner = req.db.prepare("SELECT username, email FROM users WHERE id = ?").get(row.user_id);
    if (owner?.email) {
      const notice = passwordChangedEmail({ username: owner.username, siteUrl: SITE_URL });
      sendEmail({ to: owner.email, subject: notice.subject, body: notice.text, html: notice.html }).catch(() => {});
    }

    res.json({ message: "Senha redefinida com sucesso." });
  } catch (err) {
    console.error("[auth] reset-password error:", err);
    res.status(500).json({ error: "Erro ao redefinir senha." });
  }
});

// POST /api/auth/change-password — troca a senha do usuario logado (exige a
// senha atual). Invalida todas as sessoes anteriores e devolve um token novo
// para a sessao que fez a troca.
router.post("/change-password", passwordChangeLimiter, requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || typeof currentPassword !== "string") {
      return res.status(400).json({ error: "Confirme com sua senha atual." });
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Senha deve ter entre ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caracteres.`,
      });
    }

    const user = req.db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Senha atual incorreta." });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    req.db.prepare(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?"
    ).run(passwordHash, user.id);

    const updated = req.db.prepare("SELECT id, username, email, token_version FROM users WHERE id = ?").get(user.id);
    const token = signUserToken(updated);

    if (updated.email) {
      const notice = passwordChangedEmail({ username: updated.username, siteUrl: SITE_URL });
      sendEmail({ to: updated.email, subject: notice.subject, body: notice.text, html: notice.html }).catch(() => {});
    }

    res.json({ message: "Senha alterada com sucesso.", token });
  } catch (err) {
    console.error("[auth] change-password error:", err);
    res.status(500).json({ error: "Erro ao alterar senha." });
  }
});

// GET /api/auth/me/export — Direito de acesso (LGPD art. 18): retorna TODO
// o dado pessoal do usuario logado em um JSON. Nunca expoe dados de outros.
router.get("/me/export", requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const user = req.db.prepare(
      "SELECT id, username, email, bio, avatar_url, created_at, terms_accepted_at, is_judge FROM users WHERE id = ?"
    ).get(userId);
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado." });

    const decks = req.db.prepare(
      "SELECT id, name, alter_ego_id, main_deck, sideboard, drop_pile, description, created_at FROM community_decks WHERE user_id = ?"
    ).all(userId);

    const tournamentRegistrations = req.db.prepare(
      `SELECT tp.tournament_id, t.name AS tournament_name, tp.deck_id, tp.dropped, tp.had_bye, tp.joined_at
       FROM tournament_players tp JOIN tournaments t ON t.id = tp.tournament_id
       WHERE tp.user_id = ?`
    ).all(userId);

    const organizedTournaments = req.db.prepare(
      "SELECT id, name, format, status, created_at FROM tournaments WHERE organizer_id = ?"
    ).all(userId);

    const pointHistory = req.db.prepare(
      "SELECT tournament_id, points_awarded, reason, created_at FROM point_history WHERE user_id = ?"
    ).all(userId);

    const forumTopics = req.db.prepare(
      "SELECT id, category_id, title, body, created_at FROM forum_topics WHERE author_id = ?"
    ).all(userId);

    const forumReplies = req.db.prepare(
      "SELECT id, topic_id, body, created_at FROM forum_replies WHERE author_id = ?"
    ).all(userId);

    const stores = req.db.prepare(
      "SELECT id, name, city, state, address, contact_info, approved, created_at FROM stores WHERE owner_user_id = ?"
    ).all(userId);

    res.json({
      exported_at: new Date().toISOString(),
      account: user,
      published_decks: decks,
      tournament_registrations: tournamentRegistrations,
      organized_tournaments: organizedTournaments,
      point_history: pointHistory,
      forum_topics: forumTopics,
      forum_replies: forumReplies,
      partner_stores: stores,
    });
  } catch (err) {
    console.error("[auth] export error:", err);
    res.status(500).json({ error: "Erro ao exportar dados." });
  }
});

// DELETE /api/auth/me — Direito ao esquecimento (LGPD art. 18).
// Exige confirmar a senha atual.
//
// DECISAO DE DESIGN (anonimizacao, nao exclusao fisica): dados vinculados a
// torneios finalizados (resultados de partida) e decks publicados fazem parte
// do historico competitivo de OUTRAS pessoas (ranking, standings). Apaga-los
// quebraria a integridade historica alheia. Por isso ANONIMIZAMOS a conta:
//   - username vira "Usuario removido #<id>" (nao mais rastreavel a uma pessoa)
//   - email e password_hash sao apagados de verdade (dado pessoal sensivel)
//   - bio/avatar removidos; tokens de reset apagados
//   - decks/resultados permanecem, mas sem vinculo a uma pessoa identificavel
// Isso esta documentado tambem na Politica de Privacidade.
router.delete("/me", accountDeletionLimiter, requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: "Confirme com sua senha atual para apagar a conta." });
    }
    const user = req.db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado." });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Senha incorreta." });

    // Senha aleatoria irreversivel — impede login e satisfaz NOT NULL do schema.
    const deadHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const anonUsername = `Usuario removido #${user.id}`;

    // token_version + 1: rejeita qualquer token emitido antes para esta conta.
    req.db.prepare(
      "UPDATE users SET username = ?, email = NULL, password_hash = ?, bio = '', avatar_url = NULL, token_version = token_version + 1 WHERE id = ?"
    ).run(anonUsername, deadHash, user.id);

    // Remove tokens de recuperacao pendentes (nao ha mais conta para recuperar).
    req.db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(user.id);

    res.json({
      message: "Conta apagada. Seus dados pessoais (e-mail, senha) foram removidos; o historico de resultados foi anonimizado para preservar a integridade dos torneios de outros jogadores.",
      anonymized_username: anonUsername,
    });
  } catch (err) {
    console.error("[auth] delete account error:", err);
    res.status(500).json({ error: "Erro ao apagar conta." });
  }
});

export default router;
