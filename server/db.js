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
  `);

  const userColumns = new Set(
    wrapper.prepare("PRAGMA table_info(users)").all().map((column) => column.name)
  );
  const addUserColumn = (name, definition) => {
    if (!userColumns.has(name)) {
      wrapper.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
      userColumns.add(name);
    }
  };

  addUserColumn("email", "TEXT");
  addUserColumn("google_id", "TEXT");
  addUserColumn("avatar_url", "TEXT DEFAULT ''");
  addUserColumn("role", "TEXT NOT NULL DEFAULT 'player'");

  wrapper.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
      ON users(email)
      WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
      ON users(google_id)
      WHERE google_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_users_role
      ON users(role);
  `);

  return wrapper;
}
