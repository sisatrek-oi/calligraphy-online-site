import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/search.js";

test("cloud search preserves real results and does not count a fallback link", async () => {
  const fetchBefore = globalThis.fetch;
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; } };
  try {
    globalThis.fetch = async () => ({ ok: true, text: async () => '<a class="result__a" href="https://example.org/source">Source title</a><a class="result__snippet">Source context</a>' });
    await handler({ query: { q: "test" } }, response);
    assert.equal(response.code, 200);
    assert.equal(response.payload.results[0].url, "https://example.org/source");
    globalThis.fetch = async () => ({ ok: true, text: async () => "<html>No results</html>" });
    await handler({ query: { q: "test" } }, response);
    assert.deepEqual(response.payload.results, []);
    globalThis.fetch = async () => { throw new Error("timeout"); };
    await handler({ query: { q: "test" } }, response);
    assert.equal(response.code, 502);
    assert.deepEqual(response.payload.results, []);
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
