// Pre-carregamento (`node --import <url deste arquivo> ...`) que registra
// todas as escritas em disco feitas pelo processo, para os testes de
// preservacao verificarem QUEM gravou o que (sem depender de comparar
// listagens de pastas, que outros testes alteram em paralelo).
//
// Variaveis de ambiente:
// - FS_TRACE_FILE: arquivo (JSON por linha) onde as operacoes sao registradas.
// - FS_TRACE_BLOCK=1: bloqueia as escritas (lanca EACCES) em vez de executa-las.
// - FS_TRACE_PROBES=1: registra tambem consultas/leituras por caminho
//   (existsSync, readFileSync, statSync, accessSync).
//
// Cobre a API de `node:fs` (sincrona, callback e promises), inclusive imports
// nomeados ESM (`import { writeFileSync } from "fs"`) via syncBuiltinESMExports.
// Este arquivo nao define testes; `node --test` apenas o carrega.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = process.env.FS_TRACE_FILE;
const BLOCK = process.env.FS_TRACE_BLOCK === "1";
const PROBES = process.env.FS_TRACE_PROBES === "1";

if (LOG) {
  const originalAppend = fs.appendFileSync;
  let busy = false;

  const toPath = (p) => {
    if (typeof p === "string") return resolve(p);
    if (p instanceof URL) return resolve(fileURLToPath(p));
    if (Buffer.isBuffer(p)) return resolve(p.toString());
    return null; // descritor numerico: o caminho ja foi registrado no open
  };

  const record = (entry) => {
    busy = true;
    try {
      originalAppend.call(fs, LOG, JSON.stringify(entry) + "\n");
    } finally {
      busy = false;
    }
  };

  const READ_ONLY_FLAGS = new Set(["r", "rs", "sr"]);
  const isWriteFlag = (flags) => {
    if (flags === undefined || flags === null || typeof flags === "function") return false;
    if (typeof flags === "number") {
      const c = fs.constants;
      return (flags & (c.O_WRONLY | c.O_RDWR | c.O_CREAT | c.O_TRUNC | c.O_APPEND)) !== 0;
    }
    return !READ_ONLY_FLAGS.has(String(flags));
  };

  // nome -> indices dos argumentos que sao caminhos de destino
  const WRITE_OPS = {
    writeFile: [0], appendFile: [0], mkdir: [0], mkdtemp: [0], rm: [0], rmdir: [0],
    unlink: [0], rename: [0, 1], copyFile: [1], cp: [1], truncate: [0], symlink: [1], link: [1],
  };

  const blockedError = (op, paths) =>
    Object.assign(new Error(`EACCES: escrita bloqueada pelo teste (${op} ${paths.join(" -> ")})`), { code: "EACCES" });

  const pathsOf = (op, args) => {
    if (op === "open") return isWriteFlag(args[1]) ? [toPath(args[0])].filter(Boolean) : [];
    return (WRITE_OPS[op] || []).map((i) => toPath(args[i])).filter(Boolean);
  };

  const wrap = (target, name, op, style) => {
    const original = target[name];
    if (typeof original !== "function") return;
    target[name] = function traced(...args) {
      if (busy) return original.apply(this, args);
      const paths = pathsOf(op, args);
      if (paths.length === 0) return original.apply(this, args);
      record({ op: `${op}${style === "sync" ? "Sync" : style === "promise" ? "(promise)" : ""}`, paths, blocked: BLOCK });
      if (BLOCK) {
        const err = blockedError(op, paths);
        if (style === "sync") throw err;
        if (style === "promise") return Promise.reject(err);
        const cb = args.findLast((a) => typeof a === "function");
        if (cb) process.nextTick(cb, err);
        return undefined;
      }
      return original.apply(this, args);
    };
  };

  for (const op of [...Object.keys(WRITE_OPS), "open"]) {
    wrap(fs, `${op}Sync`, op, "sync");
    wrap(fs, op, op, "callback");
    if (fs.promises) wrap(fs.promises, op, op, "promise");
  }

  const originalCreateWriteStream = fs.createWriteStream;
  fs.createWriteStream = function tracedStream(path, ...rest) {
    const p = toPath(path);
    if (!busy && p) {
      record({ op: "createWriteStream", paths: [p], blocked: BLOCK });
      if (BLOCK) throw blockedError("createWriteStream", [p]);
    }
    return originalCreateWriteStream.call(this, path, ...rest);
  };

  if (PROBES) {
    for (const name of ["existsSync", "readFileSync", "statSync", "accessSync"]) {
      const original = fs[name];
      fs[name] = function tracedProbe(p, ...rest) {
        const resolved = toPath(p);
        if (!busy && resolved) record({ op: name, paths: [resolved], probe: true });
        return original.call(this, p, ...rest);
      };
    }
  }

  syncBuiltinESMExports();
}

/** Le o registro gerado por este helper (lista de { op, paths, blocked?, probe? }). */
export function readTrace(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
