const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const proxyUrl = pathToFileURL(path.join(__dirname, "..", "arena-proxy.mjs")).href;
const WORKER = "https://worker.example.test";
const ENV = { ARENA_PROXY_KEY: "proxy-secret" };

function upstream() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ code: 0, data: { ok: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

test("arena proxy: forwards /user/* with the key, only safe headers, to arena.rone.dev", async () => {
  const { handleArenaProxy, isArenaProxyRequest } = await import(proxyUrl);
  const { calls, fetchImpl } = upstream();

  const req = new Request(`${WORKER}/arena-proxy/user/auth/send-vc`, {
    method: "POST",
    headers: { "x-arena-proxy-key": "proxy-secret", "Content-Type": "application/json", Cookie: "x=1", "X-Forwarded-For": "1.2.3.4" },
    body: JSON.stringify({ role_id: 123456, zone_id: 2001 }),
  });
  assert.equal(isArenaProxyRequest(req), true);
  const res = await handleArenaProxy(req, ENV, fetchImpl);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { code: 0, data: { ok: 1 } });
  assert.equal(calls[0].url, "https://arena.rone.dev/api/user/auth/send-vc");
  assert.deepEqual(calls[0].headers, { Accept: "application/json", "Content-Type": "application/json" });
  assert.equal(calls[0].body, '{"role_id":123456,"zone_id":2001}');

  const get = await handleArenaProxy(new Request(`${WORKER}/arena-proxy/user/matches/42?lang=en`, {
    headers: { "x-arena-proxy-key": "proxy-secret", Authorization: "Bearer jwt" },
  }), ENV, fetchImpl);
  assert.equal(get.status, 200);
  assert.equal(calls[1].url, "https://arena.rone.dev/api/user/matches/42?lang=en");
  assert.equal(calls[1].headers.Authorization, "Bearer jwt");

  assert.equal(isArenaProxyRequest(new Request(`${WORKER}/`)), false);
});

test("arena proxy: rejects missing/wrong key, other paths and methods; disabled without a secret", async () => {
  const { handleArenaProxy } = await import(proxyUrl);
  const { calls, fetchImpl } = upstream();
  const call = (url, init = {}, env = ENV) => handleArenaProxy(new Request(`${WORKER}${url}`, init), env, fetchImpl);
  const key = { "x-arena-proxy-key": "proxy-secret" };

  assert.equal((await call("/arena-proxy/user/info")).status, 403);
  assert.equal((await call("/arena-proxy/user/info", { headers: { "x-arena-proxy-key": "proxy-secre" } })).status, 403);
  assert.equal((await call("/arena-proxy/user/info", { headers: key }, {})).status, 404, "secret yo'q — marshrut yo'q");
  assert.equal((await call("/arena-proxy/admin/x", { headers: key })).status, 404);
  assert.equal((await call("/arena-proxy/user/../admin", { headers: key })).status, 404);
  assert.equal((await call("/arena-proxy/user/info", { method: "DELETE", headers: key })).status, 405);
  assert.equal((await call("/arena-proxy/user/auth/login", { method: "POST", headers: key, body: "x".repeat(5000) })).status, 413);
  assert.equal(calls.length, 0, "rad etilgan so'rovlar Arena'ga bormaydi");
});
