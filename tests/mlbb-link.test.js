const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const arena = require("../api/_mlbb-arena.js");

const ARENA = "https://arena.example.test/api";
const MINIAPP = "https://mini.example.test/api/account";
const BOT_TOKEN = "123456:test-token";
const LINK_SECRET = "test-link-secret";

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
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = typeof payload === "string" && this.headers["Content-Type"] === "application/json" ? JSON.parse(payload) : payload; return this; },
  };
}

function signInitData(user, { token = BOT_TOKEN, authDate = Math.floor(Date.now() / 1000) } = {}) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: "AAE-test", user: JSON.stringify(user) });
  const dataCheckString = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

// Supabase RPC'larining xotiradagi soxta versiyasi (user_accounts + ML ulanish).
function createFakeSupabase() {
  const rows = [];
  const calls = [];
  let nextId = 100;
  const own = (args) => rows.find((r) => String(r.id) === String(args.p_row_id) && String(r.user_id) === String(args.p_user_id));

  function rpc(name, args) {
    calls.push({ name, args });

    switch (name) {
      case "add_user_account": {
        if (rows.some((r) => r.account_id === args.p_account_id && r.zone_id === args.p_zone_id)) {
          return { ok: false, error: "already_exists" };
        }
        const row = { id: nextId++, user_id: String(args.p_user_id), account_id: args.p_account_id, zone_id: args.p_zone_id, ml_token: null, ml_nickname: null, ml_linked_at: null };
        rows.push(row);
        return { ok: true, id: row.id, account_id: row.account_id, zone_id: row.zone_id };
      }
      case "list_user_accounts":
        return rows
          .filter((r) => r.user_id === String(args.p_user_id))
          .map((r) => ({ id: r.id, account_id: r.account_id, zone_id: r.zone_id, ml_linked: r.ml_token !== null, ml_nickname: r.ml_nickname, ml_linked_at: r.ml_linked_at }));
      case "set_user_account_ml_link": {
        const row = own(args);
        if (!row) return { ok: false, error: "not_found" };
        Object.assign(row, { ml_token: args.p_token, ml_nickname: args.p_nickname, ml_linked_at: "2026-10-02T10:00:00Z" });
        return { ok: true };
      }
      case "get_user_account_ml_link": {
        const row = own(args);
        return row ? { ok: true, ...row } : { ok: false, error: "not_found" };
      }
      case "clear_user_account_ml_link": {
        const row = own(args);
        if (!row) return { ok: false, error: "not_found" };
        Object.assign(row, { ml_token: null, ml_nickname: null, ml_linked_at: null });
        return { ok: true };
      }
      case "remove_user_account": {
        const index = rows.findIndex((r) => r.user_id === String(args.p_user_id) && r.account_id === args.p_account_id && r.zone_id === args.p_zone_id);
        if (index === -1) return { ok: false, error: "not_found" };
        rows.splice(index, 1);
        return { ok: true };
      }
      case "get_reset_pw_quota":
      case "get_full_info_quota":
        return { remaining: 3 };
      default:
        return null;
    }
  }

  return { rows, calls, rpc };
}

