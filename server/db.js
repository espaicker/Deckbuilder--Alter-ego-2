import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// DATA_DIR permite apontar o banco para um disco persistente em produção
// (ex: um Persistent Disk do Render montado em /data). Sem essa variável,
// usa a própria pasta server/ — funciona local, mas não sobrevive a
// redeploys/reinícios em serviços com sistema de arquivos efêmero.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = join(DATA_DIR, "deckbuilder.db");

/**
 * Wrapper que expõe a mesma API do better-sqlite3 usando sql.js.
 * Evita compilação nativa — funciona em qualquer Windows sem Build Tools.
 */
class DbWrapper {
  constructor(db) {
    this._db = db;
  }

  exec(sql) {
    this._db.run(sql);
    this._save();
  }

  prepare(sql) {
    return new StatementWrapper(this, sql);
  }

  pragma(pragma) {
    this._db.run(`PRAGMA ${pragma}`);
  }

  _save() {
    const data = this._db.export();
    writeFileSync(DB_PATH, Buffer.from(data));
  }
}

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
    const stmt = this._wrapper._db.prepare(this._sql);
    if (params.length > 0) stmt.bind(params);
    stmt.step();
    stmt.free();
    const changes = this._wrapper._db.getRowsModified();
    const lastIdResult = this._wrapper._db.exec("SELECT last_insert_rowid() as id");
    const lastInsertRowid = lastIdResult.length > 0 ? lastIdResult[0].values[0][0] : 0;
    this._wrapper._save();
    return { changes, lastInsertRowid };
  }
}

export async function initDb() {
  const SQL = await initSqlJs();

  let db;
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  const wrapper = new DbWrapper(db);

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
  `);

  return wrapper;
}
