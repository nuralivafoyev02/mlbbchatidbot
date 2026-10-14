const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const limitPrices = require("../api/_limit-prices.js");
const quotaLog = require("../api/_quota-log.js");

const SUPABASE = "https://testproject.supabase.co/rest/v1";
const ARENA = "https://arena.example.test/api";
const BOT_TOKEN = "123456:test-token";
const HAMYON = "https://hamyon-api.example.test";
const ELDER = "https://pay.elder.example.test";

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
        // p_exact (021): aniq summa, band bo'lsa +1, +2 ...; aks holda tasodifiy (+347).
        let pay = args.p_amount + (args.p_exact ? 0 : 347);
        while (args.p_exact && wallet.topups.some((t) => t.pay_amount === pay && t.status !== "paid")) pay += 1;
        const topup = {
          id: wallet.topups.length + 1, user_id: userId, amount: args.p_amount, pay_amount: pay, status: "pending",
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
      if (path.startsWith("/wallet_events")) {
        if (String(options.method || "GET").toUpperCase() === "POST") {
          walletEvents.unshift({ id: walletEvents.length + 1, created_at: new Date().toISOString(), ...body });
          return jsonResponse([]);
        }
        const params = new URL(`https://x${path}`).searchParams;
        return jsonResponse(walletEvents.filter((e) =>
          ["level", "kind", "provider"].every((f) => !params.get(f) || !params.get(f).startsWith("eq.") || String(e[f]) === params.get(f).slice(3))
        ).slice(0, Number(params.get("limit") || 100)));
      }
      if (path.startsWith("/wallet_topups")) {
        const params = new URL(`https://x${path}`).searchParams;
        const matches = (t) =>
          (!params.get("id") || String(t.id) === params.get("id").slice(3)) &&
          (!params.get("user_id") || t.user_id === params.get("user_id").slice(3)) &&
          (!params.get("status") || (params.get("status").startsWith("neq.")
            ? t.status !== params.get("status").slice(4)
            : t.status === params.get("status").slice(3))) &&
          (!params.get("provider_order") || (params.get("provider_order").startsWith("eq.")
            ? t.provider_order === params.get("provider_order").slice(3)
            : Boolean(t.provider_order)));
        if (String(options.method || "GET").toUpperCase() === "PATCH") {
          if (wallet.failPatch) return jsonResponse({ code: "PGRST204", message: "Could not find the 'provider_order' column" }, 400);
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
    if (href.startsWith(HAMYON)) {
      const url = new URL(href);
      if (url.pathname === "/payment/create") {
        const call = Object.fromEntries(new URLSearchParams(options.body));
        hamyonCalls.push({ path: url.pathname, body: call });
        if (hamyon.conflicts > 0) {
          hamyon.conflicts -= 1;
          return jsonResponse({ error: "Bu summada ochiq to'lov mavjud — summani biroz o'zgartiring!" }, 400);
        }
        const paymentId = `pay-${hamyonCalls.length}`;
        hamyon.orders.set(paymentId, { amount: Number(call.amount), status: "pending" });
        return jsonResponse({ payment_id: paymentId, order_id: call.order_id, card: "8600 1234 5678 9012", amount: Number(call.amount), expires_in: 300 });
      }
      if (url.pathname === "/payment/status") {
        const order = hamyon.orders.get(url.searchParams.get("payment_id"));
        if (!order) return jsonResponse({ error: "payment topilmadi" }, 400);
        return jsonResponse({ payment_id: url.searchParams.get("payment_id"), amount: order.amount, status: order.status, created_at: "2026-10-09" });
      }
      if (url.pathname === "/payment/cancel") {
        const call = Object.fromEntries(new URLSearchParams(options.body));
        hamyonCalls.push({ path: url.pathname, body: call });
        const order = hamyon.orders.get(call.payment_id);
        if (order) order.status = "cancel";
        return jsonResponse({ ok: true, payment_id: call.payment_id, status: "cancel" });
      }
    }
    if (href === `${ELDER}/api`) {
      const call = JSON.parse(options.body);
      elderCalls.push(call);
      if (call.method === "create") {
        if (elder.conflicts > 0) {
          elder.conflicts -= 1;
          return jsonResponse({ status: "error", message: "Shu summada faol to'lov mavjud" }, 409);
        }
        const order = `ep-${elderCalls.length}`;
        elder.orders.set(order, { amount: call.amount, status: "pending" });
        return jsonResponse({
          status: "success",
          order,
          ...(elder.page ? { pay_url: `https://pay.elder.uz/pay/${order}` } : {}),
          data: { amount: call.amount, over: 0 },
        });
      }
      const found = elder.orders.get(call.order);
      if (!found) return jsonResponse({ status: "error", message: "order topilmadi" }, 400);
      if (call.method === "check") {
        return jsonResponse({ status: "success", order: call.order, data: { amount: found.amount, status: found.status, date: "2026-10-12" } });
      }
      if (call.method === "cancel") {
        found.status = "cancel";
        return jsonResponse({ status: "success", message: "cancelled", order: call.order });
      }
    }
    return jsonResponse({});
  };

  const walletEvents = [];
  require("../api/_pay-events.js").resetThrottle();
  const elder = { orders: new Map(), conflicts: 0, page: false };
  const elderCalls = [];
  const hamyon = { orders: new Map(), conflicts: 0 };
  const hamyonCalls = [];
  return {
    settings, accounts, telegram, arenaCalls, orders, wallet, hamyon, hamyonCalls, elder, elderCalls, walletEvents,
    restore: () => { global.fetch = original; },
  };
}

function loadAccountApp({ provider = "hamyon", card = "8600 1234 5678 9012" } = {}) {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_BOT_USERNAME = "checkmlbbidBot";
  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  process.env.MLBB_ARENA_API_URL = ARENA;
  process.env.MLBB_LINK_SECRET = "test-link-secret";
  process.env.SUPPORT_USERNAME = "Ksava_org";
  process.env.ADMIN_IDS = "5081175125";
  delete process.env.SHOP_NOTIFY_CHAT_ID;
  process.env.WALLET_CARD_NUMBER = card;
  process.env.WALLET_CARD_HOLDER = "ALI VALIYEV";
  process.env.HAMYON_API_URL = HAMYON;
  process.env.HAMYON_SHOP_ID = "123456";
  process.env.HAMYON_SHOP_KEY = "shop-secret-key";
  if (provider === "elderpay") {
    process.env.ELDERPAY_API_URL = ELDER;
    process.env.ELDERPAY_SHOP_ID = "445100";
    process.env.ELDERPAY_SHOP_KEY = "elder-secret-key";
  } else {
    delete process.env.ELDERPAY_SHOP_ID;
    delete process.env.ELDERPAY_SHOP_KEY;
  }
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
    // Batafsil oyna uchun: qachon qo'shilgani va tarkibi (parolning o'zi emas).
    assert.equal(d.firstmails[0].has_password, true);
    assert.ok(!Number.isNaN(Date.parse(d.firstmails[0].created_at)));
    assert.ok(!JSON.stringify(d).includes("secret-pass"), "parol kabinetga chiqmasligi kerak");
  } finally {
    backend.restore();
  }
});

