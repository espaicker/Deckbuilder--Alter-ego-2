import initSqlJs from "sql.js";
import { readFileSync, existsSync } from "fs";
import { basename, dirname } from "path";
// DATA_DIR (ver server/lib/paths.js) permite apontar o banco para um disco
// persistente em produção (ex: o disco do Render montado em /data). Sem essa
// variável, usa a própria pasta server/.
import { DB_PATH } from "./lib/paths.js";
import { writeFileAtomicSync, cleanupStaleTemps } from "./lib/atomicWrite.js";

const DEFAULT_SAVE_DELAY_MS = 250;
const RETRY_DELAY_MS = 5000;

function resolveSaveDelay(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_SAVE_DELAY_MS;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SAVE_DELAY_MS;
}

/**
 * Wrapper que expõe a mesma API do better-sqlite3 usando sql.js.
 * Evita compilação nativa — funciona em qualquer Windows sem Build Tools.
 *
 * Persistência: o banco vive em memória e as leituras veem cada escrita na
 * hora. A gravação em disco é agrupada (debounce): exec()/run() só marcam o
 * banco como "sujo" e um único timer grava o arquivo inteiro, de forma
 * atômica, no fim da janela (DB_SAVE_DELAY_MS, padrão 250 ms). flush() grava
 * na hora (encerramento, backup, testes).
 *
 * A gravação é síncrona de propósito: bloqueia o event loop no máximo uma vez
 * por janela (e não mais uma vez por comando) e evita corridas entre gravações
 * assíncronas concorrentes e o flush de encerramento.
 */
class DbWrapper {
  constructor(db, { dbPath = DB_PATH, saveDelayMs } = {}) {
    this._db = db;
    this._dbPath = dbPath;
    this._saveDelayMs = resolveSaveDelay(saveDelayMs);
    this._dirty = false;
    this._timer = null;
  }

  exec(sql) {
    this._db.run(sql);
    this._markDirty();
  }

  prepare(sql) {
    return new StatementWrapper(this, sql);
  }

  pragma(pragma) {
    this._db.run(`PRAGMA ${pragma}`);
  }

  /**
   * Grava as alterações pendentes no disco (síncrono e idempotente).
   * Retorna true se gravou, false se não havia nada pendente. Em erro, mantém
   * as alterações pendentes, agenda nova tentativa e relança o erro para quem
   * chamou explicitamente (o timer de debounce só registra no log).
   */
  flush() {
    if (!this._dirty) return false;
    this._clearTimer();
    try {
      const data = this._db.export();
      writeFileAtomicSync(this._dbPath, data);
      this._dirty = false;
      return true;
    } catch (err) {
      console.error(`[db] Falha ao gravar o banco em disco (${err?.code || "erro desconhecido"}). Nova tentativa em ${RETRY_DELAY_MS / 1000} s.`);
      this._schedule(RETRY_DELAY_MS);
      throw err;
    }
  }

  /** Cópia consistente do banco (inclui escritas ainda não gravadas). */
  serialize() {
    this.flush();
    return this._db.export();
  }

  /** Cancela o timer pendente e grava o que faltar. */
  close() {
    this._clearTimer();
    return this.flush();
  }

  _markDirty() {
    this._dirty = true;
    this._schedule(this._saveDelayMs);
  }

  _schedule(delayMs) {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      try {
        this.flush();
      } catch {
        // Já registrado em flush(); uma nova tentativa foi agendada.
      }
    }, delayMs);
    if (typeof this._timer.unref === "function") this._timer.unref();
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _scalar(sql) {
    const res = this._db.exec(sql);
    return res.length > 0 ? res[0].values[0][0] : 0;
  }
}

// Comandos que podem inserir linhas (e portanto definem lastInsertRowid).
const INSERT_RE = /^\s*(?:INSERT|REPLACE)\b/i;

class StatementWrapper {
  constructor(wrapper, sql) {
    this._wrapper = wrapper;
    this._sql = sql;
  }

