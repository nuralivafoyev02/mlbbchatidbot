const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const limitPrices = require("../api/_limit-prices.js");
const quotaLog = require("../api/_quota-log.js");

const SUPABASE = "https://testproject.supabase.co/rest/v1";
const ARENA = "https://arena.example.test/api";
const BOT_TOKEN = "123456:test-token";
const ELDERPAY = "https://elderpay.example.test";

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
  await store.save({ kind: "reset_pw", amount: 10, price: 5000 });
  await store.save({ kind: "full_info", amount: 5, price: 12000 });
  // Ulanmalar tekshiruvi botda yo'q — bunday paket qabul qilinmaydi.
  assert.equal((await store.save({ kind: "bind_info", amount: 30, price: 15000 })).error, "kind_invalid");

  const list = await store.list();
  assert.deepEqual(list.map((i) => `${i.kind}:${i.amount}`), ["full_info:5", "full_info:20", "reset_pw:10"]);
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
  const orders = [];
  let nextId = 10;
  const history = [
    { id: 1, user_id: "777", kind: "full_info", delta: -1, source: "use", account_id: "555555", zone_id: "1", target: null, remaining: 2, created_at: "2026-10-09T10:00:00Z" },
  ];

  // 020_wallet.sql funksiyalarining soddalashtirilgan nusxasi.
  const wallet = { balances: new Map(), topups: [], txns: [] };
  const balanceOf = (userId) => wallet.balances.get(String(userId)) || 0;
  function apply(userId, delta, kind, extra = {}) {
    const next = balanceOf(userId) + delta;
    if (next < 0) return null;
    wallet.balances.set(String(userId), next);
    wallet.txns.unshift({ id: wallet.txns.length + 1, user_id: String(userId), delta, balance_after: next, kind, created_at: new Date().toISOString(), ...extra });
    return next;
  }
  function insertOrder(row) {
    const order = { id: orders.length + 1, created_at: new Date().toISOString(), ...row };
    orders.unshift(order);
    return order;
  }

  function walletRpc(name, args) {
    const userId = String(args.p_user_id);
    switch (name) {
      case "wallet_get": return { ok: true, balance: balanceOf(userId) };
      case "wallet_create_topup": {
        wallet.topups.filter((t) => t.user_id === userId && t.status === "pending").forEach((t) => { t.status = "cancelled"; });
        const topup = {
          id: wallet.topups.length + 1, user_id: userId, amount: args.p_amount, pay_amount: args.p_amount + 347, status: "pending",
          created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
        };
        wallet.topups.push(topup);
        return { ok: true, topup };
      }
      case "wallet_cancel_topup": {
        const topup = wallet.topups.find((t) => String(t.id) === String(args.p_topup_id) && t.user_id === userId && t.status === "pending");
        if (topup) topup.status = "cancelled";
        return { ok: Boolean(topup) };
      }
      case "wallet_credit_topup": {
        if (wallet.topups.some((t) => t.provider_txn_id === args.p_txn_id)) return { ok: true, status: "duplicate" };
        const topup = args.p_topup_id
          ? wallet.topups.find((t) => String(t.id) === String(args.p_topup_id))
          : wallet.topups.find((t) => t.pay_amount === args.p_amount && t.status !== "paid");
        if (!topup) return { ok: false, error: "not_matched" };
        if (topup.status === "paid") return { ok: true, status: "already_paid", topup_id: topup.id, user_id: topup.user_id };
        Object.assign(topup, { status: "paid", provider_txn_id: args.p_txn_id, paid_amount: args.p_amount });
        const balance = apply(topup.user_id, args.p_amount, "topup", { topup_id: topup.id });
        return { ok: true, status: "credited", topup_id: topup.id, user_id: topup.user_id, amount: args.p_amount, balance };
      }
      case "wallet_buy_limit": {
        const pkg = settings.rows.get(`shop_lp:${args.p_package_id}`);
        if (!pkg) return { ok: false, error: "not_available" };
        const { kind, amount, price } = pkg.value;
        if (balanceOf(userId) < price) return { ok: false, error: "insufficient_funds", price, balance: balanceOf(userId) };
        const order = insertOrder({ user_id: userId, kind: "limit", item_id: args.p_package_id, title: `${kind}:${amount}`, price, paid_amount: price, status: "done", delivery: { kind, amount } });
        const balance = apply(userId, -price, "purchase", { order_id: order.id });
        return { ok: true, order_id: order.id, balance, kind, amount, price, remaining: 2 + amount };
      }
      case "wallet_buy_firstmail": {
        const row = settings.rows.get(`shop_fm:${args.p_item_id}`);
        if (!row || row.value.status !== "available") return { ok: false, error: "not_available" };
        const price = Number(String(row.value.price).replace(/\s/g, ""));
        if (!price) return { ok: false, error: "price_not_set" };
        if (balanceOf(userId) < price) return { ok: false, error: "insufficient_funds", price, balance: balanceOf(userId) };
        const order = insertOrder({ user_id: userId, kind: "firstmail", item_id: args.p_item_id, title: "masked", price, paid_amount: price, status: "done", delivery: { email: row.value.email, password: row.value.password } });
        const balance = apply(userId, -price, "purchase", { order_id: order.id });
        row.value = { ...row.value, status: "sold", buyer_id: userId };
        return { ok: true, order_id: order.id, balance, price, email: row.value.email, password: row.value.password };
      }
      default:
        return undefined;
    }
  }

  function rpc(name, args) {
    const userId = String(args.p_user_id);
    const walletResult = walletRpc(name, args);
    if (walletResult !== undefined) return walletResult;
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
      if (path.startsWith("/shop_orders")) {
        if (String(options.method || "GET").toUpperCase() === "POST") {
          const row = { id: orders.length + 1, status: "pending", created_at: new Date().toISOString(), ...body };
          orders.unshift(row);
          return jsonResponse([row]);
        }
        const userId = new URL(`https://x${path}`).searchParams.get("user_id").slice(3);
        return jsonResponse(orders.filter((o) => String(o.user_id) === userId));
      }
      if (path.startsWith("/wallet_topups")) {
        const params = new URL(`https://x${path}`).searchParams;
        const matches = (t) =>
          (!params.get("id") || String(t.id) === params.get("id").slice(3)) &&
          (!params.get("user_id") || t.user_id === params.get("user_id").slice(3)) &&
          (!params.get("status") || (params.get("status").startsWith("neq.")
            ? t.status !== params.get("status").slice(4)
            : t.status === params.get("status").slice(3))) &&
          (!params.get("provider_order") || Boolean(t.provider_order));
        if (String(options.method || "GET").toUpperCase() === "PATCH") {
          wallet.topups.filter(matches).forEach((t) => Object.assign(t, body));
          return jsonResponse([]);
        }
        return jsonResponse(wallet.topups.filter(matches).slice().reverse());
      }
      if (path.startsWith("/wallet_transactions")) {
        const userId = new URL(`https://x${path}`).searchParams.get("user_id").slice(3);
        return jsonResponse(wallet.txns.filter((t) => t.user_id === userId));
      }
      if (path.startsWith("/bot_settings")) return jsonResponse(settings.handle(path, { ...options, body }));
      if (path.startsWith("/bot_users")) return jsonResponse([{ preferred_language: "uz", user_id: 1, chat_id: 1, username: "Ksava_org" }]);
      return jsonResponse([]);
    }
    if (href.startsWith(ELDERPAY)) {
      const call = JSON.parse(options.body);
      elderCalls.push(call);
      if (call.method === "create") {
        if (elder.conflicts > 0) {
          elder.conflicts -= 1;
          return jsonResponse({ status: "error", message: "Bu miqdordagi to'lov allaqachon mavjud" }, 409);
        }
        const order = `ord-${elderCalls.length}`;
        elder.orders.set(order, { amount: call.amount, status: "pending" });
        return jsonResponse({ status: "success", order, data: { amount: String(call.amount), over: 5 } });
      }
      const order = elder.orders.get(call.order);
      if (!order) return jsonResponse({ status: "error", message: "order topilmadi" }, 400);
      if (call.method === "check") {
        return jsonResponse({ status: "success", order: call.order, data: { amount: String(order.amount), status: order.status, date: "2026-10-09", over: 3 } });
      }
      if (call.method === "cancel") {
        order.status = "cancel";
        return jsonResponse({ status: "success", message: "ok", order: call.order });
      }
    }
    return jsonResponse({});
  };

  const elder = { orders: new Map(), conflicts: 0 };
  const elderCalls = [];
  return {
    settings, accounts, telegram, arenaCalls, orders, wallet, elder, elderCalls,
    restore: () => { global.fetch = original; },
  };
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
  process.env.WALLET_CARD_NUMBER = "8600 1234 5678 9012";
  process.env.WALLET_CARD_HOLDER = "ALI VALIYEV";
  process.env.ELDERPAY_API_URL = ELDERPAY;
  process.env.ELDERPAY_SHOP_ID = "123456";
  process.env.ELDERPAY_SHOP_KEY = "shop-secret-key";
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
    assert.deepEqual(Object.keys(d.limits), ["full_info", "reset_pw"]);
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