test("cabinet: groups from the admin panel show in settings; language is saved for bot and cabinet", async () => {
  const backend = installCabinetBackend();
  try {
    const groups = require("../api/_cabinet-groups.js").createCabinetGroupsStore(backend.settings.handle);
    assert.equal((await groups.save([{ name: "Asosiy guruh", link: "@ksava_chat" }, { name: "Sayt", link: "https://ksava.uz/info" }])).ok, true);

    const app = loadAccountApp();
    const d = (await call(app, USER, "cabinet")).body;
    assert.deepEqual(d.groups.map((g) => [g.name, g.link, g.telegram]), [
      ["Asosiy guruh", "https://t.me/ksava_chat", true],
      ["Sayt", "https://ksava.uz/info", false],
    ]);

    assert.equal((await call(app, USER, "set_lang", { value: "de" })).statusCode, 400);
    const saved = await call(app, USER, "set_lang", { value: "ru" });
    assert.deepEqual([saved.statusCode, saved.body.lang], [200, "ru"]);
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

function fakeJwt(claims) {
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(claims)}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
}

test("cabinet: ML link — the Mini App logs in to Arena itself; the server only checks and stores the token", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();
    const rowId = (await call(app, USER, "account_add", { account_id: "123456", zone_id: "2001" })).body.accounts[0].id;

    // Boshqa foydalanuvchi bu qatorni ulay olmaydi; noto'g'ri token rad etiladi.
    const token = fakeJwt({ roleid: 123456, zoneid: 2001, exp: 9999999999 });
    assert.equal((await call(app, { id: 888, first_name: "B" }, "ml_link", { rowId, token })).statusCode, 404);
    assert.equal((await call(app, USER, "ml_link", { rowId, token: "not-a-jwt" })).body.error, "invalid_token");
    assert.equal((await call(app, USER, "ml_link", { rowId, token: fakeJwt({ roleid: 999999, zoneid: 2001 }) })).body.error, "invalid_token",
      "boshqa akkaunt tokeni bilan ulab bo'lmaydi");

    const ok = await call(app, USER, "ml_link", { rowId, token, nickname: "  Lily<script>  " });
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.accounts[0].ml_linked, true);
    assert.equal(ok.body.accounts[0].ml_nickname, "Lilyscript");
    const stored = backend.accounts[0].ml_token;
    assert.ok(stored && !stored.includes(token), "token shifrlangan holda saqlanadi");
    assert.equal((await call(app, USER, "ml_link", { rowId, token })).body.error, "already_linked");

    // Server Arena'ga umuman murojaat qilmaydi (u yerdan bloklangan).
    assert.equal(backend.arenaCalls.length, 0);
  } finally {
    backend.restore();
  }
});

