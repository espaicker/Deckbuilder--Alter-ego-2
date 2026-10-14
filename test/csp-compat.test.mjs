// Caso de borda 1.15 / 3.12: os pop-ups de impressao (about:blank) herdam a
// CSP de quem os abriu. Com `script-src 'self'`, um <script> inline escrito via
// document.write seria bloqueado e a impressao automatica pararia. O HTML
// escrito nos pop-ups nao pode conter script inline.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Trechos de codigo entre window.open(...) e o document.close() seguinte. */
function popupRegions(source) {
  const regions = [];
  const openRe = /window\.open\(\s*["'`]{2}\s*,\s*["'`]_blank["'`]\s*\)/g;
  let match;
  while ((match = openRe.exec(source))) {
    const end = source.indexOf("document.close()", match.index);
    regions.push(source.slice(match.index, end === -1 ? undefined : end));
  }
  return regions;
}

// ---------------------------------------------------------------------------
// Preservacao 3.12 (Property 11): as paginas do build continuam compativeis com
// uma CSP estrita (script-src 'self'). Baseline observado no codigo sem correcao:
// index.html/admin.html (fonte e dist/) so tem <script type="module" src="...">,
// carregam CSS de https://fonts.googleapis.com (que puxa fontes de
// https://fonts.gstatic.com) e usam style="..." no <body>. Se o servidor enviar
// Content-Security-Policy (codigo corrigido), ela precisa permitir tudo isso.
// ---------------------------------------------------------------------------
const HTML_FILES = ["index.html", "admin.html"];
const DIST_DIR = join(PROJECT_ROOT, "dist");
const HAS_DIST = existsSync(join(DIST_DIR, "index.html"));

function scriptTags(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], body: m[2] }));
}

function externalOrigins(html) {
  const origins = new Set();
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) origins.add(new URL(m[1]).origin);
  return origins;
}

function assertNoInlineScripts(file, html) {
  const scripts = scriptTags(html);
  assert.ok(scripts.length > 0, `${file}: nenhum <script> encontrado`);
  for (const s of scripts) {
    assert.match(s.attrs, /\bsrc\s*=\s*["'][^"']+["']/, `${file}: <script> sem src (inline): <script${s.attrs}>`);
    assert.equal(s.body.trim(), "", `${file}: <script src> com conteudo inline`);
    const src = s.attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/)[1];
    assert.ok(src.startsWith("/"), `${file}: script de outra origem (${src}) nao e permitido por script-src 'self'`);
  }
  assert.ok(!/\son[a-z]+\s*=/i.test(html), `${file}: atributo de evento inline (onload=, onclick=...)`);
}

const BASELINE_EXTERNAL = ["https://fonts.googleapis.com"];
// O CSS do Google Fonts carrega os arquivos de fonte de fonts.gstatic.com.
const GOOGLE_FONTS_FILES_ORIGIN = "https://fonts.gstatic.com";

for (const file of HTML_FILES) {
  test(`${file} (fonte): sem <script> inline e origens externas = Google Fonts`, () => {
    const html = readFileSync(join(PROJECT_ROOT, file), "utf-8");
    assertNoInlineScripts(file, html);
    assert.deepEqual([...externalOrigins(html)].sort(), BASELINE_EXTERNAL);
  });

  test(`dist/${file}: sem <script> inline e origens externas = Google Fonts`, { skip: !HAS_DIST && "dist/ nao existe" }, () => {
    const html = readFileSync(join(DIST_DIR, file), "utf-8");
    assertNoInlineScripts(`dist/${file}`, html);
    assert.deepEqual([...externalOrigins(html)].sort(), BASELINE_EXTERNAL);
  });
}

function parseCsp(header) {
  const directives = new Map();
  for (const part of header.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), values);
  }
  return directives;
}

function sources(csp, directive) {
  return csp.get(directive) ?? csp.get("default-src") ?? null;
}

function allows(list, origin) {
  if (list === null) return true; // diretiva ausente e sem default-src: sem restricao
  if (list.includes("'none'")) return false;
  return list.includes("*") || list.includes(origin) || list.includes(new URL(origin).protocol);
}

test("CSP do servidor (se existir) permite scripts/estilos do build, Google Fonts, imagens e API", async () => {
  let security = null;
  try {
    security = await import("../server/middleware/security.js");
  } catch (err) {
    if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
  }
  const headers = {};
  if (security && typeof security.securityHeaders === "function") {
    for (const isProduction of [false, true]) {
      const res = { setHeader: (k, v) => { headers[`${isProduction}:${k.toLowerCase()}`] = String(v); }, set: (k, v) => { headers[`${isProduction}:${k.toLowerCase()}`] = String(v); } };
      await new Promise((resolve) => security.securityHeaders({ isProduction })({ headers: {}, path: "/" }, res, resolve));
    }
  }
  const policies = Object.entries(headers).filter(([k]) => k.endsWith(":content-security-policy")).map(([, v]) => v);
  if (policies.length === 0) return; // codigo sem correcao: nenhuma CSP enviada

  for (const header of policies) {
    const csp = parseCsp(header);
    const script = sources(csp, "script-src");
    assert.ok(script === null || script.includes("'self'") || script.includes("*"), `script-src nao permite 'self': ${header}`);
    const style = sources(csp, "style-src");
    assert.ok(allows(style, "https://fonts.googleapis.com"), `style-src bloqueia fonts.googleapis.com: ${header}`);
    assert.ok(style === null || style.includes("'self'"), `style-src nao permite o CSS do build: ${header}`);
    assert.ok(style === null || style.includes("'unsafe-inline'"), `style-src bloqueia style="..." do <body> e dos pop-ups: ${header}`);
    const font = sources(csp, "font-src");
    assert.ok(allows(font, GOOGLE_FONTS_FILES_ORIGIN), `font-src bloqueia fonts.gstatic.com: ${header}`);
    const img = sources(csp, "img-src");
    assert.ok(img === null || img.includes("'self'"), `img-src nao permite /assets/...: ${header}`);
    const connect = sources(csp, "connect-src");
    assert.ok(connect === null || connect.includes("'self'"), `connect-src nao permite a API: ${header}`);
  }
});

for (const file of ["src/App.jsx", "src/components/AdminPanel.jsx"]) {
  test(`${file}: HTML do pop-up de impressao nao contem <script> inline`, () => {
    const source = readFileSync(join(PROJECT_ROOT, file), "utf-8");
    const regions = popupRegions(source);
    assert.ok(regions.length > 0, `nenhum pop-up de impressao encontrado em ${file}`);
    for (const region of regions) {
      assert.ok(region.includes("document.write"), `pop-up em ${file} sem document.write`);
      // Pega tanto "<script>" quanto a forma concatenada '<' + 'script>'.
      const inline = region.match(/.{0,40}script>.{0,60}/i);
      assert.ok(!inline, `${file}: o HTML escrito no pop-up contem script inline (bloqueado por script-src 'self'): ${inline?.[0]}`);
    }
  });
}
