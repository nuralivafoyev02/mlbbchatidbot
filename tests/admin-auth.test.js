const assert = require("node:assert/strict");
const test = require("node:test");

const auth = require("../api/_admin-auth.js");

test("admin auth: login is refused when env credentials are missing", () => {
  assert.equal(auth.isAdminLoginConfigured({}), false);
  assert.equal(auth.verifyAdminLogin("admin", "admin123", {}), false);
  assert.equal(auth.verifyAdminLogin("", "", { ADMIN_PANEL_USERNAME: "a" }), false);
});

test("admin auth: only the env username and password are accepted", () => {
  const env = { ADMIN_PANEL_USERNAME: "boss", ADMIN_PANEL_PASSWORD: "p@ss w0rd" };

  assert.equal(auth.verifyAdminLogin("boss", "p@ss w0rd", env), true);
  assert.equal(auth.verifyAdminLogin(" boss ", "p@ss w0rd", env), true);
  assert.equal(auth.verifyAdminLogin("boss", "p@ss w0r", env), false);
  assert.equal(auth.verifyAdminLogin("admin", "admin123", env), false);
});

test("admin auth: changing the password changes the session signing key", () => {
  const a = auth.getAdminSessionKey({ ADMIN_PANEL_SECRET: "s", ADMIN_PANEL_USERNAME: "u", ADMIN_PANEL_PASSWORD: "one" });
  const b = auth.getAdminSessionKey({ ADMIN_PANEL_SECRET: "s", ADMIN_PANEL_USERNAME: "u", ADMIN_PANEL_PASSWORD: "two" });

  assert.notDeepEqual(a, b);
});

test("admin auth: no hardcoded default credentials remain in the panels", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  for (const file of ["admin.js", "miniapp.js", "index.html", "_admin-auth.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "api", file), "utf8");
    assert.doesNotMatch(source, /admin123/, `${file} still contains admin123`);
    assert.doesNotMatch(source, /DEFAULT_ADMIN_(USER|PASSWORD)/, `${file} still has a default admin constant`);
  }
});

test("miniapp: login without env returns login_not_configured and old sessions die on password change", async () => {
  const modulePath = require.resolve("../api/miniapp.js");
  const saved = { ...process.env };

  const call = async (body, cookie = "") => {
    const headers = {};
    let status = 200;
    let payload = null;
    delete require.cache[modulePath];
    await require("../api/miniapp.js")(
      { method: "POST", headers: { cookie }, query: { action: body.action }, body },
      {
        status(code) { status = code; return this; },
        setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
        send(text) { payload = JSON.parse(text); return this; },
      }
    );
    return { status, payload, headers };
  };

  try {
    delete process.env.ADMIN_PANEL_USERNAME;
    delete process.env.ADMIN_PANEL_PASSWORD;
    process.env.ADMIN_PANEL_SECRET = "secret";

    const refused = await call({ action: "login", username: "admin", password: "admin123" });
    assert.equal(refused.status, 503);
    assert.equal(refused.payload.error, "login_not_configured");

    process.env.ADMIN_PANEL_USERNAME = "boss";
    process.env.ADMIN_PANEL_PASSWORD = "first-pass";

    const wrong = await call({ action: "login", username: "admin", password: "admin123" });
    assert.equal(wrong.status, 401);

    const ok = await call({ action: "login", username: "boss", password: "first-pass" });
    assert.equal(ok.payload.ok, true);
    const cookie = String(ok.headers["set-cookie"]).split(";")[0];

    process.env.ADMIN_PANEL_PASSWORD = "second-pass";
    const stale = await call({ action: "get_settings" }, cookie);
    assert.equal(stale.status, 401, "session signed with the old password must be rejected");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    delete require.cache[modulePath];
  }
});

test("miniapp: serves the admin background image with an image content type", async () => {
  delete require.cache[require.resolve("../api/miniapp.js")];
  const handler = require("../api/miniapp.js");
  const res = {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    send(payload) { this.body = payload; return this; },
  };

  await handler({ method: "GET", headers: {}, query: { asset: "bg" } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /^image\/(jpeg|png)$/);
  assert.ok(Buffer.isBuffer(res.body) && res.body.length > 1000);
  assert.match(res.headers["Cache-Control"], /max-age/);
});
