import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../middleware/auth.js";
import { loginLimiter, registerLimiter } from "../middleware/rateLimit.js";

const router = Router();

// Validação básica
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72; // limite do bcrypt
const RESERVED_USERNAMES = new Set(["admin", "administrator", "administrador", "root", "system"]);

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

export default router;
