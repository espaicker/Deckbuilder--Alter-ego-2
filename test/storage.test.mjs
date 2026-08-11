import test from "node:test";
import assert from "node:assert/strict";
import { safeJsonParse } from "../src/lib/storage.js";

test("safeJsonParse retorna objeto para JSON válido", () => {
  assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 });
  assert.deepEqual(safeJsonParse("[1,2,3]"), [1, 2, 3]);
  assert.equal(safeJsonParse("42"), 42);
});

test("safeJsonParse retorna null para JSON inválido", () => {
  assert.equal(safeJsonParse("{invalid}"), null);
  assert.equal(safeJsonParse(""), null);
  assert.equal(safeJsonParse("{"), null);
});

test("safeJsonParse retorna null para tipos não-string", () => {
  assert.equal(safeJsonParse(null), null);
  assert.equal(safeJsonParse(undefined), null);
  assert.equal(safeJsonParse(123), null);
});

test("safeJsonParse não polui Object.prototype via __proto__", () => {
  safeJsonParse('{"__proto__": {"polluted": true}}');
  assert.equal(({}).polluted, undefined);
});
