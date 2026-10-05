import test from "node:test";
import assert from "node:assert/strict";
import { passwordResetEmail, passwordChangedEmail } from "../server/lib/emailTemplates.js";
import { emailConfigWarnings } from "../server/lib/email.js";

const LINK = "https://forja.example/resetar-senha?token=abc123";

test("e-mail de recuperação traz saudação, link, validade e versão em texto", () => {
  const m = passwordResetEmail({ username: "ana", link: LINK, ttlMinutes: 60 });
  assert.equal(m.subject, "Redefinição de senha - Forja de Alter Egos");
  assert.match(m.text, /^Olá, ana!/);
  assert.ok(m.text.includes(LINK));
  assert.match(m.text, /60 minutos/);
  assert.ok(m.html.includes('href="' + LINK + '"'));
});

test("e-mail escapa HTML no nome de usuário", () => {
  const m = passwordResetEmail({ username: '<img src=x onerror=alert(1)>', link: LINK });
  assert.ok(!m.html.includes("<img src=x"));
  assert.ok(m.html.includes("&lt;img src=x"));
});

test("aviso de senha alterada orienta quem não reconhece a troca", () => {
  const m = passwordChangedEmail({ username: "ana", siteUrl: "https://forja.example" });
  assert.match(m.subject, /Sua senha foi alterada/);
  assert.match(m.text, /Se não foi você/);
});

test("diagnóstico de configuração de e-mail", () => {
  assert.deepEqual(emailConfigWarnings({ NODE_ENV: "development" }), []);
  assert.ok(emailConfigWarnings({ NODE_ENV: "production" }).some((w) => w.includes("Sem EMAIL_PROVIDER")));
  assert.ok(emailConfigWarnings({ NODE_ENV: "production" }).some((w) => w.includes("SITE_URL")));
  assert.ok(!emailConfigWarnings({ NODE_ENV: "production", RENDER_EXTERNAL_URL: "https://x.onrender.com", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", EMAIL_FROM: "a@b.c" }).length);
  assert.ok(emailConfigWarnings({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" }).some((w) => w.includes("EMAIL_FROM")));
});
