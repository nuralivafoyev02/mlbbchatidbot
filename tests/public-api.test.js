const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(require.resolve("../public-api.mjs")).href;

const TOKEN = `mlbb_${"a".repeat(40)}`;
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");
const ENV = {
  SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_KEY: "service-key",
  MLBB_LOOKUP_API_URL: "https://lookup.test/nickname/ml",
  ADVANCED_SERVER_RANGES: "5101-5800",
};

// Cloudflare Cache API'ning soxtasi (PoP keshi).
function fakeEdgeCache() {
  const store = new Map();
  return {
    store,
    async match(key) {
      const hit = store.get(String(key));
      return hit ? new Response(hit) : undefined;
    },
    async put(key, response) {
      store.set(String(key), await response.text());
    },
  };
}

function setup({ tokenRow = { id: 7, expires_at: "2099-01-01T00:00:00Z", is_revoked: false }, lookup } = {}) {
  const calls = { lookup: 0, token: 0, hits: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://db.test/rest/v1/api_tokens?token_hash=")) {
      calls.token += 1;
      assert.ok(u.includes(TOKEN_HASH));
      return Response.json(tokenRow ? [tokenRow] : []);
    }
    if (u.startsWith("https://db.test/rest/v1/rpc/api_token_hit")) {
      calls.hits.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    if (u.startsWith("https://lookup.test/")) {
      calls.lookup += 1;
      return lookup ? lookup(u) : Response.json({ success: true, name: "Wader", country: "Uzbekistan" });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return calls;
}

async function load() {
  const mod = await import(moduleUrl);
  mod.resetPublicApiState();
  globalThis.caches = { default: fakeEdgeCache() };
  return mod;
}

function req(path, headers = { authorization: `Bearer ${TOKEN}` }) {
  return new Request(`https://mlbb.nurali.uz${path}`, { headers });
}

test("returns nickname + region and serves repeats from memory", async () => {
  const api = await load();
  const calls = setup();

  const first = await api.handlePublicApi(req("/v1/check?id=1290132154&zone=15246"), ENV);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-cache"), "MISS");
  assert.deepEqual(await first.json(), {
    ok: true,
    account_id: "1290132154",
    zone_id: "15246",
    nickname: "Wader",
    region: "Uzbekistan",
    server_type: "Original Server",
  });

  const second = await api.handlePublicApi(req("/v1/check/1290132154/15246"), ENV);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-cache"), "HIT-MEM");
  assert.equal(calls.lookup, 1);
  assert.equal(calls.token, 1);
});

test("edge cache answers when isolate memory is cold", async () => {
  const api = await load();
  const calls = setup();
  const edge = globalThis.caches.default;

  await api.handlePublicApi(req("/v1/check?id=1&zone=5200"), ENV);
  api.resetPublicApiState(); // yangi isolate
  globalThis.caches = { default: edge };

  const res = await api.handlePublicApi(req("/v1/check?id=1&zone=5200"), ENV);
  assert.equal(res.headers.get("x-cache"), "HIT-EDGE");
  assert.equal((await res.json()).server_type, "Advanced Server");
  assert.equal(calls.lookup, 1);
  assert.equal(calls.token, 1);
});

test("concurrent identical lookups share one upstream call", async () => {
  const api = await load();
  const calls = setup();

  const results = await Promise.all(
    Array.from({ length: 10 }, () => api.handlePublicApi(req("/v1/check?id=55&zone=1"), ENV))
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(calls.lookup, 1);
});

test("unknown account is 404 and cached briefly", async () => {
  const api = await load();
  const calls = setup({ lookup: () => new Response("error code: 1101", { status: 500 }) });

  const first = await api.handlePublicApi(req("/v1/check?id=1&zone=1"), ENV);
  assert.equal(first.status, 404);
  assert.equal((await first.json()).error, "account_not_found");
  await api.handlePublicApi(req("/v1/check?id=1&zone=1"), ENV);
  assert.equal(calls.lookup, 1);
});

test("upstream outage is 502 and not cached", async () => {
  const api = await load();
  const calls = setup({ lookup: () => new Response("bad gateway", { status: 503 }) });

  const res = await api.handlePublicApi(req("/v1/check?id=9&zone=9"), ENV);
  assert.equal(res.status, 502);
  assert.equal(calls.lookup, 2); // bitta qayta urinish
});

test("rejects missing, malformed, revoked and unknown tokens", async () => {
  let api = await load();
  setup();
  assert.equal((await api.handlePublicApi(req("/v1/check?id=1&zone=1", {}), ENV)).status, 401);
  assert.equal((await api.handlePublicApi(req("/v1/check?id=1&zone=1", { "x-api-token": "nope" }), ENV)).status, 401);

  api = await load();
  setup({ tokenRow: { id: 1, expires_at: "2099-01-01T00:00:00Z", is_revoked: true } });
  const revoked = await api.handlePublicApi(req("/v1/check?id=1&zone=1"), ENV);
  assert.equal((await revoked.json()).error, "token_revoked");

  api = await load();
  const calls = setup({ tokenRow: null });
  const unknown = await api.handlePublicApi(req(`/v1/check?id=1&zone=1&token=${TOKEN}`, {}), ENV);
  assert.equal((await unknown.json()).error, "token_not_found");
  await api.handlePublicApi(req(`/v1/check?id=1&zone=1&token=${TOKEN}`, {}), ENV);
  assert.equal(calls.token, 1); // salbiy natija ham keshlanadi
  assert.equal(calls.lookup, 0);
});

test("validates params before touching the token store", async () => {
  const api = await load();
  const calls = setup();
  const res = await api.handlePublicApi(req("/v1/check?id=abc&zone=1"), ENV);
  assert.equal(res.status, 400);
  assert.equal(calls.token, 0);
});

test("usage is batched into one RPC call", async () => {
  const api = await load();
  const calls = setup();
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };

  for (let i = 0; i < 3; i += 1) {
    await api.handlePublicApi(req("/v1/check?id=1&zone=1"), ENV, ctx);
  }
  await Promise.all(waits);
  await api.flushUsage(ENV);
  const total = calls.hits.reduce((sum, h) => sum + h.p_hits, 0);
  assert.equal(total, 3);
  assert.ok(calls.hits.length <= 2);
});

test("info, CORS preflight and path matching", async () => {
  const api = await load();
  assert.equal(api.isPublicApiPath("/v1"), true);
  assert.equal(api.isPublicApiPath("/v1/check"), true);
  assert.equal(api.isPublicApiPath("/tg"), false);
  assert.equal(api.isPublicApiPath("/v10"), false);

  const info = await api.handlePublicApi(req("/v1", {}), ENV);
  assert.equal(info.status, 200);
  const pre = await api.handlePublicApi(new Request("https://mlbb.nurali.uz/v1/check", { method: "OPTIONS" }), ENV);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
});

test("rate limit: 429 with Retry-After after the per-token limit", async () => {
  const api = await load();
  setup();
  let allowed = 0;
  const env = { ...ENV, PUBLIC_API_LIMITER: { limit: async ({ key }) => ({ success: key === "tok:7" && allowed++ < 2 }) } };

  assert.equal((await api.handlePublicApi(req("/v1/check?id=1&zone=1"), env)).status, 200);
  assert.equal((await api.handlePublicApi(req("/v1/check?id=1&zone=1"), env)).status, 200);
  const limited = await api.handlePublicApi(req("/v1/check?id=1&zone=1"), env);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.match((await limited.json()).message, /@vafoyev_n/);
});

test("rate limit falls back to isolate memory without the binding", async () => {
  const api = await load();
  setup();
  const statuses = [];
  for (let i = 0; i < api.RATE_LIMIT + 1; i += 1) {
    statuses.push((await api.handlePublicApi(req("/v1/check?id=1&zone=1"), ENV)).status);
  }
  assert.equal(statuses.filter((s) => s === 200).length, api.RATE_LIMIT);
  assert.equal(statuses.at(-1), 429);
});

test("auth errors point to the Telegram contact", async () => {
  const api = await load();
  setup();
  const res = await api.handlePublicApi(req("/v1/check?id=1&zone=1", {}), ENV);
  assert.match((await res.json()).message, /@vafoyev_n/);
});
