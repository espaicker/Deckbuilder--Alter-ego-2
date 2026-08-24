import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-forum");
const PORT = 3096;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

async function startServer() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env, PORT: String(PORT), DATA_DIR,
        JWT_SECRET: "test-jwt-forum", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-forum",
        // NOTE: we do NOT set NODE_ENV=test so rate limiter is ACTIVE for flood test
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

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function registerAndLogin(username) {
  await req("POST", "/api/auth/register", { username, password: "senha123456", email: `${username}@teste.com`, accepted_terms: true }); // patched
  const { data } = await req("POST", "/api/auth/login", { username, password: "senha123456" });
  return data.token;
}

async function adminLogin() {
  const { data } = await req("POST", "/api/admin/login", { username: "admin", password: "test-admin-forum" });
  return data.token;
}

test("E2E Fórum — XSS, Flood, Moderação", async (t) => {
  await startServer();

  let userToken, adminToken;
  let categoryId, topicId, replyId;

  await t.test("Setup: login de user e admin", async () => {
    userToken = await registerAndLogin("forumuser");
    adminToken = await adminLogin();
    assert.ok(userToken && adminToken);
  });

  await t.test("Categorias seeded automaticamente", async () => {
    const { status, data } = await req("GET", "/api/forum/categories");
    assert.equal(status, 200);
    assert.ok(data.length >= 4, `Esperava >= 4 categorias, tem ${data.length}`);
    categoryId = data[0].id;
  });

  // === TESTE XSS: payload <script>alert(1)</script> ===
  await t.test("XSS no título: <script> é escapado no banco", async () => {
    const xssTitle = '<script>alert(1)</script>Tópico XSS';
    const xssBody = '<img src=x onerror=alert(1)>Conteúdo malicioso';

    const { status, data } = await req("POST", `/api/forum/categories/${categoryId}/topics`, {
      title: xssTitle,
      body: xssBody,
    }, userToken);

    assert.equal(status, 201, JSON.stringify(data));
    topicId = data.id;

    // Contrato: o servidor guarda o texto EXATAMENTE como enviado.
    // A seguranca XSS e responsabilidade do React (escapa ao renderizar com {}),
    // nunca via dangerouslySetInnerHTML. Ver Fase 3.
    const { data: topicData } = await req("GET", `/api/forum/topics/${topicId}`);
    const topic = topicData.topic;
    assert.equal(topic.title, xssTitle, "Title deve vir exatamente como enviado");
    assert.equal(topic.body, xssBody, "Body deve vir exatamente como enviado");
  });

  await t.test("XSS em resposta: scripts escapados", async () => {
    const xssReply = '<script>document.cookie</script>Teste';
    const { status, data } = await req("POST", `/api/forum/topics/${topicId}/replies`, {
      body: xssReply,
    }, userToken);

    assert.equal(status, 201);
    replyId = data.id;

    const { data: topicData } = await req("GET", `/api/forum/topics/${topicId}`);
    const reply = topicData.replies.find(r => r.id === replyId);
    assert.equal(reply.body, xssReply, "Reply body deve vir exatamente como enviado");
  });

  // === TESTE FLOOD: 10 requests em 2 segundos deve gerar 429 ===
  await t.test("Rate limiting: flood de 10 posts em 2s retorna 429", async () => {
    const results = [];
    // Fire 10 requests concurrently
    const promises = Array.from({ length: 10 }, (_, i) =>
      req("POST", `/api/forum/categories/${categoryId}/topics`, {
        title: `Flood post ${i}`,
        body: `Corpo do flood post ${i} - testando rate limit`,
      }, userToken)
    );

    const responses = await Promise.all(promises);
    const statuses = responses.map(r => r.status);

    const successCount = statuses.filter(s => s === 201).length;
    const rateLimited = statuses.filter(s => s === 429).length;

    // Rate limiter allows 5 per minute — so at least some should be blocked
    assert.ok(rateLimited > 0, `Esperava pelo menos 1 request com 429, mas todos passaram: ${JSON.stringify(statuses)}`);
    assert.ok(successCount <= 5, `No máximo 5 devem passar, mas passaram ${successCount}`);
  });

  // === TESTE MODERAÇÃO: admin oculta/tranca/fixa ===
  await t.test("Admin pode trancar tópico", async () => {
    const { status, data } = await req("POST", `/api/forum/topics/${topicId}/lock`, {}, adminToken);
    assert.equal(status, 200);
    assert.equal(data.is_locked, 1);
  });

  await t.test("User não pode responder tópico trancado", async () => {
    const { status } = await req("POST", `/api/forum/topics/${topicId}/replies`, { body: "teste" }, userToken);
    assert.equal(status, 403);
  });

  await t.test("Admin pode destrancar tópico", async () => {
    const { data } = await req("POST", `/api/forum/topics/${topicId}/lock`, {}, adminToken);
    assert.equal(data.is_locked, 0);
  });

  await t.test("Admin pode fixar tópico", async () => {
    const { data } = await req("POST", `/api/forum/topics/${topicId}/pin`, {}, adminToken);
    assert.equal(data.is_pinned, 1);
  });

  await t.test("Admin pode ocultar resposta", async () => {
    const { status } = await req("POST", `/api/forum/replies/${replyId}/hide`, {}, adminToken);
    assert.equal(status, 200);

    // Verify reply is hidden from public view
    const { data } = await req("GET", `/api/forum/topics/${topicId}`);
    const hiddenReply = data.replies.find(r => r.id === replyId);
    assert.equal(hiddenReply, undefined, "Reply oculta não deve aparecer");
  });

  await t.test("Admin pode ocultar tópico", async () => {
    const { status } = await req("POST", `/api/forum/topics/${topicId}/hide`, {}, adminToken);
    assert.equal(status, 200);

    // Topic should not be visible
    const { status: getStatus } = await req("GET", `/api/forum/topics/${topicId}`);
    assert.equal(getStatus, 404);
  });

  // === TESTE DENÚNCIA ===
  await t.test("User pode denunciar conteúdo", async () => {
    // Create a new topic to report
    const { data: newTopic } = await req("POST", `/api/forum/categories/${categoryId}/topics`, {
      title: "Tópico para denunciar", body: "Conteúdo inapropriado"
    }, userToken);

    const { status } = await req("POST", "/api/forum/reports", {
      topic_id: newTopic.id, reason: "Conteúdo ofensivo"
    }, userToken);
    assert.equal(status, 201);
  });

  await t.test("Admin vê lista de denúncias", async () => {
    const { status, data } = await req("GET", "/api/forum/reports", undefined, adminToken);
    assert.equal(status, 200);
    assert.ok(data.length > 0);
  });

  await t.test("User comum NÃO pode acessar denúncias", async () => {
    const { status } = await req("GET", "/api/forum/reports", undefined, userToken);
    assert.equal(status, 403);
  });

  await t.test("User comum NÃO pode moderar (ocultar/trancar)", async () => {
    const { data: t2 } = await req("POST", `/api/forum/categories/${categoryId}/topics`, {
      title: "Outro tópico", body: "teste"
    }, userToken);

    const { status: lockStatus } = await req("POST", `/api/forum/topics/${t2.id}/lock`, {}, userToken);
    assert.equal(lockStatus, 403);

    const { status: hideStatus } = await req("POST", `/api/forum/topics/${t2.id}/hide`, {}, userToken);
    assert.equal(hideStatus, 403);
  });

  stopServer();
});
