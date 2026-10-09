const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const limitPrices = require("../api/_limit-prices.js");
const quotaLog = require("../api/_quota-log.js");

const SUPABASE = "https://testproject.supabase.co/rest/v1";
const ARENA = "https://arena.example.test/api";
const BOT_TOKEN = "123456:test-token";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    send(payload) {
      this.body = typeof payload === "string" && this.headers["Content-Type"] === "application/json" ? JSON.parse(payload) : payload;
      return this;
    },
  };
}

function signInitData(user) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAE-test", user: JSON.stringify(user) });
  const dataCheckString = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

// Soxta bot_settings (key/value) — eq./like. filtrlari bilan.
function createFakeBotSettings() {
  const rows = new Map();

  function handle(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const url = new URL(`https://fake.local/rest/v1${path}`);
    const keyFilter = url.searchParams.get("key") || "";

    if (method === "GET") {
      if (keyFilter.startsWith("eq.")) {
        const row = rows.get(keyFilter.slice(3));
        return row ? [JSON.parse(JSON.stringify(row))] : [];
      }
      if (keyFilter.startsWith("like.")) {
        const prefix = keyFilter.slice(5).replace(/\*$/, "");
        return [...rows.values()].filter((row) => row.key.startsWith(prefix)).map((row) => JSON.parse(JSON.stringify(row)));
      }
      return [];
    }

    if (method === "POST") {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      const row = JSON.parse(JSON.stringify({ key: body.key, value: body.value, updated_at: body.updated_at }));
      rows.set(row.key, row);
      return [row];
    }

    if (method === "DELETE") {
      rows.delete(keyFilter.slice(3));
    }
    return [];
  }

  return { rows, handle };
}

// ---------------------------------------------------------------------------
// _limit-prices.js / _quota-log.js
// ---------------------------------------------------------------------------
test("limit prices: validation, CRUD, sorting and duplicate guard", async () => {
  const fake = createFakeBotSettings();
  const store = limitPrices.createLimitPriceStore(fake.handle);

  assert.equal((await store.save({ kind: "nope", amount: 5, price: 1000 })).error, "kind_invalid");
  assert.equal((await store.save({ kind: "full_info", amount: "0", price: 1000 })).error, "amount_invalid");
  assert.equal((await store.save({ kind: "full_info", amount: 5, price: "abc" })).error, "price_invalid");

  const big = await store.save({ kind: "full_info", amount: "20", price: "40 000", title: "Pro", hit: true });
  assert.equal(big.ok, true);
  assert.equal(big.item.price, 40000);
  assert.equal(big.item.hit, true);
  await store.save({ kind: "bind_info", amount: 30, price: 15000 });
  await store.save({ kind: "full_info", amount: 5, price: 12000 });

  const list = await store.list();
  assert.deepEqual(list.map((i) => `${i.kind}:${i.amount}`), ["full_info:5", "full_info:20", "bind_info:30"]);
  assert.equal((await store.save({ kind: "full_info", amount: 5, price: 1 })).error, "item_exists");

  const edited = await store.save({ id: big.item.id, kind: "full_info", amount: 25, price: 45000 });
  assert.equal(edited.item.amount, 25);
  assert.equal(edited.item.hit, false);
  assert.equal((await store.save({ id: "zzzzzzzz", kind: "reset_pw", amount: 1, price: 1 })).error, "item_not_found");

  await store.remove(big.item.id);
  assert.equal((await store.list()).length, 2);
  assert.ok([...fake.rows.keys()].every((key) => key.startsWith("shop_lp:")));
});

test("quota log: builds clean events and masks emails", async () => {
  assert.equal(quotaLog.maskEmail("someone@gmail.com"), "so•••@gmail.com");
  assert.equal(quotaLog.buildQuotaEvent({ userId: "1", kind: "x", delta: -1 }), null);
  assert.equal(quotaLog.buildQuotaEvent({ userId: "1", kind: "full_info", delta: 0 }), null);

  const sent = [];
  const ok = await quotaLog.logQuotaEvent((path, options) => sent.push({ path, options }), {
    userId: 42, kind: "full_info", delta: -1, accountId: "123456", zoneId: "2001", remaining: 2,
  });
  assert.equal(ok, true);
  assert.equal(sent[0].path, "/quota_usage_events");
  assert.deepEqual(sent[0].options.body, {
    user_id: "42", kind: "full_info", delta: -1, source: "use", account_id: "123456", zone_id: "2001", target: null, remaining: 2,
  });
});

