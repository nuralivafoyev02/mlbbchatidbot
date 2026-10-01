const assert = require("node:assert/strict");
const test = require("node:test");

const shop = require("../api/_shop.js");

// ---------------------------------------------------------------------------
// Soxta Supabase: faqat bot_settings jadvali (shop_fm:* va boshqa kalitlar).
// ---------------------------------------------------------------------------
function createFakeBotSettings() {
  const rows = new Map();

  function handle(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const url = new URL(`https://fake.local/rest/v1${path}`);
    const table = url.pathname.replace(/^\/rest\/v1\//, "");

    if (table !== "bot_settings") {
      return method === "GET" ? [] : {};
    }

    const keyFilter = url.searchParams.get("key") || "";

    if (method === "GET") {
      if (keyFilter.startsWith("eq.")) {
        const row = rows.get(keyFilter.slice(3));
        return row ? [row] : [];
      }

      if (keyFilter.startsWith("like.")) {
        const prefix = keyFilter.slice(5).replace(/\*$/, "");
        return [...rows.values()].filter((row) => row.key.startsWith(prefix));
      }

      return [...rows.values()];
    }

    if (method === "POST") {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      const row = { key: body.key, value: body.value, updated_at: body.updated_at || new Date().toISOString() };
      rows.set(row.key, row);
      return [row];
    }

    if (method === "DELETE") {
      rows.delete(keyFilter.slice(3));
      return [];
    }

    return [];
  }

  return { rows, handle };
}

// ---------------------------------------------------------------------------
// _shop.js — yordamchi funksiyalar
// ---------------------------------------------------------------------------
test("shop: email masking hides the local part", () => {
  assert.equal(shop.maskShopEmail("abcdef@firstmail.ltd"), "abc•••@firstmail.ltd");
  assert.equal(shop.maskShopEmail("ab@firstmail.ltd"), "a•••@firstmail.ltd");
  assert.equal(shop.maskShopEmail(""), "");
});

test("shop: numeric prices get thousands separators", () => {
  assert.equal(shop.formatShopPrice("15000"), "15 000 so'm");
  assert.equal(shop.formatShopPrice("1500000", "UZS"), "1 500 000 UZS");
  assert.equal(shop.formatShopPrice("$2"), "$2");
  assert.equal(shop.formatShopPrice(""), "");
});

test("shop: input validation rejects bad emails", () => {
  assert.equal(shop.normalizeFirstmailInput({ email: "" }).error, "email_required");
  assert.equal(shop.normalizeFirstmailInput({ email: "not-an-email" }).error, "email_invalid");
  const ok = shop.normalizeFirstmailInput({ email: " Test@FirstMail.ltd ", password: "p@ss word", price: " 10000 " });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.email, "test@firstmail.ltd");
  assert.equal(ok.value.password, "p@ss word");
  assert.equal(ok.value.price, "10000");
});

test("shop: bulk parser accepts common separators and skips duplicates", () => {
  const { items, invalid } = shop.parseBulkFirstmails([
    "one@firstmail.ltd:pass1",
    "two@firstmail.ltd pass2",
    "three@firstmail.ltd|pa:ss3",
    "one@firstmail.ltd:dup",
    "",
    "broken line",
  ].join("\n"));

  assert.deepEqual(items.map((i) => [i.email, i.password]), [
    ["one@firstmail.ltd", "pass1"],
    ["two@firstmail.ltd", "pass2"],
    ["three@firstmail.ltd", "pa:ss3"],
  ]);
  assert.equal(invalid.length, 1);
});

test("shop: sorting puts available first and sold last", () => {
  const sorted = shop.sortFirstmails([
    { id: "a", status: "sold", sold_at: "2026-01-01T00:00:00Z", created_at: "2025-01-01T00:00:00Z" },
    { id: "b", status: "available", created_at: "2026-01-01T00:00:00Z" },
    { id: "c", status: "available", created_at: "2026-02-01T00:00:00Z" },
  ]);

  assert.deepEqual(sorted.map((i) => i.id), ["c", "b", "a"]);
  assert.deepEqual(shop.filterFirstmails(sorted, "B").map((i) => i.id), ["b"]);
});