// Global fetch: Telegram, Supabase va Arena chaqiruvlarini yozib boradi.
function installFetch({ supabase, arenaHandler }) {
  const telegram = [];
  const arenaCalls = [];
  const original = global.fetch;

  global.fetch = async (url, options = {}) => {
    const href = String(url);

    if (href.startsWith("https://api.telegram.org/")) {
      telegram.push({ method: href.split("/").pop(), payload: options.body ? JSON.parse(options.body) : {} });
      return jsonResponse({ ok: true, result: { message_id: telegram.length } });
    }

    if (href.startsWith("https://testproject.supabase.co/rest/v1")) {
      const path = href.slice("https://testproject.supabase.co/rest/v1".length);
      if (path.startsWith("/rpc/")) {
        const name = decodeURIComponent(path.slice(5).split("?")[0]);
        const data = supabase.rpc(name, options.body ? JSON.parse(options.body) : {});
        return new Response(data === null ? "" : JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
      }
      return jsonResponse([]);
    }

    if (href.startsWith(ARENA)) {
      const parsed = new URL(href);
      const call = {
        method: options.method || "GET",
        path: parsed.pathname.replace(/^\/api/, ""),
        query: Object.fromEntries(parsed.searchParams),
        body: options.body ? JSON.parse(options.body) : null,
        auth: options.headers?.Authorization || null,
      };
      arenaCalls.push(call);
      return arenaHandler(call);
    }

    return jsonResponse({});
  };

  return { telegram, arenaCalls, restore: () => { global.fetch = original; } };
}

function loadBot() {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.SUPPORT_USERNAME = "Ksava_org";
  process.env.ADMIN_IDS = "5081175125";
  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  process.env.MLBB_ARENA_API_URL = ARENA;
  process.env.MLBB_LINK_SECRET = LINK_SECRET;
  process.env.ACCOUNT_MINIAPP_URL = MINIAPP;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.MAIN_GROUP_ID;
  delete global.__MLBB_BOT_STATS__;
  delete require.cache[require.resolve("../api/bot.js")];
  return require("../api/bot.js");
}

function loadAccountApp() {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_BOT_USERNAME = "checkmlbbidBot";
  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  process.env.MLBB_ARENA_API_URL = ARENA;
  process.env.MLBB_LINK_SECRET = LINK_SECRET;
  delete require.cache[require.resolve("../api/account.js")];
  return require("../api/account.js");
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function sendUpdate(bot, body) {
  await bot({ method: "POST", headers: { "x-telegram-bot-api-secret-token": "test-secret" }, query: {}, body }, createRes());
  await flush();
}

function textUpdate(updateId, userId, text) {
  return {
    update_id: updateId,
    message: { message_id: updateId, chat: { id: userId, type: "private" }, from: { id: userId, first_name: "Ali" }, text },
  };
}

function callbackUpdate(updateId, userId, data) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: userId, first_name: "Ali" },
      message: { message_id: 500 + updateId, chat: { id: userId, type: "private" }, from: { id: 1 }, text: "old" },
      data,
    },
  };
}

function lastText(telegram) {
  return [...telegram].reverse().find((c) => typeof c.payload.text === "string");
}

function buttonsOf(call) {
  return call?.payload?.reply_markup?.inline_keyboard?.flat() || [];
}

const SAMPLE_INFO = { avatar: "https://img.example.test/a.jpg", name: "Lily•°", level: 150, rank_level: 168, history_rank_level: 240, reg_country: "uz", roleId: 1006613098, zoneId: 13019 };
const SAMPLE_STATS = {
  wc: 188, tc: 308, as: 762.3552, gt: 77.95, mvpc: 73, wsc: 11,
  hk: { v: 25, ts: 1672500616, hid: 84, hid_e: { id: 84, n: "Ling", ix: "https://img.example.test/ling.png" } },
  ms: { v: 1330, ts: 1715555863, hid: 84, hid_e: { id: 84, n: "Ling", ix: "" } },
};

function defaultArenaHandler(call) {
  if (call.path === "/user/auth/send-vc") return jsonResponse({ code: 0, data: "", msg: "ok" });
  if (call.path === "/user/auth/login") {
    return call.body.vc === 1234
      ? jsonResponse({ code: 0, data: { jwt: "jwt-abc", token: "tok", roleid: call.body.role_id, zoneid: call.body.zone_id, time: 1 }, msg: "ok" })
      : jsonResponse({ status: "error", code: "INTERNAL_SERVER_ERROR", details: { type: "ResponseValidationError" } }, 500);
  }
  if (call.path === "/user/auth/logout") return jsonResponse({ code: 0, data: "", msg: "ok" });
  if (call.auth !== "Bearer jwt-abc") return jsonResponse({ code: 1002, data: null, message: "auth is empty" });
  if (call.path === "/user/info") return jsonResponse({ code: 0, data: SAMPLE_INFO, msg: "ok" });
  if (call.path === "/user/stats") return jsonResponse({ code: 0, data: SAMPLE_STATS, message: "Success" });
  if (call.path === "/user/season") return jsonResponse({ code: 0, data: { sids: [40, 39] } });
  if (call.path === "/user/privacy/settings") return jsonResponse({ code: 0, data: { popup_shown: true, privacy: false } });
  if (call.path === "/user/matches") return jsonResponse({ code: 0, data: { pageInfo: { nextCursor: "77", hasNext: true, count: 1 }, result: [{ sid: 40, bid_s: "4132717739868068534", hid: 17, k: 14, d: 1, a: 11, res: 1 }] } });
  return jsonResponse({ code: 0, data: {} });
}

