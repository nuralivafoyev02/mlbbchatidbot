const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const hamyon = require("../api/_hamyon.js");
const elderpay = require("../api/_elderpay.js");
const walletLib = require("../api/_wallet.js");
const payEvents = require("../api/_pay-events.js");

// ---------------------------------------------------------------------------
// _hamyon.js
// ---------------------------------------------------------------------------
function hamyonFetch(handler) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    const href = String(url);
    const body = options.body ? Object.fromEntries(new URLSearchParams(options.body)) : null;
    calls.push({ url: href, body, headers: options.headers || {} });
    const [status, payload] = handler({ href, body });
    return new Response(JSON.stringify(payload), { status });
  };
  return { calls, fetchFn };
}

test("hamyon: create / check / cancel follow the REST API and return the card", async () => {
  const config = hamyon.resolveHamyonConfig({ HAMYON_SHOP_ID: "73", HAMYON_SHOP_KEY: "k" });
  assert.equal(config.apiUrl, "https://hamyon-api.uz");

  const { calls, fetchFn } = hamyonFetch(({ href, body }) => {
    if (body) {
      if (href.includes("/payment/create")) return [200, { payment_id: "pay-a1b2", card: "9860 1901 1131 6492", amount: "20000.00", expires_in: 300 }];
      return [200, { ok: true, payment_id: body.payment_id, status: "cancel" }];
    }
    return [200, { payment_id: "pay-a1b2", amount: 20000, status: "paid", created_at: "2026-10-10" }];
  });
  const client = hamyon.createHamyonClient({ config, fetchFn });
  assert.equal(client.enabled, true);

  assert.deepEqual(await client.createOrder({ amount: 20000, orderId: "42" }), {
    order: "pay-a1b2",
    amount: 20000,
    card: "9860190111316492",
    payUrl: null,
  });
  assert.deepEqual(calls[0].body, { shop_id: "73", shop_key: "k", amount: "20000", order_id: "42" });
  assert.equal(calls[0].headers["Content-Type"], "application/x-www-form-urlencoded");

  assert.deepEqual(await client.checkOrder("pay-a1b2"), { order: "pay-a1b2", status: "paid", amount: 20000, date: "2026-10-10" });
  assert.match(calls[1].url, /payment\/status\?payment_id=pay-a1b2/);
  assert.ok(calls[1].url.includes("shop_key=k"));

  assert.equal(await client.cancelOrder("pay-a1b2"), true);
  assert.deepEqual(calls[2].body, { shop_id: "73", shop_key: "k", payment_id: "pay-a1b2" });
});

test("elderpay: create / check / cancel speak JSON to /api; errors map to reasons without leaking the key", async () => {
  const config = elderpay.resolveElderPayConfig({ ELDERPAY_SHOP_ID: "445188", ELDERPAY_SHOP_KEY: "top-secret" });
  assert.equal(config.apiUrl, "https://pay.elder.uz");
  const calls = [];
  let next = [200, {}];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body), headers: options.headers });
    return new Response(JSON.stringify(next[1]), { status: next[0] });
  };
  const client = elderpay.createElderPayClient({ config, fetchFn });
  assert.equal(client.provider, "elderpay");

  next = [200, { status: "success", order: "o-1", pay_url: "https://pay.elder.uz/pay/t", data: { amount: "20000", over: 0 } }];
  assert.deepEqual(await client.createOrder({ amount: 20000, userId: 9 }), { order: "o-1", amount: 20000, card: null, payUrl: "https://pay.elder.uz/pay/t" });
  assert.equal(calls[0].url, "https://pay.elder.uz/api");
  assert.equal(calls[0].headers["Content-Type"], "application/json");
  assert.deepEqual(calls[0].body, { method: "create", shop_id: "445188", shop_key: "top-secret", amount: 20000, user_id: "tg_9" });

  next = [200, { status: "success", order: "o-1", data: { amount: 20000, status: "PAID", date: "2026-10-12" } }];
  assert.deepEqual(await client.checkOrder("o-1"), { order: "o-1", status: "paid", amount: 20000, date: "2026-10-12" });
  assert.deepEqual(calls[1].body, { method: "check", order: "o-1" });

  next = [200, { status: "success", message: "ok", order: "o-1" }];
  assert.equal(await client.cancelOrder("o-1"), true);
  assert.deepEqual(calls[2].body, { method: "cancel", order: "o-1", shop_id: "445188", shop_key: "top-secret" });

  for (const [status, reason] of [[400, "invalid"], [403, "auth"], [409, "conflict"], [500, "unavailable"]]) {
    next = [status, { status: "error", message: "Oylik to'lov qilinmagan!" }];
    const error = await client.createOrder({ amount: 1000 }).catch((e) => e);
    assert.equal(error.reason, reason);
    assert.ok(!error.message.includes("top-secret"));
  }
  assert.equal(client.parseCallback({}).ok, false);

  const off = elderpay.createElderPayClient({ config: elderpay.resolveElderPayConfig({}) });
  assert.equal(off.enabled, false);
  assert.equal((await off.createOrder({ amount: 1 }).catch((e) => e)).reason, "not_configured");
});

