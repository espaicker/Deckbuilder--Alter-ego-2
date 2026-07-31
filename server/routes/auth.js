import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { OAuth2Client } from "google-auth-library";
import { signUserToken } from "../middleware/auth.js";
import { loginLimiter, registerLimiter } from "../middleware/rateLimit.js";

const router = Router();

// Validação básica
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72; // limite do bcrypt
const RESERVED_USERNAMES = new Set(["admin", "administrator", "administrador", "root", "system"]);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email || null,
    avatar_url: row.avatar_url || "",
    role: row.role || "player",
  };
}

function createTokenResponse(row) {
  const user = publicUser(row);
  return { token: signUserToken(user), user };
}

function normalizeGoogleUsername(payload) {
  const source = payload.name || payload.email?.split("@")[0] || "jogador";
  return source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 18) || "jogador";
}

function uniqueUsername(db, base) {
  let candidate = base;
  let suffix = 0;
  while (db.prepare("SELECT id FROM users WHERE username = ?").get(candidate)) {
    suffix += 1;
    const tail = String(suffix);
    candidate = `${base.slice(0, 20 - tail.length)}${tail}`;
  }
  return candidate;
}

router.get("/google/config", (req, res) => {
  res.json({ clientId: GOOGLE_CLIENT_ID });
});

router.post("/register", registerLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: "Nome de usuário deve ter 3-20 caracteres (letras, números, _ ou -).",
      });
    }
    if (RESERVED_USERNAMES.has(username.toLowerCase())) {
      return res.status(409).json({ error: "Esse nome de usuário é reservado." });
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Senha deve ter entre ${MIN_PASSWORD_LENGTH} e ${MAX_PASSWORD_LENGTH} caracteres.`,
      });
    }

    // Verifica se username já existe
    const existing = req.db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) {
      return res.status(409).json({ error: "Nome de usuário já está em uso." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = req.db.prepare(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)"
    ).run(username, passwordHash);

    const user = req.db.prepare("SELECT id, username, email, avatar_url, role FROM users WHERE id = ?").get(result.lastInsertRowid);

    res.status(201).json(createTokenResponse(user));
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

    res.json(createTokenResponse(user));
  } catch (err) {
    console.error("[auth] login error:", err);
    res.status(500).json({ error: "Erro interno ao fazer login." });
  }
});

router.post("/google", loginLimiter, async (req, res) => {
  try {
    if (!googleClient || !GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: "Login com Google não configurado." });
    }

    const { credential } = req.body || {};
    if (!credential || typeof credential !== "string") {
      return res.status(400).json({ error: "Credencial do Google é obrigatória." });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified === false) {
      return res.status(401).json({ error: "Conta Google inválida ou email não verificado." });
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();
    const avatarUrl = payload.picture || "";
    let user = req.db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId);

    if (!user) {
      const existingByEmail = req.db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      if (existingByEmail) {
        req.db.prepare(`
          UPDATE users
          SET google_id = ?, avatar_url = ?
          WHERE id = ?
        `).run(googleId, avatarUrl, existingByEmail.id);
        user = req.db.prepare("SELECT * FROM users WHERE id = ?").get(existingByEmail.id);
      } else {
        const baseUsername = normalizeGoogleUsername(payload);
        const username = uniqueUsername(req.db, baseUsername);
        const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
        const result = req.db.prepare(`
          INSERT INTO users (username, email, google_id, avatar_url, password_hash, role)
          VALUES (?, ?, ?, ?, ?, 'player')
        `).run(username, email, googleId, avatarUrl, passwordHash);
        user = req.db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
      }
    } else if (user.email !== email || user.avatar_url !== avatarUrl) {
      req.db.prepare(`
        UPDATE users
        SET email = ?, avatar_url = ?
        WHERE id = ?
      `).run(email, avatarUrl, user.id);
      user = req.db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    }

    res.json(createTokenResponse(user));
  } catch (err) {
    console.error("[auth] google error:", err);
    res.status(401).json({ error: "Não foi possível validar o login com Google." });
  }
});

export default router;