// ---------------------------------------------------------------------------
// _mlbb-arena.js
// ---------------------------------------------------------------------------
test("arena: send-vc posts numeric role/zone and maps code -20007 to send_failed", async () => {
  const seen = [];
  const client = arena.createArenaClient({
    baseUrl: ARENA,
    fetchImpl: async (url, options) => {
      seen.push({ url, body: JSON.parse(options.body) });
      return seen.length === 1 ? jsonResponse({ code: 0, data: "", msg: "ok" }) : jsonResponse({ code: -20007, msg: "", data: "" });
    },
  });

  assert.deepEqual(await client.sendVerificationCode("1006613098", "13019"), { ok: true });
  assert.equal(seen[0].url, `${ARENA}/user/auth/send-vc`);
  assert.deepEqual(seen[0].body, { role_id: 1006613098, zone_id: 13019 });

  await assert.rejects(client.sendVerificationCode("1006613098", "13019"), (error) => error.reason === "send_failed");
  await assert.rejects(client.sendVerificationCode("abc", "1"), (error) => error.reason === "invalid_input");
  assert.equal(seen.length, 2, "invalid ids must not reach the API");
});

test("arena: login returns jwt; wrong code (HTTP 500 ResponseValidationError) is invalid_code", async () => {
  const client = arena.createArenaClient({ baseUrl: ARENA, fetchImpl: async (url, options) => defaultArenaHandler({ path: "/user/auth/login", body: JSON.parse(options.body) }) });

  const session = await client.login("1006613098", "13019", "1234");
  assert.equal(session.jwt, "jwt-abc");
  assert.equal(session.roleId, "1006613098");

  await assert.rejects(client.login("1006613098", "13019", "9999"), (error) => error.reason === "invalid_code");
  await assert.rejects(client.login("1006613098", "13019", "12a4"), (error) => error.reason === "invalid_code");
});

test("arena: auth failures (HTTP 200 code 1002 and HTTP 401) are classified as unauthorized", async () => {
  const responses = [
    jsonResponse({ code: 1002, data: null, message: "auth is empty" }),
    jsonResponse({ status: "error", code: "UPSTREAM_REQUEST_FAILED", message: "x" }, 401),
    jsonResponse({ status: "error", code: "RATE_LIMITED" }, 429),
  ];
  const client = arena.createArenaClient({ baseUrl: ARENA, fetchImpl: async () => responses.shift() });

  await assert.rejects(client.getInfo("bad"), (error) => error.reason === "unauthorized");
  await assert.rejects(client.getStats("bad"), (error) => error.reason === "unauthorized");
  await assert.rejects(client.getSeasons("bad"), (error) => error.reason === "rate_limit");
});

test("arena: request timeout is reported as timeout and uses Bearer token + lang", async () => {
  let captured = null;
  const slow = arena.createArenaClient({
    baseUrl: ARENA,
    timeoutMs: 20,
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      captured = { url, options };
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });

  await assert.rejects(slow.getInfo("jwt-1", "ru"), (error) => error.reason === "timeout");
  assert.equal(captured.options.headers.Authorization, "Bearer jwt-1");
  assert.match(captured.url, /lang=ru/);
  assert.equal(arena.toArenaLang("uz"), "en", "uzbek falls back to english");
});

