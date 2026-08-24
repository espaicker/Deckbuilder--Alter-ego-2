/**
 * Envio de e-mail com fallback seguro para desenvolvimento local.
 *
 * - Sem EMAIL_PROVIDER: imprime o conteudo no console do servidor
 *   (permite testar o fluxo inteiro sem servico externo).
 * - EMAIL_PROVIDER=resend + RESEND_API_KEY: envia de verdade via Resend (fetch nativo).
 */

const FROM_ADDRESS = process.env.EMAIL_FROM || "Forja de Alter Egos <no-reply@forja.local>";

/**
 * Mascara um e-mail para logs (nunca loga o endereco completo).
 * ex: teste@teste.com -> t***@teste.com
 */
function maskEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "***";
  const [user, domain] = email.split("@");
  const maskedUser = user.length <= 1 ? "*" : user[0] + "***";
  return maskedUser + "@" + domain;
}

export async function sendEmail({ to, subject, body }) {
  const provider = process.env.EMAIL_PROVIDER;

  if (provider === "resend" && process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: FROM_ADDRESS, to, subject, text: body }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`[email] Falha ao enviar via Resend (${res.status}): ${errText}`);
        return { sent: false };
      }
      console.log(`[email] Enviado via Resend para ${maskEmail(to)}`);
      return { sent: true };
    } catch (err) {
      console.error("[email] Erro ao enviar via Resend:", err.message);
      return { sent: false };
    }
  }

  // Fallback dev: imprime no console (nao loga o e-mail completo em nivel de erro)
  console.log("");
  console.log("========================================================");
  console.log("  E-MAIL (modo desenvolvimento - nao enviado de verdade)");
  console.log(`  Para:    ${to}`);
  console.log(`  Assunto: ${subject}`);
  console.log("  --------------------------------------------------");
  console.log(body);
  console.log("========================================================");
  console.log("");
  return { sent: true, dev: true };
}

export { maskEmail };