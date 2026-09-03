const assert = require("node:assert/strict");
const test = require("node:test");

// ------------------------------------------------------------------
// Test setup: env for both lookup and admin modules
// ------------------------------------------------------------------
const SAVED_ENV = {};
for (const k of Object.keys(process.env)) {
  SAVED_ENV[k] = process.env[k];
}

function setEnv() {
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_fake";
  process.env.ADMIN_PANEL_SECRET = "test-admin-secret";
  process.env.MLBB_LOOKUP_API_URL = "https://lookup.example.test/nickname/ml";
  process.env.SUPPORT_USERNAME = "vafoyev_n";
}

function restoreEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED_ENV)) {
      delete process.env[k];
    }
  }
  for (const k of Object.keys(SAVED_ENV)) {
    process.env[k] = SAVED_ENV[k];
  }
}

function makeResponse() {
  const headers = {};
  const res = {
    statusCode: 200,
    _headers: headers,
    body: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    json(payload) {
      this.body = JSON.stringify(payload);
      return this;
    },
    send(payload) {
      this.body = String(payload);
      return this;
    },
    end(payload) {
      if (payload) {
        this.body = String(payload);
      }
    },
  };
  return res;
}

function jsonHeaders() {
  return { "content-type": "application/json" };
}

function mockFetch() {
  global.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    const u = String(url);

    if (u.includes("/rest/v1/api_tokens")) {
      if (method === "PATCH") {
        return new Response("[]", { status: 200, headers: jsonHeaders() });
      }
      if (method === "POST") {
        return new Response("[]", { status: 201, headers: jsonHeaders() });
      }
      // GET list or auth check -> always return a valid, non-expired token
      return new Response(
        JSON.stringify([
          {
            id: 7,
            title: "test",
            token_prefix: "mlbb_abc...",
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            usage_count: 0,
            is_revoked: false,
            last_used_at: null,
          },
        ]),
        { status: 200, headers: jsonHeaders() }
      );
    }

    if (u.includes("/rest/v1/admin_settings?key=eq.admin_password")) {
      return new Response("[]", { status: 200, headers: jsonHeaders() });
    }

    if (u.includes("/nickname/ml")) {
      return new Response(
        JSON.stringify({
          success: true,
          id: "1290132154",
          server: 15246,
          name: "Doué",
          country: "Uzbekistan",
        }),
        { status: 200, headers: jsonHeaders() }
      );
    }

    return new Response("[]", { status: 200, headers: jsonHeaders() });
  };
}

// ------------------------------------------------------------------
// Public lookup endpoint tests
// ------------------------------------------------------------------
test("lookup: requires token and returns access-denied gating message", async () => {
  setEnv();
  mockFetch();
  const handler = require("../api/lookup.js");

  const res = makeResponse();
  await handler(
    { method: "GET", query: { account_id: "1290132154", zone_id: "15246" }, headers: {}, body: {} },
    res
  );

  assert.equal(res.statusCode, 401);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.message.includes("@vafoyev_n"), parsed.message);
  assert.match(parsed.message, /murojaat qiling/);
  restoreEnv();
});

test("lookup: returns MLBB result with a valid token", async () => {
  setEnv();
  mockFetch();
  const handler = require("../api/lookup.js");

  const res = makeResponse();
  await handler(
    {
      method: "GET",
      query: { account_id: "1290132154", zone_id: "15246", token: "mlbb_validtoken" },
      headers: {},
      body: {},
    },
    res
  );

  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.nickname, "Doué");
  assert.equal(parsed.region, "Uzbekistan");
  assert.equal(parsed.account_id, "1290132154");
  restoreEnv();
});

test("lookup: validates required account_id and zone_id", async () => {
  setEnv();
  mockFetch();
  const handler = require("../api/lookup.js");

  const res = makeResponse();
  await handler(
    {
      method: "GET",
      query: { account_id: "1290132154", token: "mlbb_validtoken" },
      headers: {},
      body: {},
    },
    res
  );

  assert.equal(res.statusCode, 400);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.error.includes("account_id"));
  restoreEnv();
});

test("lookup: accepts token via x-api-token header", async () => {
  setEnv();
  mockFetch();
  const handler = require("../api/lookup.js");

  const res = makeResponse();
  await handler(
    {
      method: "GET",
      query: { account_id: "1290132154", zone_id: "15246" },
      headers: { "x-api-token": "mlbb_validtoken" },
      body: {},
    },
    res
  );

  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, true);
  restoreEnv();
});

// ------------------------------------------------------------------
// Admin panel tests
// ------------------------------------------------------------------
test("admin: unauthenticated GET serves the login form", async () => {
  setEnv();
  mockFetch();
  const handler = require("../api/admin.js");

  const res = makeResponse();
  await handler({ method: "GET", query: {}, headers: {}, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes("Admin Panel"));
  assert.ok(res.body.includes("<form"));
  restoreEnv();
});

test("admin: correct login sets session cookie and redirects", async () => {
  setEnv();
  mockFetch();
  const handler = require("../api/admin.js");

  const res = makeResponse();
  await handler(
    {
      method: "POST",
      query: { action: "login" },
      headers: {},
      body: { action: "login", username: "admin", password: "admin123" },
    },
    res
  );

  assert.equal(res.statusCode, 302);
  assert.equal(res._headers.location, "/api/admin");
  assert.ok(res._headers["set-cookie"].includes("mlbb_admin_session="));
  restoreEnv();
});

test("admin: wrong login shows an error (no session)", async () => {
  setEnv();
  mockFetch();
  const handler = require("../api/admin.js");

  const res = makeResponse();
  await handler(
    {
      method: "POST",
      query: { action: "login" },
      headers: {},
      body: { action: "login", username: "admin", password: "wrongpass" },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes("Foydalanuvchi"));
  assert.equal(res._headers["set-cookie"], undefined);
  restoreEnv();
});

test("admin: authenticated dashboard shows token creation form and list", async () => {
  setEnv();
  mockFetch();
  const handler = require("../api/admin.js");

  // Login to get a session cookie
  const loginRes = makeResponse();
  await handler(
    {
      method: "POST",
      query: { action: "login" },
      headers: {},
      body: { action: "login", username: "admin", password: "admin123" },
    },
    loginRes
  );
  const cookie = loginRes._headers["set-cookie"].split(";")[0];

  const res = makeResponse();
  await handler(
    { method: "GET", query: {}, headers: { cookie }, body: {} },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes("Yangi token yaratish"));
  assert.ok(res.body.includes("mlbb_abc"));
  assert.ok(res.body.includes("Parolni o'zgartirish"));
  restoreEnv();
});

test("admin: creating a token reveals the raw token only once", async () => {
  setEnv();
  mockFetch();
  const handler = require("../api/admin.js");

  const loginRes = makeResponse();
  await handler(
    {
      method: "POST",
      query: { action: "login" },
      headers: {},
      body: { action: "login", username: "admin", password: "admin123" },
    },
    loginRes
  );
  const cookie = loginRes._headers["set-cookie"].split(";")[0];

  const res = makeResponse();
  await handler(
    {
      method: "POST",
      query: { action: "create_token" },
      headers: { cookie },
      body: { action: "create_token", title: "Alisa", days: "30" },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /mlbb_[0-9a-f]{40}/);
  assert.ok(res.body.includes("faqat bir marta ko'rsatiladi"));
  restoreEnv();
});
