const assert = require("node:assert/strict");
const test = require("node:test");

// Admin panel → foydalanuvchini bloklash va API kaliti muddatini uzaytirish.

const SUPABASE = "https://testproject.supabase.co/rest/v1";
const BLOCK_TEXT = "Botdan foydalanish huquqidan maxrum bo'lgan siz. Cheklovni olib tashlash uchun @ksava_org ga murojaat qiling.";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function installBackend(state) {
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    if (href.startsWith("https://api.telegram.org/")) {
      state.telegram.push({ method: href.split("/").pop(), payload: body || {} });
      if (href.endsWith("/getChatMember")) return jsonResponse({ ok: true, result: { status: "member" } });
      return jsonResponse({ ok: true, result: { message_id: state.telegram.length } });
    }
    if (!href.startsWith(SUPABASE)) return jsonResponse({});
    const path = decodeURIComponent(href.slice(SUPABASE.length));
    state.db.push({ path, method: options.method || "GET", body });
    if (path.startsWith("/bot_users?is_blocked=eq.true")) {
      return jsonResponse([...state.blocked].map((id) => ({ user_id: Number(id) })));
    }
    if (path.startsWith("/bot_users?user_id=eq.") && options.method === "PATCH") {
      const id = path.match(/user_id=eq\.(\d+)/)[1];
      if (body.is_blocked) state.blocked.add(id); else state.blocked.delete(id);
      return jsonResponse([{ user_id: Number(id), is_blocked: body.is_blocked, blocked_at: body.blocked_at }]);
    }
    if (path.startsWith("/api_tokens?id=eq.") && options.method === "PATCH") {
      state.tokenPatches.push(body);
      Object.assign(state.token, body);
      return jsonResponse([]);
    }
    if (path.startsWith("/api_tokens?id=eq.")) return jsonResponse([state.token]);
    if (path.startsWith("/bot_users?")) return jsonResponse([{ preferred_language: "uz" }]);
    if (path.startsWith("/bot_settings?")) return jsonResponse([]);
    return jsonResponse(null);
  };
  return () => { global.fetch = original; };
}

function loadBot() {
  process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.ADMIN_IDS = "5081175125";
  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  delete process.env.SUPABASE_SERVICE_KEY;
  delete global.__MLBB_BOT_STATS__;
  delete global.__MLBB_BOT_SETTINGS__;
  delete require.cache[require.resolve("../api/bot.js")];
  return require("../api/bot.js");
}

function createRes() {
  return { statusCode: 200, headers: {}, body: "", status(c) { this.statusCode = c; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, send(b) { this.body = b; return this; }, json(b) { this.body = JSON.stringify(b); return this; }, end(b) { this.body = b || ""; return this; } };
}

const send = (bot, update) => bot({ method: "POST", headers: { "x-telegram-bot-api-secret-token": "test-secret" }, query: {}, body: update }, createRes());
const text = (id, userId, value, chat = { id: userId, type: "private" }) => ({ update_id: id, message: { message_id: id, chat, from: { id: userId, first_name: "U" }, text: value } });

test("blocked users get only the restriction text; admins and others are unaffected", async () => {
  const state = { telegram: [], db: [], blocked: new Set(["777", "5081175125"]), token: {}, tokenPatches: [] };
  const restore = installBackend(state);
  try {
    const bot = loadBot();
    await send(bot, text(1, 777, "/start"));
    const sent = state.telegram.filter((c) => c.method === "sendMessage");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.text, BLOCK_TEXT);
    assert.deepEqual(sent[0].payload.reply_markup, { remove_keyboard: true });

    // Tugma bosish — alert bilan o'sha matn.
    await send(bot, { update_id: 2, callback_query: { id: "cb1", data: "check_membership", from: { id: 777 }, message: { message_id: 5, chat: { id: 777, type: "private" } } } });
    const alert = state.telegram.find((c) => c.method === "answerCallbackQuery");
    assert.deepEqual([alert.payload.text, alert.payload.show_alert], [BLOCK_TEXT, true]);

    // Guruhda jim.
    const before = state.telegram.length;
    await send(bot, text(3, 777, "salom", { id: -100500, type: "supergroup" }));
    assert.equal(state.telegram.length, before);

    // Admin (ro'yxatda bo'lsa ham) va oddiy user — odatdagidek.
    await send(bot, text(4, 5081175125, "/start"));
    await send(bot, text(5, 888, "/start"));
    const replies = state.telegram.filter((c) => c.method === "sendMessage").slice(1);
    assert.ok(replies.length >= 2);
    assert.ok(replies.every((c) => c.payload.text !== BLOCK_TEXT));

    // Ro'yxat bitta so'rov bilan keshlangan.
    assert.equal(state.db.filter((c) => c.path.startsWith("/bot_users?is_blocked")).length, 1);
  } finally {
    restore();
  }
});

async function adminCall(action, body, cookie = "") {
  let status = 200;
  let payload = null;
  const res = { status(c) { status = c; return this; }, setHeader(k, v) { this.h = this.h || {}; this.h[k.toLowerCase()] = v; return this; }, send(t) { payload = JSON.parse(t); return this; } };
  await require("../api/miniapp.js")({ method: "POST", headers: { cookie }, query: { action }, body: { action, ...body } }, res);
  return { status, payload, headers: res.h || {} };
}

