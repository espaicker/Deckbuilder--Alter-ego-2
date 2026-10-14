import fs from "fs";
import { basename, dirname, join } from "path";
import { randomBytes } from "crypto";

// No Windows, renomear sobre um arquivo existente pode falhar por alguns
// milissegundos quando antivirus/indexador esta com o arquivo aberto.
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 50;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === "string") return Buffer.from(data, "utf-8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

function tempPathFor(targetPath) {
  const unique = `${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}`;
  return join(dirname(targetPath), `.${basename(targetPath)}.${unique}.tmp`);
}

/**
 * Grava `data` em `targetPath` de forma atomica: escreve num temporario no
 * mesmo diretorio (mesmo sistema de arquivos), faz fsync e renomeia sobre o
 * destino. O destino fica sempre com a versao anterior completa ou com a
 * nova completa. Em qualquer falha o temporario e apagado e o erro relancado.
 *
 * `fsImpl` (padrao: node:fs) permite injetar falhas nos testes.
 */
export function writeFileAtomicSync(targetPath, data, { fsImpl = fs } = {}) {
  const buffer = toBuffer(data);
  const tmpPath = tempPathFor(targetPath);
  let fd = null;
  try {
    fd = fsImpl.openSync(tmpPath, "w");
    // do/while: mesmo um conteudo vazio passa por writeSync (comportamento uniforme).
    let offset = 0;
    do {
      offset += fsImpl.writeSync(fd, buffer, offset, buffer.length - offset);
    } while (offset < buffer.length);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = null;

    for (let attempt = 1; ; attempt++) {
      try {
        fsImpl.renameSync(tmpPath, targetPath);
        break;
      } catch (err) {
        if (attempt >= RENAME_ATTEMPTS || !RETRYABLE_RENAME_CODES.has(err.code)) throw err;
        sleepSync(RENAME_RETRY_DELAY_MS * attempt);
      }
    }
  } catch (err) {
    if (fd !== null) {
      try { fsImpl.closeSync(fd); } catch { /* ignore */ }
    }
    try { fsImpl.unlinkSync(tmpPath); } catch { /* temporario pode nem existir */ }
    throw err;
  }
}

/**
 * Remove temporarios `.<baseName>.*.tmp` deixados por um processo que caiu no
 * meio de uma gravacao. Nao toca em nenhum outro arquivo.
 */
export function cleanupStaleTemps(dir, baseName, { fsImpl = fs } = {}) {
  let names;
  try {
    names = fsImpl.readdirSync(dir);
  } catch {
    return [];
  }
  const prefix = `.${baseName}.`;
  const removed = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".tmp")) continue;
    try {
      fsImpl.unlinkSync(join(dir, name));
      removed.push(name);
    } catch { /* ignore */ }
  }
  return removed;
}