test("arena: match/season/cursor params are validated before calling the API", async () => {
  let calls = 0;
  const client = arena.createArenaClient({ baseUrl: ARENA, fetchImpl: async () => { calls += 1; return jsonResponse({ code: 0, data: {} }); } });

  await assert.rejects(client.getMatches("t", { sid: "abc" }), (error) => error.reason === "invalid_input");
  await assert.rejects(client.getMatchDetail("t", { sid: 40, matchId: "../info" }), (error) => error.reason === "invalid_input");
  await assert.rejects(client.getMatchesByHero("t", { sid: 40, heroId: "x/y" }), (error) => error.reason === "invalid_input");
  assert.equal(calls, 0);
});

test("arena: tokens are sealed with AES-GCM and only open with the same secret", () => {
  const sealed = arena.sealArenaToken("jwt-secret-value", LINK_SECRET);
  assert.match(sealed, /^v1:/);
  assert.ok(!sealed.includes("jwt-secret-value"));
  assert.equal(arena.openArenaToken(sealed, LINK_SECRET), "jwt-secret-value");
  assert.equal(arena.openArenaToken(sealed, "other-secret"), null);
  assert.equal(arena.openArenaToken(`${sealed.slice(0, -2)}xx`, LINK_SECRET), null, "tampered ciphertext is rejected");
  assert.equal(arena.openArenaToken(arena.sealArenaToken("plain", ""), ""), "plain", "no secret → p1 fallback");
  assert.equal(arena.resolveLinkSecret({ SUPABASE_SERVICE_KEY: "svc" }), "svc");
  assert.equal(arena.resolveLinkSecret({ MLBB_LINK_SECRET: "own", SUPABASE_SERVICE_KEY: "svc" }), "own");
});

test("arena: Telegram initData signature, tampering and expiry", () => {
  const user = { id: 7700123, first_name: "Ali" };
  const initData = signInitData(user);
  const ok = arena.verifyTelegramInitData(initData, BOT_TOKEN);
  assert.equal(ok.ok, true);
  assert.equal(ok.user.id, 7700123);

  const tampered = initData.replace("7700123", "7700124");
  assert.equal(arena.verifyTelegramInitData(tampered, BOT_TOKEN).ok, false);
  assert.equal(arena.verifyTelegramInitData(initData, "999:other").ok, false, "other bot token");
  assert.equal(arena.verifyTelegramInitData(signInitData(user, { authDate: 1000 }), BOT_TOKEN).error, "expired");
  assert.equal(arena.verifyTelegramInitData("", BOT_TOKEN).ok, false);
});

test("arena: rank_level star totals map to MLBB rank names", () => {
  const label = (level) => arena.formatRankLevel(level)?.label;
  assert.equal(label(1), "Warrior III ★0");
  assert.equal(label(10), "Warrior I ★2");
  assert.equal(label(88), "Epic III ★0");
  assert.equal(label(135), "Legend I ★5");
  assert.equal(label(136), "Mythic ★0");
  assert.equal(label(161), "Mythical Honor ★25");
  assert.equal(label(186), "Mythical Glory ★50");
  assert.equal(label(240), "Mythical Immortal ★104");
  assert.equal(arena.formatRankLevel(0), null);
  assert.equal(arena.formatRankLevel("abc"), null);
});

// ---------------------------------------------------------------------------
// Bot oqimi
// ---------------------------------------------------------------------------
test("bot: adding an account asks 'Mobile Legendsga ham ulaysizmi?' with Ha / Yo'q", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: defaultArenaHandler });

  try {
    const bot = loadBot();
    const userId = 7700123;
    await sendUpdate(bot, callbackUpdate(1, userId, "profile_add"));
    await sendUpdate(bot, textUpdate(2, userId, "1006613098 (13019)"));

    const ask = net.telegram.find((c) => c.method === "sendMessage" && /Mobile Legends'ga ham ulaysizmi/.test(c.payload.text || ""));
    assert.ok(ask, "ask post expected");
    const buttons = buttonsOf(ask);
    assert.deepEqual(buttons.map((b) => b.text), ["✅ Ha", "❌ Yo'q"]);
    assert.equal(buttons[0].callback_data, `ml_link:${supabase.rows[0].id}`);
    assert.equal(buttons[1].callback_data, "ml_link_no");
    assert.equal(net.arenaCalls.length, 0, "nothing is sent to the game before the user agrees");

    await sendUpdate(bot, callbackUpdate(3, userId, "ml_link_no"));
    assert.match(lastText(net.telegram).payload.text, /Yaxshi/);
  } finally {
    net.restore();
  }
});

