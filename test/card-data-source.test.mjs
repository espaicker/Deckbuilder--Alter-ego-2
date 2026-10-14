// Bug 1.8 / Esperado 2.11 (Property 5): o frontend busca as cartas em
// GET /api/cards em tempo de execucao e so usa o JSON embutido no build
// quando a API falha (rede, status != 200, JSON invalido, formato invalido
// ou timeout).
import test from "node:test";
import assert from "node:assert/strict";
import { forAll, gen } from "./helpers/prop.mjs";

const FALLBACK = Object.freeze({
  colors: ["Vermelho"],
  types: { "Ação": { has_cost: true } },
  known_keywords: [],
  cards: [{ id: "EMB-0001", name: "Carta Embutida", type: "Ação", colors: ["Vermelho"] }],
});

async function loadModule() {
  // No codigo sem correcao o modulo nao existe: o frontend importa o JSON do build.
  return import("../src/lib/cardDataSource.js");
}

const validDataGen = gen.map(
  gen.record({
    ids: gen.array(gen.string({ min: 3, max: 8 }), { min: 0, max: 5 }),
    colors: gen.array(gen.elements(["Vermelho", "Verde", "Azul", "Amarelo", "Roxo"]), { min: 1, max: 5 }),
  }),
  ({ ids, colors }) => ({
    colors,
    types: { "Ação": { has_cost: true }, "Alter Ego": { has_cost: false } },
    known_keywords: [],
    cards: ids.map((id, i) => ({ id: `API-${id}-${i}`, name: `Carta ${i}`, type: "Ação", colors: [colors[0]] })),
  }),
);

const invalidShapeGen = gen.elements([
  null,
  [],
  "texto",
  42,
  {},
  { cards: "nao-e-lista", colors: [], types: {} },
  { cards: [], colors: "nao-e-lista", types: {} },
  { cards: [], colors: [], types: null },
  { cards: [], colors: [], types: [] },
  { colors: [], types: {} },
  { cards: [], types: {} },
  { cards: [], colors: [] },
]);

const scenarioGen = gen.oneOf(
  gen.map(validDataGen, (body) => ({ kind: "valid", status: 200, body: JSON.stringify(body), data: body })),
  gen.map(
    gen.record({ data: validDataGen, status: gen.elements([301, 400, 401, 403, 404, 500, 502, 503]) }),
    ({ data, status }) => ({ kind: "status", status, body: JSON.stringify(data) }),
  ),
  gen.map(gen.elements(["nao e json{", "<!doctype html><html></html>", "", "{\"cards\": ["]), (body) => ({ kind: "badjson", status: 200, body })),
  gen.map(invalidShapeGen, (data) => ({ kind: "badshape", status: 200, body: JSON.stringify(data) })),
  gen.constant({ kind: "network" }),
  gen.constant({ kind: "timeout" }),
);

function fetchFor(scenario) {
  return (url, options = {}) => {
    if (scenario.kind === "network") return Promise.reject(new TypeError("fetch failed"));
    if (scenario.kind === "timeout") {
      // Nunca responde; so termina quando o chamador aborta.
      return new Promise((_, reject) => {
        const signal = options.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    }
    return Promise.resolve(
      new Response(scenario.body, { status: scenario.status, headers: { "Content-Type": "application/json" } }),
    );
  };
}

test("Property 5: usa a API so com dados validos; senao o fallback embutido", { timeout: 60_000 }, async () => {
  const { fetchCardData } = await loadModule();

  await forAll(scenarioGen, async (scenario) => {
    const result = await fetchCardData({ fallback: FALLBACK, fetchImpl: fetchFor(scenario), timeoutMs: 30 });
    if (scenario.kind === "valid") {
      assert.equal(result.source, "api");
      assert.deepEqual(result.data, scenario.data);
    } else {
      assert.equal(result.source, "bundled", `cenario ${scenario.kind} deveria usar o fallback`);
      assert.deepEqual(result.data, FALLBACK);
    }
  }, { runs: 80 });
});
