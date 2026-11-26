import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const worker = readFileSync(new URL("../public/referee/sw.js", import.meta.url), "utf8");

for (const failure of ["open", "match", "put"] as const) {
  test(`referee static assets still load from the network when CacheStorage ${failure} fails`, async () => {
    let handler: ((event: object) => void) | undefined;
    const unavailable = async () => { throw new Error("CacheStorage unavailable"); };
    const response = new Response("script");
    runInNewContext(worker, {
      URL,
      fetch: async () => response,
      caches: { open: failure === "open" ? unavailable : async () => ({
        match: failure === "match" ? unavailable : async () => undefined,
        put: failure === "put" ? unavailable : async () => undefined,
      }) },
      self: {
        location: { origin: "http://127.0.0.1" },
        addEventListener: (type: string, listener: typeof handler) => { if (type === "fetch") handler = listener; },
      },
    });
    let result: Promise<Response> | undefined;
    assert(handler);
    handler({ request: new Request("http://127.0.0.1/_next/static/chunks/referee.js"),
      respondWith: (value: Promise<Response>) => { result = value; } });
    assert(result);
    assert.equal(await result, response);
  });
}