test("bot: Ha → in-game code → login stores sealed token and shows account summary + Mening akkauntim", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: defaultArenaHandler });

  try {
    const bot = loadBot();
    const userId = 7700124;
    const rowId = supabase.rpc("add_user_account", { p_user_id: userId, p_account_id: "1006613098", p_zone_id: "13019" }).id;

    await sendUpdate(bot, callbackUpdate(10, userId, `ml_link:${rowId}`));
    const sendVc = net.arenaCalls.find((c) => c.path === "/user/auth/send-vc");
    assert.deepEqual(sendVc.body, { role_id: 1006613098, zone_id: 13019 });
    assert.match(lastText(net.telegram).payload.text, /Tasdiqlash kodi yuborildi/);

    await sendUpdate(bot, textUpdate(11, userId, "12 34"));
    const login = net.arenaCalls.find((c) => c.path === "/user/auth/login");
    assert.deepEqual(login.body, { role_id: 1006613098, zone_id: 13019, vc: 1234 });

    const saved = supabase.calls.find((c) => c.name === "set_user_account_ml_link");
    assert.ok(saved, "session must be saved");
    assert.equal(String(saved.args.p_row_id), String(rowId));
    assert.match(saved.args.p_token, /^v1:/, "jwt is stored encrypted");
    assert.equal(arena.openArenaToken(saved.args.p_token, LINK_SECRET), "jwt-abc");
    assert.equal(saved.args.p_nickname, "Lily•°");

    const summary = net.telegram.find((c) => /Mobile Legends akkaunti ulandi/.test(c.payload.text || ""));
    assert.ok(summary, "summary expected");
    assert.match(summary.payload.text, /Lily•°/);
    assert.match(summary.payload.text, /Mythical Honor ★32/);
    assert.match(summary.payload.text, /Mythical Immortal ★104/);
    assert.match(summary.payload.text, /308/);
    assert.match(summary.payload.text, /61\.0%/);
    assert.match(summary.payload.text, /Ling — <b>25<\/b>/);
    assert.ok(!summary.payload.text.includes("jwt-abc"), "token never leaks into messages");
    const webApp = buttonsOf(summary).find((b) => b.web_app);
    assert.equal(webApp.web_app.url, MINIAPP);
    assert.equal(webApp.text, "🎮 Mening akkauntim");

    // Profil: "Mening akkauntim" web_app tugmasi paydo bo'ladi, ulanmagan akkaunt yo'q.
    await sendUpdate(bot, callbackUpdate(12, userId, "my_profile"));
    const profile = lastText(net.telegram);
    assert.match(profile.payload.text, /ulangan Lily•°/);
    const profileButtons = buttonsOf(profile);
    assert.ok(profileButtons.some((b) => b.web_app?.url === MINIAPP));
    assert.ok(!profileButtons.some((b) => b.callback_data === "ml_link_menu"));
  } finally {
    net.restore();
  }
});

test("bot: wrong codes are limited to 5 attempts, resend has a cooldown", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: defaultArenaHandler });

  try {
    const bot = loadBot();
    const userId = 7700125;
    const rowId = supabase.rpc("add_user_account", { p_user_id: userId, p_account_id: "13100313", p_zone_id: "2013" }).id;

    await sendUpdate(bot, callbackUpdate(20, userId, `ml_link:${rowId}`));
    await sendUpdate(bot, callbackUpdate(21, userId, `ml_link:${rowId}`));
    assert.equal(net.arenaCalls.filter((c) => c.path === "/user/auth/send-vc").length, 1, "resend inside cooldown must not hit the API");
    assert.match(lastText(net.telegram).payload.text, /soniya kuting/);

    for (let i = 0; i < 4; i += 1) {
      await sendUpdate(bot, textUpdate(30 + i, userId, "0000"));
      assert.match(lastText(net.telegram).payload.text, new RegExp(`Yana <b>${4 - i}</b> ta urinish`));
    }

    await sendUpdate(bot, textUpdate(40, userId, "0000"));
    assert.match(lastText(net.telegram).payload.text, /Urinishlar soni tugadi/);

    // Rejim yopildi — endi "1234" kod sifatida qabul qilinmaydi.
    await sendUpdate(bot, textUpdate(41, userId, "1234"));
    assert.equal(net.arenaCalls.filter((c) => c.path === "/user/auth/login").length, 5);
    assert.ok(!supabase.calls.some((c) => c.name === "set_user_account_ml_link"));
  } finally {
    net.restore();
  }
});

