import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, isSafeCardId, safeCardImagePath, escapeRegExp, truncateString } from "../src/lib/sanitize.js";

test("escapeHtml escapa todos os caracteres perigosos", () => {
  assert.equal(escapeHtml('<script>alert("xss")</script>'), "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
});

test("escapeHtml escapa aspas simples", () => {
  assert.equal(escapeHtml("it's a test"), "it&#x27;s a test");
});

test("escapeHtml escapa &", () => {
  assert.equal(escapeHtml("a & b"), "a &amp; b");
});

test("escapeHtml converte não-string para string", () => {
  assert.equal(escapeHtml(123), "123");
  assert.equal(escapeHtml(null), "null");
});

test("escapeHtml não altera strings seguras", () => {
  assert.equal(escapeHtml("Burnout"), "Burnout");
});

test("isSafeCardId aceita IDs válidos", () => {
  assert.ok(isSafeCardId("AE-0001"));
  assert.ok(isSafeCardId("82"));
});

test("isSafeCardId rejeita path traversal", () => {
  assert.equal(isSafeCardId("../etc/passwd"), false);
  assert.equal(isSafeCardId("..\\windows"), false);
});

test("isSafeCardId rejeita strings vazias e longas", () => {
  assert.equal(isSafeCardId(""), false);
  assert.equal(isSafeCardId("A".repeat(31)), false);
});

test("isSafeCardId rejeita caracteres especiais", () => {
  assert.equal(isSafeCardId("card<script>"), false);
  assert.equal(isSafeCardId("card id"), false);
});

test("isSafeCardId rejeita tipos não-string", () => {
  assert.equal(isSafeCardId(null), false);
  assert.equal(isSafeCardId(123), false);
});

test("safeCardImagePath retorna caminho correto", () => {
  assert.equal(safeCardImagePath("AE-0001"), "./assets/cards/AE-0001.jpg");
});

test("safeCardImagePath retorna null para IDs inseguros", () => {
  assert.equal(safeCardImagePath("../secret"), null);
  assert.equal(safeCardImagePath(""), null);
});

test("escapeRegExp escapa metacaracteres", () => {
  assert.equal(escapeRegExp("a.b+c*d"), "a\\.b\\+c\\*d");
});

test("truncateString limita o comprimento", () => {
  assert.equal(truncateString("abcdefgh", 5), "abcde");
  assert.equal(truncateString("abc", 10), "abc");
});

test("truncateString retorna vazio para não-strings", () => {
  assert.equal(truncateString(null, 10), "");
  assert.equal(truncateString(123, 10), "");
});