test("wallet: Hamyon is the default; ElderPay / manual only when chosen in the panel; panel keys beat env", () => {
  const both = { ELDERPAY_SHOP_ID: "1", ELDERPAY_SHOP_KEY: "aaaa", HAMYON_SHOP_ID: "2", HAMYON_SHOP_KEY: "bbbb" };
  assert.equal(walletLib.createPayClient(both).provider, "hamyon");
  assert.equal(walletLib.createPayClient(both, fetch, { mode: "elderpay" }).provider, "elderpay");
  assert.equal(walletLib.createPayClient(both, fetch, { mode: "manual" }).enabled, false);

  const s = walletLib.normalizeProviderSettings({ hamyon: { shopId: "77", shopKey: "panel-key" } }, both);
  assert.deepEqual(s.hamyon, { shopId: "77", shopKey: "panel-key", source: "panel" });
  assert.deepEqual(s.elderpay, { shopId: "1", shopKey: "aaaa", source: "env" });
  const pub = walletLib.publicProviderSettings(s);
  assert.deepEqual(pub.hamyon, { shopId: "77", keySet: true, keyHint: "••••-key", source: "panel" });
  assert.ok(!JSON.stringify(pub).includes("panel-key"), "shop_key panelga chiqmaydi");

  // Bo'sh kalit — eskisi qoladi; clear — panel kalitlari o'chadi; noto'g'ri qiymatlar rad etiladi.
  const stored = { mode: "hamyon", hamyon: { shopId: "77", shopKey: "panel-key" } };
  assert.deepEqual(walletLib.normalizeProviderInput({ mode: "hamyon", hamyon: { shopId: "78", shopKey: "" } }, stored).value.hamyon, { shopId: "78", shopKey: "panel-key" });
  assert.deepEqual(walletLib.normalizeProviderInput({ mode: "hamyon", hamyon: { clear: true } }, stored).value.hamyon, {});
  assert.equal(walletLib.normalizeProviderInput({ mode: "paypal" }).error, "provider_invalid");
  assert.equal(walletLib.normalizeProviderInput({ mode: "hamyon", hamyon: { shopId: "a b" } }).error, "shop_id_invalid");
  assert.equal(walletLib.normalizeProviderInput({ mode: "hamyon", hamyon: { shopId: "1", shopKey: "x" } }).error, "shop_key_invalid");
});

