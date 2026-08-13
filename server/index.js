import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { initDb } from "./db.js";
import authRoutes from "./routes/auth.js";
import deckRoutes from "./routes/decks.js";
import adminRoutes from "./routes/admin.js";
import cardsRoutes from "./routes/cards.js";
import tournamentRoutes from "./routes/tournaments.js";
import rankingRoutes from "./routes/ranking.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: por padrão permite qualquer origem (bom pra desenvolvimento local,
// já que o Vite roda em outra porta). Ao publicar de verdade, defina
// ALLOWED_ORIGINS (separado por vírgula) com a URL real do site pra
// restringir — por exemplo: ALLOWED_ORIGINS=https://seu-app.onrender.com
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : true;
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Inicializa o banco (async por causa do sql.js)
const db = await initDb();

// Injeta db nos requests
app.use((req, res, next) => {
  req.db = db;
  next();
});

// Rotas
app.use("/api/auth", authRoutes);
app.use("/api/decks", deckRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/cards", cardsRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/ranking", rankingRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Serve o front-end já compilado (rode `npm run build` antes de subir pra
// produção). Em desenvolvimento local isso é ignorado — você usa
// `npm run dev` (Vite) num terminal separado, que não gera a pasta dist/.
const DIST_DIR = join(__dirname, "../dist");
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get("/admin", (req, res) => res.sendFile(join(DIST_DIR, "admin.html")));
  app.get("/", (req, res) => res.sendFile(join(DIST_DIR, "index.html")));
}

app.listen(PORT, () => {
  console.log(`[server] Rodando em http://localhost:${PORT}`);
});
