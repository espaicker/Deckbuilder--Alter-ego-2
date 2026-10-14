// Helper minimo de testes baseados em propriedades (sem dependencias).
//
// - mulberry32: gerador pseudoaleatorio com semente (reproduzivel).
// - gen.*: geradores basicos. Um gerador e uma funcao (rng) => valor.
// - forAll(gerador, propriedade, { runs, seed }): roda a propriedade com
//   `runs` amostras. Na primeira falha, lanca um erro com a semente, o indice
//   da execucao e o contraexemplo, para reproduzir com a mesma semente.
//
// Este arquivo nao define testes; `node --test` apenas o carrega.

export const DEFAULT_SEED = 0x5eed1234;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed = DEFAULT_SEED) {
  const next = mulberry32(seed);
  const rng = {
    seed,
    next,
    /** Inteiro em [min, max] (inclusivo). */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    bool(pTrue = 0.5) {
      return next() < pTrue;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
  };
  return rng;
}

const DEFAULT_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const gen = {
  constant: (value) => () => value,
  int: (min, max) => (rng) => rng.int(min, max),
  bool: (pTrue = 0.5) => (rng) => rng.bool(pTrue),
  elements: (arr) => (rng) => rng.pick(arr),
  oneOf: (...gens) => (rng) => rng.pick(gens)(rng),
  map: (g, fn) => (rng) => fn(g(rng), rng),
  string: ({ min = 0, max = 16, alphabet = DEFAULT_ALPHABET } = {}) => (rng) => {
    const len = rng.int(min, max);
    let out = "";
    for (let i = 0; i < len; i++) out += alphabet[rng.int(0, alphabet.length - 1)];
    return out;
  },
  bytes: ({ min = 0, max = 64 } = {}) => (rng) => {
    const len = rng.int(min, max);
    const buf = Buffer.alloc(len);
    for (let i = 0; i < len; i++) buf[i] = rng.int(0, 255);
    return buf;
  },
  array: (g, { min = 0, max = 8 } = {}) => (rng) => {
    const len = rng.int(min, max);
    const out = [];
    for (let i = 0; i < len; i++) out.push(g(rng));
    return out;
  },
  /** Subconjunto aleatorio (ordem preservada) de `arr`. */
  subset: (arr) => (rng) => arr.filter(() => rng.bool()),
  record: (shape) => (rng) => {
    const out = {};
    for (const [key, g] of Object.entries(shape)) out[key] = g(rng);
    return out;
  },
};

function describeValue(value) {
  return JSON.stringify(
    value,
    (key, v) => {
      if (v && typeof v === "object" && v.type === "Buffer" && Array.isArray(v.data)) {
        const hex = Buffer.from(v.data.slice(0, 16)).toString("hex");
        return `<bytes len=${v.data.length} inicio=${hex}${v.data.length > 16 ? "..." : ""}>`;
      }
      if (v instanceof Uint8Array) {
        const hex = Buffer.from(v.subarray(0, 16)).toString("hex");
        return `<bytes len=${v.length} inicio=${hex}${v.length > 16 ? "..." : ""}>`;
      }
      if (typeof v === "string" && v.length > 200) return `${v.slice(0, 200)}...(${v.length} chars)`;
      return v;
    },
    2,
  );
}

/**
 * Roda `property(valor, { run, rng })` para `runs` valores gerados.
 * A propriedade pode ser sincrona ou assincrona; falha = lancar erro.
 */
export async function forAll(generator, property, { runs = 100, seed } = {}) {
  const envSeed = process.env.PROP_SEED ? Number(process.env.PROP_SEED) : undefined;
  const effectiveSeed = (seed ?? envSeed ?? DEFAULT_SEED) >>> 0;
  const rng = makeRng(effectiveSeed);

  for (let run = 0; run < runs; run++) {
    const value = generator(rng);
    try {
      await property(value, { run, rng });
    } catch (err) {
      const message =
        `Propriedade falhou na execucao ${run + 1}/${runs} (semente ${effectiveSeed}).\n` +
        `Contraexemplo: ${describeValue(value)}\n` +
        `Erro: ${err && err.message ? err.message : String(err)}`;
      console.error(`[prop] ${message}`);
      const wrapped = new Error(message, { cause: err });
      wrapped.counterexample = value;
      wrapped.seed = effectiveSeed;
      throw wrapped;
    }
  }
}