test("hamyon: wrong shop (400 'Do'kon topilmadi') is an auth error; unknown payment is not_found", async () => {
  const config = hamyon.resolveHamyonConfig({ HAMYON_SHOP_ID: "1", HAMYON_SHOP_KEY: "bad-key" });
  let reply = [400, { error: "Do'kon topilmadi!" }];
  const { fetchFn } = hamyonFetch(() => reply);
  const client = hamyon.createHamyonClient({ config, fetchFn });
  assert.equal((await client.createOrder({ amount: 1000 }).catch((e) => e)).reason, "auth");
  reply = [404, { error: "To'lov yaratilmagan!" }];
  assert.equal((await client.checkOrder("x").catch((e) => e)).reason, "not_found");
  reply = [400, { error: "amount noto'g'ri!" }];
  assert.equal((await client.createOrder({ amount: 0 }).catch((e) => e)).reason, "invalid");
});

test("hamyon: callback sign = md5(shop_id + payment_id + amount + shop_key)", () => {
  const client = hamyon.createHamyonClient({ config: hamyon.resolveHamyonConfig({ HAMYON_SHOP_ID: "12", HAMYON_SHOP_KEY: "sk_x" }) });
  const sign = require("node:crypto").createHash("md5").update("12a1b2c350000sk_x").digest("hex");
  const fields = { payment_id: "a1b2c3", order_id: "7", shop_id: "12", amount: "50000", status: "paid", paid_at: "1767225431", sign };

  assert.deepEqual(client.parseCallback(fields), {
    ok: true, order: "a1b2c3", orderId: "7", status: "paid", amount: 50000,
    paidAt: new Date(1767225431 * 1000).toISOString(), reason: null,
  });
  assert.equal(client.parseCallback({ ...fields, sign: sign.toUpperCase() }).ok, true);
  assert.equal(client.parseCallback({ ...fields, amount: "50001" }).error, "bad_sign");
  assert.equal(client.parseCallback({ ...fields, shop_id: "13" }).error, "shop_mismatch");
  assert.equal(client.parseCallback({ payment_id: "x" }).error, "invalid");
  assert.equal(hamyon.createHamyonClient({ config: hamyon.resolveHamyonConfig({}) }).parseCallback(fields).error, "not_configured");
});

