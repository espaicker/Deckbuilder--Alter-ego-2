/**
 * Configuracao da borda HTTP: trust proxy, CORS e cabecalhos de seguranca.
 * Funcoes puras sobre `env` para poderem ser testadas sem subir o servidor.
 */

/**
 * Quantos saltos de proxy o Express deve confiar (define req.ip, usado pelo
 * rate limit). TRUST_PROXY:
 * - vazio/ausente -> 1 em producao (proxy do Render), false fora;
 * - numero (ex.: "1", "2") -> numero de saltos;
 * - "true"/"false" -> booleano (true e permissivo: qualquer cliente pode
 *   forjar X-Forwarded-For, e o express-rate-limit avisa);
 * - outro texto (ex.: "loopback, 10.0.0.0/8") -> repassado ao Express.
 */
export function resolveTrustProxy(env = process.env) {
  const raw = env.TRUST_PROXY === undefined || env.TRUST_PROXY === null ? "" : String(env.TRUST_PROXY).trim();
  if (raw === "") return env.NODE_ENV === "production" ? 1 : false;
  if (/^\d+$/.test(raw)) return Number(raw);
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "false") {
    if (lower === "true") {
      console.warn('[server] AVISO: TRUST_PROXY=true confia em qualquer X-Forwarded-For; prefira o numero de proxies (ex.: TRUST_PROXY=1).');
    } else {
      console.warn("[server] AVISO: TRUST_PROXY=false: atras de um proxy, todos os clientes compartilham o mesmo IP no rate limit.");
    }
    return lower === "true";
  }
  return raw;
}

function toOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

/**
 * Opcoes do pacote `cors`:
 * - ALLOWED_ORIGINS definido -> exatamente a lista (como antes);
 * - producao sem ALLOWED_ORIGINS -> so a origem do proprio site (SITE_URL e/ou
 *   RENDER_EXTERNAL_URL). Requisicoes sem Origin passam (mesma origem ou
 *   cliente nao-navegador); origens desconhecidas nao recebem cabecalhos CORS;
 * - fora de producao -> qualquer origem (Vite em outra porta no dev).
 */
export function resolveCorsOptions(env = process.env) {
  if (env.ALLOWED_ORIGINS) {
    return { origin: env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()), credentials: true };
  }
  if (env.NODE_ENV === "production") {
    const siteOrigins = new Set([toOrigin(env.SITE_URL), toOrigin(env.RENDER_EXTERNAL_URL)].filter(Boolean));
    return {
      origin(origin, callback) {
        if (!origin || siteOrigins.has(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    };
  }
  return { origin: true, credentials: true };
}

// 'unsafe-inline' so em style-src: necessario para o style="..." do <body> nos
// HTML e para o <style>/style="..." dos pop-ups de impressao (about:blank herda
// a CSP de quem abriu). script-src continua estrito ('self').
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Middleware de cabecalhos de seguranca (HSTS so em producao). */
export function securityHeaders({ isProduction = false } = {}) {
  return function securityHeadersMiddleware(req, res, next) {
    // As paginas de 404/erro padrao do Express (finalhandler) trocam a CSP por
    // "default-src 'none'" (mais restrita, mas sem frame-ancestors). Mantem a
    // politica delas e so acrescenta a protecao contra framing.
    const originalSetHeader = res.setHeader;
    res.setHeader = function setHeaderWithFrameAncestors(name, value) {
      if (typeof name === "string" && name.toLowerCase() === "content-security-policy" && !/frame-ancestors/i.test(String(value))) {
        value = `${value}; frame-ancestors 'none'`;
      }
      return originalSetHeader.call(this, name, value);
    };

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    if (isProduction) res.setHeader("Strict-Transport-Security", "max-age=15552000");
    next();
  };
}