test("shop: store supports create, edit, sold and delete", async () => {
  const fake = createFakeBotSettings();
  const store = shop.createFirstmailStore(async (path, options) => fake.handle(path, options));

  const created = await store.create({ email: "seller@firstmail.ltd", password: "x", price: "20000" });
  assert.equal(created.ok, true);
  assert.equal(created.item.status, "available");
  assert.ok(fake.rows.has(`shop_fm:${created.item.id}`));

  const dup = await store.create({ email: "SELLER@firstmail.ltd" });
  assert.equal(dup.error, "email_exists");

  const many = await store.createMany(
    [{ email: "a@firstmail.ltd", password: "1" }, { email: "seller@firstmail.ltd" }],
    { price: "5000" }
  );
  assert.equal(many.created.length, 1);
  assert.equal(many.created[0].price, "5000");
  assert.equal(many.skipped[0].error, "email_exists");

  const edited = await store.update(created.item.id, { price: "25000", note: "yangi" });
  assert.equal(edited.item.price, "25000");
  assert.equal(edited.item.note, "yangi");
  assert.equal(edited.item.email, "seller@firstmail.ltd");

  const sold = await store.setSold(created.item.id, true);
  assert.equal(sold.item.status, "sold");
  assert.ok(sold.item.sold_at);

  const list = await store.list();
  assert.equal(list[list.length - 1].id, created.item.id, "sold item goes to the end");

  const restored = await store.setSold(created.item.id, false);
  assert.equal(restored.item.status, "available");
  assert.equal(restored.item.sold_at, null);

  await store.remove(created.item.id);
  assert.equal(await store.get(created.item.id), null);
  assert.equal((await store.update("nonexistent1", {})).error, "not_found");
});

// ---------------------------------------------------------------------------
// Bot oqimi: Do'kon tugmasi, shop rejimi, ro'yxat va xarid so'rovi.
// ---------------------------------------------------------------------------
function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader() {
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    },
  };
}

function loadBotWithSupabase() {
  process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.SUPPORT_USERNAME = "Ksava_org";
  process.env.ADMIN_IDS = "5081175125";
  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.MAIN_GROUP_ID;
  delete global.__MLBB_BOT_STATS__;
  delete require.cache[require.resolve("../api/bot.js")];

  return require("../api/bot.js");
}