test("hamyon: errors map to reasons, 400 conflict means busy amount, never leaks the key", async () => {
  const off = hamyon.createHamyonClient({ config: hamyon.resolveHamyonConfig({}) });
  assert.equal(off.enabled, false);
  await assert.rejects(off.createOrder({ amount: 1 }), (e) => e.reason === "not_configured");

  const config = hamyon.resolveHamyonConfig({ HAMYON_SHOP_ID: "1", HAMYON_SHOP_KEY: "super-secret" });

  // Conflict: shu summada ochiq to'lov bor → retry.
  const { fetchFn } = hamyonFetch(() => [400, { error: "Bu summada ochiq to'lov mavjud — summani biroz o'zgartiring!" }]);
  const client = hamyon.createHamyonClient({ config, fetchFn });
  await assert.rejects(client.createOrder({ amount: 1000 }), (e) => {
    assert.equal(e.reason, "conflict");
    assert.ok(!e.message.includes("super-secret"));
    return true;
  });

  for (const [status, reason] of [[403, "auth"], [400, "invalid"], [500, "unavailable"]]) {
    const { fetchFn } = hamyonFetch(() => [status, { error: "Xatolik sababi" }]);
    const client = hamyon.createHamyonClient({ config, fetchFn });
    await assert.rejects(client.checkOrder("x"), (e) => {
      assert.equal(e.reason, reason);
      assert.ok(!e.message.includes("super-secret"));
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// _wallet.js — konfiguratsiya
// ---------------------------------------------------------------------------
test("wallet: config merges admin settings over env and validates input", () => {
  const env = { WALLET_CARD_NUMBER: "8600-1234-5678-9012", WALLET_CARD_HOLDER: "ALI" };
  const fromEnv = walletLib.normalizeWalletConfig(null, env);
  assert.equal(fromEnv.cardNumber, "8600123456789012");
  assert.deepEqual([fromEnv.min, fromEnv.max, fromEnv.enabled], [5000, 5000000, true]);
  assert.equal(walletLib.formatCardNumber(fromEnv.cardNumber), "8600 1234 5678 9012");

  const stored = walletLib.normalizeWalletConfig({ cardNumber: "9860000011112222", min: "1000", presets: [5000, "x"] }, env);
  assert.deepEqual([stored.cardNumber, stored.cardHolder, stored.min, stored.presets], ["9860000011112222", "ALI", 1000, [5000]]);

  assert.equal(walletLib.normalizeWalletConfigInput({ cardNumber: "1234" }).error, "card_invalid");
  assert.equal(walletLib.normalizeWalletConfigInput({ min: "10", max: "5" }).error, "max_invalid");
  const ok = walletLib.normalizeWalletConfigInput({ cardNumber: "8600 0000 1111 2222", presets: "10000, 20 000;50000", enabled: "false" });
  assert.deepEqual([ok.value.presets, ok.value.enabled], [[10000, 20000, 50000], false]);
});

// ---------------------------------------------------------------------------
// supabase/020_wallet.sql — haqiqiy Postgres (PGlite) ustida
// ---------------------------------------------------------------------------
async function createWalletDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  // Supabase rollari: service_role RLS'ni chetlab o'tadi.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.bot_users (user_id bigint primary key, updated_at timestamptz default now());
    grant all on public.bot_users to service_role;
  `);
  for (const file of [
    "007_bot_settings.sql",
    "012_full_info_quota.sql",
    "014_reset_pw_quota.sql",
    "018_quota_usage_events.sql",
    "019_shop_orders.sql",
    "020_wallet.sql",
    "021_wallet_exact_amount.sql",
    "022_wallet_hamyon.sql",
    "023_wallet_provider_columns.sql",
  ]) {
    await db.exec(fs.readFileSync(path.join(__dirname, "..", "supabase", file), "utf8"));
  }
  await db.exec(`
    insert into bot_settings (key, value) values
      ('shop_lp:pkgaaaaa', '{"kind":"full_info","amount":10,"price":20000}'),
      ('shop_fm:fmaaaaaa', '{"email":"abcdef@firstmail.ltd","password":"pw1","price":"15 000","status":"available"}'),
      ('shop_fm:fmbbbbbb', '{"email":"x@firstmail.ltd","password":"pw2","price":"kelishiladi","status":"available"}');
    set role service_role;
  `);
  const one = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];
  return { db, one };
}

test("wallet sql: purchase is all-or-nothing and never goes below zero", async () => {
  const { db, one } = await createWalletDb();

  const poor = await one("select wallet_buy_limit(1, 'pkgaaaaa')");
  assert.deepEqual([poor.ok, poor.error, poor.balance], [false, "insufficient_funds", 0]);
  assert.equal(await one("select count(*)::int from shop_orders"), 0, "buyurtma ham bekor bo'ladi");

  const { topup } = await one("select wallet_create_topup(1, 30000)");
  assert.ok(topup.pay_amount > 30000 && topup.pay_amount < 31000);
  const credit = await one("select wallet_credit_topup('lderpay', 'tx1', $1, now())", [topup.pay_amount]);
  assert.deepEqual([credit.status, credit.balance], ["credited", topup.pay_amount]);
  assert.equal((await one("select wallet_credit_topup('lderpay', 'tx1', $1, now())", [topup.pay_amount])).status, "duplicate");
  assert.equal((await one("select wallet_credit_topup('lderpay', 'tx9', 12345, now())")).error, "not_matched");

  const limit = await one("select wallet_buy_limit(1, 'pkgaaaaa')");
  assert.deepEqual([limit.ok, limit.remaining, limit.balance], [true, 13, topup.pay_amount - 20000]);
  assert.equal(await one("select full_info_quota from bot_users where user_id = 1"), 13);

  const fm = await one("select wallet_buy_firstmail(1, 'fmaaaaaa')");
  assert.equal(fm.error, "insufficient_funds", "10 xxx so'm 15 000 ga yetmaydi");
  assert.equal(await one("select value->>'status' from bot_settings where key = 'shop_fm:fmaaaaaa'"), "available");
  assert.equal((await one("select wallet_buy_firstmail(1, 'fmbbbbbb')")).error, "price_not_set");

  assert.equal((await one("select wallet_admin_adjust(1, -999999, 'x')")).error, "insufficient_funds");
  await db.close();
});

test("wallet sql: firstmail is sold once; refund returns money once and can restock goods", async () => {
  const { db, one } = await createWalletDb();
  await one("select wallet_admin_adjust(1, 50000, 'bonus')");
  await one("select wallet_admin_adjust(2, 50000, 'bonus')");

  const fm = await one("select wallet_buy_firstmail(1, 'fmaaaaaa')");
  assert.deepEqual([fm.ok, fm.email, fm.password, fm.balance], [true, "abcdef@firstmail.ltd", "pw1", 35000]);
  assert.equal((await one("select wallet_buy_firstmail(2, 'fmaaaaaa')")).error, "not_available");
  const sold = await one("select value from bot_settings where key = 'shop_fm:fmaaaaaa'");
  assert.deepEqual([sold.status, sold.buyer_id], ["sold", "1"]);
  assert.equal(await one("select title from shop_orders where id = $1", [fm.order_id]), "abc•••@firstmail.ltd");

  const refund = await one("select wallet_refund_order($1, 'pochta ochilmadi', true)", [fm.order_id]);
  assert.deepEqual([refund.status, refund.balance], ["refunded", 50000]);
  assert.equal((await one("select wallet_refund_order($1, 'x', true)", [fm.order_id])).status, "already_refunded");
  assert.equal(await one("select balance from wallets where user_id = 1"), 50000);
  assert.equal(await one("select value->>'status' from bot_settings where key = 'shop_fm:fmaaaaaa'"), "available");

  // Limit qaytarilsa berilgan limit ham olib qo'yiladi.
  const limit = await one("select wallet_buy_limit(2, 'pkgaaaaa')");
  await one("select wallet_refund_order($1, 'xato', true)", [limit.order_id]);
  assert.equal(await one("select full_info_quota from bot_users where user_id = 2"), 3);

  const ledger = (await db.query("select kind, delta, balance_after from wallet_transactions where user_id = 1 order by id")).rows;
  assert.deepEqual(ledger.map((r) => [r.kind, Number(r.delta), Number(r.balance_after)]), [
    ["admin", 50000, 50000],
    ["purchase", -15000, 35000],
    ["refund", 15000, 50000],
  ]);
  await db.close();
});

test("wallet sql: exact mode gives the chosen amount, +1/+2 when it's taken", async () => {
  const { db, one } = await createWalletDb();
  const pays = [];
  for (let user = 1; user <= 3; user += 1) {
    pays.push((await one("select wallet_create_topup($1, 5000, 5, 10, true)", [user])).topup.pay_amount);
  }
  assert.deepEqual(pays, [5000, 5001, 5002]);
  // Bekor qilingan summa grace ichida boshqaga berilmaydi.
  const own = (await one("select wallet_create_topup(1, 7000, 5, 10, true)")).topup;
  assert.equal(own.pay_amount, 7000);
  assert.equal((await one("select wallet_create_topup(4, 5000, 5, 10, true)")).topup.pay_amount, 5003);
  await db.close();
});

test("wallet sql: pending topups get unique amounts; a late payment still finds its topup", async () => {
  const { db, one } = await createWalletDb();
  const amounts = new Set();
  for (let user = 1; user <= 20; user += 1) {
    amounts.add((await one("select wallet_create_topup($1, 10000)", [user])).topup.pay_amount);
  }
  assert.equal(amounts.size, 20);

  // Yangi so'rov eskisini bekor qiladi; bekor qilingan so'rovga kechikib kelgan pul ham yoziladi.
  const first = (await one("select wallet_create_topup(99, 20000)")).topup;
  const second = (await one("select wallet_create_topup(99, 25000)")).topup;
  assert.equal(await one("select status from wallet_topups where id = $1", [first.id]), "cancelled");
  assert.equal((await one("select wallet_credit_topup('lderpay', 'late', $1, now())", [first.pay_amount])).user_id, 99);
  assert.equal(await one("select status from wallet_topups where id = $1", [second.id]), "pending");

  assert.equal((await one("select wallet_create_topup(1, 0)")).error, "invalid_amount");
  await db.close();
});

// ---------------------------------------------------------------------------
// api/miniapp.js — admin panel: balans va to'lovlar
// ---------------------------------------------------------------------------
test("wallet admin: requires login; refund / manual topup / adjust call the RPCs and notify the user", async () => {
  const originalFetch = global.fetch;
  const modulePath = require.resolve("../api/miniapp.js");
  const rpcCalls = [];
  const telegram = [];

  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  process.env.ADMIN_PANEL_SECRET = "panel-secret";
  process.env.ADMIN_PANEL_USERNAME = "shop-admin";
  process.env.ADMIN_PANEL_PASSWORD = "shop-pass-123";
  process.env.TELEGRAM_BOT_TOKEN = "123:abc";
  delete require.cache[modulePath];

  const rpcResults = {
    wallet_refund_order: { ok: true, status: "refunded", user_id: 777, amount: 15000, balance: 20000 },
    wallet_credit_topup: { ok: true, status: "credited", user_id: 777, amount: 20347, balance: 40347 },
    wallet_admin_adjust: { ok: false, error: "insufficient_funds", balance: 100 },
  };
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith("https://api.telegram.org/")) {
      telegram.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const path = href.slice("https://testproject.supabase.co/rest/v1".length);
    let payload = [];
    if (path.startsWith("/rpc/")) {
      const name = path.slice(5);
      rpcCalls.push({ name, body: JSON.parse(options.body) });
      payload = rpcResults[name] || { ok: true };
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };

  const call = async (action, body = {}, cookie = "") => {
    const headers = {};
    let status = 200;
    let payload = null;
    const res = {
      status(code) { status = code; return this; },
      setHeader(key, value) { headers[key.toLowerCase()] = value; return this; },
      send(text) { payload = JSON.parse(text); return this; },
    };
    await require("../api/miniapp.js")({ method: "POST", headers: { cookie }, query: { action }, body: { action, ...body } }, res);
    return { status, payload, headers };
  };

  try {
    assert.equal((await call("wallet_refund", { order_id: "5" })).status, 401);
    const login = await call("login", { username: "shop-admin", password: "shop-pass-123" });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];

    const refund = await call("wallet_refund", { order_id: "5", reason: "pochta <ochilmadi>", reverse: true }, cookie);
    assert.equal(refund.payload.data.status, "refunded");
    assert.deepEqual(rpcCalls.at(-1), { name: "wallet_refund_order", body: { p_order_id: "5", p_reason: "pochta <ochilmadi>", p_reverse_goods: true } });
    assert.equal(telegram.at(-1).chat_id, "777");
    assert.match(telegram.at(-1).text, /15 000 so'm/);
    assert.match(telegram.at(-1).text, /pochta &lt;ochilmadi&gt;/);

    const confirm = await call("wallet_topup_confirm", { id: "12", amount: "20 347" }, cookie);
    assert.equal(confirm.payload.data.status, "credited");
    assert.deepEqual(
      [rpcCalls.at(-1).body.p_provider, rpcCalls.at(-1).body.p_txn_id, rpcCalls.at(-1).body.p_amount, rpcCalls.at(-1).body.p_topup_id],
      ["manual", "manual-12", 20347, "12"]
    );

    const adjust = await call("wallet_adjust", { user_id: "777", delta: "-5000" }, cookie);
    assert.deepEqual([adjust.status, adjust.payload.error], [400, "insufficient_funds"]);
    assert.equal((await call("wallet_adjust", { user_id: "abc", delta: 5 }, cookie)).payload.error, "invalid_user");
    assert.equal((await call("wallet_config_save", { cardNumber: "123" }, cookie)).payload.error, "card_invalid");
  } finally {
    global.fetch = originalFetch;
    for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_PANEL_SECRET", "ADMIN_PANEL_USERNAME", "ADMIN_PANEL_PASSWORD", "TELEGRAM_BOT_TOKEN"]) {
      delete process.env[key];
    }
    delete require.cache[modulePath];
  }
});

// ---------------------------------------------------------------------------
// Feat: statistika va jurnal
// ---------------------------------------------------------------------------
test("wallet stats: today / 7 days in Tashkent time, success rate and per-card income", async () => {
  const now = Date.parse("2026-10-12T10:00:00Z"); // Toshkent 15:00
  const at = (h) => new Date(now - h * 3600000).toISOString();
  const topups = [
    { id: 1, status: "paid", pay_amount: 50001, paid_amount: 50001, provider: "hamyon", card: "9860190111316492", created_at: at(1), paid_at: at(1) },
    { id: 2, status: "paid", pay_amount: 20000, paid_amount: 20000, provider: "hamyon", card: "9860 1901 1131 6492", created_at: at(30), paid_at: at(30) },
    { id: 3, status: "paid", pay_amount: 30500, paid_amount: 30500, provider: "manual", card: null, created_at: at(2), paid_at: at(2) },
    { id: 4, status: "expired", pay_amount: 10000, provider: "hamyon", card: "8600000000000001", created_at: at(3), expires_at: at(3) },
    { id: 5, status: "cancelled", pay_amount: 10000, provider: "hamyon", created_at: at(40) },
    // Toshkent bo'yicha kecha (UTC 18:30 = 23:30 TAS) — bugunga kirmaydi.
    { id: 6, status: "paid", pay_amount: 7000, paid_amount: 7000, provider: "hamyon", card: "9860190111316492", created_at: "2026-10-11T18:30:00Z", paid_at: "2026-10-11T18:30:00Z" },
  ];
  const requestFn = async (path) => {
    if (path.startsWith("/bot_settings") && path.includes("wallet_config")) return [{ value: { cardNumber: "8600123412341234" } }];
    if (path.startsWith("/wallet_topups")) return topups;
    return [];
  };
  const stats = await walletLib.createWallet(requestFn, { env: {} }).getStats({ now });
  assert.deepEqual([stats.today.paid, stats.today.paidSum, stats.today.created], [2, 80501, 3]);
  assert.deepEqual([stats.week.paid, stats.week.paidSum, stats.week.expired, stats.week.cancelled], [4, 107501, 1, 1]);
  assert.equal(stats.week.successRate, 67);
  assert.equal(stats.daily.length, 7);
  assert.equal(stats.daily[6].day, "2026-10-12");
  assert.equal(stats.daily[6].paidSum, 80501);
  assert.equal(stats.daily[5].paidSum, 27000, "kecha: 20 000 (30 soat oldin) + 7 000 (23:30 TAS)");

  const byCard = Object.fromEntries(stats.cards.map((c) => [c.card, c]));
  assert.deepEqual([byCard["9860190111316492"].paid, byCard["9860190111316492"].paidSum, byCard["9860190111316492"].todaySum], [3, 77001, 50001]);
  assert.deepEqual([byCard["8600123412341234"].isAdminCard, byCard["8600123412341234"].paidSum, byCard["8600123412341234"].providers], [true, 30500, ["manual"]]);
  assert.equal(byCard["8600000000000001"].paid, 0, "Hamyon bergan, hali to'lov olmagan karta ham ko'rinadi");
});

test("pay events: secrets are scrubbed, repeated problems throttled, missing table never breaks payments", async () => {
  payEvents.resetThrottle();
  const writes = [];
  let clock = 1000000;
  const events = payEvents.createPayEvents(async (path, options) => {
    if (options?.method === "POST") writes.push(options.body);
    return [];
  }, { now: () => clock });

  await events.record("error", "check", "hamyon_status_500", { provider: "hamyon", topupId: 7, data: { shop_key: "x", sign: "y", reason: "unavailable" } });
  await events.record("error", "check", "hamyon_status_500", { provider: "hamyon", topupId: 7 });
  await events.record("error", "check", "hamyon_status_500", { provider: "hamyon", topupId: 8 });
  clock += 61000;
  await events.record("error", "check", "hamyon_status_500", { provider: "hamyon", topupId: 7 });
  await events.record("info", "create", "ok", { topupId: "abc" });
  await events.record("info", "create", "ok", {});
  assert.equal(writes.length, 5, "bir xil xato 60 s ichida bir marta; info har doim");
  assert.deepEqual(writes[0].data, { reason: "unavailable" });
  assert.equal(writes[0].topup_id, "7");
  assert.equal(writes[3].topup_id, null, "raqam bo'lmagan id saqlanmaydi");

  let calls = 0;
  const broken = payEvents.createPayEvents(async () => {
    calls += 1;
    throw new Error('Supabase HTTP 404: {"code":"PGRST205","message":"Could not find the table wallet_events"}');
  });
  await broken.record("info", "create", "a");
  await broken.record("info", "create", "b");
  assert.equal(calls, 1, "jadval yo'q bo'lsa qayta urinilmaydi");
  assert.deepEqual(await broken.list(), { available: false, events: [] });
});

// ---------------------------------------------------------------------------
// Kabinet guruhlari (admin panel → Sozlamalar)
// ---------------------------------------------------------------------------
test("cabinet groups: links are normalized, bad input rejected, ids kept stable", () => {
  const groups = require("../api/_cabinet-groups.js");
  assert.equal(groups.normalizeGroupLink("@ksava_chat"), "https://t.me/ksava_chat");
  assert.equal(groups.normalizeGroupLink("t.me/+AbCdEf123"), "https://t.me/+AbCdEf123");
  assert.equal(groups.normalizeGroupLink("https://ksava.uz/a"), "https://ksava.uz/a");
  for (const bad of ["http://t.me/x", "javascript:alert(1)", "@ab", "https://user:pw@t.me/x", "ftp://x.uz", "nope"]) {
    assert.equal(groups.normalizeGroupLink(bad), "", bad);
  }

  const ok = groups.normalizeGroupsInput([{ id: "abc123", name: "  Chat  <b>", link: "@ksava_chat" }, { name: "Kanal", link: "https://t.me/ksava" }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.items[0].id, "abc123", "mavjud id saqlanadi");
  assert.equal(ok.items[0].name, "Chat b", "HTML belgilar olib tashlanadi");
  assert.match(ok.items[1].id, /^[a-f0-9]{10}$/);

  assert.deepEqual(groups.normalizeGroupsInput([{ name: "", link: "@ksava_chat" }]), { ok: false, error: "group_name_invalid", index: 0 });
  assert.deepEqual(groups.normalizeGroupsInput([{ name: "A", link: "http://x" }]), { ok: false, error: "group_link_invalid", index: 0 });
  assert.equal(groups.normalizeGroupsInput(Array.from({ length: 13 }, () => ({ name: "A", link: "@ksava_chat" }))).error, "groups_limit");
  assert.deepEqual(groups.toPublicGroup({ id: "1", name: "A", link: "https://t.me/x" }), { id: "1", name: "A", link: "https://t.me/x", telegram: true });
});