test("bot: text that is not a code leaves code mode; unknown accounts cannot be linked", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: defaultArenaHandler });

  try {
    const bot = loadBot();
    const userId = 7700126;
    const rowId = supabase.rpc("add_user_account", { p_user_id: userId, p_account_id: "22223333", p_zone_id: "5001" }).id;
    const foreignRow = supabase.rpc("add_user_account", { p_user_id: 999, p_account_id: "44445555", p_zone_id: "5002" }).id;

    await sendUpdate(bot, callbackUpdate(50, userId, `ml_link:${foreignRow}`));
    assert.match(lastText(net.telegram).payload.text, /Akkaunt topilmadi/);
    assert.equal(net.arenaCalls.length, 0, "someone else's account row is rejected");

    await sendUpdate(bot, callbackUpdate(51, userId, `ml_link:${rowId}`));
    await sendUpdate(bot, textUpdate(52, userId, "salom"));
    await sendUpdate(bot, textUpdate(53, userId, "1234"));
    assert.equal(net.arenaCalls.filter((c) => c.path === "/user/auth/login").length, 0);
  } finally {
    net.restore();
  }
});

test("bot: send-vc failure shows a friendly error with retry; profile offers linking for unlinked accounts", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({
    supabase,
    arenaHandler: (call) => (call.path === "/user/auth/send-vc" ? jsonResponse({ code: -20007, msg: "", data: "" }) : defaultArenaHandler(call)),
  });

  try {
    const bot = loadBot();
    const userId = 7700127;
    const rowId = supabase.rpc("add_user_account", { p_user_id: userId, p_account_id: "66667777", p_zone_id: "5003" }).id;

    await sendUpdate(bot, callbackUpdate(60, userId, "my_profile"));
    const profileButtons = buttonsOf(lastText(net.telegram));
    assert.ok(profileButtons.some((b) => b.callback_data === "ml_link_menu"));
    assert.ok(!profileButtons.some((b) => b.web_app), "no Mening akkauntim before linking");

    await sendUpdate(bot, callbackUpdate(61, userId, "ml_link_menu"));
    assert.ok(buttonsOf(lastText(net.telegram)).some((b) => b.callback_data === `ml_link:${rowId}`));

    await sendUpdate(bot, callbackUpdate(62, userId, `ml_link:${rowId}`));
    const failure = lastText(net.telegram);
    assert.match(failure.payload.text, /Kod yuborilmadi/);
    assert.ok(buttonsOf(failure).some((b) => b.callback_data === `ml_link:${rowId}`));
  } finally {
    net.restore();
  }
});

test("bot: removing a linked account logs the game session out first", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: defaultArenaHandler });

  try {
    const bot = loadBot();
    const userId = 7700128;
    const rowId = supabase.rpc("add_user_account", { p_user_id: userId, p_account_id: "88889999", p_zone_id: "5004" }).id;
    supabase.rpc("set_user_account_ml_link", { p_user_id: userId, p_row_id: rowId, p_token: arena.sealArenaToken("jwt-abc", LINK_SECRET), p_nickname: "Z" });

    await sendUpdate(bot, callbackUpdate(70, userId, `profile_unlink:${rowId}`));
    const logout = net.arenaCalls.find((c) => c.path === "/user/auth/logout");
    assert.ok(logout, "arena logout expected");
    assert.equal(logout.auth, "Bearer jwt-abc");
    assert.equal(supabase.rows.length, 0);
  } finally {
    net.restore();
  }
});