// ---------------------------------------------------------------------------
// api/account.js — ?view=cabinet
// ---------------------------------------------------------------------------
function installCabinetBackend() {
  const settings = createFakeBotSettings();
  const accounts = [];
  const telegram = [];
  const arenaCalls = [];
  let nextId = 10;
  const history = [
    { id: 1, user_id: "777", kind: "full_info", delta: -1, source: "use", account_id: "555555", zone_id: "1", target: null, remaining: 2, created_at: "2026-10-09T10:00:00Z" },
  ];

  function rpc(name, args) {
    const userId = String(args.p_user_id);
    switch (name) {
      case "list_user_accounts":
        return accounts.filter((a) => a.user_id === userId).map((a) => ({ id: a.id, account_id: a.account_id, zone_id: a.zone_id, ml_linked: a.ml_token !== null, ml_nickname: a.ml_nickname }));
      case "add_user_account":
        if (accounts.some((a) => a.account_id === args.p_account_id && a.zone_id === args.p_zone_id)) return { ok: false, error: "already_exists" };
        accounts.push({ id: nextId++, user_id: userId, account_id: args.p_account_id, zone_id: args.p_zone_id, ml_token: null, ml_nickname: null });
        return { ok: true };
      case "remove_user_account": {
        const index = accounts.findIndex((a) => a.user_id === userId && a.account_id === args.p_account_id && a.zone_id === args.p_zone_id);
        if (index < 0) return { ok: false, error: "not_found" };
        accounts.splice(index, 1);
        return { ok: true };
      }
      case "set_user_account_ml_link": {
        const row = accounts.find((a) => String(a.id) === String(args.p_row_id) && a.user_id === userId);
        if (!row) return { ok: false };
        Object.assign(row, { ml_token: args.p_token, ml_nickname: args.p_nickname });
        return { ok: true };
      }
      case "get_full_info_quota": return { remaining: 2 };
      case "get_reset_pw_quota": return { remaining: 0 };
      case "check_bind_limit_only": return { remaining: 7, total_limit: 10 };
      case "get_account_check_history":
        return [{ id: 5, account_id: "555555", zone_id: "1", checker_user_id: 9, checker_username: "spy", action: "full_info", created_at: "2026-10-09T09:00:00Z" }];
      default:
        return null;
    }
  }

  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith("https://api.telegram.org/")) {
      telegram.push(JSON.parse(options.body));
      return jsonResponse({ ok: true, result: {} });
    }
    if (href.startsWith(ARENA)) {
      const call = { path: new URL(href).pathname.replace(/^\/api/, ""), body: options.body ? JSON.parse(options.body) : null };
      arenaCalls.push(call);
      if (call.path === "/user/auth/login") {
        return call.body.vc === 1234
          ? jsonResponse({ code: 0, data: { jwt: "jwt-abc" } })
          : jsonResponse({ status: "error", details: { type: "ResponseValidationError" } }, 500);
      }
      if (call.path === "/user/info") return jsonResponse({ code: 0, data: { name: "Lily" } });
      return jsonResponse({ code: 0, data: "" });
    }
    if (href.startsWith(SUPABASE)) {
      const path = href.slice(SUPABASE.length);
      const body = options.body ? JSON.parse(options.body) : {};
      if (path.startsWith("/rpc/")) return jsonResponse(rpc(decodeURIComponent(path.slice(5)), body));
      if (path.startsWith("/quota_usage_events")) return jsonResponse(history);
      if (path.startsWith("/bot_settings")) return jsonResponse(settings.handle(path, { ...options, body }));
      if (path.startsWith("/bot_users")) return jsonResponse([{ preferred_language: "uz", user_id: 1, chat_id: 1, username: "Ksava_org" }]);
      return jsonResponse([]);
    }
    return jsonResponse({});
  };

  return { settings, accounts, telegram, arenaCalls, restore: () => { global.fetch = original; } };
}

