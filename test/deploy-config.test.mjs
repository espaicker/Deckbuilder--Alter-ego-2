// Bug 1.1 / Esperado 2.1, 2.13: o blueprint do Render precisa de plano pago com
// disco persistente em /data, DATA_DIR=/data e TRUST_PROXY configurado.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RENDER_YAML = readFileSync(join(PROJECT_ROOT, "render.yaml"), "utf-8");

function envValue(key) {
  const re = new RegExp(`-\\s*key:\\s*${key}\\s*\\r?\\n\\s*value:\\s*["']?([^"'\\r\\n#]+?)["']?\\s*(?:#.*)?\\r?$`, "m");
  const match = RENDER_YAML.match(re);
  return match ? match[1].trim() : null;
}

test("render.yaml: plano pago Starter (disco persistente exige plano pago)", () => {
  const plan = RENDER_YAML.match(/^\s*plan:\s*([^\s#]+)/m)?.[1] ?? null;
  assert.equal(plan, "starter", `plano atual: ${plan}`);
});

test("render.yaml: disco persistente montado em /data", () => {
  assert.match(RENDER_YAML, /^\s*disk:\s*$/m, "bloco disk ausente");
  assert.match(RENDER_YAML, /mountPath:\s*["']?\/data["']?\s*$/m, "mountPath /data ausente");
});

test("render.yaml: DATA_DIR=/data", () => {
  assert.equal(envValue("DATA_DIR"), "/data");
});

test("render.yaml: TRUST_PROXY definido", () => {
  assert.notEqual(envValue("TRUST_PROXY"), null, "TRUST_PROXY ausente");
});
