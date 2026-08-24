import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-articles");
const PORT = 3091;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

async function startServer() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", ["server/index.js"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env, PORT: String(PORT), NODE_ENV: "test", DATA_DIR,
        JWT_SECRET: "test-jwt-articles", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-articles",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    serverProcess.stdout.on("data", (d) => { out += d.toString(); if (out.includes("Rodando em")) resolve(); });
    serverProcess.stderr.on("data", (d) => { out += d.toString(); });
    serverProcess.on("error", reject);
    setTimeout(() => { if (!out.includes("Rodando em")) reject(new Error("Timeout: " + out)); }, 10000);
  });
}
function stopServer() {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  rmSync(DATA_DIR, { recursive: true, force: true });
}
async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
async function registerAndLogin(username) {
  await req("POST", "/api/auth/register", { username, password: "senha123456", email: `${username}@teste.com` });
  const { data } = await req("POST", "/api/auth/login", { username, password: "senha123456" });
  return data;
}
async function adminLogin() {
  const { data } = await req("POST", "/api/admin/login", { username: "admin", password: "test-admin-articles" });
  return data.token;
}

test("E2E Conteudo recorrente (blog/noticias)", async (t) => {
  await startServer();

  let adminToken, user;
  let articleId, articleSlug;

  await t.test("Setup: admin + usuario comum", async () => {
    adminToken = await adminLogin();
    user = await registerAndLogin("leitor");
    assert.ok(adminToken && user.token);
  });

  await t.test("Usuario comum NAO cria artigo (so admin)", async () => {
    const { status } = await req("POST", "/api/admin/articles", { title: "Hack", body: "nope" }, user.token);
    assert.equal(status, 403);
  });

  await t.test("Admin cria artigo (rascunho, nao publicado)", async () => {
    const { status, data } = await req("POST", "/api/admin/articles", { title: "Bem-vindos a Forja", body: "Primeiro post de teste" }, adminToken);
    assert.equal(status, 201, JSON.stringify(data));
    articleId = data.id;
    articleSlug = data.slug;
    assert.equal(articleSlug, "bem-vindos-a-forja");
  });

  await t.test("Artigo NAO publicado nao aparece em GET /api/articles", async () => {
    const { data } = await req("GET", "/api/articles");
    assert.equal(data.find((a) => a.id === articleId), undefined);
  });

  await t.test("Artigo NAO publicado nao e acessivel por GET /api/articles/:slug", async () => {
    const { status } = await req("GET", `/api/articles/${articleSlug}`);
    assert.equal(status, 404);
  });

  await t.test("Usuario comum NAO edita nem publica (so admin)", async () => {
    const edit = await req("PATCH", `/api/admin/articles/${articleId}`, { title: "X" }, user.token);
    assert.equal(edit.status, 403);
    const pub = await req("POST", `/api/admin/articles/${articleId}/publish`, {}, user.token);
    assert.equal(pub.status, 403);
  });

  await t.test("Admin publica o artigo", async () => {
    const { status, data } = await req("POST", `/api/admin/articles/${articleId}/publish`, {}, adminToken);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.published, true);
  });

  await t.test("Depois de publicado, aparece na lista e no detalhe", async () => {
    const list = await req("GET", "/api/articles");
    const found = list.data.find((a) => a.id === articleId);
    assert.ok(found, "artigo publicado deve aparecer");
    assert.equal(found.author, "admin");
    const detail = await req("GET", `/api/articles/${articleSlug}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.title, "Bem-vindos a Forja");
  });

  await t.test("Slugs duplicados geram slug diferente (nao quebra UNIQUE)", async () => {
    const { status, data } = await req("POST", "/api/admin/articles", { title: "Bem-vindos a Forja", body: "outro corpo" }, adminToken);
    assert.equal(status, 201, JSON.stringify(data));
    assert.notEqual(data.slug, articleSlug);
    assert.equal(data.slug, "bem-vindos-a-forja-2");
  });

  await t.test("body com XSS sai sanitizado na resposta", async () => {
    const payload = "<script>alert('xss')</script> texto normal";
    const { data: created } = await req("POST", "/api/admin/articles", { title: "Post XSS", body: payload }, adminToken);
    await req("POST", `/api/admin/articles/${created.id}/publish`, {}, adminToken);
    const { data: detail } = await req("GET", `/api/articles/${created.slug}`);
    assert.ok(!detail.body.includes("<script>"), "nao deve conter <script> cru");
    assert.ok(detail.body.includes("&lt;script&gt;"), "deve conter script escapado");
  });

  await t.test("Admin despublica e artigo some da lista publica", async () => {
    await req("POST", `/api/admin/articles/${articleId}/unpublish`, {}, adminToken);
    const { data } = await req("GET", "/api/articles");
    assert.equal(data.find((a) => a.id === articleId), undefined);
  });

  await t.test("Admin apaga artigo", async () => {
    const { status } = await req("DELETE", `/api/admin/articles/${articleId}`, undefined, adminToken);
    assert.equal(status, 200);
    const { data: adminList } = await req("GET", "/api/admin/articles", undefined, adminToken);
    assert.equal(adminList.find((a) => a.id === articleId), undefined);
  });

  stopServer();
});