function loadAccountApp() {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_BOT_USERNAME = "checkmlbbidBot";
  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  process.env.MLBB_ARENA_API_URL = ARENA;
  process.env.MLBB_LINK_SECRET = "test-link-secret";
  process.env.SUPPORT_USERNAME = "Ksava_org";
  process.env.ADMIN_IDS = "5081175125";
  delete process.env.SHOP_NOTIFY_CHAT_ID;
  delete require.cache[require.resolve("../api/account.js")];
  return require("../api/account.js");
}

async function call(app, user, action, payload = {}) {
  const res = createRes();
  await app({ method: "POST", headers: {}, query: {}, body: { action, initData: signInitData(user), ...payload } }, res);
  return res;
}

const USER = { id: 777, first_name: "Ali", username: "ali" };

test("cabinet: GET ?view=cabinet serves the cabinet page with the shell", async () => {
  const app = loadAccountApp();
  const res = createRes();
  await app({ method: "GET", headers: {}, query: { view: "cabinet" } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Shaxsiy kabinet/);
  assert.match(res.body, /tg-shell-script/);

  const ml = createRes();
  await app({ method: "GET", headers: {}, query: {} }, ml);
  assert.match(ml.body, /Mening akkauntim/);
});

test("cabinet: returns limits, accounts, viewers, history, prices and only available firstmails", async () => {
  const backend = installCabinetBackend();
  try {
    const shop = require("../api/_shop.js");
    const fmStore = shop.createFirstmailStore(backend.settings.handle);
    const sold = await fmStore.create({ email: "sold@firstmail.ltd", price: "9000" });
    await fmStore.setSold(sold.item.id, true);
    await fmStore.create({ email: "fresh@firstmail.ltd", password: "secret-pass", price: "15000" });
    await limitPrices.createLimitPriceStore(backend.settings.handle).save({ kind: "full_info", amount: 10, price: 20000 });

    const app = loadAccountApp();
    const res = await call(app, USER, "cabinet");
    assert.equal(res.statusCode, 200);
    const d = res.body;
    assert.equal(d.limits.full_info.remaining, 2);
    assert.equal(d.limits.reset_pw.remaining, 0);
    assert.deepEqual(d.limits.bind_info, { remaining: 7, total: 10 });
    assert.equal(d.unlimited, false);
    assert.equal(d.viewers[0].checker_username, "spy");
    assert.equal(d.history[0].account_id, "555555");
    assert.equal(d.prices.length, 1);
    assert.equal(d.supportUsername, "Ksava_org");
    assert.equal(d.firstmails.length, 1);
    assert.equal(d.firstmails[0].email, "fre•••@firstmail.ltd");
    assert.ok(!JSON.stringify(d).includes("secret-pass"), "parol kabinetga chiqmasligi kerak");
  } finally {
    backend.restore();
  }
});

test("cabinet: add / remove accounts with validation", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();
    assert.equal((await call(app, USER, "account_add", { account_id: "12", zone_id: "1" })).body.error, "invalid_input");

    const added = await call(app, USER, "account_add", { account_id: "123456", zone_id: "2001" });
    assert.equal(added.body.ok, true);
    assert.equal(added.body.accounts.length, 1);

    const other = await call(app, { id: 888, first_name: "B" }, "account_add", { account_id: "123456", zone_id: "2001" });
    assert.equal(other.body.error, "already_exists");

    // Boshqa user birovning qatorini o'chira olmaydi.
    const rowId = added.body.accounts[0].id;
    assert.equal((await call(app, { id: 888, first_name: "B" }, "account_remove", { rowId })).statusCode, 404);

    const removed = await call(app, USER, "account_remove", { rowId });
    assert.equal(removed.body.ok, true);
    assert.equal(backend.accounts.length, 0);
  } finally {
    backend.restore();
  }
});

