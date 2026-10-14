import { existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { resolvePaths } from "./paths.js";
import { writeFileAtomicSync } from "./atomicWrite.js";

/**
 * Snapshots periodicos do banco em DATA_DIR/backups, com rotacao.
 *
 * Os snapshots ficam no mesmo disco do banco: protegem contra corrupcao e
 * exclusao acidental, nao contra a perda do disco. Para uma copia externa,
 * o admin baixa o banco em GET /api/admin/backup.
 */
export const SNAPSHOT_RE = /^deckbuilder-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;

const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_KEEP = 7;
const HOUR_MS = 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** "deckbuilder-AAAAMMDDTHHMMSSZ.db" (UTC: a ordem lexicografica e a cronologica). */
export function snapshotFileName(now = new Date()) {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "");
  return `deckbuilder-${stamp}Z.db`;
}

function snapshotTime(name) {
  const m = name.match(SNAPSHOT_RE);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

function listSnapshots(backupsDir) {
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir).filter((name) => SNAPSHOT_RE.test(name)).sort();
}

/** Apaga os snapshots mais antigos alem de `keep`. Nunca toca em outros arquivos. */
export function rotateSnapshots(backupsDir, keep) {
  const snapshots = listSnapshots(backupsDir);
  const excess = snapshots.slice(0, Math.max(0, snapshots.length - Math.max(1, keep)));
  for (const name of excess) {
    try {
      unlinkSync(join(backupsDir, name));
    } catch (err) {
      console.warn(`[backup] Nao foi possivel apagar o snapshot antigo ${name} (${err.code || "erro"}).`);
    }
  }
  return excess;
}

/**
 * Grava um snapshot consistente do banco (db.serialize() inclui escritas
 * ainda nao gravadas em disco) e aplica a rotacao.
 */
export function createSnapshot(db, { backupsDir, keep = DEFAULT_KEEP, now = new Date() } = {}) {
  if (!backupsDir) throw new Error("backupsDir e obrigatorio.");
  mkdirSync(backupsDir, { recursive: true });
  const target = join(backupsDir, snapshotFileName(now));
  writeFileAtomicSync(target, db.serialize());
  rotateSnapshots(backupsDir, keep);
  return target;
}

function parseNumber(raw, { name, fallback, min }) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    console.warn(`[backup] AVISO: ${name}="${raw}" invalido; usando ${fallback}.`);
    return fallback;
  }
  return n;
}

/**
 * Configuracao dos backups a partir do ambiente:
 * - BACKUP_ENABLED: padrao ligado; desligado com NODE_ENV=test, a nao ser que
 *   BACKUP_ENABLED=1|true. "0"/"false" desliga.
 * - BACKUP_INTERVAL_HOURS: padrao 24; 0 desliga.
 * - BACKUP_KEEP: padrao 7, minimo 1.
 */
export function resolveBackupConfig(env = process.env) {
  const flag = String(env.BACKUP_ENABLED ?? "").trim().toLowerCase();
  let enabled;
  if (flag === "1" || flag === "true") enabled = true;
  else if (flag === "0" || flag === "false") enabled = false;
  else enabled = env.NODE_ENV !== "test";

  const intervalHours = parseNumber(env.BACKUP_INTERVAL_HOURS, { name: "BACKUP_INTERVAL_HOURS", fallback: DEFAULT_INTERVAL_HOURS, min: 0 });
  const keep = Math.floor(parseNumber(env.BACKUP_KEEP, { name: "BACKUP_KEEP", fallback: DEFAULT_KEEP, min: 1 }));
  if (intervalHours === 0) enabled = false;

  return {
    enabled,
    intervalMs: intervalHours * HOUR_MS,
    keep,
    backupsDir: resolvePaths(env).BACKUPS_DIR,
  };
}

/**
 * Agenda os snapshots. Como cada deploy reinicia o processo, um setInterval
 * de 24 h poderia nunca disparar: o primeiro snapshot sai em
 * max(0, intervalo - idade do ultimo snapshot) e depois a cada intervalo.
 * Timers com unref() (nao seguram o processo). Retorna stop().
 */
export function startBackupSchedule(db, config, { now = () => Date.now() } = {}) {
  if (!config || !config.enabled || !(config.intervalMs > 0)) return () => {};

  const { intervalMs, keep, backupsDir } = config;
  let timer = null;
  let stopped = false;

  const run = () => {
    if (stopped) return;
    try {
      const file = createSnapshot(db, { backupsDir, keep, now: new Date(now()) });
      console.log(`[backup] Snapshot do banco gravado (${file.split(/[\\/]/).pop()}).`);
    } catch (err) {
      console.error(`[backup] Falha ao gerar snapshot do banco (${err?.code || err?.message || "erro"}).`);
    }
    schedule(intervalMs);
  };

  const schedule = (delay) => {
    if (stopped) return;
    // setTimeout aceita no maximo ~24,8 dias; acima disso dispararia na hora.
    timer = setTimeout(run, Math.min(delay, MAX_TIMEOUT_MS));
    if (typeof timer.unref === "function") timer.unref();
  };

  const latest = listSnapshots(backupsDir).pop();
  const lastTime = latest ? snapshotTime(latest) : null;
  const age = lastTime === null ? Infinity : now() - lastTime;
  schedule(Math.max(0, Math.min(intervalMs, intervalMs - age)));

  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
