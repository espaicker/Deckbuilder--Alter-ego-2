// Bug 1.15 / Esperado 2.19 (Property 7): toda resposta (API, estatico, 404)
// tem cabecalhos de seguranca; HSTS so em producao (aqui NODE_ENV=test).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-secheaders");
const PORT = 3082;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

function startServer() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env, PORT: String(PORT), NODE_ENV: "test", DATA_DIR,
        JWT_SECRET: "test-jwt-secheaders", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-secheaders",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    serverProcess.stdout.on("data", (d) => { output += d.toString(); if (output.includes("Rodando em")) resolve(); });
    serverProcess.stderr.on("data", (d) => { output += d.toString(); });
    serverProcess.on("error", reject);
    setTimeout(() => { if (!output.includes("Rodando em")) reject(new Error(`Timeout: ${output}`)); }, 10000);
  });
}

function stopServer() {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  rmSync(DATA_DIR, { recursive: true, force: true });
}

function assertSecurityHeaders(res, path) {
  const h = res.headers;
  assert.equal(h.get("x-content-type-options"), "nosniff", `${path}: sem X-Content-Type-Options: nosniff`);
  assert.equal(h.get("x-frame-options"), "DENY", `${path}: sem X-Frame-Options: DENY`);
  assert.ok(h.get("referrer-policy"), `${path}: sem Referrer-Policy`);
  const csp = h.get("content-security-policy");
  assert.ok(csp, `${path}: sem content-security-policy`);
  assert.match(csp, /frame-ancestors 'none'/, `${path}: CSP sem frame-ancestors 'none'`);
  assert.equal(h.get("strict-transport-security"), null, `${path}: HSTS nao deve ser enviado fora de producao`);
}

test("E2E Cabecalhos de seguranca", async (t) => {
  await startServer();
  try {
    for (const path of ["/api/health", "/assets/cards/ACA-0001.jpg", "/assets/cards/NAO-EXISTE-9999.jpg"]) {
      await t.test(`GET ${path} tem cabecalhos de seguranca`, async () => {
        const res = await fetch(`${BASE_URL}${path}`);
        await res.arrayBuffer();
        assertSecurityHeaders(res, path);
      });
    }
  } finally {
    stopServer();
  }
});
