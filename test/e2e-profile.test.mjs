import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { rmSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "server", ".test-data-profile");
const PORT = 3097;
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
        JWT_SECRET: "test-jwt-profile", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-admin-profile",
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

async function rawReq(method, path, headers, body) {
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test("E2E Perfil — segurança, sanitização e heurísticas", async (t) => {
  await startServer();

  let userToken;

  await t.test("Setup: registra um jogador", async () => {
    userToken = await registerAndLogin("testplayer");
    assert.ok(userToken);
  });

  // === TESTE 1: Vazamento de dados ===
  await t.test("Perfil público NÃO vaza password_hash ou dados sensíveis", async () => {
    const { status, data } = await req("GET", "/api/profile/testplayer");
    assert.equal(status, 200);
    // Must NOT contain sensitive fields
    const json = JSON.stringify(data);
    assert.ok(!json.includes("password_hash"), "Não deve conter password_hash");
    assert.ok(!json.includes("senha"), "Não deve conter senha");
    assert.ok(!data.password_hash, "Campo password_hash ausente");
    assert.ok(!data.email, "Campo email ausente");
    assert.ok(!data.id, "Campo id numérico ausente (expor user_id interno é risco)");
    // Must contain expected public fields
    assert.ok(data.username === "testplayer");
    assert.ok(typeof data.stats === "object");
    assert.ok(typeof data.heuristics === "object");
  });

  // === TESTE 2: Sanitização de upload (MIME-type real) ===
  await t.test("Rejeita arquivo HTML mascarado como imagem", async () => {
    // Create a fake "image" that is actually HTML
    const fakeHtml = Buffer.from("<html><script>alert('xss')</script></html>");
    const boundary = "----TestBoundary123";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="hack.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      fakeHtml,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const { status, data } = await rawReq("POST", "/api/profile/avatar", {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Authorization": `Bearer ${userToken}`,
    }, body);

    assert.equal(status, 400, `Deve rejeitar: ${JSON.stringify(data)}`);
    assert.ok(data.error.includes("inválido") || data.error.includes("invalid"), data.error);
  });

  await t.test("Rejeita arquivo sem magic bytes válidos", async () => {
    const randomBytes = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const boundary = "----TestBoundary456";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="fake.png"\r\nContent-Type: image/png\r\n\r\n`),
      randomBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const { status, data } = await rawReq("POST", "/api/profile/avatar", {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Authorization": `Bearer ${userToken}`,
    }, body);

    assert.equal(status, 400);
  });

  await t.test("Aceita JPEG real (magic bytes FF D8 FF)", async () => {
    // Minimal valid JPEG (just header, won't render but passes magic byte check)
    const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
    const boundary = "----TestBoundary789";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="real.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      jpegHeader,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const { status, data } = await rawReq("POST", "/api/profile/avatar", {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Authorization": `Bearer ${userToken}`,
    }, body);

    assert.equal(status, 200, JSON.stringify(data));
    assert.ok(data.avatar_url);
  });

  // === TESTE 3: Editar bio ===
  await t.test("Usuário pode editar sua bio", async () => {
    const { status, data } = await req("PUT", "/api/profile", { bio: "Jogador competitivo de Alter Ego!" }, userToken);
    assert.equal(status, 200);
    assert.equal(data.bio, "Jogador competitivo de Alter Ego!");
  });

  await t.test("Bio aparece no perfil público", async () => {
    const { data } = await req("GET", "/api/profile/testplayer");
    assert.equal(data.bio, "Jogador competitivo de Alter Ego!");
  });

  await t.test("Bio é truncada em 500 caracteres", async () => {
    const longBio = "A".repeat(1000);
    const { data } = await req("PUT", "/api/profile", { bio: longBio }, userToken);
    assert.equal(data.bio.length, 500);
  });

  // === TESTE 4: Heurística de estilo de jogo ===
  await t.test("Publica deck com 80%+ cartas ofensivas → estilo Agressivo", async () => {
    // Deck com maioria de cartas Ação (ofensivas)
    const aggressiveDeck = {
      "ACO-0001": 4, "ACO-0002": 4, "ACO-0003": 4, "ACO-0004": 4,  // Ação
      "ACO-0005": 4, "ACO-0006": 4, "ACO-0007": 4, "ACO-0008": 4,  // Ação
      "ACO-0009": 4, "ACO-0010": 4, "ACO-0011": 4,                  // Ação
      "REA-0001": 2, "TAB-0001": 4,                                  // Non-Ação (para chegar a 50)
    };
    const { status } = await req("POST", "/api/decks", {
      name: "Deck Super Agressivo",
      alter_ego_id: "AE-0001",
      main_deck: aggressiveDeck,
      drop_pile: { Vermelho: 7, Verde: 3 },
      description: "Deck focado em ataque",
    }, userToken);
    assert.equal(status, 201);

    // Check profile heuristics
    const { data } = await req("GET", "/api/profile/testplayer");
    // With a heavily offensive deck, should be "Agressivo" or "Ofensivo"
    assert.ok(
      data.heuristics.play_style === "Agressivo" || data.heuristics.play_style === "Ofensivo",
      `Estilo esperado Agressivo/Ofensivo, recebeu: ${data.heuristics.play_style} (ratio: ${data.heuristics.offensive_ratio}%)`
    );
    assert.ok(data.heuristics.offensive_ratio >= 60, `Ratio ofensivo deve ser >= 60%, recebeu: ${data.heuristics.offensive_ratio}%`);
  });

  // === TESTE 5: Perfil inexistente ===
  await t.test("Perfil de usuário inexistente retorna 404", async () => {
    const { status } = await req("GET", "/api/profile/usuario_fake_xyz");
    assert.equal(status, 404);
  });

  // === TESTE 6: Sem auth não pode editar ===
  await t.test("Sem autenticação não pode editar bio", async () => {
    const { status } = await req("PUT", "/api/profile", { bio: "hack" });
    assert.equal(status, 401);
  });

  await t.test("Sem autenticação não pode fazer upload de avatar", async () => {
    const boundary = "----NoAuth";
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"\r\n\r\ntest\r\n--${boundary}--\r\n`);
    const { status } = await rawReq("POST", "/api/profile/avatar", {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    }, body);
    assert.equal(status, 401);
  });

  stopServer();
});