test("cabinet: ML link — code send cooldown, wrong-code attempts are counted server-side, success links", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();
    const rowId = (await call(app, USER, "account_add", { account_id: "123456", zone_id: "2001" })).body.accounts[0].id;

    assert.equal((await call(app, USER, "ml_verify", { rowId, code: "1234" })).body.error, "code_expired");
    assert.equal((await call(app, USER, "ml_send_code", { rowId })).body.ok, true);
    const again = await call(app, USER, "ml_send_code", { rowId });
    assert.equal(again.body.error, "cooldown");

    const wrong = await call(app, USER, "ml_verify", { rowId, code: "9999" });
    assert.deepEqual([wrong.body.error, wrong.body.left], ["wrong_code", 4]);
    assert.equal(backend.settings.rows.get("ml_vc:777").value.attempts, 1);

    const ok = await call(app, USER, "ml_verify", { rowId, code: "1234" });
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.accounts[0].ml_linked, true);
    assert.equal(ok.body.accounts[0].ml_nickname, "Lily");
    assert.ok(!backend.settings.rows.has("ml_vc:777"), "kod holati tozalanadi");
    assert.equal((await call(app, USER, "ml_send_code", { rowId })).body.error, "already_linked");
  } finally {
    backend.restore();
  }
});

test("cabinet: ML link — 5 wrong codes lock the code", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();
    const rowId = (await call(app, USER, "account_add", { account_id: "123456", zone_id: "2001" })).body.accounts[0].id;
    await call(app, USER, "ml_send_code", { rowId });
    for (let i = 0; i < 5; i += 1) await call(app, USER, "ml_verify", { rowId, code: "9999" });
    assert.equal((await call(app, USER, "ml_verify", { rowId, code: "1234" })).body.error, "too_many");
  } finally {
    backend.restore();
  }
});

test("cabinet: buy requests go to the shop owner with buyer + item details", async () => {
  const backend = installCabinetBackend();
  try {
    const item = (await limitPrices.createLimitPriceStore(backend.settings.handle).save({ kind: "reset_pw", amount: 5, price: 10000 })).item;
    const app = loadAccountApp();

    const res = await call(app, USER, "buy_limit", { id: item.id });
    assert.equal(res.body.ok, true);
    assert.equal(backend.telegram.length, 1);
    assert.equal(String(backend.telegram[0].chat_id), "1");
    assert.match(backend.telegram[0].text, /#dokon_sorov #limit/);
    assert.match(backend.telegram[0].text, /@ali/);
    assert.match(backend.telegram[0].text, /10 000 so'm/);

    assert.equal((await call(app, USER, "buy_limit", { id: "zzzzzzzz" })).body.error, "not_available");
    assert.equal((await call(app, USER, "buy_firstmail", { id: "zzzzzzzz" })).body.error, "not_available");
  } finally {
    backend.restore();
  }
});

test("cabinet: firstmails come in pages of 30 (rest via the firstmails action)", async () => {
  const backend = installCabinetBackend();
  try {
    const shop = require("../api/_shop.js");
    const fmStore = shop.createFirstmailStore(backend.settings.handle);
    for (let i = 0; i < 35; i += 1) {
      await fmStore.create({ email: `user${String(i).padStart(2, "0")}@firstmail.ltd`, price: "10000" });
    }

    const app = loadAccountApp();
    const first = (await call(app, USER, "cabinet")).body;
    assert.equal(first.firstmails.length, 30);
    assert.equal(first.firstmailTotal, 35);
    assert.equal(first.firstmailHasMore, true);

    const next = (await call(app, USER, "firstmails", { offset: 30 })).body;
    assert.equal(next.items.length, 5);
    assert.equal(next.hasMore, false);
    const ids = new Set([...first.firstmails, ...next.items].map((f) => f.id));
    assert.equal(ids.size, 35, "sahifalar takrorlanmaydi");
  } finally {
    backend.restore();
  }
});
