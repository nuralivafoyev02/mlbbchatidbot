const assert = require("node:assert/strict");
const test = require("node:test");

// Javob Supabase'ni keragidan ortiq kutmasin va so'rovlar soni oshmasin:
// Profilim so'rovlari parallel, majburiy kanal sozlamasi fonda bitta so'rov
// bilan yangilanadi.

const SUPABASE = "https://testproject.supabase.co/rest/v1";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
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

// Soxta Supabase + Telegram; har bir DB so'rovining boshlanish/tugash vaqti yoziladi.
function installBackend({ channelDelay = 20 } = {}) {
  const state = { channel: { id: -1001, username: "old_channel" }, db: [], telegram: [] };
  const original = global.fetch;

  global.fetch = async (url, options = {}) => {
    const href = String(url);

    if (href.startsWith("https://api.telegram.org/")) {
      const payload = options.body ? JSON.parse(options.body) : {};
      state.telegram.push({ method: href.split("/").pop(), payload, at: Date.now() });
      if (href.endsWith("/getChatMember")) return jsonResponse({ ok: true, result: { status: "member" } });
      return jsonResponse({ ok: true, result: { message_id: state.telegram.length } });
    }

    if (!href.startsWith(SUPABASE)) throw new Error(`unexpected fetch ${href}`);

    const path = href.slice(SUPABASE.length);
    const call = { path, start: Date.now(), end: null };
    state.db.push(call);
    const isChannel = path.startsWith("/bot_settings?key=eq.mandatory_channel");
    const channelSnapshot = state.channel;
    await sleep(isChannel ? channelDelay : 20);
    call.end = Date.now();

    if (isChannel) return jsonResponse([{ value: channelSnapshot }]);
    if (path.startsWith("/bot_users?")) return jsonResponse([{ preferred_language: "uz" }]);
    if (path === "/rpc/wallet_get") return jsonResponse({ ok: true, balance: 25000 });
    if (path === "/rpc/get_reset_pw_quota") return jsonResponse({ remaining: 1 });
    if (path === "/rpc/get_full_info_quota") return jsonResponse({ remaining: 2 });
    if (path === "/rpc/list_user_accounts") return jsonResponse([{ account_id: "123456", zone_id: "7890" }]);
    return jsonResponse(null);
  };

  return { state, restore: () => { global.fetch = original; } };
}

function createRes() {
  return { status() { return this; }, setHeader() { return this; }, json() { return this; }, send() { return this; }, end() { return this; } };
}

async function sendText(bot, user, text, background) {
  const ctx = { waitUntil: (promise) => background.push(promise) };
  await bot(
    {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "test-secret" },
      query: {},
      body: {
        update_id: Math.floor(Math.random() * 1e9),
        message: { message_id: 1, date: 0, chat: { id: user.id, type: "private" }, from: user, text },
      },
    },
    createRes(),
    {},
    ctx,
    { userModeStore: { get: async () => null, set: async () => {}, clear: async () => {} } }
  );
}

const channelCalls = (state) => state.db.filter((c) => c.path.startsWith("/bot_settings?key=eq.mandatory_channel"));
const memberChecks = (state) => state.telegram.filter((c) => c.method === "getChatMember").map((c) => c.payload.chat_id);

test("profile: balance, both quotas and accounts are requested at once, one request each", async () => {
  const backend = installBackend();
  try {
    const bot = loadBot();
    const user = { id: 601, first_name: "Ali", language_code: "uz" };
    const background = [];

    await sendText(bot, user, "Server aniqlash", background); // til va a'zolik keshlansin
    await Promise.allSettled(background);
    backend.state.db.length = 0;

    await sendText(bot, user, "👤 Profilim", background);

    const names = ["/rpc/wallet_get", "/rpc/get_reset_pw_quota", "/rpc/get_full_info_quota", "/rpc/list_user_accounts"];
    const calls = names.map((name) => {
      const found = backend.state.db.filter((c) => c.path === name);
      assert.equal(found.length, 1, `${name} once`);
      return found[0];
    });
    assert.ok(Math.max(...calls.map((c) => c.start)) < Math.min(...calls.map((c) => c.end)), "all four run in parallel");

    const reply = backend.state.telegram.filter((c) => c.method === "sendMessage").pop();
    assert.match(reply.payload.text, /25[\s ]?000/);
    assert.match(reply.payload.text, /123456/);
  } finally {
    backend.restore();
  }
});

test("mandatory channel: first load runs alongside the language; a stale value is served at once and refreshed by one shared request", async () => {
  const backend = installBackend({ channelDelay: 80 });
  try {
    const bot = loadBot();
    const background = [];

    // 1) Hech qachon yuklanmagan: til bilan bir vaqtda, bitta so'rov.
    await sendText(bot, { id: 701, first_name: "A", language_code: "uz" }, "Server aniqlash", background);
    const lang = backend.state.db.find((c) => c.path.startsWith("/bot_users?"));
    const [first] = channelCalls(backend.state);
    assert.equal(channelCalls(backend.state).length, 1);
    assert.ok(first.start < lang.end && lang.start < first.end, "channel and language load in parallel");
    assert.deepEqual(memberChecks(backend.state), [-1001]);

    // 2) Eskirgan: ikki yangi user bir vaqtda — javob eski qiymat bilan darhol,
    //    yangilash fonda va ikkalasiga bitta so'rov.
    global.__MLBB_BOT_SETTINGS__.lastFetchedAt -= 61000;
    backend.state.channel = { id: -1002, username: "new_channel" };
    await Promise.all([
      sendText(bot, { id: 702, first_name: "B", language_code: "uz" }, "Server aniqlash", background),
      sendText(bot, { id: 703, first_name: "C", language_code: "uz" }, "Server aniqlash", background),
    ]);
    assert.deepEqual(memberChecks(backend.state).slice(1), [-1001, -1001], "stale value used, reply did not wait");
    await Promise.allSettled(background);
    assert.equal(channelCalls(backend.state).length, 2, "one shared refresh for both users");

    // 3) Yangilangan qiymat keyingi userda ishlatiladi, yangi so'rovsiz.
    await sendText(bot, { id: 704, first_name: "D", language_code: "uz" }, "Server aniqlash", background);
    assert.equal(memberChecks(backend.state).at(-1), -1002);
    assert.equal(channelCalls(backend.state).length, 2);

    // 4) A'zoligi keshlangan user eskirgan sozlamada ham so'rov yubormaydi.
    global.__MLBB_BOT_SETTINGS__.lastFetchedAt -= 61000;
    await sendText(bot, { id: 704, first_name: "D", language_code: "uz" }, "Server aniqlash", background);
    await Promise.allSettled(background);
    assert.equal(channelCalls(backend.state).length, 2);
  } finally {
    backend.restore();
  }
});
