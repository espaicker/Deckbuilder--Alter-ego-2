// Precisa ser o primeiro import: os outros modulos leem process.env ao carregar.
import "./env.js";
import express from "express";
import cors from "cors";
import { join } from "path";
import { existsSync } from "fs";
import { initDb } from "./db.js";
import { emailConfigWarnings } from "./lib/email.js";
import {
  DIST_DIR, CARDS_IMG_DIR, PUBLIC_CARDS_IMG_DIR, AVATARS_DIR, PUBLIC_AVATARS_DIR,
} from "./lib/paths.js";
import { seedDataDir } from "./lib/seedData.js";
import { resolveBackupConfig, startBackupSchedule } from "./lib/backup.js";
import { resolveTrustProxy, resolveCorsOptions, securityHeaders } from "./middleware/security.js";
import authRoutes from "./routes/auth.js";
import deckRoutes from "./routes/decks.js";
import adminRoutes from "./routes/admin.js";
import cardsRoutes, { publicCardsRouter } from "./routes/cards.js";
import tournamentRoutes from "./routes/tournaments.js";
import rankingRoutes from "./routes/ranking.js";
import profileRoutes from "./routes/profile.js";
import forumRoutes from "./routes/forum.js";
import storesRoutes from "./routes/stores.js";
import articlesRoutes, { adminRouter as articlesAdminRoutes } from "./routes/articles.js";

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === "production";

// Atras do proxy do Render, req.ip precisa ser o IP real do cliente (rate
// limit por cliente). TRUST_PROXY define quantos saltos confiar (padrao 1 em
// producao). Veja server/middleware/security.js.
app.disable("x-powered-by");
app.set("trust proxy", resolveTrustProxy(process.env));

// Cabecalhos de seguranca em TODA resposta (API, estaticos, SPA e 404).
app.use(securityHeaders({ isProduction }));

// CORS: com ALLOWED_ORIGINS (separado por virgula), so as origens listadas.
// Sem ALLOWED_ORIGINS: em producao, so a origem do proprio site (SITE_URL /
// RENDER_EXTERNAL_URL); em desenvolvimento, qualquer origem (o Vite roda em
// outra porta).
app.use(cors(resolveCorsOptions(process.env)));
app.use(express.json({ limit: "1mb" }));

// Primeiro boot com DATA_DIR vazio: copia cartas, imagens e avatares do
// repositorio (nunca sobrescreve o que ja existe).
seedDataDir();

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
app.use("/api/cards", publicCardsRouter);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/ranking", rankingRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/forum", forumRoutes);
app.use("/api/stores", storesRoutes);
app.use("/api/articles", articlesRoutes);
app.use("/api/admin/articles", articlesAdminRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Imagens de cartas e avatares: primeiro DATA_DIR (enviados pelo admin/
// usuarios em runtime), depois as copias do repositorio. Vale com ou sem
// dist/. A raiz de DATA_DIR nunca e servida (banco, segredos e backups).
app.use(
  "/assets/cards",
  express.static(CARDS_IMG_DIR, { index: false }),
  express.static(PUBLIC_CARDS_IMG_DIR, { index: false }),
);
app.use(
  "/assets/avatars",
  express.static(AVATARS_DIR, { index: false }),
  express.static(PUBLIC_AVATARS_DIR, { index: false }),
);

// Serve o front-end já compilado (rode `npm run build` antes de subir pra
// produção). Em desenvolvimento local isso é ignorado — você usa
// `npm run dev` (Vite) num terminal separado, que não gera a pasta dist/.
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get("/admin", (req, res) => res.sendFile(join(DIST_DIR, "admin.html")));
  app.get("/", (req, res) => res.sendFile(join(DIST_DIR, "index.html")));
  // SPA fallback — qualquer rota que não é API nem arquivo estático serve o index.html
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/assets/")) return next();
    res.sendFile(join(DIST_DIR, "index.html"));
  });
}

const server = app.listen(PORT, () => {
  console.log(`[server] Rodando em http://localhost:${PORT}`);
  for (const warning of emailConfigWarnings()) console.warn(`[server] AVISO: ${warning}`);
});

// Snapshots periodicos do banco em DATA_DIR/backups (desligado em NODE_ENV=test).
const stopBackups = startBackupSchedule(db, resolveBackupConfig(process.env));

// Encerramento gracioso: o Render envia SIGTERM a cada deploy. Grava as
// escritas pendentes do banco antes de sair.
let shuttingDown = false;
function shutdown(motivo) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] Encerrando (${motivo})...`);

  // Rede de seguranca: se algo travar, sai mesmo assim.
  const forceExit = setTimeout(() => {
    console.error("[server] Encerramento demorou demais; saindo.");
    process.exit(1);
  }, 5000);
  forceExit.unref();

  let exitCode = 0;
  try {
    stopBackups();
  } catch { /* ignore */ }
  try {
    db.close();
  } catch {
    exitCode = 1;
    console.error("[server] Nao foi possivel gravar o banco antes de encerrar.");
  }
  server.close(() => process.exit(exitCode));
  // Conexoes keep-alive ociosas nao devem segurar o encerramento.
  if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
// No Windows nao da para enviar sinais a um processo filho: os testes e2e
// pedem o encerramento pela mensagem IPC "shutdown".
if (typeof process.send === "function") {
  process.on("message", (msg) => {
    if (msg === "shutdown") shutdown("mensagem shutdown");
  });
}
// Ultima chance de gravar pendencias (flush e sincrono e idempotente).
process.on("exit", () => {
  try {
    db.flush();
  } catch { /* ja registrado em flush() */ }
});
