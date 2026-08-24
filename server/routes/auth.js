import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "crypto";
import { JWT_SECRET, JWT_EXPIRES_IN, requireAuth } from "../middleware/auth.js";
import { loginLimiter, registerLimiter, passwordResetLimiter } from "../middleware/rateLimit.js";
import { sendEmail } from "../lib/email.js";

const router = Router();

// Validacao basica
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72; // limite do bcrypt
const RESERVED_USERNAMES = new Set(["admin", "administrator", "administrador", "root", "system"]);

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const SITE_URL = process.env.SITE_URL || "http://localhost:5173";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

router.post("/register", registerLimiter, async (req, res) => {
  try {
    const { username, password, email } = req.body || {};

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
    const result = req.db.prepare(
      "INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)"
    ).run(username, passwordHash, normalizedEmail);

    const token = jwt.sign(
      { sub: result.lastInsertRowid, username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

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

    const token = jwt.sign(
      { sub: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

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

    const user = req.db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(email.trim().toLowerCase());
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
    await sendEmail({
      to: email,
      subject: "Recuperação de senha - Forja de Alter Egos",
      body: `Você pediu para redefinir sua senha.\n\nAbra este link (válido por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail.`,
    });

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
    req.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, row.user_id);
    req.db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE id = ?").run(row.id);

    res.json({ message: "Senha redefinida com sucesso." });
  } catch (err) {
    console.error("[auth] reset-password error:", err);
    res.status(500).json({ error: "Erro ao redefinir senha." });
  }
});

export default router;
