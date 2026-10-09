const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const elderpay = require("../api/_elderpay.js");
const walletLib = require("../api/_wallet.js");

// ---------------------------------------------------------------------------
// _elderpay.js
// ---------------------------------------------------------------------------
function elderFetch(handler) {
  const calls = [];
  const fetchFn = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    const [status, payload] = handler(body);
    return new Response(JSON.stringify(payload), { status });
  };
  return { calls, fetchFn };
}

test("elderpay: create / check / cancel follow the v1 API", async () => {
  const config = elderpay.resolveElderPayConfig({ ELDERPAY_SHOP_ID: "123456", ELDERPAY_SHOP_KEY: "k" });
  assert.equal(config.apiUrl, "https://pay.elder.uz");

  const { calls, fetchFn } = elderFetch((body) => {
    if (body.method === "create") return [200, { status: "success", order: "a1b2", pay_url: "https://pay.elder.uz/pay/t", data: { amount: "15000", over: 5 } }];
    if (body.method === "check") return [200, { status: "success", order: "a1b2", data: { amount: "15000", status: "paid", date: "2026-06-23", over: 3 } }];
    return [200, { status: "success", message: "ok", order: "a1b2" }];
  });
  const client = elderpay.createElderPayClient({ config, fetchFn });
  assert.equal(client.enabled, true);

  assert.deepEqual(await client.createOrder({ amount: 15000, userId: 777 }), { order: "a1b2", amount: 15000, payUrl: "https://pay.elder.uz/pay/t" });
  assert.deepEqual(calls[0], { url: "https://pay.elder.uz/api", body: { method: "create", shop_id: "123456", shop_key: "k", amount: 15000, user_id: "tg_777" } });

  assert.deepEqual(await client.checkOrder("a1b2"), { order: "a1b2", status: "paid", amount: 15000, date: "2026-06-23" });
  assert.deepEqual(calls[1].body, { method: "check", order: "a1b2" }, "check'da shop_key yuborilmaydi");

  assert.equal(await client.cancelOrder("a1b2"), true);
  assert.deepEqual(calls[2].body, { method: "cancel", order: "a1b2", shop_id: "123456", shop_key: "k" });
});

test("elderpay: errors map to reasons and never leak the shop key", async () => {
  const off = elderpay.createElderPayClient({ config: elderpay.resolveElderPayConfig({}) });
  assert.equal(off.enabled, false);
  await assert.rejects(off.createOrder({ amount: 1 }), (e) => e.reason === "not_configured");

  const config = elderpay.resolveElderPayConfig({ ELDERPAY_SHOP_ID: "1", ELDERPAY_SHOP_KEY: "super-secret" });
  for (const [status, reason] of [[409, "conflict"], [403, "auth"], [400, "invalid"], [500, "unavailable"]]) {
    const { fetchFn } = elderFetch(() => [status, { status: "error", message: "Xatolik sababi" }]);
    const client = elderpay.createElderPayClient({ config, fetchFn });
    await assert.rejects(client.createOrder({ amount: 1000 }), (e) => {
      assert.equal(e.reason, reason);
      assert.ok(!e.message.includes("super-secret"));
      return true;
    });
  }

  // 200 lekin status=error — ham xato.
  const { fetchFn } = elderFetch(() => [200, { status: "error", message: "order topilmadi" }]);
  await assert.rejects(elderpay.createElderPayClient({ config, fetchFn }).checkOrder("x"), (e) => e.reason === "unavailable");
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
