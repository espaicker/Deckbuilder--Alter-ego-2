/**
 * Textos dos e-mails transacionais. Cada funcao devolve { subject, text, html }:
 * a versao em texto puro e sempre enviada junto (alguns clientes de e-mail e
 * filtros de spam preferem ela), e a versao HTML tem todo dado dinamico escapado.
 */

const BRAND = "Forja de Alter Egos";

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function layout({ heading, paragraphs, button, footnote }) {
  const p = (html) => '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#222;">' + html + "</p>";
  const btn = button
    ? '<p style="margin:24px 0;"><a href="' + escapeHtml(button.href) + '" style="display:inline-block;background:#c62828;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px;">' + escapeHtml(button.label) + "</a></p>" +
      p('Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="word-break:break-all;color:#555;">' + escapeHtml(button.href) + "</span>")
    : "";
  return (
    '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:28px;">' +
    '<p style="margin:0 0 20px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#c62828;font-weight:bold;">' + BRAND + "</p>" +
    '<h1 style="margin:0 0 18px;font-size:20px;color:#111;">' + escapeHtml(heading) + "</h1>" +
    paragraphs.map(p).join("") +
    btn +
    '<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#888;">' + footnote + "</p>" +
    "</div></body></html>"
  );
}

const AUTOMATIC = "Este é um e-mail automático, não é preciso responder.";

export function passwordResetEmail({ username, link, ttlMinutes = 60 }) {
  const subject = "Redefinição de senha - " + BRAND;
  const text = [
    "Olá, " + username + "!",
    "",
    "Recebemos um pedido para redefinir a senha da sua conta na " + BRAND + ".",
    "",
    "Para criar uma nova senha, abra o link abaixo:",
    link,
    "",
    "O link vale por " + ttlMinutes + " minutos e só pode ser usado uma vez.",
    "",
    "Se você não pediu isso, pode ignorar este e-mail. Sua senha atual continua a mesma.",
    "",
    "Equipe " + BRAND,
    AUTOMATIC,
  ].join("\n");
  const html = layout({
    heading: "Redefinição de senha",
    paragraphs: [
      "Olá, <strong>" + escapeHtml(username) + "</strong>!",
      "Recebemos um pedido para redefinir a senha da sua conta na " + BRAND + ".",
      "O link vale por <strong>" + ttlMinutes + " minutos</strong> e só pode ser usado uma vez.",
    ],
    button: { href: link, label: "Criar nova senha" },
    footnote: "Se você não pediu isso, pode ignorar este e-mail. Sua senha atual continua a mesma.<br>" + AUTOMATIC,
  });
  return { subject, text, html };
}

export function passwordChangedEmail({ username, siteUrl }) {
  const subject = "Sua senha foi alterada - " + BRAND;
  const text = [
    "Olá, " + username + "!",
    "",
    "A senha da sua conta na " + BRAND + " acabou de ser alterada.",
    "",
    "Se foi você, está tudo certo e não precisa fazer nada.",
    "Se não foi você, peça uma nova senha agora mesmo em " + siteUrl + " (Entrar > Esqueci minha senha).",
    "",
    "Equipe " + BRAND,
    AUTOMATIC,
  ].join("\n");
  const html = layout({
    heading: "Sua senha foi alterada",
    paragraphs: [
      "Olá, <strong>" + escapeHtml(username) + "</strong>!",
      "A senha da sua conta na " + BRAND + " acabou de ser alterada.",
      "Se foi você, está tudo certo e não precisa fazer nada.",
      "<strong>Se não foi você</strong>, peça uma nova senha agora mesmo em Entrar &gt; Esqueci minha senha.",
    ],
    button: { href: siteUrl, label: "Abrir o site" },
    footnote: AUTOMATIC,
  });
  return { subject, text, html };
}
