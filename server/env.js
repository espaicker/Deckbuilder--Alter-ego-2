/**
 * Carrega o arquivo .env da raiz do projeto (se existir) ANTES de qualquer
 * outro modulo ler process.env. Precisa ser o primeiro import de index.js.
 *
 * - Variaveis ja definidas (painel do Render, linha de comando) tem prioridade.
 * - Valores vazios sao ignorados (o .env.example tem varias chaves vazias).
 * - Nos testes (NODE_ENV=test) nao carrega: o ambiente e controlado pelo
 *   proprio teste e nunca deve, por exemplo, enviar e-mail de verdade.
 */
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");

if (process.env.NODE_ENV !== "test" && existsSync(ENV_PATH)) {
  for (const raw of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
}
