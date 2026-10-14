import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { readFileSync, writeFileSync, existsSync } from "fs";
// Mesmo DATA_DIR usado pelo banco (server/lib/paths.js) — mantém tudo junto
// no mesmo disco persistente quando configurado em produção.
import { JWT_SECRET_PATH, ADMIN_CREDENTIALS_PATH, ensureDataDir } from "./lib/paths.js";

/**
 * Segredo usado para assinar os tokens de login (JWT).
 *
 * Prioridade:
 *   1. Variável de ambiente JWT_SECRET (use isso ao publicar o site de verdade,
 *      configurando-a no painel do serviço de hospedagem).
 *   2. Um valor aleatório gerado na primeira vez que o servidor roda, salvo em
 *      server/.jwt-secret (arquivo local, fora do Git — veja .gitignore).
 *
 * Nunca existe um valor padrão fixo: se nada disso estiver disponível, um
 * segredo novo é gerado automaticamente, então não há risco de alguém
 * forjar um token usando um valor conhecido publicamente.
 */
export function getJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (existsSync(JWT_SECRET_PATH)) {
    return readFileSync(JWT_SECRET_PATH, "utf-8").trim();
  }

  const generated = randomBytes(48).toString("hex");
  ensureDataDir();
  writeFileSync(JWT_SECRET_PATH, generated, "utf-8");
  console.log("[server] Gerado um novo segredo de assinatura de login (server/.jwt-secret).");
  return generated;
}

/**
 * Credenciais do painel admin.
 *
 * Prioridade:
 *   1. Variáveis de ambiente ADMIN_USERNAME / ADMIN_PASSWORD (use ao publicar
 *      o site de verdade — a senha é hasheada na hora, nunca fica em disco).
 *   2. Um hash salvo em server/.admin-credentials.json. Se esse arquivo não
 *      existir ainda, uma senha aleatória é gerada, o HASH dela é salvo (não
 *      a senha em si), e a senha em texto puro é impressa no terminal UMA
 *      ÚNICA VEZ — anote nesse momento, pois não é possível recuperá-la depois
 *      (só gerar uma nova apagando o arquivo).
 */
export function getAdminCredentials() {
  const username = process.env.ADMIN_USERNAME || "admin";

  if (process.env.ADMIN_PASSWORD) {
    return { username, passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10) };
  }

  if (existsSync(ADMIN_CREDENTIALS_PATH)) {
    const saved = JSON.parse(readFileSync(ADMIN_CREDENTIALS_PATH, "utf-8"));
    return { username: saved.username || username, passwordHash: saved.passwordHash };
  }

  const generatedPassword = randomBytes(9).toString("base64url"); // ~12 caracteres, só letras/números
  const passwordHash = bcrypt.hashSync(generatedPassword, 10);
  ensureDataDir();
  writeFileSync(
    ADMIN_CREDENTIALS_PATH,
    JSON.stringify({ username, passwordHash }, null, 2),
    "utf-8"
  );

  console.log("");
  console.log("========================================================");
  console.log("  CREDENCIAIS DE ADMIN GERADAS (primeira vez rodando)");
  console.log(`  Usuário: ${username}`);
  console.log(`  Senha:   ${generatedPassword}`);
  console.log("  Anote agora — essa senha não será mostrada de novo.");
  console.log("  (fica salva, com hash, em server/.admin-credentials.json)");
  console.log("========================================================");
  console.log("");

  return { username, passwordHash };
}
