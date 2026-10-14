// Bugs 1.10 e 1.14 / Esperado 2.13, 2.18 (Property 7):
// - atras do proxy do Render, o rate limit precisa contar por IP real do
//   cliente (X-Forwarded-For), nao pelo IP do proxy;
// - em producao sem ALLOWED_ORIGINS, o CORS so libera a origem do site.
//
// Os apps minimos usam a configuracao do servidor: se server/middleware/security.js
// existir (codigo corrigido), usa resolveTrustProxy/resolveCorsOptions; senao,
// reproduz a configuracao atual de server/index.js (sem trust proxy, origin: true).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cors from "cors";
import { forAll, gen } from "./helpers/prop.mjs";

// `node --test` nao define NODE_ENV=test; garante limitadores ativos.
if (process.env.NODE_ENV === "test") delete process.env.NODE_ENV;
const { loginLimiter } = await import("../server/middleware/rateLimit.js");

let security = null;
try {
  security = await import("../server/middleware/security.js");
} catch (err) {
  if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
}

function trustProxyFor(env) {
  // Configuracao atual do index.js: nunca chama app.set("trust proxy", ...).
  return security ? security.resolveTrustProxy(env) : false;
}

function corsOptionsFor(env) {
  if (security) return security.resolveCorsOptions(env);
  // Configuracao atual do index.js.
  const origin = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()) : true;
  return { origin, credentials: true };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, { method = "GET", path = "/", headers = {} } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const octet = gen.int(1, 254);
const ipGen = gen.map(gen.array(octet, { min: 4, max: 4 }), (parts) => parts.join("."));

test("rate limit de login: segundo cliente atras do mesmo proxy nao herda o bloqueio do primeiro", async () => {
  const app = express();
  app.set("trust proxy", trustProxyFor({ NODE_ENV: "production" }));
  app.post("/login", loginLimiter, (req, res) => res.json({ ok: true, ip: req.ip }));
  const server = await listen(app);

  // Evita que execucoes diferentes reutilizem o mesmo IP (contador compartilhado).
  const usedIps = new Set();
  const pairGen = gen.map(gen.record({ a: ipGen, b: ipGen }), (p) => p);

  try {
    await forAll(pairGen, async ({ a, b }) => {
      if (a === b || usedIps.has(a) || usedIps.has(b)) return;
      usedIps.add(a);
      usedIps.add(b);

      for (let i = 0; i < 10; i++) {
        const r = await request(server, { method: "POST", path: "/login", headers: { "X-Forwarded-For": a } });
        assert.notEqual(r.status, 429, `cliente ${a} limitado cedo demais (tentativa ${i + 1})`);
      }
      const other = await request(server, { method: "POST", path: "/login", headers: { "X-Forwarded-For": b } });
      assert.notEqual(other.status, 429, `segundo cliente (${b}) recebeu 429 por causa das falhas de ${a}`);

      const eleventh = await request(server, { method: "POST", path: "/login", headers: { "X-Forwarded-For": a } });
      assert.equal(eleventh.status, 429, `cliente ${a} deveria estar limitado na 11a tentativa`);
    }, { runs: 8 });
  } finally {
    server.close();
  }
});

function allowOriginFor(env, origin) {
  const app = express();
  app.use(cors(corsOptionsFor(env)));
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));
  return listen(app).then(async (server) => {
    try {
      const headers = origin ? { Origin: origin } : {};
      const r = await request(server, { path: "/api/health", headers });
      return { status: r.status, allowOrigin: r.headers["access-control-allow-origin"] ?? null };
    } finally {
      server.close();
    }
  });
}

test("CORS em producao sem ALLOWED_ORIGINS nao reflete origem arbitraria", async () => {
  const env = { NODE_ENV: "production", SITE_URL: "https://forja.example" };
  const evil = await allowOriginFor(env, "https://site-malicioso.example");
  assert.equal(evil.allowOrigin, null, `origem maliciosa refletida: ${evil.allowOrigin}`);

  const own = await allowOriginFor(env, "https://forja.example");
  assert.equal(own.allowOrigin, "https://forja.example");

  const noOrigin = await allowOriginFor(env, null);
  assert.equal(noOrigin.status, 200, "requisicao sem Origin deve continuar funcionando");
});

const hostGen = gen.map(gen.array(gen.string({ min: 1, max: 8, alphabet: "abcdefghijklmnopqrstuvwxyz0123456789" }), { min: 1, max: 3 }), (labels) => labels.join(".") + ".example");
const originGen = gen.map(
  gen.record({ https: gen.bool(0.8), host: hostGen, port: gen.oneOf(gen.constant(null), gen.int(1024, 65000)) }),
  ({ https, host, port }) => `${https ? "https" : "http"}://${host}${port ? `:${port}` : ""}`,
);

test("Property 7 (CORS): em producao sem ALLOWED_ORIGINS, Allow-Origin so para SITE_URL/RENDER_EXTERNAL_URL", async () => {
  await forAll(
    gen.record({
      site: originGen,
      sitePath: gen.elements(["", "/", "/caminho", "/caminho/"]),
      render: gen.oneOf(gen.constant(null), originGen),
      other: originGen,
      pick: gen.elements(["site", "render", "other"]),
    }),
    async ({ site, sitePath, render, other, pick }) => {
      const env = { NODE_ENV: "production", SITE_URL: site + sitePath };
      if (render) env.RENDER_EXTERNAL_URL = render;
      const siteOrigins = new Set([new URL(site).origin, ...(render ? [new URL(render).origin] : [])]);
      const origin = pick === "site" ? new URL(site).origin : pick === "render" && render ? new URL(render).origin : other;

      const { allowOrigin } = await allowOriginFor(env, origin);
      if (siteOrigins.has(origin)) {
        assert.equal(allowOrigin, origin, `origem do site ${origin} deveria ser permitida`);
      } else {
        assert.equal(allowOrigin, null, `origem ${origin} refletida em producao (origens do site: ${[...siteOrigins].join(", ")})`);
      }
    },
    { runs: 40 },
  );
});
