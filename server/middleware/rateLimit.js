import rateLimit from "express-rate-limit";

/**
 * Limites de tentativa pra proteger contra força bruta de senha. Cada
 * limite é por IP. Passar `NODE_ENV=test` desativa o limite (usado pela
 * suíte de testes, que faz dezenas de logins de propósito em segundos).
 */
const DISABLED = process.env.NODE_ENV === "test";

function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max: DISABLED ? 0 : max,
    skip: () => DISABLED,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

// Login de jogador: 10 tentativas a cada 15 minutos por IP.
export const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Muitas tentativas de login. Tente novamente em alguns minutos.",
});

// Registro de conta: 10 contas novas por hora por IP (evita criação em massa).
export const registerLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Muitas contas criadas a partir deste endereço. Tente novamente mais tarde.",
});

// Login de admin: mais restrito, é o alvo mais sensível.
export const adminLoginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Muitas tentativas de login administrativo. Tente novamente em alguns minutos.",
});

// Fórum: 5 postagens por minuto por IP (anti-flood)
export const forumPostLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Muitas postagens em pouco tempo. Aguarde um momento antes de postar novamente.",
});

// Recuperacao de senha: 5 tentativas a cada 15 minutos por IP (alvo de abuso).
export const passwordResetLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Muitas tentativas. Tente novamente em alguns minutos.",
});

// Troca de senha (usuario logado): 5 tentativas a cada 15 minutos por IP —
// limita a adivinhacao da senha atual com um token roubado.
export const passwordChangeLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Muitas tentativas. Tente novamente em alguns minutos.",
});

// Exclusao de conta (LGPD, Fase 9): acao sensivel e repetivel — limita
// tentativas de adivinhacao de senha na rota de apagar conta.
export const accountDeletionLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Muitas tentativas. Tente novamente em alguns minutos.",
});