  all(...params) {
    const stmt = this._wrapper._db.prepare(this._sql);
    if (params.length > 0) stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  get(...params) {
    const stmt = this._wrapper._db.prepare(this._sql);
    if (params.length > 0) stmt.bind(params);
    let result = undefined;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  run(...params) {
    const wrapper = this._wrapper;
    // Antes do debounce, cada run() terminava com export(), que reabre o banco
    // e zera changes/last_insert_rowid da conexão. Para devolver exatamente os
    // mesmos valores de antes, os dois são calculados só sobre ESTE comando:
    // sem alteração de linhas -> changes 0; lastInsertRowid só para INSERT que
    // inseriu (senão 0).
    const totalBefore = wrapper._scalar("SELECT total_changes()");
    const stmt = wrapper._db.prepare(this._sql);
    try {
      if (params.length > 0) stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
    const modified = wrapper._scalar("SELECT total_changes()") !== totalBefore;
    const changes = modified ? wrapper._db.getRowsModified() : 0;
    const lastInsertRowid = modified && INSERT_RE.test(this._sql) ? wrapper._scalar("SELECT last_insert_rowid()") : 0;
    wrapper._markDirty();
    return { changes, lastInsertRowid };
  }
}

/**
 * Abre (ou cria) o banco e aplica o schema/migrações.
 * Parâmetros opcionais para testes: { dbPath, saveDelayMs }. Sem argumentos,
 * usa DATA_DIR/deckbuilder.db e DB_SAVE_DELAY_MS (padrão 250 ms).
 */
export async function initDb({ dbPath = DB_PATH, saveDelayMs = process.env.DB_SAVE_DELAY_MS } = {}) {
  const SQL = await initSqlJs();

  // Temporários deixados por um processo que caiu no meio de uma gravação.
  cleanupStaleTemps(dirname(dbPath), basename(dbPath));

  let db;
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  const wrapper = new DbWrapper(db, { dbPath, saveDelayMs });

  wrapper.pragma("foreign_keys = ON");

  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS community_decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      alter_ego_id TEXT NOT NULL,
      main_deck TEXT NOT NULL,
      drop_pile TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_community_decks_user
      ON community_decks(user_id);
    CREATE INDEX IF NOT EXISTS idx_community_decks_alter_ego
      ON community_decks(alter_ego_id);

    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      format TEXT NOT NULL CHECK (format IN ('swiss', 'swiss_topcut', 'single_elim')),
      top_cut_size INTEGER,
      round_count INTEGER,
      current_round INTEGER NOT NULL DEFAULT 0,
      max_players INTEGER,
      organizer_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'inscricao'
        CHECK (status IN ('inscricao','em_andamento','finalizado','cancelado')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tournament_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      dropped INTEGER NOT NULL DEFAULT 0,
      had_bye INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (deck_id) REFERENCES community_decks(id) ON DELETE CASCADE,
      UNIQUE (tournament_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tournament_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL,
      round_number INTEGER NOT NULL,
      stage TEXT NOT NULL DEFAULT 'swiss' CHECK (stage IN ('swiss','topcut')),
      status TEXT NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento','finalizado')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tournament_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL,
      round_id INTEGER NOT NULL,
      bracket_slot INTEGER,
      table_number INTEGER,
      player1_id INTEGER,
      player2_id INTEGER,
      result TEXT NOT NULL DEFAULT 'pending'
        CHECK (result IN ('pending','player1','player2','draw','bye')),
      reported_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
      FOREIGN KEY (round_id) REFERENCES tournament_rounds(id) ON DELETE CASCADE,
      FOREIGN KEY (player1_id) REFERENCES tournament_players(id) ON DELETE CASCADE,
      FOREIGN KEY (player2_id) REFERENCES tournament_players(id) ON DELETE CASCADE,
      FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tournament_players_tournament
      ON tournament_players(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_tournament_rounds_tournament
      ON tournament_rounds(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_tournament_matches_round
      ON tournament_matches(round_id);
    CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament
      ON tournament_matches(tournament_id);

    CREATE TABLE IF NOT EXISTS point_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tournament_id INTEGER NOT NULL,
      points_awarded INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_point_history_user
      ON point_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_point_history_tournament
      ON point_history(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_point_history_user_points
      ON point_history(user_id, points_awarded);
  `);

  // Forum tables
  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS forum_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS forum_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      last_reply_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES forum_categories(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS forum_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (topic_id) REFERENCES forum_topics(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS forum_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      topic_id INTEGER,
      reply_id INTEGER,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','resolvido','rejeitado')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES forum_topics(id) ON DELETE SET NULL,
      FOREIGN KEY (reply_id) REFERENCES forum_replies(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_forum_topics_category ON forum_topics(category_id);
    CREATE INDEX IF NOT EXISTS idx_forum_topics_author ON forum_topics(author_id);
    CREATE INDEX IF NOT EXISTS idx_forum_replies_topic ON forum_replies(topic_id);
    CREATE INDEX IF NOT EXISTS idx_forum_reports_status ON forum_reports(status);
  `);

  // Seed default categories if empty
  const catCount = wrapper.prepare("SELECT COUNT(*) AS cnt FROM forum_categories").get();
  if (catCount && catCount.cnt === 0) {
    wrapper.prepare("INSERT INTO forum_categories (name, description, sort_order) VALUES (?, ?, ?)").run("Geral", "Discussões gerais sobre o jogo", 1);
    wrapper.prepare("INSERT INTO forum_categories (name, description, sort_order) VALUES (?, ?, ?)").run("Estratégia", "Dicas de deck building e combos", 2);
    wrapper.prepare("INSERT INTO forum_categories (name, description, sort_order) VALUES (?, ?, ?)").run("Torneios", "Discussões sobre torneios e competições", 3);
    wrapper.prepare("INSERT INTO forum_categories (name, description, sort_order) VALUES (?, ?, ?)").run("Bug Reports", "Reporte problemas encontrados", 4);
  }

  // Migration: add bio and avatar_url columns if missing
  try {
    wrapper.exec("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''");
  } catch (e) { /* already exists */ }
  try {
    wrapper.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL");
  } catch (e) { /* already exists */ }

  // Migration: add email column if missing (safe for existing DBs)
  try {
    const cols = wrapper.prepare("PRAGMA table_info(users)").all();
    const hasEmail = cols.some((col) => col.name === "email");
    if (!hasEmail) {
      wrapper.exec("ALTER TABLE users ADD COLUMN email TEXT");
    }
  } catch (e) { /* ignore */ }

  // Migration: sideboard (ate 15 cartas extras) em decks publicados
  try {
    const cols = wrapper.prepare("PRAGMA table_info(community_decks)").all();
    if (!cols.some((col) => col.name === "sideboard")) {
      wrapper.exec("ALTER TABLE community_decks ADD COLUMN sideboard TEXT NOT NULL DEFAULT '{}'");
    }
  } catch (e) { /* ignore */ }

  // Migration: add terms_accepted_at (LGPD - evidencia de consentimento, Fase 9)
  try {
    const cols = wrapper.prepare("PRAGMA table_info(users)").all();
    if (!cols.some((col) => col.name === "terms_accepted_at")) {
      wrapper.exec("ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER");
    }
  } catch (e) { /* ignore */ }

  // Migration: add is_judge column if missing
  try {
    const cols = wrapper.prepare("PRAGMA table_info(users)").all();
    if (!cols.some((col) => col.name === "is_judge")) {
      wrapper.exec("ALTER TABLE users ADD COLUMN is_judge INTEGER NOT NULL DEFAULT 0");
    }
  } catch (e) { /* ignore */ }

  // Migration: add override tracking columns to tournament_matches
  try {
    const cols = wrapper.prepare("PRAGMA table_info(tournament_matches)").all();
    if (!cols.some((col) => col.name === "overridden_by_user_id")) {
      wrapper.exec("ALTER TABLE tournament_matches ADD COLUMN overridden_by_user_id INTEGER");
    }
    if (!cols.some((col) => col.name === "override_reason")) {
      wrapper.exec("ALTER TABLE tournament_matches ADD COLUMN override_reason TEXT");
    }
  } catch (e) { /* ignore */ }

  // Lojas parceiras (Fase 7)
  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      address TEXT,
      contact_info TEXT,
      owner_user_id INTEGER NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_stores_approved ON stores(approved);
    CREATE INDEX IF NOT EXISTS idx_stores_owner ON stores(owner_user_id);
  `);

  // Migration: add store_id to tournaments (nullable)
  try {
    const cols = wrapper.prepare("PRAGMA table_info(tournaments)").all();
    if (!cols.some((col) => col.name === "store_id")) {
      wrapper.exec("ALTER TABLE tournaments ADD COLUMN store_id INTEGER");
    }
  } catch (e) { /* ignore */ }

  // Artigos / noticias (Fase 8) — conteudo publicado so por admin
  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      body TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      author_user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      published_at INTEGER,
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published, published_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
  `);

  // Password reset tokens (armazena apenas o HASH do token, nunca o token puro)
  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
  `);

  // Migration: add is_official column if missing
  try {
    wrapper.exec("ALTER TABLE tournaments ADD COLUMN is_official INTEGER NOT NULL DEFAULT 0");
  } catch (e) {
    // Column already exists — ignore
  }

  // Migration: versão da sessão (revogação de tokens após troca/redefinição de
  // senha ou exclusão de conta). Tokens sem claim "tv" valem como 0.
  try {
    const cols = wrapper.prepare("PRAGMA table_info(users)").all();
    if (!cols.some((col) => col.name === "token_version")) {
      wrapper.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
    }
  } catch (e) { /* ignore */ }

  // Flush forçado ao fim da inicialização: garante que o arquivo exista após o
  // boot (como antes) e mantém o estado efetivo dos PRAGMAs determinístico.
  // O export() do sql.js fecha e reabre o banco, o que reinicia os PRAGMAs:
  // "foreign_keys = ON" lá em cima vale só durante a criação do schema e, a
  // partir daqui, foreign_keys fica efetivamente 0 em runtime — exatamente
  // como antes do debounce (quando todo exec() fazia export()). Ligar as FKs
  // de verdade é trabalho futuro (há inserts que dependem disso, ex.: artigos
  // do admin com author_user_id 0).
  wrapper._dirty = true;
  wrapper.flush();

  return wrapper;
}
