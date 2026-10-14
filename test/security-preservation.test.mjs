// Preservacao 3.10 (Property 11): para um mesmo cliente (sem X-Forwarded-For),
// os limites, o ponto em que o 429 aparece e as mensagens em pt-BR continuam
// iguais aos observados no codigo SEM a correcao. NODE_ENV=test continua
// desativando os limitadores.
//
// Baseline observado (express-rate-limit v8, server/middleware/rateLimit.js):
//   loginLimiter 10, registerLimiter 10, adminLoginLimiter 5, forumPostLimiter 5,
//   passwordResetLimiter 5, accountDeletionLimiter 5 requisicoes por janela;
//   a requisicao max+1 recebe 429 { error: <mensagem pt-BR> } com os cabecalhos
//   padrao RateLimit-Policy/RateLimit-Limit/RateLimit-Remaining/RateLimit-Reset
//   e sem os cabecalhos legados X-RateLimit-*.
//
// Cada execucao importa uma instancia nova do modulo (query string na URL),
// entao os contadores comecam do zero. O app minimo usa a configuracao de
// trust proxy do servidor: resolveTrustProxy(env) se server/middleware/security.js
// existir (codigo corrigido), senao o padrao atual do index.js (sem trust proxy).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { forAll, gen } from "./helpers/prop.mjs";

// `node --test` nao define NODE_ENV=test; garante limitadores ativos.
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
if (process.env.NODE_ENV === "test") delete process.env.NODE_ENV;

let security = null;
try {
  security = await import("../server/middleware/security.js");
} catch (err) {
  if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
}

const LIMITERS = {
  loginLimiter: { max: 10, message: "Muitas tentativas de login. Tente novamente em alguns minutos." },
  registerLimiter: { max: 10, message: "Muitas contas criadas a partir deste endereço. Tente novamente mais tarde." },
  adminLoginLimiter: { max: 5, message: "Muitas tentativas de login administrativo. Tente novamente em alguns minutos." },
  forumPostLimiter: { max: 5, message: "Muitas postagens em pouco tempo. Aguarde um momento antes de postar novamente." },
  passwordResetLimiter: { max: 5, message: "Muitas tentativas. Tente novamente em alguns minutos." },
  accountDeletionLimiter: { max: 5, message: "Muitas tentativas. Tente novamente em alguns minutos." },
};

let instance = 0;
async function freshLimiters({ nodeEnv } = {}) {
  const previous = process.env.NODE_ENV;
  if (nodeEnv) process.env.NODE_ENV = nodeEnv;
  else delete process.env.NODE_ENV;
  try {
    instance += 1;
    return await import(`../server/middleware/rateLimit.js?preservacao=${instance}`);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

function trustProxyFor(env) {
  return security ? security.resolveTrustProxy(env) : false;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function appWith(limiters, env) {
  const app = express();
  app.set("trust proxy", trustProxyFor(env));
  for (const name of Object.keys(LIMITERS)) {
    app.post(`/${name}`, limiters[name], (req, res) => res.json({ ok: true }));
  }
  return listen(app);
}

test("Property 11 (rate limit): mesmo cliente recebe 429 exatamente na requisicao max+1, com a mensagem pt-BR de hoje", async () => {
  await forAll(
    gen.record({
      limiter: gen.elements(Object.keys(LIMITERS)),
      extra: gen.int(1, 4),
      nodeEnv: gen.elements(["production", "development", undefined]),
    }),
    async ({ limiter, extra, nodeEnv }) => {
      const limiters = await freshLimiters({ nodeEnv });
      const env = nodeEnv ? { NODE_ENV: nodeEnv } : {};
      const server = await appWith(limiters, env);
      const { max, message } = LIMITERS[limiter];
      try {
        for (let i = 1; i <= max; i++) {
          const r = await request(server, `/${limiter}`);
          assert.equal(r.status, 200, `${limiter}: requisicao ${i}/${max} deveria passar`);
          assert.equal(r.headers["ratelimit-limit"], String(max), `${limiter}: RateLimit-Limit`);
          assert.equal(r.headers["ratelimit-remaining"], String(max - i), `${limiter}: RateLimit-Remaining`);
        }
        for (let j = 0; j < extra; j++) {
          const r = await request(server, `/${limiter}`);
          assert.equal(r.status, 429, `${limiter}: requisicao ${max + 1 + j} deveria ser bloqueada`);
          assert.deepEqual(JSON.parse(r.body), { error: message }, `${limiter}: corpo do 429`);
          assert.match(r.headers["content-type"] || "", /application\/json/);
          assert.equal(r.headers["ratelimit-remaining"], "0");
          assert.match(r.headers["ratelimit-policy"] || "", new RegExp(`^${max};w=\\d+$`));
          assert.ok(r.headers["ratelimit-reset"], "RateLimit-Reset presente");
          assert.equal(r.headers["x-ratelimit-limit"], undefined, "sem cabecalhos legados");
        }
      } finally {
        server.close();
      }
    },
    { runs: 18, seed: 0x0a7e11 },
  );
});

test("Limites independentes por limitador: estourar um nao bloqueia os outros para o mesmo cliente", async () => {
  const limiters = await freshLimiters({ nodeEnv: "production" });
  const server = await appWith(limiters, { NODE_ENV: "production" });
  try {
    for (let i = 0; i < LIMITERS.adminLoginLimiter.max + 1; i++) await request(server, "/adminLoginLimiter");
    assert.equal((await request(server, "/adminLoginLimiter")).status, 429);
    assert.equal((await request(server, "/loginLimiter")).status, 200, "loginLimiter herdou o bloqueio do adminLoginLimiter");
    assert.equal((await request(server, "/forumPostLimiter")).status, 200);
  } finally {
    server.close();
  }
});

test("NODE_ENV=test continua desativando os limitadores", async () => {
  const limiters = await freshLimiters({ nodeEnv: "test" });
  const server = await appWith(limiters, { NODE_ENV: "test" });
  try {
    for (const [name, { max }] of Object.entries(LIMITERS)) {
      for (let i = 0; i < max + 3; i++) {
        const r = await request(server, `/${name}`);
        assert.equal(r.status, 200, `${name} bloqueou com NODE_ENV=test (requisicao ${i + 1})`);
      }
    }
  } finally {
    server.close();
  }
});

after(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});