test("bot: ML locale keys exist in every language", () => {
  const bot = loadBot();
  const { translations } = bot.__private;
  const keys = Object.keys(translations.uz).filter((key) => key.startsWith("ml_") || key === "label_ml_link");
  assert.ok(keys.length > 30);
  for (const lang of ["ru", "en"]) {
    for (const key of keys) {
      assert.ok(translations[lang][key], `${lang}.${key} missing`);
    }
  }
});

test("bot: code mode string fits the 32-char DO limit", () => {
  const { buildMlCodeMode, parseMlCodeMode } = loadBot().__private;
  const mode = buildMlCodeMode("9223372036854775807", 4, Date.UTC(2030, 0, 1));
  assert.ok(mode.length <= 32, mode);
  assert.deepEqual(parseMlCodeMode(mode), { rowId: "9223372036854775807", attempts: 4, sentAt: Date.UTC(2030, 0, 1) });
  assert.equal(parseMlCodeMode("profile_add"), null);
});

// ---------------------------------------------------------------------------
// Mini App backend (api/account.js)
// ---------------------------------------------------------------------------
async function callAccount(app, body, headers = {}) {
  const res = createRes();
  await app({ method: "POST", headers, query: {}, body }, res);
  return res;
}

test("account app: rejects requests without a valid Telegram signature", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: defaultArenaHandler });

  try {
    const app = loadAccountApp();
    assert.equal((await callAccount(app, { action: "bootstrap" })).statusCode, 401);
    const forged = signInitData({ id: 1 }, { token: "999:attacker" });
    assert.equal((await callAccount(app, { action: "bootstrap", initData: forged })).statusCode, 401);
    assert.equal(supabase.calls.length, 0);

    const page = createRes();
    await app({ method: "GET", headers: {}, query: {} }, page);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /telegram-web-app\.js/);
  } finally {
    net.restore();
  }
});

test("account app: bootstrap + overview + matches never expose the jwt", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: defaultArenaHandler });

  try {
    const app = loadAccountApp();
    const userId = 7700200;
    const rowId = supabase.rpc("add_user_account", { p_user_id: userId, p_account_id: "1006613098", p_zone_id: "13019" }).id;
    supabase.rpc("set_user_account_ml_link", { p_user_id: userId, p_row_id: rowId, p_token: arena.sealArenaToken("jwt-abc", LINK_SECRET), p_nickname: "Lily•°" });
    const initData = signInitData({ id: userId, first_name: "Ali", language_code: "ru" });

    const boot = await callAccount(app, { action: "bootstrap", initData });
    assert.equal(boot.statusCode, 200);
    assert.equal(boot.body.lang, "ru");
    assert.equal(boot.body.botUsername, "checkmlbbidBot");
    assert.deepEqual(boot.body.accounts.map((a) => [a.id, a.ml_linked, a.ml_nickname]), [[String(rowId), true, "Lily•°"]]);

    const overview = await callAccount(app, { action: "overview", initData, rowId, lang: "ru" });
    assert.equal(overview.statusCode, 200);
    assert.equal(overview.body.info.name, "Lily•°");
    assert.equal(overview.body.rank.label, "Mythical Honor ★32");
    assert.deepEqual(overview.body.seasons, [40, 39]);
    assert.equal(overview.body.privacy.privacy, false);
    assert.equal(net.arenaCalls.find((c) => c.path === "/user/info").query.lang, "ru");

    const matches = await callAccount(app, { action: "matches", initData, rowId, sid: 40, cursor: "55" });
    assert.equal(matches.body.data.pageInfo.nextCursor, "77");
    assert.equal(net.arenaCalls.find((c) => c.path === "/user/matches").query.last_cursor, "55");

    for (const res of [boot, overview, matches]) {
      assert.ok(!JSON.stringify(res.body).includes("jwt-abc"));
      assert.ok(!JSON.stringify(res.body).includes("v1:"));
    }
  } finally {
    net.restore();
  }
});