test("cabinet: limit is bought from the balance — insufficient funds first, then topup + purchase", async () => {
  const backend = installCabinetBackend();
  try {
    const item = (await limitPrices.createLimitPriceStore(backend.settings.handle).save({ kind: "reset_pw", amount: 5, price: 10000 })).item;
    const app = loadAccountApp();

    const poor = await call(app, USER, "buy_limit", { id: item.id });
    assert.equal(poor.statusCode, 402);
    assert.deepEqual([poor.body.error, poor.body.balance, poor.body.price], ["insufficient_funds", 0, 10000]);
    assert.equal(backend.orders.length, 0, "pul yetmasa buyurtma yozilmaydi");

    // To'ldirish: noyob summa, karta rekvizitlari.
    const cabinet = (await call(app, USER, "cabinet")).body;
    assert.equal(cabinet.wallet.balance, 0);
    assert.equal(cabinet.wallet.config.card, "8600 1234 5678 9012");
    assert.equal(cabinet.wallet.config.auto, true);
    assert.equal((await call(app, USER, "topup_create", { amount: 100 })).body.error, "invalid_amount");
    const topup = (await call(app, USER, "topup_create", { amount: 20000 })).body.topup;
    assert.equal(topup.pay_amount, 20347);

    // ElderPay'da aynan shu summaga buyurtma ochildi (shop_key faqat serverda).
    assert.deepEqual(backend.elderCalls[0], { method: "create", shop_id: "123456", shop_key: "shop-secret-key", amount: 20347, user_id: "tg_777" });
    assert.ok(!JSON.stringify(topup).includes("shop-secret-key"));

    // Pul hali tushmagan.
    const early = (await call(app, USER, "topup_check", { id: topup.id })).body;
    assert.deepEqual([early.ok, early.credited, early.topup.status], [true, false, "pending"]);
    assert.deepEqual(backend.elderCalls.at(-1), { method: "check", order: "ord-1" });

    // Boshqa user birovning so'rovini tekshira olmaydi.
    assert.equal((await call(app, { id: 888, first_name: "B" }, "topup_check", { id: topup.id })).statusCode, 404);

    backend.elder.orders.get("ord-1").status = "paid";
    const paid = (await call(app, USER, "topup_check", { id: topup.id })).body;
    assert.deepEqual([paid.credited, paid.balance, paid.topup.status], [true, 20347, "paid"]);
    assert.ok(backend.telegram.some((m) => String(m.chat_id) === "777" && /Balans to'ldirildi/.test(m.text)));

    // Qayta tekshirish ikkinchi marta yozmaydi.
    assert.equal((await call(app, USER, "topup_check", { id: topup.id })).body.balance, 20347);

    const bought = (await call(app, USER, "buy_limit", { id: item.id })).body;
    assert.equal(bought.ok, true);
    assert.equal(bought.balance, 10347);
    assert.deepEqual(bought.limit, { kind: "reset_pw", amount: 5, remaining: 7 });
    assert.equal(bought.order.status, "done");
    assert.ok(backend.telegram.some((m) => String(m.chat_id) === "1" && /#sotuv #limit/.test(m.text) && /@ali/.test(m.text)));

    const wallet = (await call(app, USER, "wallet")).body;
    assert.deepEqual(wallet.transactions.map((t) => [t.kind, t.delta]), [["purchase", -10000], ["topup", 20347]]);

    assert.equal((await call(app, USER, "buy_limit", { id: "zzzzzzzz" })).body.error, "not_available");
    assert.equal((await call(app, USER, "buy_firstmail", { id: "zzzzzzzz" })).body.error, "not_available");
  } finally {
    backend.restore();
  }
});

test("cabinet: firstmail from balance reveals credentials to the buyer only; agreed-price mail stays a request", async () => {
  const backend = installCabinetBackend();
  try {
    const shop = require("../api/_shop.js");
    const store = shop.createFirstmailStore(backend.settings.handle);
    const fm = (await store.create({ email: "secretbox@firstmail.ltd", password: "pw-123", price: "15 000" })).item;
    const agreed = (await store.create({ email: "deal@firstmail.ltd", price: "kelishiladi" })).item;
    backend.wallet.balances.set("777", 20000);
    const app = loadAccountApp();

    const res = (await call(app, USER, "buy_firstmail", { id: fm.id })).body;
    assert.equal(res.ok, true);
    assert.deepEqual(res.delivery, { email: "secretbox@firstmail.ltd", password: "pw-123" });
    assert.equal(res.balance, 5000);
    assert.deepEqual(res.order.delivery, { email: "secretbox@firstmail.ltd", password: "pw-123" });

    // Ikkinchi xaridor ololmaydi.
    backend.wallet.balances.set("888", 50000);
    assert.equal((await call(app, { id: 888, first_name: "B" }, "buy_firstmail", { id: fm.id })).body.error, "not_available");

    // Kabinet tarixida login/parol faqat egasida.
    const mine = (await call(app, USER, "cabinet")).body;
    assert.equal(mine.orders[0].delivery.password, "pw-123");
    const other = (await call(app, { id: 888, first_name: "B" }, "cabinet")).body;
    assert.ok(!JSON.stringify(other).includes("pw-123"));

    // Narx kelishiladigan pochta — eski so'rov yo'li, balansdan yechilmaydi.
    const manual = (await call(app, USER, "buy_firstmail", { id: agreed.id })).body;
    assert.deepEqual([manual.ok, manual.manual], [true, true]);
    assert.equal(manual.order.status, "pending");
    assert.equal(backend.wallet.balances.get("777"), 5000);
  } finally {
    backend.restore();
  }
});

test("cabinet: ElderPay — 409 picks another amount, cancel closes the order, a paid order is credited on the next cabinet open", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();

    // Shu summada boshqa faol to'lov bor — so'rov bekor qilinib, qayta yaratiladi.
    backend.elder.conflicts = 1;
    const first = (await call(app, USER, "topup_create", { amount: 50000 })).body;
    assert.equal(first.ok, true);
    assert.equal(backend.wallet.topups.length, 2);
    assert.equal(backend.wallet.topups[0].status, "cancelled");
    assert.equal(backend.wallet.topups[1].provider_order, "ord-2");

    // Bekor qilish ElderPay'dagi buyurtmani ham yopadi.
    assert.equal((await call(app, USER, "topup_cancel", { id: first.topup.id })).body.ok, true);
    assert.equal(backend.elder.orders.get("ord-2").status, "cancel");

    // To'lab, oynani yopib qo'ygan foydalanuvchi: kabinet ochilganda yoziladi.
    const second = (await call(app, USER, "topup_create", { amount: 30000 })).body.topup;
    const order = backend.wallet.topups.find((t) => String(t.id) === second.id).provider_order;
    backend.elder.orders.get(order).status = "paid";
    const cabinet = (await call(app, USER, "cabinet")).body;
    assert.equal(cabinet.wallet.balance, 30347);
    assert.ok(backend.telegram.some((m) => String(m.chat_id) === "777" && /Balans to'ldirildi/.test(m.text)));

    // ElderPay ishlamasa — foydalanuvchiga tushunarli xato, so'rov ochiq qolmaydi.
    backend.elder.conflicts = 5;
    const busy = (await call(app, USER, "topup_create", { amount: 10000 })).body;
    assert.equal(busy.error, "busy");
    assert.ok(backend.wallet.topups.every((t) => t.status !== "pending"));
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

test("cabinet: background image is served from the account function", async () => {
  const app = loadAccountApp();
  const res = createRes();
  await app({ method: "GET", query: { asset: "bg" }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /^image\//);
  assert.ok(Buffer.isBuffer(res.body) && res.body.length > 1000);
});