test("cabinet: Mini App HTML carries the browser Arena client", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();
    const res = createRes();
    await app({ method: "GET", headers: {}, query: { view: "cabinet" }, url: "/api/account?view=cabinet" }, res);
    assert.match(res.body, /window\.ArenaWeb = createArenaWeb/);
    assert.ok(!res.body.includes("<!-- arena-web -->"));
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
    assert.equal(topup.pay_amount, 20000, "Hamyon rejimida aniq summa");
    assert.equal(topup.card, "8600123456789012", "mijozga o'tkaziladigan karta ko'rsatiladi");

    // Hamyon'da aynan shu summaga buyurtma ochildi (shop_key faqat serverda).
    assert.deepEqual(backend.hamyonCalls[0], {
      path: "/payment/create",
      body: { shop_id: "123456", shop_key: "shop-secret-key", amount: "20000", order_id: String(topup.id) },
    });
    assert.ok(!JSON.stringify(topup).includes("shop-secret-key"));

    // Pul hali tushmagan.
    const early = (await call(app, USER, "topup_check", { id: topup.id })).body;
    assert.deepEqual([early.ok, early.credited, early.topup.status], [true, false, "pending"]);
    assert.equal(backend.hamyon.orders.get("pay-1").status, "pending");

    // Boshqa user birovning so'rovini tekshira olmaydi.
    assert.equal((await call(app, { id: 888, first_name: "B" }, "topup_check", { id: topup.id })).statusCode, 404);

    backend.hamyon.orders.get("pay-1").status = "paid";
    const paid = (await call(app, USER, "topup_check", { id: topup.id })).body;
    assert.deepEqual([paid.credited, paid.balance, paid.topup.status], [true, 20000, "paid"]);
    assert.ok(backend.telegram.some((m) => String(m.chat_id) === "777" && /Balans to'ldirildi/.test(m.text)));

    // Qayta tekshirish ikkinchi marta yozmaydi.
    assert.equal((await call(app, USER, "topup_check", { id: topup.id })).body.balance, 20000);

    const bought = (await call(app, USER, "buy_limit", { id: item.id })).body;
    assert.equal(bought.ok, true);
    assert.equal(bought.balance, 10000);
    assert.deepEqual(bought.limit, { kind: "reset_pw", amount: 5, remaining: 7 });
    assert.equal(bought.order.status, "done");
    assert.ok(backend.telegram.some((m) => String(m.chat_id) === "1" && /#sotuv #limit/.test(m.text) && /@ali/.test(m.text)));
    // Asosiy guruhga ham: kim, qaysi limitdan nechta, qanchaga.
    const groupLimit = backend.telegram.find((m) => String(m.chat_id) === "-1003832186200" && /#sotuv #limit/.test(m.text));
    assert.ok(groupLimit, "limit xaridi asosiy guruhga ham boradi");
    assert.match(groupLimit.text, /@ali .*Parolni tiklash.*limitidan <b>5 ta<\/b> sotib oldi — 10 000 so'm\./);
    assert.equal(groupLimit.reply_markup.inline_keyboard[0][0].url, "tg://user?id=777");

    const wallet = (await call(app, USER, "wallet")).body;
    assert.deepEqual(wallet.transactions.map((t) => [t.kind, t.delta]), [["purchase", -10000], ["topup", 20000]]);

    // Kabinet "Tarix → To'lovlar": ledger xarid buyurtmasiga va to'ldirishga bog'langan.
    const tx = (await call(app, USER, "cabinet")).body.transactions;
    assert.deepEqual(tx.map((t) => [t.kind, t.delta]), [["purchase", -10000], ["topup", 20000]]);
    assert.equal(tx[0].order_id, String(bought.order.id));
    assert.equal(tx[1].topup_id, String(topup.id));

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
    assert.equal(res.order.title, "secretbox@firstmail.ltd", "tarixda pochta ochiq");
    const delivered = backend.telegram.find((m) => String(m.chat_id) === "777" && /Firstmail xaridingiz/.test(m.text));
    assert.ok(delivered, "pochta va parol bot orqali ham yuboriladi");
    assert.match(delivered.text, /secretbox@firstmail\.ltd/);
    assert.match(delivered.text, /pw-123/);
    assert.match(delivered.text, /Balansdan yechildi: <b>15 000 so'm<\/b>/);
    assert.match(delivered.text, /Qoldiq: <b>5 000 so'm<\/b>/, "qolgan balans ham yuboriladi");
    // Asosiy guruhga: "@ali secretbox@firstmail.ltd ni sotib oldi" — parolsiz.
    const groupSale = backend.telegram.find((m) => String(m.chat_id) === "-1003832186200" && /#sotuv #firstmail/.test(m.text));
    assert.ok(groupSale, "pochta xaridi asosiy guruhga ham boradi");
    assert.match(groupSale.text, /@ali <b>secretbox@firstmail\.ltd<\/b> ni sotib oldi — 15 000 so'm\./);
    assert.ok(!groupSale.text.includes("pw-123"), "parol guruhga chiqmaydi");
    assert.equal(delivered.parse_mode, "HTML");

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

test("cabinet: Hamyon — conflict picks another amount, cancel closes the order, a paid order is credited on the next cabinet open", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();

    // Shu summada boshqa faol to'lov bor — so'rov bekor qilinib, qayta yaratiladi.
    backend.hamyon.conflicts = 1;
    const first = (await call(app, USER, "topup_create", { amount: 50000 })).body;
    assert.equal(first.ok, true);
    assert.equal(backend.wallet.topups.length, 2);
    assert.equal(backend.wallet.topups[0].status, "cancelled");
    assert.equal(backend.wallet.topups[1].provider_order, "pay-2");
    assert.deepEqual(backend.wallet.topups.map((t) => t.pay_amount), [50000, 50001], "band bo'lsa +1 so'm");

    // Bekor qilish Hamyon'dagi buyurtmani ham yopadi.
    assert.equal((await call(app, USER, "topup_cancel", { id: first.topup.id })).body.ok, true);
    assert.equal(backend.hamyon.orders.get("pay-2").status, "cancel");

    // To'lab, oynani yopib qo'ygan foydalanuvchi: kabinet ochilganda yoziladi.
    const second = (await call(app, USER, "topup_create", { amount: 30000 })).body.topup;
    const order = backend.wallet.topups.find((t) => String(t.id) === second.id).provider_order;
    backend.hamyon.orders.get(order).status = "paid";
    const cabinet = (await call(app, USER, "cabinet")).body;
    assert.equal(cabinet.wallet.balance, 30000);
    assert.deepEqual(cabinet.topups.map((t) => [t.paid_amount, t.reference]), [[30000, order]], "tarixda to'ldirish ko'rinadi");
    assert.ok(backend.telegram.some((m) => String(m.chat_id) === "777" && /Balans to'ldirildi/.test(m.text)));

    // Hamyon ishlamasa — foydalanuvchiga tushunarli xato, so'rov ochiq qolmaydi.
    backend.hamyon.conflicts = 5;
    const busy = (await call(app, USER, "topup_create", { amount: 10000 })).body;
    assert.equal(busy.error, "busy");
    assert.ok(backend.wallet.topups.every((t) => t.status !== "pending"));
  } finally {
    backend.restore();
  }
});

function useProvider(backend, mode, extra = {}) {
  backend.settings.handle("/bot_settings?on_conflict=key", { method: "POST", body: { key: "wallet_provider", value: { mode, ...extra } } });
}

test("cabinet: ElderPay — admin card, 409 picks another amount, polling credits once, cancel closes the order", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp({ provider: "elderpay" });
    // Env'da kalit bo'lsa ham default — Hamyon; ElderPay panelda tanlanadi.
    assert.equal((await call(app, USER, "wallet")).body.config.provider, "hamyon");
    useProvider(backend, "elderpay");
    assert.equal((await call(app, USER, "wallet")).body.config.provider, "elderpay");

    // 409 — shu summada faol to'lov bor: +1 so'm bilan qayta.
    backend.elder.conflicts = 1;
    const created = (await call(app, USER, "topup_create", { amount: 50000 })).body;
    assert.equal(created.ok, true);
    assert.equal(created.topup.pay_amount, 50001);
    assert.equal(created.topup.card, null, "api rejimida admin kartasi ko'rsatiladi");
    assert.deepEqual(backend.elderCalls[1], { method: "create", shop_id: "445100", shop_key: "elder-secret-key", amount: 50001, user_id: "tg_777" });
    const row = backend.wallet.topups.find((t) => String(t.id) === created.topup.id);
    assert.equal(row.provider, "elderpay");
    assert.equal(row.provider_order, "ep-2");

    // Hali to'lanmagan — kabinet polling'i kutadi.
    const waiting = (await call(app, USER, "topup_check", { id: created.topup.id })).body;
    assert.equal(waiting.credited, false);
    assert.equal(waiting.topup.status, "pending");

    // To'landi — polling balansga yozadi (animatsiya status=paid bo'yicha), ikkinchi marta yozmaydi.
    backend.elder.orders.get("ep-2").status = "paid";
    const paid = (await call(app, USER, "topup_check", { id: created.topup.id })).body;
    assert.equal(paid.credited, true);
    assert.equal(paid.topup.status, "paid");
    assert.equal(paid.balance, 50001);
    const again = (await call(app, USER, "topup_check", { id: created.topup.id })).body;
    assert.equal(again.credited, false);
    assert.equal(again.balance, 50001);
    assert.equal(backend.telegram.filter((m) => /Balans to'ldirildi/.test(m.text)).length, 1);

    const cabinet = (await call(app, USER, "cabinet")).body;
    assert.deepEqual(cabinet.topups.map((t) => [t.provider, t.paid_amount, t.reference]), [["elderpay", 50001, "ep-2"]]);

    // Bekor qilish ElderPay'dagi buyurtmani ham yopadi.
    const next = (await call(app, USER, "topup_create", { amount: 20000 })).body.topup;
    assert.equal((await call(app, USER, "topup_cancel", { id: next.id })).body.ok, true);
    assert.equal(backend.elder.orders.get("ep-5").status, "cancel");
    assert.ok(!JSON.stringify(backend.telegram).includes("elder-secret-key"));
  } finally {
    backend.restore();
  }
});

test("cabinet: ElderPay page mode saves pay_url; api mode without an admin card refuses to open a payment", async () => {
  const backend = installCabinetBackend();
  try {
    backend.elder.page = true;
    useProvider(backend, "elderpay");
    let app = loadAccountApp({ provider: "elderpay" });
    const page = (await call(app, USER, "topup_create", { amount: 30000 })).body;
    assert.equal(page.topup.pay_url, "https://pay.elder.uz/pay/ep-1");
    assert.equal(backend.wallet.topups[0].pay_url, "https://pay.elder.uz/pay/ep-1");
    await call(app, USER, "topup_cancel", { id: page.topup.id });

    backend.elder.page = false;
    app = loadAccountApp({ provider: "elderpay", card: "" });
    const refused = (await call(app, USER, "topup_create", { amount: 30000 })).body;
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "topup_disabled");
    assert.ok(backend.wallet.topups.every((t) => t.status !== "pending"));
    assert.ok([...backend.elder.orders.values()].every((o) => o.status === "cancel"));
  } finally {
    backend.restore();
  }
});

function hamyonSign(paymentId, amount) {
  return crypto.createHash("md5").update(`123456${paymentId}${amount}shop-secret-key`).digest("hex");
}

async function hamyonCallback(app, fields, { form = true } = {}) {
  const res = createRes();
  const body = form ? new URLSearchParams(fields).toString() : fields;
  await app({ method: "POST", headers: {}, query: { hook: "hamyon" }, body }, res);
  return res;
}

test("cabinet: Hamyon complete_url callback credits once, verifies the sign and closes cancelled orders", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();
    const topup = (await call(app, USER, "topup_create", { amount: 25000 })).body.topup;
    const row = backend.wallet.topups.find((t) => String(t.id) === topup.id);
    const paid = { payment_id: row.provider_order, order_id: topup.id, shop_id: "123456", amount: "25000", status: "paid", paid_at: "1767225431" };

    // Soxta imzo — rad etiladi, balans o'zgarmaydi.
    const forged = await hamyonCallback(app, { ...paid, sign: hamyonSign(row.provider_order, "1") });
    assert.equal(forged.statusCode, 403);
    assert.equal(row.status, "pending");

    // Boshqa summa — yozilmaydi (summa o'z bazamizdan).
    const wrong = await hamyonCallback(app, { ...paid, amount: "99999", sign: hamyonSign(row.provider_order, "99999") });
    assert.equal(wrong.statusCode, 200);
    assert.equal(row.status, "pending");

    const ok = await hamyonCallback(app, { ...paid, sign: hamyonSign(row.provider_order, "25000") });
    assert.deepEqual([ok.statusCode, ok.body], [200, { result: "ok" }]);
    assert.equal(row.status, "paid");
    assert.equal(backend.wallet.balances.get("777"), 25000);
    assert.equal(backend.telegram.filter((m) => String(m.chat_id) === "777" && /Balans to'ldirildi/.test(m.text)).length, 1);
    // Xabardagi ✅ ➕ 💳 — premium (custom) emoji, HTML rejimida.
    const credited = backend.telegram.find((m) => String(m.chat_id) === "777" && /Balans to'ldirildi/.test(m.text));
    assert.equal(credited.parse_mode, "HTML");
    const premiumIds = require("../api/emojis.json").premium;
    for (const id of ["✅", "➕", "💳"].map((emoji) => premiumIds[emoji])) {
      assert.ok(credited.text.includes(`<tg-emoji emoji-id="${id}">`), id);
    }
    assert.ok(!/(?<!>)💰/.test(credited.text));

    // Hamyon qayta yuborsa — ikkinchi marta yozilmaydi; kabinet ham "paid" ko'radi.
    assert.equal((await hamyonCallback(app, { ...paid, sign: hamyonSign(row.provider_order, "25000") }, { form: false })).statusCode, 200);
    assert.equal(backend.wallet.balances.get("777"), 25000);
    const check = (await call(app, USER, "topup_check", { id: topup.id })).body;
    assert.deepEqual([check.topup.status, check.balance], ["paid", 25000]);

    // cancel (timeout) callback kutilayotgan so'rovni yopadi.
    const next = (await call(app, USER, "topup_create", { amount: 15000 })).body.topup;
    const nextRow = backend.wallet.topups.find((t) => String(t.id) === next.id);
    const cancel = { payment_id: nextRow.provider_order, order_id: next.id, shop_id: "123456", amount: "15000", status: "cancel", reason: "timeout" };
    assert.equal((await hamyonCallback(app, { ...cancel, sign: hamyonSign(nextRow.provider_order, "15000") })).statusCode, 200);
    assert.equal(nextRow.status, "cancelled");
  } finally {
    backend.restore();
  }
});

test("cabinet: panel keys beat env; switching provider keeps in-flight Hamyon payments working; journal records it all", async () => {
  const backend = installCabinetBackend();
  try {
    // Panelda boshqa Hamyon do'koni — create shu kalit bilan, callback imzosi ham shu bilan.
    useProvider(backend, "hamyon", { hamyon: { shopId: "999", shopKey: "panel-key-1" } });
    const app = loadAccountApp({ provider: "elderpay" });
    const topup = (await call(app, USER, "topup_create", { amount: 40000 })).body.topup;
    assert.deepEqual([backend.hamyonCalls[0].body.shop_id, backend.hamyonCalls[0].body.shop_key], ["999", "panel-key-1"]);
    const row = backend.wallet.topups.find((t) => String(t.id) === topup.id);
    assert.equal(row.provider, "hamyon");

    // Admin ElderPay'ga o'tdi — ochiq Hamyon to'lovi baribir Hamyon bilan tekshiriladi.
    useProvider(backend, "elderpay", { hamyon: { shopId: "999", shopKey: "panel-key-1" } });
    backend.hamyon.orders.get(row.provider_order).status = "paid";
    const checked = (await call(app, USER, "topup_check", { id: topup.id })).body;
    assert.deepEqual([checked.credited, checked.topup.status, checked.balance], [true, "paid", 40000]);
    assert.equal(backend.elderCalls.length, 0, "Hamyon to'lovi ElderPay'ga yuborilmaydi");

    // Hamyon callback'i ham (imzo panel kaliti bilan) qabul qilinadi; env kaliti bilan — yo'q.
    const sign = (key, id, amount) => crypto.createHash("md5").update(`999${id}${amount}${key}`).digest("hex");
    const fields = { payment_id: row.provider_order, order_id: topup.id, shop_id: "999", amount: "40000", status: "paid" };
    assert.equal((await hamyonCallback(app, { ...fields, sign: sign("shop-secret-key", row.provider_order, "40000") })).statusCode, 403);
    assert.equal((await hamyonCallback(app, { ...fields, sign: sign("panel-key-1", row.provider_order, "40000") })).statusCode, 200);
    assert.equal(backend.wallet.balances.get("777"), 40000, "qayta yozilmaydi");

    // "Tekshirish" test to'lovining callback'i — 200, hech narsa o'zgarmaydi.
    const health = { payment_id: "pay-health", order_id: "health-1767225431", shop_id: "999", amount: "1042", status: "cancel" };
    const before = JSON.stringify(backend.wallet.topups);
    assert.equal((await hamyonCallback(app, { ...health, sign: sign("panel-key-1", "pay-health", "1042") })).statusCode, 200);
    assert.equal(JSON.stringify(backend.wallet.topups), before);

    const kinds = backend.walletEvents.map((e) => `${e.level}:${e.kind}`);
    for (const expected of ["info:create", "info:credit", "warn:callback", "info:callback"]) {
      assert.ok(kinds.includes(expected), `${expected} jurnalda bo'lishi kerak: ${kinds.join(", ")}`);
    }
    assert.ok(backend.walletEvents.some((e) => /Test to'lov callback'i keldi/.test(e.message)));
    assert.ok(!JSON.stringify(backend.walletEvents).includes("panel-key-1"), "kalit jurnalga tushmaydi");
    assert.ok(!JSON.stringify(backend.walletEvents).match(/"sign"/), "imzo jurnalga tushmaydi");
  } finally {
    backend.restore();
  }
});

test("cabinet: manual mode shows the admin card and opens no provider payment", async () => {
  const backend = installCabinetBackend();
  try {
    useProvider(backend, "manual");
    const app = loadAccountApp();
    const wallet = (await call(app, USER, "wallet")).body;
    assert.deepEqual([wallet.config.auto, wallet.config.provider, wallet.config.card], [false, null, "8600 1234 5678 9012"]);
    const topup = (await call(app, USER, "topup_create", { amount: 20000 })).body.topup;
    assert.ok(topup.pay_amount > 20000 && topup.pay_amount < 21000, "qo'lda rejimda noyob summa");
    assert.equal(backend.hamyonCalls.length, 0);
  } finally {
    backend.restore();
  }
});

test("cabinet: if the Hamyon payment can't be saved, it is closed on both sides instead of hanging open", async () => {
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();
    backend.wallet.failPatch = true;
    const res = await call(app, USER, "topup_create", { amount: 10000 });
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, "wallet_unavailable");
    assert.equal(backend.hamyon.orders.get("pay-1").status, "cancel");
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

test("cabinet: reply-keyboard launch token works without initData; expired and forged ones are refused", async () => {
  const launch = require("../api/_cabinet-launch.js");
  const backend = installCabinetBackend();
  try {
    const app = loadAccountApp();
    const send = async (body) => {
      const res = createRes();
      await app({ method: "POST", headers: {}, query: {}, body }, res);
      return res;
    };

    // Telegram reply tugmasidan ochilganda initData bo'sh — bot bergan kalit bilan kiriladi.
    const ok = await send({ action: "cabinet", initData: "", launch: launch.createCabinetLaunchToken(777, BOT_TOKEN) });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.user.id, "777");

    const expired = await send({
      action: "cabinet",
      launch: launch.createCabinetLaunchToken(777, BOT_TOKEN, { now: Date.now() - 40 * 24 * 3600 * 1000 }),
    });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.body.error, "launch_expired");

    const forged = launch.createCabinetLaunchToken(777, "999:other-bot-token");
    assert.equal((await send({ action: "cabinet", launch: forged })).body.error, "unauthorized");
    const swapped = launch.createCabinetLaunchToken(777, BOT_TOKEN).replace(/^777\./, "778.");
    assert.equal((await send({ action: "cabinet", launch: swapped })).body.error, "unauthorized");
  } finally {
    backend.restore();
  }
});

test("cabinet: avatar comes from the Bot API as a data URL (photo_url is missing without initData)", async () => {
  const launch = require("../api/_cabinet-launch.js");
  const backend = installCabinetBackend();
  const backendFetch = global.fetch;
  const avatarCalls = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  let hasPhoto = true;

  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/getUserProfilePhotos")) {
      avatarCalls.push(JSON.parse(options.body));
      return jsonResponse({ ok: true, result: { total_count: hasPhoto ? 1 : 0, photos: hasPhoto ? [[
        { file_id: "big", width: 640, height: 640 },
        { file_id: "small", width: 160, height: 160 },
      ]] : [] } });
    }
    if (href.endsWith("/getFile")) {
      assert.equal(JSON.parse(options.body).file_id, "small", "smallest size that is >= 160 px");
      return jsonResponse({ ok: true, result: { file_id: "small", file_path: "profile_photos/file_1.jpg", file_size: jpeg.length } });
    }
    if (href.startsWith("https://api.telegram.org/file/bot")) {
      return new Response(jpeg, { status: 200 });
    }
    return backendFetch(url, options);
  };

  try {
    const app = loadAccountApp();
    const res = createRes();
    await app({ method: "POST", headers: {}, query: {}, body: { action: "avatar", launch: launch.createCabinetLaunchToken(777, BOT_TOKEN) } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.photo, `data:image/jpeg;base64,${jpeg.toString("base64")}`);
    assert.equal(avatarCalls[0].user_id, 777, "only the signed-in user's photo");
    assert.ok(!JSON.stringify(res.body).includes(BOT_TOKEN), "bot token never reaches the browser");

    hasPhoto = false;
    const none = await call(app, USER, "avatar");
    assert.deepEqual(none.body, { ok: true, photo: null });

    const anon = createRes();
    await app({ method: "POST", headers: {}, query: {}, body: { action: "avatar" } }, anon);
    assert.equal(anon.statusCode, 401);
  } finally {
    backend.restore();
  }
});

test("cabinet: firstmail purchase still succeeds when the bot cannot deliver the message, and the reason is logged", async () => {
  const backend = installCabinetBackend();
  const backendFetch = global.fetch;
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(" "));
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    if (String(url).endsWith("/sendMessage") && String(body.chat_id) === "777") {
      return jsonResponse({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, 403);
    }
    return backendFetch(url, options);
  };

  try {
    const fm = (await require("../api/_shop.js").createFirstmailStore(backend.settings.handle)
      .create({ email: "blocked@firstmail.ltd", password: "pw-9", price: "10000" })).item;
    backend.wallet.balances.set("777", 10000);
    const app = loadAccountApp();

    const res = (await call(app, USER, "buy_firstmail", { id: fm.id })).body;
    assert.equal(res.ok, true);
    assert.deepEqual(res.delivery, { email: "blocked@firstmail.ltd", password: "pw-9" }, "kabinetda baribir ko'rinadi");
    assert.equal(res.balance, 0);
    const line = logged.find((entry) => entry.includes("[WALLET_FM_DELIVERY]"));
    assert.ok(line && /blocked by the user/.test(line), "sabab log'ga yoziladi");
    assert.ok(!line.includes("pw-9") && !line.includes(BOT_TOKEN), "parol va token log'ga tushmaydi");
  } finally {
    console.error = originalError;
    backend.restore();
  }
});

test("cabinet: new sb_secret_ key goes only in apikey; a legacy JWT key also goes in Authorization", async () => {
  const original = global.fetch;
  const seen = [];
  global.fetch = async (url, options = {}) => {
    if (String(url).startsWith(SUPABASE)) seen.push(options.headers || {});
    return jsonResponse([]);
  };
  try {
    await call(loadAccountApp(), USER, "cabinet");
    assert.ok(seen.length > 0);
    assert.ok(seen.every((h) => h.apikey === "sb_secret_test-role-key" && !("Authorization" in h)));

    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";
    seen.length = 0;
    loadAccountApp();
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt;
    delete require.cache[require.resolve("../api/account.js")];
    await call(require("../api/account.js"), USER, "cabinet");
    assert.ok(seen.length > 0);
    assert.ok(seen.every((h) => h.apikey === jwt && h.Authorization === `Bearer ${jwt}`));
  } finally {
    global.fetch = original;
  }
});