test("admin: block/unblock a user and extend an API key with a bot message to its owner", async () => {
  const state = { telegram: [], db: [], blocked: new Set(), token: { id: 9, title: "shop.uz", expires_at: "2027-01-10T19:00:00.000Z", is_revoked: false }, tokenPatches: [] };
  const restore = installBackend(state);
  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  process.env.ADMIN_PANEL_SECRET = "panel-secret";
  process.env.ADMIN_PANEL_USERNAME = "shop-admin";
  process.env.ADMIN_PANEL_PASSWORD = "shop-pass-123";
  process.env.TELEGRAM_BOT_TOKEN = "123:abc";
  process.env.ADMIN_IDS = "5081175125";
  delete require.cache[require.resolve("../api/miniapp.js")];
  try {
    assert.equal((await adminCall("user_block", { user_id: "777", blocked: true })).status, 401);
    const login = await adminCall("login", { username: "shop-admin", password: "shop-pass-123" });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];

    const block = await adminCall("user_block", { user_id: "777", blocked: true }, cookie);
    assert.equal(block.payload.data.is_blocked, true);
    assert.ok(state.blocked.has("777"));
    assert.equal((await adminCall("user_block", { user_id: "5081175125", blocked: true }, cookie)).payload.error, "cannot_block_admin");
    const unblock = await adminCall("user_block", { user_id: "777", blocked: false }, cookie);
    assert.equal(unblock.payload.data.is_blocked, false);
    assert.ok(!state.blocked.has("777"));

    assert.equal((await adminCall("api_token_extend", { id: 9, days: 0 }, cookie)).payload.error, "invalid_days");
    assert.equal((await adminCall("api_token_extend", { id: 9, days: 30, owner_user_id: "abc" }, cookie)).payload.error, "invalid_owner");
    const ext = await adminCall("api_token_extend", { id: 9, days: 30, owner_user_id: "7396686285" }, cookie);
    assert.equal(ext.status, 200);
    assert.equal(ext.payload.data.expires_at, "2027-02-09T19:00:00.000Z", "extends from the current expiry");
    assert.deepEqual(state.tokenPatches.at(-1), { expires_at: "2027-02-09T19:00:00.000Z", owner_user_id: "7396686285" });
    assert.equal(ext.payload.data.notified, true);
    const dm = state.telegram.find((c) => c.method === "sendMessage" && c.payload.chat_id === "7396686285");
    assert.equal(dm.payload.text, "Xaridingiz uchun raxmat!\nSizning kalitingiz muddati <b>shop.uz</b> 11.01.2027 dan 10.02.2027 gacha uzaytirildi.\nAloqa va yordam uchun: @vafoyev_n");

    // Aniq sanagacha (Toshkent vaqti bo'yicha kun oxiri).
    const until = await adminCall("api_token_extend", { id: 9, until: "2027-06-30", owner_user_id: "7396686285" }, cookie);
    assert.equal(until.payload.data.expires_at, "2027-06-30T18:59:59.000Z");
    const dm2 = state.telegram.filter((c) => c.method === "sendMessage" && c.payload.chat_id === "7396686285").at(-1);
    assert.match(dm2.payload.text, /10\.02\.2027 dan 30\.06\.2027 gacha/);
    assert.equal((await adminCall("api_token_extend", { id: 9, until: "2027-03-01" }, cookie)).payload.error, "until_too_early");
    assert.equal((await adminCall("api_token_extend", { id: 9, until: "30.06.2027" }, cookie)).payload.error, "invalid_until");

    // Faqat egasini saqlash / olib tashlash.
    assert.equal((await adminCall("api_token_owner", { id: 9, owner_user_id: "12x" }, cookie)).payload.error, "invalid_owner");
    const own = await adminCall("api_token_owner", { id: 9, owner_user_id: "5551234" }, cookie);
    assert.equal(own.payload.data.owner_user_id, "5551234");
    assert.deepEqual(state.tokenPatches.at(-1), { owner_user_id: "5551234" });
    await adminCall("api_token_owner", { id: 9, owner_user_id: "" }, cookie);
    assert.deepEqual(state.tokenPatches.at(-1), { owner_user_id: null });

    // Muddati o'tgan kalit bugundan boshlab uzaytiriladi.
    state.token.expires_at = "2020-01-01T00:00:00.000Z";
    const late = await adminCall("api_token_extend", { id: 9, days: 10 }, cookie);
    const expected = Date.now() + 10 * 86400000;
    assert.ok(Math.abs(Date.parse(late.payload.data.expires_at) - expected) < 5000);
    assert.equal(late.payload.data.notified, false);
  } finally {
    restore();
    for (const key of ["ADMIN_PANEL_SECRET", "ADMIN_PANEL_USERNAME", "ADMIN_PANEL_PASSWORD"]) delete process.env[key];
    delete require.cache[require.resolve("../api/miniapp.js")];
  }
});