test("shop: Do'kon mode disables ID checks and lists firstmails with sold ones struck through", async () => {
  const originalFetch = global.fetch;
  const fake = createFakeBotSettings();
  const telegramCalls = [];
  const externalCalls = [];

  global.fetch = async (url, options = {}) => {
    const href = String(url);

    if (href.startsWith("https://api.telegram.org/")) {
      const payload = options.body ? JSON.parse(options.body) : {};
      telegramCalls.push({ method: href.split("/").pop(), payload });
      return new Response(JSON.stringify({ ok: true, result: { message_id: telegramCalls.length } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (href.startsWith("https://testproject.supabase.co/rest/v1")) {
      const path = href.slice("https://testproject.supabase.co/rest/v1".length);
      const data = path.startsWith("/rpc/") ? null : fake.handle(path, options);
      return new Response(data === null ? "" : JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    externalCalls.push(href);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  const send = async (bot, body) => {
    await bot({ method: "POST", headers: { "x-telegram-bot-api-secret-token": "test-secret" }, query: {}, body }, createRes());
    await new Promise((resolve) => setImmediate(resolve));
  };

  const userId = 7700123;
  const message = (updateId, text) => ({
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: userId, type: "private" },
      from: { id: userId, first_name: "Ali", username: "ali_buyer" },
      text,
    },
  });

  try {
    const bot = loadBotWithSupabase();
    const store = shop.createFirstmailStore(async (path, options) => fake.handle(path, options));
    const available = (await store.create({ email: "freshmail@firstmail.ltd", password: "secret-pass", price: "15000" })).item;
    const soldItem = (await store.create({ email: "oldmail@firstmail.ltd", password: "x", price: "9000" })).item;
    await store.setSold(soldItem.id, true);

    // Asosiy klaviaturada Do'kon tugmasi bor.
    assert.match(JSON.stringify(bot.__private.mainKeyboard({ id: userId })), /🛒 Do'kon/);

    // 1) Do'kon tugmasi — shop klaviaturasi.
    await send(bot, message(9101, "🛒 Do'kon"));
    const welcome = telegramCalls.find((c) => c.method === "sendMessage" && /Do'kon/.test(c.payload.text));
    assert.ok(welcome, "shop welcome should be sent");
    const welcomeButtons = welcome.payload.reply_markup.keyboard.flat().map((b) => b.text);
    assert.deepEqual(welcomeButtons, ["📧 Firstmail sotib olish", "⬅️ Orqaga"]);

    // 2) Shop rejimida ID + server yuborilsa tekshiruv ishlamaydi.
    telegramCalls.length = 0;
    await send(bot, message(9102, "1289050 10050"));
    assert.equal(externalCalls.length, 0, "MLBB lookup must not run inside the shop");
    const blocked = telegramCalls.find((c) => c.method === "sendMessage");
    assert.match(blocked.payload.text, /Do'kon<\/b> bo'limidasiz/);

    // 3) Firstmail ro'yxati: sotilgani ustidan chizilgan, parol ko'rinmaydi.
    telegramCalls.length = 0;
    await send(bot, message(9103, "📧 Firstmail sotib olish"));
    const list = telegramCalls.find((c) => c.method === "sendMessage" && /Firstmail/.test(c.payload.text));
    assert.ok(list, "firstmail list should be sent");
    assert.match(list.payload.text, /<code>fre•••@firstmail\.ltd<\/code> — 15 000 so'm/);
    assert.match(list.payload.text, /<s>old•••@firstmail\.ltd<\/s>/);
    assert.doesNotMatch(list.payload.text, /secret-pass|freshmail@/);
    const itemButtons = list.payload.reply_markup.inline_keyboard.flat().filter((b) => b.callback_data?.startsWith("shop_fm:"));
    assert.deepEqual(itemButtons.map((b) => b.callback_data), [`shop_fm:${available.id}`], "only available items are buyable");

    // 4) Xarid so'rovi — adminga to'liq email bilan xabar boradi.
    telegramCalls.length = 0;
    await send(bot, {
      update_id: 9104,
      callback_query: {
        id: "cb-buy",
        data: `shop_fm_buy:${available.id}`,
        from: { id: userId, first_name: "Ali", username: "ali_buyer" },
        message: { message_id: 55, chat: { id: userId, type: "private" } },
      },
    });
    const adminNotice = telegramCalls.find((c) => c.method === "sendMessage" && String(c.payload.chat_id) === "5081175125");
    assert.ok(adminNotice, "admin should be notified");
    assert.match(adminNotice.payload.text, /freshmail@firstmail\.ltd/);
    assert.match(adminNotice.payload.text, /@ali_buyer/);
    const buyerReply = telegramCalls.find((c) => c.method === "editMessageText" && String(c.payload.chat_id) === String(userId));
    assert.ok(buyerReply, "buyer message should be edited");
    assert.match(buyerReply.payload.text, /adminga yuborildi/);
    assert.equal(buyerReply.payload.reply_markup.inline_keyboard[0][0].url, "https://t.me/Ksava_org");

    // 5) Sotilgan mahsulotni sotib olib bo'lmaydi.
    telegramCalls.length = 0;
    await send(bot, {
      update_id: 9105,
      callback_query: {
        id: "cb-sold",
        data: `shop_fm_buy:${soldItem.id}`,
        from: { id: userId, first_name: "Ali" },
        message: { message_id: 56, chat: { id: userId, type: "private" } },
      },
    });
    const soldReply = telegramCalls.find((c) => c.method === "editMessageText");
    assert.match(soldReply.payload.text, /allaqachon sotilgan/);
    assert.equal(telegramCalls.filter((c) => String(c.payload.chat_id) === "5081175125").length, 0);

    // 6) Orqaga — asosiy klaviatura qaytadi, ID tekshiruv yana ishlaydi.
    telegramCalls.length = 0;
    await send(bot, message(9106, "⬅️ Orqaga"));
    const back = telegramCalls.find((c) => c.method === "sendMessage");
    assert.match(JSON.stringify(back.payload.reply_markup), /🔎 Server aniqlash/);

    await send(bot, message(9107, "1289050 10050"));
    assert.ok(externalCalls.length > 0, "server check should run again after leaving the shop");
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[require.resolve("../api/bot.js")];
  }
});

test("shop: slash commands leave the shop mode", async () => {
  const originalFetch = global.fetch;
  const telegramCalls = [];

  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith("https://api.telegram.org/")) {
      telegramCalls.push({ method: href.split("/").pop(), payload: options.body ? JSON.parse(options.body) : {} });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const bot = loadBotWithSupabase();
    const req = (updateId, text) => ({
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "test-secret" },
      query: {},
      body: {
        update_id: updateId,
        message: { chat: { id: 7700200, type: "private" }, from: { id: 7700200, first_name: "Vali" }, text },
      },
    });

    await bot(req(9201, "🛒 Do'kon"), createRes());
    telegramCalls.length = 0;
    await bot(req(9202, "/start"), createRes());

    const start = telegramCalls.find((c) => c.method === "sendMessage");
    assert.match(JSON.stringify(start.payload.reply_markup), /🔎 Server aniqlash/);
    assert.equal(global.__MLBB_BOT_STATS__.userModes.get("7700200"), undefined);
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[require.resolve("../api/bot.js")];
  }
});

// ---------------------------------------------------------------------------
// Admin panel (miniapp) — Do'kon → Firstmail API
// ---------------------------------------------------------------------------
test("shop: admin panel API requires login and manages firstmails", async () => {
  const originalFetch = global.fetch;
  const fake = createFakeBotSettings();
  const modulePath = require.resolve("../api/miniapp.js");

  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  process.env.ADMIN_PANEL_SECRET = "panel-secret";
  delete require.cache[modulePath];

  global.fetch = async (url, options = {}) => {
    const href = String(url);
    const path = href.slice("https://testproject.supabase.co/rest/v1".length);
    return new Response(JSON.stringify(fake.handle(path, options)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
    await require("../api/miniapp.js")(
      { method: "POST", headers: { cookie }, query: { action }, body: { action, ...body } },
      res
    );
    return { status, payload, headers };
  };

  try {
    const denied = await call("shop_fm_list");
    assert.equal(denied.status, 401);

    const login = await call("login", { username: "admin", password: "admin123" });
    assert.equal(login.payload.ok, true);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];

    const created = await call("shop_fm_create", { email: "panel@firstmail.ltd", password: "pw", price: "10000" }, cookie);
    assert.equal(created.payload.ok, true);
    const id = created.payload.data.items[0].id;

    const dup = await call("shop_fm_create", { email: "panel@firstmail.ltd" }, cookie);
    assert.equal(dup.status, 400);
    assert.equal(dup.payload.error, "email_exists");

    const bulk = await call("shop_fm_create", { bulk: "b1@firstmail.ltd:1\nb2@firstmail.ltd:2\nxx", price: "8000" }, cookie);
    assert.equal(bulk.payload.data.created, 2);
    assert.equal(bulk.payload.data.skipped, 1);

    const sold = await call("shop_fm_set_sold", { id, sold: true }, cookie);
    assert.equal(sold.payload.data.item.status, "sold");

    const edited = await call("shop_fm_update", { id, note: "tahrir" }, cookie);
    assert.equal(edited.payload.data.item.note, "tahrir");
    assert.equal(edited.payload.data.item.status, "sold", "editing keeps sold status");

    const list = await call("shop_fm_list", { query: "panel" }, cookie);
    assert.equal(list.payload.data.items.length, 1);
    assert.deepEqual(list.payload.data.counts, { total: 3, available: 2, sold: 1 });

    const removed = await call("shop_fm_delete", { id }, cookie);
    assert.equal(removed.payload.ok, true);
    assert.equal(fake.rows.has(`shop_fm:${id}`), false);
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ADMIN_PANEL_SECRET;
    delete require.cache[modulePath];
  }
});