test("account app: other users' rows are 404, expired sessions are session_expired", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: defaultArenaHandler });

  try {
    const app = loadAccountApp();
    const owner = 7700300;
    const rowId = supabase.rpc("add_user_account", { p_user_id: owner, p_account_id: "11112222", p_zone_id: "3001" }).id;
    supabase.rpc("set_user_account_ml_link", { p_user_id: owner, p_row_id: rowId, p_token: arena.sealArenaToken("expired-jwt", LINK_SECRET) });

    const intruder = await callAccount(app, { action: "overview", initData: signInitData({ id: 7700301 }), rowId });
    assert.equal(intruder.statusCode, 404);
    assert.equal(net.arenaCalls.length, 0);

    const expired = await callAccount(app, { action: "overview", initData: signInitData({ id: owner }), rowId });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.body.error, "session_expired");

    const unlinkedRow = supabase.rpc("add_user_account", { p_user_id: owner, p_account_id: "11113333", p_zone_id: "3001" }).id;
    const notLinked = await callAccount(app, { action: "friends", initData: signInitData({ id: owner }), rowId: unlinkedRow, sid: 40 });
    assert.equal(notLinked.statusCode, 409);
    assert.equal(notLinked.body.error, "not_linked");
  } finally {
    net.restore();
  }
});

test("account app: logout ends the Arena session and clears the stored token", async () => {
  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: defaultArenaHandler });

  try {
    const app = loadAccountApp();
    const userId = 7700400;
    const rowId = supabase.rpc("add_user_account", { p_user_id: userId, p_account_id: "12121212", p_zone_id: "4001" }).id;
    supabase.rpc("set_user_account_ml_link", { p_user_id: userId, p_row_id: rowId, p_token: arena.sealArenaToken("jwt-abc", LINK_SECRET), p_nickname: "Z" });

    const res = await callAccount(app, { action: "logout", initData: signInitData({ id: userId }), rowId });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(net.arenaCalls.find((c) => c.path === "/user/auth/logout").auth, "Bearer jwt-abc");
    assert.equal(supabase.rows[0].ml_token, null);
    assert.equal(supabase.rows.length, 1, "account stays in the profile list");

    const privacy = await callAccount(app, { action: "privacy_set", initData: signInitData({ id: userId }), rowId, visible: true });
    assert.equal(privacy.statusCode, 409, "after logout the session is gone");
  } finally {
    net.restore();
  }
});

test("arena/account app: Moonton-disabled endpoints (code 10407 接口下线) are reported as unavailable", async () => {
  const offline = (call) => (["/user/stats", "/user/season", "/user/privacy/settings", "/user/matches"].includes(call.path)
    ? jsonResponse({ code: 10407, data: null, msg: null, message: "接口下线" })
    : defaultArenaHandler(call));

  const client = arena.createArenaClient({ baseUrl: ARENA, fetchImpl: async (url) => offline({ path: new URL(url).pathname.replace(/^\/api/, ""), auth: "Bearer jwt-abc" }) });
  await assert.rejects(client.getStats("jwt-abc"), (error) => error.reason === "unavailable");

  const supabase = createFakeSupabase();
  const net = installFetch({ supabase, arenaHandler: offline });

  try {
    const app = loadAccountApp();
    const userId = 7700500;
    const rowId = supabase.rpc("add_user_account", { p_user_id: userId, p_account_id: "1544940920", p_zone_id: "16474" }).id;
    supabase.rpc("set_user_account_ml_link", { p_user_id: userId, p_row_id: rowId, p_token: arena.sealArenaToken("jwt-abc", LINK_SECRET) });
    const initData = signInitData({ id: userId });

    const overview = await callAccount(app, { action: "overview", initData, rowId });
    assert.equal(overview.statusCode, 200, "profile still works with /user/info only");
    assert.equal(overview.body.info.name, "Lily•°");
    assert.equal(overview.body.stats, null);
    assert.deepEqual(overview.body.unavailable, { stats: true, seasons: true, privacy: true });

    const matches = await callAccount(app, { action: "matches", initData, rowId, sid: 40 });
    assert.equal(matches.statusCode, 503);
    assert.equal(matches.body.error, "unavailable");
  } finally {
    net.restore();
  }
});
