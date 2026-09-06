const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.SUPPORT_USERNAME = "@Ksava_org";
process.env.ADMIN_IDS = "5081175125,8500085987,7396686285";
process.env.TELEGRAM_BOT_USERNAME = "mlbb_test_bot";
process.env.MLBB_BIND_INFO_API_URL = "https://bind.example.test/bind";
process.env.MLBB_BIND_INFO_API_METHOD = "POST";
process.env.MLBB_BIND_INFO_API_KEY = "test-bind-key"; 
process.env.FULL_INFO_API_KEY = "test-full-info-key";
process.env.FULL_INFO_API = "https://fullinfo.example.test";
delete process.env.TELEGRAPH_ACCESS_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const handler = require("../api/bot.js");
const {
  buildRuntimeDailyReport,
  enrichPremiumEmojis,
  getAdminFeedbackText,
  getBindInfoResultText,
  getBindInfoWaitText,
  getCommandsText,
  getCustomEmojiIdText,
  getDailyReportText,
  getErrorsText,
  getFailedLookupText,
  getFullInfoPostText,
  getFullInfoWaitText,
  getFullInfoPromptText,
  getResultText,
  getStatsText,
  getUsersListText,
  isAdmin,
  isValidWebhookSecret,
  isKeyboardButton,
  buildFullInfoTelegraphContent,
  buildReadableSquad,
  createTelegraphPage,
  lookupMlbbFullInfo,
  lookupMlbbBindInfo,
  mainKeyboard,
  normalizeSecretEnv,
  normalizeBindInfoResponse,
  parseBengkelBindInfoText,
  parseContentRangeTotal,
  parseIdList,
  parseAdvancedRanges,
  parseMlbbInput,
  normalizeMlbbInputText,
  parseRequestBody,
  resolveSupabaseConfig,
  sanitizeTelegramUsername,
  trackFeatureUse,
  trackUser,
  validateSupabaseServiceKey,
} = handler.__private;

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function hasUnpairedSurrogate(value) {
  const text = String(value || "");

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }

      return true;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

test("parseMlbbInput accepts common account and zone formats", () => {
  assert.deepEqual(parseMlbbInput("123456789 (5009)"), {
    ok: true,
    accountId: "123456789",
    zoneId: "5009",
  });
  assert.deepEqual(parseMlbbInput("/check 123456789 5009"), {
    ok: true,
    accountId: "123456789",
    zoneId: "5009",
  });
});

test("parseMlbbInput strips brackets, quotes and punctuation automatically", () => {
  const expected = { ok: true, accountId: "13100313", zoneId: "2013" };
  for (const input of [
    "/fullinfo [13100313] [2013]",
    "/fullinfo 13100313 (2013)",
    '/fullinfo "13100313" "2013"',
    "/fullinfo 13100313, 2013",
    "/fullinfo {13100313; 2013}",
    "/fullinfo 13100313-2013",
    "/fullinfo 13100313 2013!",
    "/fullinfo id=13100313 serv=2013",
  ]) {
    assert.deepEqual(parseMlbbInput(input), expected, `should parse: ${input}`);
  }
});

test("parseMlbbInput accepts single- and multi-digit zones", () => {
  assert.deepEqual(parseMlbbInput("/fullinfo 13100313 4"), {
    ok: true,
    accountId: "13100313",
    zoneId: "4",
  });
  assert.deepEqual(parseMlbbInput("99999 [7]"), {
    ok: true,
    accountId: "99999",
    zoneId: "7",
  });
  assert.deepEqual(parseMlbbInput("13100313 2013"), {
    ok: true,
    accountId: "13100313",
    zoneId: "2013",
  });
});

test("parseRequestBody handles JSON strings, buffers, and invalid bodies", () => {
  assert.deepEqual(parseRequestBody('{"ok":true}'), { ok: true });
  assert.deepEqual(parseRequestBody(Buffer.from('{"update_id":1}')), {
    update_id: 1,
  });
  assert.deepEqual(parseRequestBody("not-json"), {});
  assert.deepEqual(parseRequestBody(42), {});
});

test("webhook secret accepts header or query value only when it matches", () => {
  assert.equal(isValidWebhookSecret("test-secret", ""), true);
  assert.equal(isValidWebhookSecret("", "test-secret"), true);
  assert.equal(isValidWebhookSecret("wrong", ""), false);
});

test("parseAdvancedRanges supports reversed and single-value ranges", () => {
  process.env.ADVANCED_SERVER_RANGES = "10-12,20,40-30,bad";

  assert.deepEqual(parseAdvancedRanges(), [
    [10, 12],
    [20, 20],
    [30, 40],
  ]);
});

test("sanitizeTelegramUsername removes @ and falls back on invalid names", () => {
  assert.equal(sanitizeTelegramUsername("@Valid_Name"), "Valid_Name");
  assert.equal(sanitizeTelegramUsername("bad name"), "Oblto_org");
});

test("admin helpers read comma-separated admin ids", () => {
  assert.deepEqual(parseIdList("5081175125, 8500085987, nope"), [
    "5081175125",
    "8500085987",
  ]);
  assert.equal(isAdmin("5081175125"), true);
  assert.equal(isAdmin("1"), false);
});

test("supabase config helper rejects publishable keys and accepts service role keys", () => {
  const payload = Buffer.from(
    JSON.stringify({ ref: "trybbxovootehqvaiydn", role: "service_role" })
  ).toString("base64url");
  const legacyServiceKey = `header.${payload}.signature`;

  assert.equal(
    normalizeSecretEnv(`SUPABASE_SERVICE_KEY="Bearer ${legacyServiceKey}"`),
    legacyServiceKey
  );
  assert.equal(
    validateSupabaseServiceKey("sb_publishable_test_key", "trybbxovootehqvaiydn").ok,
    false
  );

  const config = resolveSupabaseConfig(
    {
      SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_wrong",
      SUPABASE_SERVICE_KEY: legacyServiceKey,
    },
    "https://trybbxovootehqvaiydn.supabase.co"
  );

  assert.equal(config.serviceKey, legacyServiceKey);
  assert.equal(config.error, "");
});

test("result text does not include elapsed time", () => {
  const text = getResultText({
    accountId: "1289050",
    zoneId: "10050",
    serverType: "Original Server",
    region: null,
    nickname: "Player",
    status: "Profil topildi",
  });

  assert.doesNotMatch(text, /Vaqt/);
  assert.match(text, /1289050/);
});

test("keyboard helper recognizes reply keyboard labels", () => {
  assert.equal(isKeyboardButton("🔎 Server aniqlash", "🔎 Server aniqlash"), true);
  assert.equal(isKeyboardButton("other", "🔎 Server aniqlash"), false);
});

test("commands text includes admin commands only for admins", () => {
  assert.match(getCommandsText({ id: 5081175125 }), /\/message/);
  assert.match(getCommandsText({ id: 5081175125 }), /\/emoji/);
  assert.doesNotMatch(getCommandsText({ id: 777 }), /\/message/);
  assert.doesNotMatch(getCommandsText({ id: 777 }), /\/emoji/);
});

test("custom emoji helper lists ids and tg-emoji snippets", () => {
  const text = "Salom 👋";
  const emojiOffset = text.indexOf("👋");
  const result = getCustomEmojiIdText({
    reply_to_message: {
      text,
      entities: [
        {
          type: "custom_emoji",
          offset: emojiOffset,
          length: 2,
          custom_emoji_id: "premium-wave-id",
        },
      ],
    },
  });

  assert.match(result, /premium-wave-id/);
  assert.match(result, /&lt;tg-emoji emoji-id="premium-wave-id"&gt;👋&lt;\/tg-emoji&gt;/);
});

test("premium emoji enrichment wraps configured emojis and preserves code snippets", () => {
  const result = enrichPremiumEmojis(
    '✅ Tayyor 🔎 <code>&lt;tg-emoji emoji-id="sample"&gt;✅&lt;/tg-emoji&gt;</code>'
  );

  assert.match(
    result,
    /<tg-emoji emoji-id="5316561083085895267">✅<\/tg-emoji> Tayyor/
  );
  assert.match(result, /<tg-emoji emoji-id="5188217332748527444">🔎<\/tg-emoji>/);
  assert.match(result, /<code>&lt;tg-emoji emoji-id="sample"&gt;✅&lt;\/tg-emoji&gt;<\/code>/);
});

test("admin /emoji returns custom emoji ids from replied message", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 9201,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125, first_name: "Admin" },
            text: "/emoji",
            reply_to_message: {
              text: "Wave 👋",
              entities: [
                {
                  type: "custom_emoji",
                  offset: "Wave ".length,
                  length: 2,
                  custom_emoji_id: "premium-wave-id",
                },
              ],
            },
          },
        },
      },
      createRes()
    );

    assert.equal(calls.length, 1);
    assert.match(calls[0].payload.text, /premium-wave-id/);
    assert.match(calls[0].payload.text, /tg-emoji/);
    assert.doesNotMatch(calls[0].payload.text, /5316561083085895267/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("stats text includes today's users and monthly active section", () => {
  trackUser({ id: 99001, first_name: "Vali" }, { id: 99001, type: "private" }, {
    updateId: 9001,
    updateType: "message",
  });

  const text = getStatsText();

  assert.match(text, /Bugun botdan foydalanganlar/);
  assert.match(text, /99001/);
  assert.match(text, /Oylik aktiv userlar/);
  assert.doesNotMatch(text, /Oxirgi xatoliklar/);
});

test("daily report endpoint requires auth and triggers report", async () => {
  const reportHandler = require("../api/daily-report.js");
  const originalFetch = global.fetch;

  global.fetch = async () => {
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const infoRes = createRes();
    await reportHandler({ method: "GET", headers: {} }, infoRes);
    assert.equal(infoRes.statusCode, 200);
    assert.equal(infoRes.body.ok, true);

    const deniedRes = createRes();
    await reportHandler(
      { method: "POST", headers: { authorization: "Bearer wrong-secret" } },
      deniedRes
    );
    assert.equal(deniedRes.statusCode, 401);

    const okRes = createRes();
    await reportHandler(
      { method: "POST", headers: { authorization: "Bearer test-secret" } },
      okRes
    );
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.body.ok, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("daily report text lists actions and top users", () => {
  const text = getDailyReportText({
    date: "2026-08-13",
    actions: [
      { action: "server_check", count: 42 },
      { action: "bind_info", count: 18 },
    ],
    top_users: [
      { user_id: "111", username: "ali", first_name: "Ali", count: 25 },
      { user_id: "222", username: null, first_name: "Vali", last_name: "Karimov", count: 10 },
    ],
  });

  assert.match(text, /Kunlik foydalanish statistikasi/);
  assert.match(text, /2026-08-13/);
  assert.match(text, /Server tekshiruv: <b>42<\/b> ta/);
  assert.match(text, /Ulanmalar: <b>18<\/b> ta/);
  assert.match(text, /1\. @ali — <b>25<\/b> ta/);
  assert.match(text, /2\. Vali Karimov — <b>10<\/b> ta/);
});

test("trackFeatureUse counts meaningful actions for runtime report", () => {
  trackFeatureUse({ id: 99011, username: "ali" }, { id: 99011, type: "private" }, "server_check");
  trackFeatureUse({ id: 99011, username: "ali" }, { id: 99011, type: "private" }, "bind_info");
  trackFeatureUse({ id: 99012 }, { id: 99012, type: "private" }, "server_check");

  const report = buildRuntimeDailyReport();
  const serverCheck = report.actions.find((entry) => entry.action === "server_check");
  const bindInfo = report.actions.find((entry) => entry.action === "bind_info");

  assert.equal(Number(serverCheck.count), 2);
  assert.equal(Number(bindInfo.count), 1);
  assert.equal(report.top_users.length, 2);
  assert.equal(report.top_users[0].user_id, "99011");
});

test("main keyboard has no placeholder and hides admin buttons from users", () => {
  const userKeyboard = mainKeyboard({ id: 777 });
  const adminKeyboard = mainKeyboard({ id: 5081175125 });
  const userKeyboardText = JSON.stringify(userKeyboard);

  assert.equal(userKeyboard.input_field_placeholder, undefined);
  assert.equal(userKeyboard.keyboard[0][0].text, "🔎 Server aniqlash");
  assert.doesNotMatch(userKeyboardText, /📊|📣|👥|⚠️|Statistika|Xabar yuborish|Foydalanuvchilar|Xatoliklar|Buyruqlar|Yordam|🏠 Menyu|💬 Fikr va izohlar/);
  assert.match(JSON.stringify(adminKeyboard), /📊 Statistika/);
  assert.match(JSON.stringify(adminKeyboard), /👥 Foydalanuvchilar/);
  assert.match(JSON.stringify(adminKeyboard), /⚙️ Majburiylikni sozlash/);
  assert.doesNotMatch(JSON.stringify(adminKeyboard), /⚠️ Xatoliklar|📣 Xabar yuborish|📋 Buyruqlar|ℹ️ Yordam|🏠 Menyu/);
});

test("bind info button prompts for account and server ids", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 24,
          message: {
            chat: { id: 70024, type: "private" },
            from: { id: 70024, first_name: "Ali" },
            text: "🔗 Ulanmalar",
          },
        },
      },
      createRes()
    );

    assert.equal(calls.length, 1);
    assert.match(calls[0].payload.text, /Ulanmalar/);
    assert.match(calls[0].payload.text, /1006613098/);
    assert.equal(calls[0].payload.reply_markup.force_reply, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("bind info result masks all linked identifiers", () => {
  const normalized = normalizeBindInfoResponse({
    data: {
      bindings: {
        Moonton: "ilovemysecureemail@gmail.com",
        VK: "",
        googlePlay: null,
        tiktok: "private-tiktok-id",
        facebook: { username: "TestFacebookName" },
        Apple: false,
        GCID: "gamecenterid",
        Telegram: true,
        WhatsApp: "998901234567",
      },
      device_login: {
        Android: 0,
        iOS: 1,
      },
    },
  });

  assert.equal(normalized.ok, true);

  const text = getBindInfoResultText({
    accountId: "1006613098",
    zoneId: "13019",
    ...normalized.data,
  });

  assert.match(text, /🆔/);
  assert.match(text, /📧 <b>Moonton:<\/b> il\*+il@gmail\.com/);
  assert.match(text, /🔵 <b>VK:<\/b> empty\./);
  assert.match(text, /🎵 <b>TikTok:<\/b> pr\*+id/);
  assert.match(
    text,
    /<tg-emoji emoji-id="5929545717583449337">📘<\/tg-emoji> <b>Facebook:<\/b> Te\*+me/
  );
  assert.match(text, /🕹 <b>GCID:<\/b> ga\*+id/);
  assert.match(text, /✈️ <b>Telegram:<\/b> linked\./);
  assert.match(text, /🟢 <b>WhatsApp:<\/b> 99\*+67/);
  assert.match(text, /📱 <b>Device Login<\/b>/);
  assert.match(text, /🤖 <b>Android:<\/b> 0/);
  assert.match(text, /🍎 <b>iOS:<\/b> 1/);
  assert.match(text, /📊 <b>Jami:<\/b> 1/);
  assert.doesNotMatch(text, /ilovemysecureemail|private-tiktok-id|TestFacebookName|998901234567/);
});

test("bind info result hides device login when provider omits device data", () => {
  const normalized = normalizeBindInfoResponse({
    data: {
      bindings: {
        Moonton: "owner@example.com",
        Facebook: "fb-owner",
      },
    },
  });

  assert.equal(normalized.ok, true);

  const text = getBindInfoResultText({
    accountId: "1514855804",
    zoneId: "16368",
    ...normalized.data,
  });

  assert.match(text, /📧 <b>Moonton:<\/b> ow\*+er@example\.com/);
  assert.match(
    text,
    /<tg-emoji emoji-id="5929545717583449337">📘<\/tg-emoji> <b>Facebook:<\/b> fb\*+er/
  );
  assert.doesNotMatch(text, /Device Login|Android|iOS/);
});

test("zite player_info bind response is normalized to linked accounts", () => {
  const normalized = normalizeBindInfoResponse({
    player_info: {
      bind_count: 2,
      bind_account: [
        {
          account_name: "mt-and",
          platform: "Moonton (Android)",
          data: {
            email: "m***********************@gmail.com",
            register_time: "1728628655",
          },
        },
        {
          account_name: "gg",
          platform: "Google",
          data: {
            email: "m***************@gmail.com",
            name: "M**********",
          },
        },
      ],
    },
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.data.bindings.moonton, "m***********************@gmail.com");
  assert.equal(normalized.data.bindings.googlePlay, "m***************@gmail.com");

  const text = getBindInfoResultText({
    accountId: "1514855804",
    zoneId: "16368",
    ...normalized.data,
  });

  assert.match(text, /📧 <b>Moonton:<\/b> m\*+@gmail\.com/);
  assert.match(text, /🎮 <b>Google Play:<\/b> m\*+@gmail\.com/);
  assert.doesNotMatch(text, /Device Login/);
});

test("bind response keeps fallback values when item data is empty", () => {
  const normalized = normalizeBindInfoResponse({
    data: {
      bind_account: [
        {
          platform: "Moonton",
          data: {},
          account_name: "owner@example.com",
        },
        {
          platform: "Facebook",
          data: {},
          username: "fb-owner",
        },
        {
          platform: "Google Play",
          data: null,
          is_bound: true,
        },
      ],
    },
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.data.bindings.moonton, "owner@example.com");
  assert.equal(normalized.data.bindings.facebook, "fb-owner");
  assert.equal(normalized.data.bindings.googlePlay, true);
});

test("zite response without player_info is not treated as all-empty bindings", () => {
  const normalized = normalizeBindInfoResponse({
    player: {
      id: 1006613098,
      zone: 13019,
    },
    clientparam: "https://play.mobilelegends.com/accountretreivalv3/",
    player_info: null,
    _meta: {
      success: true,
    },
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.reason, /ulanmalar ma’lumotini qaytarmadi/);
});

test("bind info wait text tells users zite lookup can take time", () => {
  assert.match(getBindInfoWaitText(), /biroz vaqt olishi mumkin/);
  assert.match(getBindInfoWaitText(), /kutib turing/);
});

test("bind info lookup posts player and server ids to configured API", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), payload: JSON.parse(options.body) });

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          bind_account: [
            { platform: "Moonton", email: "owner@example.com" },
            { platform: "Facebook", username: "fb-owner" },
            { platform: "Google Play", bound: true },
            { platform: "TikTok", status: "not linked" },
          ],
          connected_device: [
            { platform: "Android", count: 2 },
            { platform: "iOS", count: 1 },
          ],
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    const result = await lookupMlbbBindInfo("1006613098", "13019");

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://bind.example.test/bind");
    assert.deepEqual(calls[0].payload, {
      player_id: "1006613098",
      server_id: "13019",
      x_key: "test-bind-key",
    });
    assert.equal(result.data.bindings.moonton, "owner@example.com");
    assert.equal(result.data.bindings.facebook, "fb-owner");
    assert.equal(result.data.bindings.googlePlay, true);
    assert.equal(result.data.bindings.tiktok, "not linked");
    assert.equal(result.data.deviceLogin.android, "2");
    assert.equal(result.data.deviceLogin.ios, "1");
  } finally {
    global.fetch = originalFetch;
  }
});

test("bind info lookup classifies provider auth and endpoint errors", async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = async () =>
      new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    const authResult = await lookupMlbbBindInfo("1006613098", "13019");

    assert.equal(authResult.ok, false);
    assert.equal(authResult.reason, "bind_info_provider_auth_required");
    assert.match(authResult.technicalReason, /HTTP 401/);

    global.fetch = async () =>
      new Response("<!DOCTYPE html><html><body>Not Found</body></html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });

    const notFoundResult = await lookupMlbbBindInfo("1006613098", "13019");

    assert.equal(notFoundResult.ok, false);
    assert.equal(notFoundResult.reason, "bind_info_provider_not_found");
    assert.match(notFoundResult.technicalReason, /HTTP 404/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("bengkel bot text response is normalized to linked accounts", () => {
  const normalized = parseBengkelBindInfoText(
    [
      "Bengkel MLBB",
      "Moonton: owner@example.com",
      "Facebook = fb-owner",
      "Google Play - linked",
      "TikTok: Tidak Ada",
      "Telegram: @owner",
      "WhatsApp: +998901234567",
      "Device Login: Android 2 | iOS 1",
    ].join("\n")
  );

  assert.equal(normalized.ok, true);
  assert.equal(normalized.data.bindings.moonton, "owner@example.com");
  assert.equal(normalized.data.bindings.facebook, "fb-owner");
  assert.equal(normalized.data.bindings.googlePlay, true);
  assert.equal(normalized.data.bindings.tiktok, "not linked");
  assert.equal(normalized.data.bindings.telegram, "@owner");
  assert.equal(normalized.data.bindings.whatsapp, "+998901234567");
  assert.equal(normalized.data.deviceLogin.android, "2");
  assert.equal(normalized.data.deviceLogin.ios, "1");

  const text = getBindInfoResultText({
    accountId: "1006613098",
    zoneId: "13019",
    ...normalized.data,
  });

  assert.match(text, /📧 <b>Moonton:<\/b> ow\*+er@example\.com/);
  assert.match(text, /🎮 <b>Google Play:<\/b> linked\./);
  assert.match(text, /🎵 <b>TikTok:<\/b> empty\./);
  assert.match(text, /✈️ <b>Telegram:<\/b> @o\*+er/);
  assert.match(text, /🤖 <b>Android:<\/b> 2/);
  assert.match(text, /🍎 <b>iOS:<\/b> 1/);
  assert.match(text, /📊 <b>Jami:<\/b> 3/);
  assert.doesNotMatch(text, /998901234567/);
});

test("bengkel bridge request uses target bot and parses bridge text", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const originalFetch = global.fetch;
  const originalStats = global.__MLBB_BOT_STATS__;
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    MLBB_BIND_INFO_PROVIDER: process.env.MLBB_BIND_INFO_PROVIDER,
    MLBB_BIND_INFO_API_URL: process.env.MLBB_BIND_INFO_API_URL,
    MLBB_BIND_INFO_API_METHOD: process.env.MLBB_BIND_INFO_API_METHOD,
    MLBB_BIND_INFO_API_KEY: process.env.MLBB_BIND_INFO_API_KEY,
    MLBB_BIND_INFO_BENGKEL_BOT_USERNAME:
      process.env.MLBB_BIND_INFO_BENGKEL_BOT_USERNAME,
    MLBB_BIND_INFO_BENGKEL_MESSAGE_TEMPLATE:
      process.env.MLBB_BIND_INFO_BENGKEL_MESSAGE_TEMPLATE,
  };
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });

    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          text: [
            "Moonton: owner@example.com",
            "Facebook: fb-owner",
            "Google Play: linked",
          ].join("\n"),
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.MLBB_BIND_INFO_PROVIDER = "bengkel";
    process.env.MLBB_BIND_INFO_API_URL = "https://bridge.example.test/bengkel";
    process.env.MLBB_BIND_INFO_API_METHOD = "POST";
    process.env.MLBB_BIND_INFO_API_KEY = "bridge-secret";
    delete process.env.MLBB_BIND_INFO_BENGKEL_MESSAGE_TEMPLATE;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    const freshHandler = require("../api/bot.js");
    const result = await freshHandler.__private.lookupMlbbBindInfo(
      "1006613098",
      "13019"
    );

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://bridge.example.test/bengkel");
    assert.deepEqual(calls[0].payload, {
      bot_username: "bengkelmlbb_bot",
      message: "/info 1006613098 13019",
      account_id: "1006613098",
      zone_id: "13019",
      x_key: "bridge-secret",
    });
    assert.equal(result.data.bindings.moonton, "owner@example.com");
    assert.equal(result.data.bindings.facebook, "fb-owner");
    assert.equal(result.data.bindings.googlePlay, true);
  } finally {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    global.__MLBB_BOT_STATS__ = originalStats;
    delete require.cache[modulePath];
    require("../api/bot.js");
  }
});

test("bengkel provider rejects direct Telegram Bot API URL", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const originalStats = global.__MLBB_BOT_STATS__;
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    MLBB_BIND_INFO_PROVIDER: process.env.MLBB_BIND_INFO_PROVIDER,
    MLBB_BIND_INFO_API_URL: process.env.MLBB_BIND_INFO_API_URL,
    MLBB_BIND_INFO_API_METHOD: process.env.MLBB_BIND_INFO_API_METHOD,
  };

  try {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.MLBB_BIND_INFO_PROVIDER = "bengkel";
    process.env.MLBB_BIND_INFO_API_URL = "https://api.telegram.org/bot123/sendMessage";
    process.env.MLBB_BIND_INFO_API_METHOD = "POST";
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    const freshHandler = require("../api/bot.js");
    const result = await freshHandler.__private.lookupMlbbBindInfo(
      "1006613098",
      "13019"
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "bengkel_bridge_not_configured");
    assert.match(result.technicalReason, /bridge HTTP endpointi kerak/);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    global.__MLBB_BOT_STATS__ = originalStats;
    delete require.cache[modulePath];
    require("../api/bot.js");
  }
});

test("bind info button mode returns masked linked accounts", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlText, payload });

    if (urlText === "https://bind.example.test/bind") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            bindings: {
              Moonton: "owner@example.com",
              Facebook: "fb-owner",
              Telegram: true,
            },
            device_login: {
              Android: 2,
              iOS: 1,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const chat = { id: 70026, type: "private" };
    const from = { id: 70026, first_name: "Ali" };

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 26,
          message: { chat, from, text: "🔗 Ulanmalar" },
        },
      },
      createRes()
    );

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 27,
          message: { chat, from, text: "1006613098 (13019)" },
        },
      },
      createRes()
    );

    const bindCall = calls.find((call) => call.url === "https://bind.example.test/bind");
    const finalMessage = calls.at(-1).payload.text;

    assert.deepEqual(bindCall.payload, {
      player_id: "1006613098",
      server_id: "13019",
      x_key: "test-bind-key",
    });
    assert.match(finalMessage, /<b>Ulanmalar<\/b>/);
    assert.match(finalMessage, /📧 <b>Moonton:<\/b> ow\*+er@example\.com/);
    assert.match(finalMessage, /<b>Facebook:<\/b> fb\*+er/);
    assert.match(finalMessage, /✈️ <b>Telegram:<\/b> linked\./);
    assert.match(finalMessage, /<b>Device Login<\/b>/);
    assert.match(finalMessage, /🤖 <b>Android:<\/b> 2/);
    assert.match(finalMessage, /🍎 <b>iOS:<\/b> 1/);
    assert.match(finalMessage, /📊 <b>Jami:<\/b> 3/);
    assert.doesNotMatch(finalMessage, /owner@example\.com|fb-owner/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("bind info prompt reply uses bind lookup even if runtime mode is missing", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlText, payload });

    if (urlText === "https://bind.example.test/bind") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            bindings: {
              Moonton: "owner@example.com",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const chat = { id: 70028, type: "private" };
    const from = { id: 70028, first_name: "Ali" };

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 2801,
          message: { chat, from, text: "🔗 Ulanmalar" },
        },
      },
      createRes()
    );

    const promptText = calls[0].payload.text;
    global.__MLBB_BOT_STATS__.userModes.delete(String(from.id));
    calls.length = 0;

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 2802,
          message: {
            chat,
            from,
            text: "1006613098 (13019)",
            reply_to_message: {
              message_id: 101,
              text: promptText,
              from: { is_bot: true },
            },
          },
        },
      },
      createRes()
    );

    const bindCall = calls.find((call) => call.url === "https://bind.example.test/bind");
    const finalMessage = calls.at(-1).payload.text;

    assert.ok(bindCall);
    assert.match(finalMessage, /<b>Ulanmalar<\/b>/);
    assert.doesNotMatch(finalMessage, /Server Aniqlash Natijasi/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("/bind command returns masked linked accounts", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlText, payload });

    if (urlText === "https://bind.example.test/bind") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            bind_account: [
              { platform: "Moonton", email: "owner@example.com" },
              { platform: "Facebook", username: "fb-owner" },
            ],
            connected_device: [
              { platform: "Android", count: 1 },
              { platform: "iOS", count: 0 },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 42,
          message: {
            chat: { id: 70042, type: "private" },
            from: { id: 70042, first_name: "Ali" },
            text: "/bind 1006613098 (13019)",
          },
        },
      },
      createRes()
    );

    const bindCall = calls.find((call) => call.url === "https://bind.example.test/bind");
    const finalMessage = calls.at(-1).payload.text;

    assert.deepEqual(bindCall.payload, {
      player_id: "1006613098",
      server_id: "13019",
      x_key: "test-bind-key",
    });
    assert.match(finalMessage, /<b>Ulanmalar<\/b>/);
    assert.match(finalMessage, /📧 <b>Moonton:<\/b> ow\*+er@example\.com/);
    assert.match(finalMessage, /<b>Facebook:<\/b> fb\*+er/);
    assert.match(finalMessage, /🤖 <b>Android:<\/b> 1/);
    assert.match(finalMessage, /🍎 <b>iOS:<\/b> 0/);
    assert.match(finalMessage, /📊 <b>Jami:<\/b> 1/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("/info command is an alias for bind info lookup", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlText, payload });

    if (urlText === "https://bind.example.test/bind") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            bindings: {
              Moonton: "owner@example.com",
              GooglePlay: true,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 43,
          message: {
            chat: { id: 70043, type: "private" },
            from: { id: 70043, first_name: "Ali" },
            text: "/info 1006613098 (13019)",
          },
        },
      },
      createRes()
    );

    const bindCall = calls.find((call) => call.url === "https://bind.example.test/bind");
    const finalMessage = calls.at(-1).payload.text;

    assert.deepEqual(bindCall.payload, {
      player_id: "1006613098",
      server_id: "13019",
      x_key: "test-bind-key",
    });
    assert.match(finalMessage, /<b>Ulanmalar<\/b>/);
    assert.match(finalMessage, /📧 <b>Moonton:<\/b> ow\*+er@example\.com/);
    assert.match(finalMessage, /🎮 <b>Google Play:<\/b> linked\./);
  } finally {
    global.fetch = originalFetch;
  }
});

test("content-range parser reads exact Supabase totals", () => {
  assert.equal(parseContentRangeTotal("0-9/42"), 42);
  assert.equal(parseContentRangeTotal("*/0"), 0);
  assert.equal(parseContentRangeTotal("0-9/*"), null);
});

test("users list text numbers paginated rows", () => {
  const text = getUsersListText({
    users: [
      {
        user_id: "10011",
        first_name: "Ali",
        username: "ali_test",
        updates_count: 3,
        last_seen_at: "2026-05-11T06:00:00.000Z",
      },
    ],
    total: 12,
    page: 1,
    pageSize: 10,
    source: "supabase",
  });

  assert.match(text, /Bot foydalanuvchilari/);
  assert.match(text, /Jami: <b>12<\/b>/);
  assert.match(text, /11\. <code>10011<\/code>/);
  assert.match(text, /@ali_test/);
});

test("users list text clips names without splitting emoji pairs", () => {
  const riskyName = `${"A".repeat(41)}😀${"B".repeat(10)}`;
  const text = getUsersListText({
    users: [
      {
        user_id: "10012",
        first_name: riskyName,
        updates_count: 1,
        last_seen_at: "2026-05-11T06:00:00.000Z",
      },
    ],
    total: 1,
    page: 0,
    pageSize: 10,
    source: "runtime",
  });

  assert.equal(hasUnpairedSurrogate(text), false);
  assert.match(text, /\.\.\./);
});

test("lookup fallback hides raw provider status from users", () => {
  const text = getFailedLookupText(
    { accountId: "1289050", zoneId: "10050" },
    {
      ok: false,
      status: 500,
      reason:
        "Tashqi tekshiruv servisi vaqtincha javob bermayapti. ID va serverni tekshirib, birozdan keyin qayta urinib ko‘ring.",
      technicalReason: "Lookup API HTTP 500",
    }
  );

  assert.doesNotMatch(text, /HTTP 500|Lookup API/);
  assert.match(text, /Profil topilmadi/);
});

test("handler rejects POST requests without the configured webhook secret", async () => {
  const res = createRes();

  await handler(
    {
      method: "POST",
      headers: {},
      query: {},
      body: { update_id: 1 },
    },
    res
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test("/start sends a reply keyboard", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 2,
          message: {
            chat: { id: 777, type: "private" },
            from: { id: 777, first_name: "Ali" },
            text: "/start",
          },
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].payload.reply_markup.keyboard);
    assert.equal(calls[0].payload.reply_markup.inline_keyboard, undefined);
    assert.equal(calls[0].payload.reply_markup.input_field_placeholder, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("outgoing Telegram text strips malformed surrogate characters", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 3,
          message: {
            chat: { id: 70001, type: "private" },
            from: { id: 70001, first_name: "Ali\uD83D" },
            text: "/start",
          },
        },
      },
      createRes()
    );

    assert.ok(calls[0]);
    assert.match(calls[0].payload.text, /Ali/);
    assert.equal(hasUnpairedSurrogate(calls[0].payload.text), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("group messages without a bot mention are ignored", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 20,
          message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: 777, first_name: "Ali" },
            text: "1289050 10050",
          },
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("group mention for another username is ignored", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 44,
          message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: 777, first_name: "Ali" },
            text: "@other_user 1289050 10050",
            entities: [{ type: "mention", offset: 0, length: 11 }],
          },
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("group /info command returns masked linked accounts", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlText, payload });

    if (urlText === "https://bind.example.test/bind") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            bind_account: [
              { platform: "Moonton", email: "owner@example.com" },
              { platform: "Facebook", username: "fb-owner" },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 45,
          message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: 777, first_name: "Ali" },
            text: "@mlbb_test_bot /info 1514855804 16368",
            entities: [{ type: "mention", offset: 0, length: 14 }],
          },
        },
      },
      res
    );

    const bindCall = calls.find((call) => call.url === "https://bind.example.test/bind");
    const finalMessage = calls.at(-1).payload;

    assert.equal(res.statusCode, 200);
    assert.ok(bindCall);
    assert.deepEqual(bindCall.payload, {
      player_id: "1514855804",
      server_id: "16368",
      x_key: "test-bind-key",
    });
    assert.match(finalMessage.text, /<b>Ulanmalar<\/b>/);
    assert.match(finalMessage.text, /📧 <b>Moonton:<\/b> ow\*+er@example\.com/);
    assert.match(finalMessage.text, /<b>Facebook:<\/b> fb\*+er/);
    assert.equal(finalMessage.reply_markup, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("group /bind command works without mentioning the bot", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlText, payload });

    if (urlText === "https://bind.example.test/bind") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            bindings: {
              Moonton: "owner@example.com",
              GooglePlay: true,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 46,
          message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: 777, first_name: "Ali" },
            text: "/bind 1514855804 (16368)",
            entities: [{ type: "bot_command", offset: 0, length: 5 }],
          },
        },
      },
      res
    );

    const bindCall = calls.find((call) => call.url === "https://bind.example.test/bind");
    const finalMessage = calls.at(-1).payload;

    assert.equal(res.statusCode, 200);
    assert.ok(bindCall);
    assert.match(finalMessage.text, /<b>Ulanmalar<\/b>/);
    assert.match(finalMessage.text, /🎮 <b>Google Play:<\/b> linked\./);
    assert.equal(finalMessage.reply_markup, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("group mention with MLBB ids returns the usual lookup result", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);

    if (urlText.startsWith("https://api.telegram.org")) {
      calls.push({ url: urlText, payload: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        nickname: "Player",
        region: "Indonesia",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 21,
          message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: 777, first_name: "Ali" },
            text: "@mlbb_test_bot 1289050 10050",
            entities: [{ type: "mention", offset: 0, length: 14 }],
          },
        },
      },
      res
    );

    const finalMessage = calls.at(-1).payload;

    assert.equal(res.statusCode, 200);
    assert.match(finalMessage.text, /Server Aniqlash Natijasi/);
    assert.match(finalMessage.text, /Indonesia/);
    assert.equal(finalMessage.reply_markup, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("group /check command works without mentioning the bot", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);

    if (urlText.startsWith("https://api.telegram.org")) {
      calls.push({ url: urlText, payload: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    assert.match(urlText, /id=18013805/);
    assert.match(urlText, /zone=10190/);

    return new Response(
      JSON.stringify({
        nickname: "GroupPlayer",
        region: "Singapore",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 22,
          message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: 777, first_name: "Ali" },
            text: "/check 18013805 (10190)",
            entities: [{ type: "bot_command", offset: 0, length: 6 }],
          },
        },
      },
      res
    );

    const finalMessage = calls.at(-1).payload;

    assert.equal(res.statusCode, 200);
    assert.match(finalMessage.text, /Server Aniqlash Natijasi/);
    assert.match(finalMessage.text, /Singapore/);
    assert.equal(finalMessage.reply_markup, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("callback queries without a message are acknowledged without crashing", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 2,
          callback_query: {
            id: "callback-id",
            data: "stats",
            from: { id: 1 },
          },
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /answerCallbackQuery$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("MLBB lookup HTTP 500 returns friendly fallback and records details", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    const urlText = String(url);

    if (urlText.startsWith("https://api.telegram.org")) {
      calls.push({ url: urlText, payload: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("server exploded", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 8,
          message: {
            chat: { id: 777, type: "private" },
            from: { id: 777 },
            text: "1289050 (10050)",
          },
        },
      },
      res
    );

    const finalMessage = calls.at(-1).payload.text;

    assert.equal(res.statusCode, 200);
    assert.match(finalMessage, /Profil topilmadi/);
    assert.doesNotMatch(finalMessage, /HTTP 500|Lookup API|server exploded/);
    assert.doesNotMatch(getStatsText(), /mlbb_lookup_failed/);
    assert.match(getErrorsText(), /mlbb_lookup_failed/);
    assert.match(getErrorsText(), /status=500/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("non-admin users cannot open stats", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 3,
          message: {
            chat: { id: 777, type: "private" },
            from: { id: 777 },
            text: "/stats",
          },
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].payload.text, /admin|statistika|\/message/i);
    assert.match(calls[0].payload.text, /tushunmadim/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("feedback command sends user comments to all admins", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: calls.length + 100 } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 34,
          message: {
            chat: { id: 777, type: "private" },
            from: { id: 777, first_name: "Ali", username: "ali_test" },
            text: "/feedback",
          },
        },
      },
      createRes()
    );

    assert.match(calls[0].payload.text, /Fikr va izohlar/);
    assert.equal(calls[0].payload.reply_markup.force_reply, true);
    calls.length = 0;

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 35,
          message: {
            chat: { id: 777, type: "private" },
            from: { id: 777, first_name: "Ali", username: "ali_test" },
            text: "Botga reyting funksiyasi kerak",
          },
        },
      },
      createRes()
    );

    const mainGroupMessages = calls.filter((call) =>
      String(call.payload.chat_id) === "-1003832186200"
    );
    const userAck = calls.find((call) => call.payload.chat_id === 777);

    assert.equal(mainGroupMessages.length, 1);
    assert.ok(userAck);
    assert.match(mainGroupMessages[0].payload.text, /Feedback ID/);
    assert.match(mainGroupMessages[0].payload.text, /User ID: <code>777<\/code>/);
    assert.match(mainGroupMessages[0].payload.text, /Botga reyting funksiyasi kerak/);
    assert.match(userAck.payload.text, /Fikringiz yuborildi/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("admin reply to feedback notification is delivered to the user", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const notificationText = getAdminFeedbackText({
    id: "fb_test123",
    userId: "777",
    chatId: "777",
    user: { id: 777, first_name: "Ali", username: "ali_test" },
    text: "Qidiruv tarixi kerak",
    createdAt: "2026-05-11T06:00:00.000Z",
  });

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 36,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125, first_name: "Admin", username: "ksava_org" },
            text: "Taklif qabul qilindi, qo‘shamiz.",
            reply_to_message: {
              message_id: 90,
              text: notificationText,
              from: { is_bot: true },
            },
          },
        },
      },
      createRes()
    );

    const userReply = calls.find((call) => call.payload.chat_id === "777");
    const adminAck = calls.find((call) => call.payload.chat_id === 5081175125);

    assert.ok(userReply);
    assert.match(userReply.payload.text, /Admin @ksava_org javob berdi/);
    assert.match(userReply.payload.text, /Taklif qabul qilindi/);
    assert.equal(userReply.payload.parse_mode, undefined);
    assert.ok(adminAck);
    assert.match(adminAck.payload.text, /Javob userga yuborildi/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("admin feedback reply preserves premium custom emoji entities", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const notificationText = getAdminFeedbackText({
    id: "fb_premium123",
    userId: "777",
    chatId: "777",
    user: { id: 777, first_name: "Ali" },
    text: "Premium emoji kerak",
    createdAt: "2026-05-11T06:00:00.000Z",
  });
  const replyText = "Albatta 🙂";
  const emojiOffset = replyText.indexOf("🙂");

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 3701,
          message: {
            message_id: 501,
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125, first_name: "Admin" },
            text: replyText,
            entities: [
              {
                type: "custom_emoji",
                offset: emojiOffset,
                length: 2,
                custom_emoji_id: "premium-feedback-emoji",
              },
            ],
            reply_to_message: {
              message_id: 90,
              text: notificationText,
              from: { is_bot: true },
            },
          },
        },
      },
      createRes()
    );

    const userReply = calls.find((call) => call.payload.chat_id === "777");
    const premiumEntity = userReply.payload.entities.find(
      (entity) => entity.type === "custom_emoji"
    );

    assert.ok(userReply);
    assert.equal(userReply.payload.parse_mode, undefined);
    assert.equal(premiumEntity.custom_emoji_id, "premium-feedback-emoji");
    assert.equal(premiumEntity.offset, userReply.payload.text.indexOf("🙂"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("admin feedback reply copies sticker messages to the user", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const notificationText = getAdminFeedbackText({
    id: "fb_sticker123",
    userId: "777",
    chatId: "777",
    user: { id: 777, first_name: "Ali" },
    text: "Sticker bilan javob",
    createdAt: "2026-05-11T06:00:00.000Z",
  });

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 3801,
          message: {
            message_id: 502,
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125, first_name: "Admin" },
            sticker: { file_id: "premium-sticker-file" },
            reply_to_message: {
              message_id: 90,
              text: notificationText,
              from: { is_bot: true },
            },
          },
        },
      },
      createRes()
    );

    const copied = calls.find((call) => String(call.url).endsWith("/copyMessage"));

    assert.ok(copied);
    assert.equal(copied.payload.chat_id, "777");
    assert.equal(copied.payload.from_chat_id, 5081175125);
    assert.equal(copied.payload.message_id, 502);
  } finally {
    global.fetch = originalFetch;
  }
});

test("admin users button paginates in the same message", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  for (let index = 0; index < 12; index += 1) {
    trackUser(
      { id: 701000 + index, first_name: `User${index}` },
      { id: 701000 + index, type: "private" },
      { updateId: 710000 + index, updateType: "message" }
    );
  }

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 40,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125 },
            text: "👥 Foydalanuvchilar",
          },
        },
      },
      createRes()
    );

    const sent = calls.at(-1).payload;
    const nextCallback = sent.reply_markup.inline_keyboard[0][0].callback_data;

    assert.match(sent.text, /Bot foydalanuvchilari/);
    assert.match(nextCallback, /^users_page:1$/);

    calls.length = 0;

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 41,
          callback_query: {
            id: "callback-id",
            data: nextCallback,
            from: { id: 5081175125 },
            message: {
              message_id: 55,
              chat: { id: 5081175125, type: "private" },
            },
          },
        },
      },
      createRes()
    );

    const editCall = calls.find((call) => String(call.url).endsWith("/editMessageText"));

    assert.ok(editCall);
    assert.equal(editCall.payload.message_id, 55);
    assert.match(editCall.payload.text, /Sahifa: <b>2\//);
  } finally {
    global.fetch = originalFetch;
  }
});

test("admin /message creates a confirmation keyboard", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 4,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125 },
            text: "/message Salom hammaga",
          },
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].payload.text, /Hamma foydalanuvchilarga/);
    assert.match(calls[0].payload.text, /Hali hech kimga yuborilmadi/);
    assert.match(
      calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data,
      /^broadcast_confirm:[a-f0-9]+:[a-f0-9]+$/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("broadcast preserves Telegram text entities after /message", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const text = "/message Salom bold 🙂";
  const boldOffset = text.indexOf("bold");
  const emojiOffset = text.indexOf("🙂");

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 30,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125 },
            text,
            entities: [
              { type: "bot_command", offset: 0, length: 8 },
              { type: "bold", offset: boldOffset, length: 4 },
              {
                type: "custom_emoji",
                offset: emojiOffset,
                length: 2,
                custom_emoji_id: "premium-emoji-id",
              },
            ],
          },
        },
      },
      createRes()
    );

    const callbackData =
      calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data;
    calls.length = 0;

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 31,
          callback_query: {
            id: "callback-id",
            data: callbackData,
            from: { id: 5081175125 },
            message: { chat: { id: 5081175125, type: "private" } },
          },
        },
      },
      createRes()
    );

    const sent = calls.find((call) => call.payload.text === "Salom bold 🙂");

    assert.ok(sent);
    assert.equal(sent.payload.parse_mode, undefined);
    assert.deepEqual(sent.payload.entities, [
      { type: "bold", offset: 6, length: 4 },
      {
        type: "custom_emoji",
        offset: 11,
        length: 2,
        custom_emoji_id: "premium-emoji-id",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reply /message copies stickers or media instead of rebuilding text", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 32,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125 },
            text: "/message",
            entities: [{ type: "bot_command", offset: 0, length: 8 }],
            reply_to_message: {
              message_id: 44,
              chat: { id: 5081175125, type: "private" },
              sticker: { file_id: "premium-sticker-file" },
            },
          },
        },
      },
      createRes()
    );

    const callbackData =
      calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data;
    calls.length = 0;

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 33,
          callback_query: {
            id: "callback-id",
            data: callbackData,
            from: { id: 5081175125 },
            message: { chat: { id: 5081175125, type: "private" } },
          },
        },
      },
      createRes()
    );

    const copied = calls.find((call) => String(call.url).endsWith("/copyMessage"));

    assert.ok(copied);
    assert.equal(copied.payload.from_chat_id, 5081175125);
    assert.equal(copied.payload.message_id, 44);
  } finally {
    global.fetch = originalFetch;
  }
});

test("broadcast is not sent when confirmation token is invalid", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const res = createRes();

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 6,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125 },
            text: "/message Maxfiy test broadcast",
          },
        },
      },
      res
    );

    const callbackData =
      calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data;
    const forgedCallbackData = callbackData.replace(/:[a-f0-9]+$/, ":badtoken");
    calls.length = 0;

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 7,
          callback_query: {
            id: "callback-id",
            data: forgedCallbackData,
            from: { id: 5081175125 },
            message: { chat: { id: 5081175125, type: "private" } },
          },
        },
      },
      createRes()
    );

    assert.equal(calls.length, 2);
    assert.match(calls[1].payload.text, /eskirgan|topilmadi/);
    assert.equal(
      calls.some((call) => call.payload.text === "Maxfiy test broadcast"),
      false
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("broadcast confirm dispatches the broadcast to BROADCAST_QUEUE", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const queued = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 90,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125 },
            text: "/message Navbat orqali salom",
          },
        },
      },
      createRes()
    );

    const callbackData =
      calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data;
    calls.length = 0;

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 91,
          callback_query: {
            id: "callback-broadcast",
            data: callbackData,
            from: { id: 5081175125 },
            message: { chat: { id: 5081175125, type: "private" } },
          },
        },
      },
      createRes(),
      {
        BROADCAST_QUEUE: {
          send: async (job) => {
            queued.push(job);
          },
        },
      }
    );

    assert.equal(queued.length, 1);
    assert.equal(queued[0].payload.text, "Navbat orqali salom");
    assert.equal(queued[0].adminChatId, "5081175125");
    assert.equal(
      calls.some((call) => call.payload.text === "Navbat orqali salom"),
      false
    );
    assert.match(
      calls.map((call) => call.payload.text).join(" "),
      /navbatga qo‘yildi/
    );
  } finally {
    global.fetch = originalFetch;
  }
});


test("bind info wait message is deleted after zite lookup finishes", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const originalFetch = global.fetch;
  const originalStats = global.__MLBB_BOT_STATS__;
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    ADMIN_IDS: process.env.ADMIN_IDS,
    MLBB_BIND_INFO_PROVIDER: process.env.MLBB_BIND_INFO_PROVIDER,
    MLBB_BIND_INFO_API_URL: process.env.MLBB_BIND_INFO_API_URL,
    MLBB_BIND_INFO_API_METHOD: process.env.MLBB_BIND_INFO_API_METHOD,
    MLBB_BIND_INFO_API_KEY: process.env.MLBB_BIND_INFO_API_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlText, payload });

    if (urlText === "https://bind.example.test/bind") {
      return new Response(
        JSON.stringify({
          player_info: {
            bind_account: [
              {
                platform: "Moonton",
                data: { email: "owner@example.com" },
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, result: { message_id: calls.length + 100 } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.ADMIN_IDS = "5081175125";
    process.env.MLBB_BIND_INFO_PROVIDER = "zite";
    process.env.MLBB_BIND_INFO_API_URL = "https://bind.example.test/bind";
    process.env.MLBB_BIND_INFO_API_METHOD = "POST";
    delete process.env.MLBB_BIND_INFO_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    const freshHandler = require("../api/bot.js");

    await freshHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 3901,
          message: {
            chat: { id: 7039, type: "private" },
            from: { id: 7039, first_name: "Ali" },
            text: "/bind 1006613098 (13019)",
          },
        },
      },
      createRes()
    );

    const waitIndex = calls.findIndex((call) =>
      /Ulanmalar tekshirilmoqda/.test(call.payload?.text || "")
    );
    const deleted = calls.find((call) => String(call.url).endsWith("/deleteMessage"));

    assert.ok(waitIndex >= 0);
    assert.ok(deleted);
    assert.equal(deleted.payload.message_id, waitIndex + 1 + 100);
  } finally {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    global.__MLBB_BOT_STATS__ = originalStats;
    delete require.cache[modulePath];
    require("../api/bot.js");
  }
});

test("queued bind info update deletes the worker wait message", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlText, payload });

    if (urlText === "https://bind.example.test/bind") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            bindings: {
              Moonton: "owner@example.com",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 4001,
          __skip_bind_wait: true,
          __bind_wait_message: {
            chatId: 7040,
            messageId: 333,
          },
          message: {
            chat: { id: 7040, type: "private" },
            from: { id: 7040, first_name: "Ali" },
            text: "1006613098 (13019)",
            reply_to_message: {
              message_id: 101,
              text: "🔗 Ulanmalar\n\nMLBB Account ID va Server/Zone ID ni yuboring.",
              from: { is_bot: true },
            },
          },
        },
      },
      createRes()
    );

    const waitMessages = calls.filter((call) =>
      /Ulanmalar tekshirilmoqda/.test(call.payload?.text || "")
    );
    const deleted = calls.find((call) => String(call.url).endsWith("/deleteMessage"));

    assert.equal(waitMessages.length, 0);
    assert.ok(deleted);
    assert.equal(deleted.payload.chat_id, "7040");
    assert.equal(deleted.payload.message_id, 333);
  } finally {
    global.fetch = originalFetch;
  }
});

test("worker queues bind info prompt replies and carries wait message id", async () => {
  const originalFetch = global.fetch;
  const queued = [];
  const calls = [];
  const workerUrl = pathToFileURL(require.resolve("../worker.mjs")).href;
  const worker = await import(`${workerUrl}?test=${Date.now()}`);

  global.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });

    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 444 } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    const response = await worker.default.fetch(
      new Request("https://example.test/api/bot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify({
          update_id: 4101,
          message: {
            chat: { id: 7041, type: "private" },
            from: { id: 7041, first_name: "Ali" },
            text: "1006613098 (13019)",
            reply_to_message: {
              message_id: 101,
              text: "🔗 Ulanmalar\n\nMLBB Account ID va Server/Zone ID ni yuboring.",
              from: { is_bot: true },
            },
          },
        }),
      }),
      {
        TELEGRAM_BOT_TOKEN: "123456:test-token",
        TELEGRAM_WEBHOOK_SECRET: "test-secret",
        TELEGRAM_TIMEOUT_MS: "5000",
        BIND_INFO_QUEUE: {
          async send(payload) {
            queued.push(payload);
          },
        },
      },
      { waitUntil() {} }
    );
    const body = await response.json();

    assert.equal(body.queued, true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].__skip_bind_wait, true);
    assert.deepEqual(queued[0].__bind_wait_message, {
      chatId: 7041,
      messageId: 444,
    });
    assert.match(calls[0].payload.text, /Ulanmalar tekshirilmoqda/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("worker queues bind command aliases from group messages", async () => {
  const originalFetch = global.fetch;
  const queued = [];
  const calls = [];
  const workerUrl = pathToFileURL(require.resolve("../worker.mjs")).href;
  const worker = await import(`${workerUrl}?test=${Date.now()}-alias`);

  global.fetch = async (url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), payload });

    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 445 } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    const response = await worker.default.fetch(
      new Request("https://example.test/api/bot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify({
          update_id: 4102,
          message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: 7042, first_name: "Ali" },
            text: "/ulanmalar 1006613098 (13019)",
          },
        }),
      }),
      {
        TELEGRAM_BOT_TOKEN: "123456:test-token",
        TELEGRAM_WEBHOOK_SECRET: "test-secret",
        TELEGRAM_TIMEOUT_MS: "5000",
        BIND_INFO_QUEUE: {
          async send(payload) {
            queued.push(payload);
          },
        },
      },
      { waitUntil() {} }
    );
    const body = await response.json();

    assert.equal(body.queued, true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].__skip_bind_wait, true);
    assert.deepEqual(queued[0].__bind_wait_message, {
      chatId: -100777,
      messageId: 445,
    });
    assert.match(calls[0].payload.text, /Ulanmalar tekshirilmoqda/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("broadcast recipients include every Supabase page and use user ids", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const originalFetch = global.fetch;
  const originalStats = global.__MLBB_BOT_STATS__;
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    ADMIN_IDS: process.env.ADMIN_IDS,
    BROADCAST_USER_IDS: process.env.BROADCAST_USER_IDS,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const payload = Buffer.from(
    JSON.stringify({ ref: "trybbxovootehqvaiydn", role: "service_role" })
  ).toString("base64url");
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({
    user_id: String(1000 + index),
    chat_id: index % 2 ? String(1000 + index) : String(-100000 - index),
    chat_type: index % 2 ? "private" : "supergroup",
    is_bot: false,
  }));

  firstPage[5] = {
    user_id: "1005",
    chat_id: "1005",
    chat_type: "private",
    is_bot: true,
  };

  global.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    const offset = Number(requestUrl.searchParams.get("offset") || 0);
    const rows =
      offset === 0
        ? firstPage
        : [{ user_id: "5000", chat_id: "-200000", chat_type: "group", is_bot: false }];

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.ADMIN_IDS = "5081175125";
    process.env.BROADCAST_USER_IDS = "999";
    process.env.SUPABASE_URL = "https://trybbxovootehqvaiydn.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = `header.${payload}.signature`;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    const freshHandler = require("../api/bot.js");
    const recipients = await freshHandler.__private.getBroadcastChatIds();

    assert.equal(recipients.length, 1001);
    assert.ok(recipients.includes("999"));
    assert.ok(recipients.includes("1000"));
    assert.ok(recipients.includes("5000"));
    assert.equal(recipients.includes("-100000"), false);
    assert.equal(recipients.includes("1005"), false);
  } finally {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    global.__MLBB_BOT_STATS__ = originalStats;
    delete require.cache[modulePath];
    require("../api/bot.js");
  }
});

test("full info lookup posts player and zone ids with api key header", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          player_id: 1718026025,
          server_id: 18308,
          nickname: "Lily•°",
          level: 66,
          rank: "Mythic Honor ⭐️ 27",
        },
        elapsed: 4.48,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  };

  try {
    const result = await lookupMlbbFullInfo("1718026025", "18308");

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://fullinfo.example.test/tools/check");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers["X-API-Key"], "test-full-info-key");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      player_id: 1718026025,
      zone_id: 18308,
    });
    assert.equal(result.data.nickname, "Lily•°");
  } finally {
    global.fetch = originalFetch;
  }
});

test("full info lookup classifies provider auth and not found errors", async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = async () =>
      new Response(JSON.stringify({ success: false, error: "Invalid key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    const authResult = await lookupMlbbFullInfo("1718026025", "18308");
    assert.equal(authResult.ok, false);
    assert.equal(authResult.reason, "full_info_provider_auth_required");
    assert.match(authResult.technicalReason, /HTTP 401/);

    global.fetch = async () =>
      new Response(JSON.stringify({ success: false, error: "Player not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });

    const notFoundResult = await lookupMlbbFullInfo("1718026025", "18308");
    assert.equal(notFoundResult.ok, false);
    assert.equal(notFoundResult.reason, "full_info_provider_not_found");
    assert.match(notFoundResult.technicalReason, /HTTP 404/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("full info lookup retries transient provider failures", async () => {
  const originalFetch = global.fetch;
  let fetches = 0;

  global.fetch = async () => {
    fetches += 1;

    if (fetches === 1) {
      return new Response(
        JSON.stringify({ success: false, error: "Player not found" }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { nickname: "Lily•°", level: 66 },
        elapsed: 4.48,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await lookupMlbbFullInfo("1718026025", "18308");

    assert.equal(result.ok, true);
    assert.equal(result.data.nickname, "Lily•°");
    assert.equal(fetches, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("full info lookup does not retry auth or quota failures", async () => {
  const originalFetch = global.fetch;
  let fetches = 0;

  global.fetch = async () => {
    fetches += 1;

    return new Response(JSON.stringify({ success: false, error: "Quota exceeded" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await lookupMlbbFullInfo("1718026025", "18308");

    assert.equal(result.ok, false);
    assert.equal(result.reason, "full_info_provider_auth_required");
    assert.equal(fetches, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("createTelegraphPage puts content in form-encoded body, not the URL", async () => {
  const originalFetch = global.fetch;
  const originalToken = global.__MLBB_BOT_STATS__.telegraphToken;
  global.__MLBB_BOT_STATS__.telegraphToken = "test-token";
  let captured;

  global.fetch = async (url, options = {}) => {
    captured = { url: String(url), options };
    return new Response(
      JSON.stringify({ ok: true, result: { url: "https://telegra.ph/Natija-2026-01-01" } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const content = [{ tag: "p", children: ["x".repeat(12000)] }];
    const result = await createTelegraphPage("Natija", content);

    assert.equal(result.url, "https://telegra.ph/Natija-2026-01-01");
    assert.ok(captured.url.startsWith("https://api.telegra.ph/createPage"));
    assert.equal(captured.url.includes("content="), false, "content must not go in the URL");
    assert.ok(captured.url.length < 2048, "URL must stay small regardless of content size");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers["Content-Type"], "application/x-www-form-urlencoded");

    const parsedParameters = new URLSearchParams(captured.options.body);
    assert.equal(parsedParameters.get("access_token"), "test-token");
    assert.equal(parsedParameters.get("title"), "Natija");
    assert.deepEqual(JSON.parse(parsedParameters.get("content")), content);
  } finally {
    global.fetch = originalFetch;
    global.__MLBB_BOT_STATS__.telegraphToken = originalToken;
  }
});

test("full info telegraph content separates sections with colors and no images", () => {
  const data = JSON.parse(
    require("node:fs").readFileSync(
      `${__dirname}/../full_info_1718026025.json`,
      "utf8"
    )
  ).data;

  const content = buildFullInfoTelegraphContent(data);

  assert.ok(Array.isArray(content));
  assert.ok(content.length > 10);

  const headers = content
    .filter((node) => node.tag === "h3")
    .map((node) => String(node.children && node.children[0]));

  assert.ok(headers.some((h) => h.includes("🔵 Asosiy ma'lumotlar")));
  assert.ok(headers.some((h) => h.includes("🟡 Kolleksiya")));
  assert.ok(headers.some((h) => h.includes("🔴 Jangovor statistika")));
  assert.ok(headers.some((h) => h.includes("🟢 Sevimli qahramonlar")));
  assert.ok(headers.some((h) => h.includes("🟠 So'nggi janglar")));
  assert.ok(headers.some((h) => h.includes("🟣 Ijtimoiy ko'rsatkichlar")));

  const serialized = JSON.stringify(content);
  assert.equal(content[0].tag, "figure", "profile image must be the first (head) node");
  assert.equal(content[0].children[0].tag, "img", "figure must wrap an img");
  assert.match(content[0].children[0].attrs.src, /akmpicture/);
  assert.equal(serialized.includes('"img"'), true);
  assert.equal(serialized.includes("figure"), true);
  assert.equal(serialized.includes("hero_image"), false);
  assert.equal(serialized.includes('"hr"'), true, "sections should be separated with hr dividers");
  const hrCount = content.filter((n) => n.tag === "hr").length;
  assert.ok(hrCount >= 4, `expected at least 4 divider lines, got ${hrCount}`);
  const firstSectionIndex = content.findIndex(
    (n) => n.tag === "h3" && String(n.children && n.children[0]).includes("Asosiy ma'lumotlar")
  );
  const secondSectionIndex = content.findIndex(
    (n) => n.tag === "h3" && String(n.children && n.children[0]).includes("Kolleksiya")
  );
  assert.equal(content[secondSectionIndex - 1].tag, "hr", "a divider must sit between sections");
  assert.notEqual(content[firstSectionIndex - 1].tag, "hr", "no divider before the first section");
});

test("full info readable squad hides numeric squad ids", () => {
  assert.equal(buildReadableSquad({ name: "297880", tag: "337570" }), null, "numeric name+tag must be hidden");
  assert.equal(buildReadableSquad({ name: "200", tag: "210" }), null, "numeric only squad must be hidden");
  assert.equal(buildReadableSquad({ name: "" }), null, "empty name must be hidden");
  assert.equal(buildReadableSquad({ name: "Urganch Brothers", tag: "URG" }), "Urganch Brothers (URG)", "readable name+tag must show");
  assert.equal(buildReadableSquad({ name: "Urganch Brothers", tag: "337570" }), "Urganch Brothers", "numeric tag must be dropped");
  assert.equal(buildReadableSquad({ name: "Urganch Brothers" }), "Urganch Brothers", "readable name without tag must show");
});

test("full info post text mentions the button and hides the url", () => {
  const data = JSON.parse(
    require("node:fs").readFileSync(
      `${__dirname}/../full_info_1718026025.json`,
      "utf8"
    )
  ).data;

  const text = getFullInfoPostText(
    { accountId: "1718026025", zoneId: "18308", data },
    "https://telegra.ph/test-07-09",
    "uz"
  );

  assert.match(text, /To'liq ma'lumot/);
  assert.match(text, /Lily/);
  assert.match(text, /1718026025/);
  assert.match(text, /tugma orqali ko'rishingiz mumkin/);
  assert.doesNotMatch(text, /https:\/\/telegra\.ph\/test-07-09/);
});

test("full info wait and prompt texts are localized", () => {
  assert.match(getFullInfoWaitText("uz"), /yig'ilmoqda/i);
  assert.match(getFullInfoPromptText("uz"), /To'liq ma'lumot/);
  assert.match(getFullInfoPromptText("uz"), /Account ID/);

  const russian = getFullInfoPromptText("ru");
  assert.match(russian, /Полная информация/);
});

test("full info /full_info flow sends wait message then button-only result", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const originalFetch = global.fetch;
  const originalStats = global.__MLBB_BOT_STATS__;
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    ADMIN_IDS: process.env.ADMIN_IDS,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MAIN_GROUP_ID: process.env.MAIN_GROUP_ID,
  };
  const keyPayload = Buffer.from(
    JSON.stringify({ ref: "trybbxovootehqvaiydn", role: "service_role" })
  ).toString("base64url");
  const telegramCalls = [];
  const sample = JSON.parse(
    require("node:fs").readFileSync(
      `${__dirname}/../full_info_1718026025.json`,
      "utf8"
    )
  );
  const pageUrl = "https://telegra.ph/full-info-test-0710";

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);

    if (urlText.includes("supabase.co")) {
      if (urlText.includes("/rpc/get_full_info_quota")) {
        return new Response(JSON.stringify({ allowed: true, remaining: 5, total_limit: 5 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (urlText.includes("/rpc/consume_full_info_quota")) {
        return new Response(JSON.stringify({ ok: true, remaining: 4 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (urlText.includes("api.telegram.org/bot")) {
      const method = urlText.split("/").pop();
      telegramCalls.push({ method, payload: JSON.parse(options.body) });

      return new Response(JSON.stringify({ ok: true, result: { message_id: 200 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (urlText.includes("fullinfo.example.test")) {
      return new Response(
        JSON.stringify({ success: true, data: sample.data, elapsed: 1.2 }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (urlText.includes("api.telegra.ph")) {
      if (urlText.includes("createAccount")) {
        return new Response(
          JSON.stringify({ ok: true, result: { access_token: "dev-token" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, result: { url: pageUrl } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.ADMIN_IDS = "5081175125";
    process.env.SUPABASE_URL = "https://trybbxovootehqvaiydn.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = `header.${keyPayload}.signature`;
    process.env.MAIN_GROUP_ID = "-100999";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    const freshHandler = require("../api/bot.js");
    const res = createRes();

    await freshHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 41,
          message: {
            chat: { id: 77760, type: "private" },
            from: { id: 77760, first_name: "Test" },
            text: "/full_info 1718026025 18308",
          },
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);

    const waitPayload = telegramCalls.find(
      (call) => call.method === "sendMessage" && /Ma'lumot yig'ilmoqda/.test(call.payload.text)
    );
    const resultPayload = telegramCalls.find(
      (call) =>
        call.method === "sendMessage" &&
        /To'liq ma'lumot/.test(call.payload.text) &&
        call.payload.reply_markup
    );

    assert.ok(waitPayload, "wait message should be sent");
    assert.ok(resultPayload, "result message should be sent");
    assert.equal(resultPayload.payload.link_preview_options, undefined, "preview must be off");
    assert.equal(resultPayload.payload.disable_web_page_preview, true, "preview must be disabled");
    assert.deepEqual(resultPayload.payload.reply_markup, {
      inline_keyboard: [[{ text: "To'liq malumot", url: pageUrl }]],
    });
    assert.match(resultPayload.payload.text, /Lily/);
    assert.match(resultPayload.payload.text, /4 ta/, "remaining quota (5-1=4) must be shown");
    assert.match(
      resultPayload.payload.text,
      /<tg-emoji emoji-id="5895764412525973661">📋<\/tg-emoji>/,
      "result message must contain premium emoji enrichment"
    );
  } finally {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    global.__MLBB_BOT_STATS__ = originalStats;
    delete require.cache[modulePath];
    require("../api/bot.js");
  }
});

test("full info quota: fail-closed when supabase is not configured or rpc fails", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const originalFetch = global.fetch;
  const originalStats = global.__MLBB_BOT_STATS__;
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    ADMIN_IDS: process.env.ADMIN_IDS,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MAIN_GROUP_ID: process.env.MAIN_GROUP_ID,
  };
  const telegramCalls = [];
  let rpcShouldFail = false;

  const buildFetchMock = () =>
    async (url, options = {}) => {
      const urlText = String(url);

      if (urlText.includes("supabase.co")) {
        if (rpcShouldFail) {
          return new Response(JSON.stringify({ message: "database down" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ allowed: true, remaining: 5, total_limit: 5 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (urlText.includes("api.telegram.org/bot")) {
        const method = urlText.split("/").pop();
        telegramCalls.push({ method, payload: JSON.parse(options.body) });

        return new Response(JSON.stringify({ ok: true, result: { message_id: 300 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

  try {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.ADMIN_IDS = "5081175125";
    process.env.MAIN_GROUP_ID = "-100999";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    // 1) Supabase sozlanmagan — admin bo'lmagan user bloklanadi (fail-closed).
    global.fetch = buildFetchMock();
    const freshHandler1 = require("../api/bot.js");
    const res1 = createRes();

    await freshHandler1(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 81,
          message: {
            chat: { id: 88804, type: "private" },
            from: { id: 88804, first_name: "NoSupabase" },
            text: "/fullinfo 1718026025 18308",
          },
        },
      },
      res1
    );

    assert.ok(
      telegramCalls.some(
        (call) =>
          call.method === "sendMessage" && /vaqtincha ishlamayapti/.test(call.payload.text)
      ),
      "service unavailable message should be sent when supabase is not configured"
    );

    // 2) Supabase bor, lekin RPC xato qaytaradi — ham bloklanadi.
    telegramCalls.length = 0;
    process.env.SUPABASE_URL = "https://trybbxovootehqvaiydn.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = `header.${Buffer.from(
      JSON.stringify({ ref: "trybbxovootehqvaiydn", role: "service_role" })
    ).toString("base64url")}.signature`;
    rpcShouldFail = true;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    const freshHandler2 = require("../api/bot.js");
    const res2 = createRes();

    await freshHandler2(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 82,
          message: {
            chat: { id: 88805, type: "private" },
            from: { id: 88805, first_name: "RpcFail" },
            text: "/fullinfo 1718026025 18308",
          },
        },
      },
      res2
    );

    assert.ok(
      telegramCalls.some(
        (call) =>
          call.method === "sendMessage" && /vaqtincha ishlamayapti/.test(call.payload.text)
      ),
      "service unavailable message should be sent when the rpc fails"
    );
  } finally {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    global.__MLBB_BOT_STATS__ = originalStats;
    delete require.cache[modulePath];
    require("../api/bot.js");
  }
});

test("full info post text shows remaining quota when provided", () => {
  const text = getFullInfoPostText(
    { accountId: "1718026025", zoneId: "18308", data: { nickname: "Lily" } },
    "https://telegra.ph/test-07-09",
    "uz",
    { remaining: 12 }
  );

  assert.match(text, /Qolgan to'liq ma'lumot paketi/);
  assert.match(text, /12 ta/);

  const textWithoutQuota = getFullInfoPostText(
    { accountId: "1718026025", zoneId: "18308", data: { nickname: "Lily" } },
    "https://telegra.ph/test-07-09",
    "uz"
  );
  assert.doesNotMatch(textWithoutQuota, /paket/);
});

test("full info quota: blocks non-admin with no quota, allows admin without quota", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const originalFetch = global.fetch;
  const originalStats = global.__MLBB_BOT_STATS__;
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    ADMIN_IDS: process.env.ADMIN_IDS,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MAIN_GROUP_ID: process.env.MAIN_GROUP_ID,
  };
  const payload = Buffer.from(
    JSON.stringify({ ref: "trybbxovootehqvaiydn", role: "service_role" })
  ).toString("base64url");
  const rpcCalls = [];
  const telegramCalls = [];
  const sample = {
    success: true,
    data: { player_id: 1718026025, server_id: 18308, nickname: "Lily", level: 66 },
  };

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);

    if (urlText.includes("supabase.co")) {
      rpcCalls.push({ url: urlText, body: JSON.parse(options.body || "{}") });

      if (urlText.includes("/rpc/get_full_info_quota")) {
        return new Response(JSON.stringify({ allowed: false, remaining: 0, total_limit: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (urlText.includes("api.telegram.org/bot")) {
      const method = urlText.split("/").pop();
      telegramCalls.push({ method, payload: JSON.parse(options.body) });

      return new Response(JSON.stringify({ ok: true, result: { message_id: 300 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (urlText.includes("fullinfo.example.test")) {
      return new Response(JSON.stringify(sample), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.ADMIN_IDS = "5081175125";
    process.env.SUPABASE_URL = "https://trybbxovootehqvaiydn.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = `header.${payload}.signature`;
    process.env.MAIN_GROUP_ID = "-100999";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    const freshHandler = require("../api/bot.js");

    // 1) Admin bo'lmagan user, limit 0 — bloklanadi, provider chaqirilmaydi.
    const res1 = createRes();
    await freshHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 51,
          message: {
            chat: { id: 88801, type: "private" },
            from: { id: 88801, first_name: "NoQuota" },
            text: "/fullinfo 1718026025 18308",
          },
        },
      },
      res1
    );

    const limitMessage = telegramCalls.find(
      (call) => call.method === "sendMessage" && /Limitga yetdingiz/.test(call.payload.text)
    );
    assert.ok(limitMessage, "limit reached message should be sent");
    assert.equal(
      rpcCalls.filter((call) => call.url.includes("/tools/check")).length,
      0,
      "provider must not be called when quota is exhausted"
    );

    // 2) Admin — limit tekshiruvi umuman chaqirilmaydi.
    rpcCalls.length = 0;
    telegramCalls.length = 0;

    const res2 = createRes();
    await freshHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 52,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125, first_name: "Admin" },
            text: "/fullinfo 1718026025 18308",
          },
        },
      },
      res2
    );

    assert.equal(
      rpcCalls.filter((call) => call.url.includes("/rpc/get_full_info_quota")).length,
      0,
      "admin must not be quota-checked"
    );
  } finally {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    global.__MLBB_BOT_STATS__ = originalStats;
    delete require.cache[modulePath];
    require("../api/bot.js");
  }
});

test("full info quota: consumes one unit after success, nothing on failure", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const originalFetch = global.fetch;
  const originalStats = global.__MLBB_BOT_STATS__;
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    ADMIN_IDS: process.env.ADMIN_IDS,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MAIN_GROUP_ID: process.env.MAIN_GROUP_ID,
  };
  const payload = Buffer.from(
    JSON.stringify({ ref: "trybbxovootehqvaiydn", role: "service_role" })
  ).toString("base64url");
  const rpcCalls = [];
  const telegramCalls = [];
  let providerShouldFail = false;

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);

    if (urlText.includes("supabase.co")) {
      rpcCalls.push({ url: urlText, body: JSON.parse(options.body || "{}") });

      if (urlText.includes("/rpc/get_full_info_quota")) {
        return new Response(JSON.stringify({ allowed: true, remaining: 5, total_limit: 5 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (urlText.includes("/rpc/consume_full_info_quota")) {
        return new Response(JSON.stringify({ ok: true, remaining: 4 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (urlText.includes("api.telegram.org/bot")) {
      const method = urlText.split("/").pop();
      telegramCalls.push({ method, payload: JSON.parse(options.body) });

      return new Response(JSON.stringify({ ok: true, result: { message_id: 300 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (urlText.includes("fullinfo.example.test")) {
      if (providerShouldFail) {
        return new Response(
          JSON.stringify({ success: false, error: "player not found" }),
          { status: 404, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: { player_id: 1718026025, server_id: 18308, nickname: "Lily", level: 66 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (urlText.includes("api.telegra.ph")) {
      if (urlText.includes("createAccount")) {
        return new Response(
          JSON.stringify({ ok: true, result: { access_token: "dev-token" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, result: { url: "https://telegra.ph/quota-test-0710" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.ADMIN_IDS = "5081175125";
    process.env.SUPABASE_URL = "https://trybbxovootehqvaiydn.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = `header.${payload}.signature`;
    process.env.MAIN_GROUP_ID = "-100999";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    const freshHandler = require("../api/bot.js");

    // Muvaffaqiyatli tekshiruv: 1 birlik yeiladi, qoldiq ko'rsatiladi.
    const res1 = createRes();
    await freshHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 61,
          message: {
            chat: { id: 88802, type: "private" },
            from: { id: 88802, first_name: "Quota" },
            text: "/fullinfo 1718026025 18308",
          },
        },
      },
      res1
    );

    const consumeCall = rpcCalls.find((call) =>
      call.url.includes("/rpc/consume_full_info_quota")
    );
    assert.ok(consumeCall, "consume rpc must be called after success");
    assert.equal(consumeCall.body.p_action, "consume");
    assert.equal(consumeCall.body.p_amount, 1);

    const resultMessage = telegramCalls.find(
      (call) =>
        call.method === "sendMessage" &&
        /Qolgan to'liq ma'lumot paketi/.test(call.payload.text)
    );
    assert.ok(resultMessage, "remaining quota must be shown");
    assert.match(resultMessage.payload.text, /4 ta/);

    // Xatolikli tekshiruv: consume umuman chaqirilmaydi.
    providerShouldFail = true;
    rpcCalls.length = 0;
    telegramCalls.length = 0;

    const res2 = createRes();
    await freshHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 62,
          message: {
            chat: { id: 88802, type: "private" },
            from: { id: 88802, first_name: "Quota" },
            text: "/fullinfo 1718026025 18308",
          },
        },
      },
      res2
    );

    assert.equal(
      rpcCalls.filter((call) => call.url.includes("/rpc/consume_full_info_quota")).length,
      0,
      "consume must not be called when lookup fails"
    );
    const failedMessage = telegramCalls.find(
      (call) => call.method === "sendMessage" && /Akkaunt topilmadi/.test(call.payload.text)
    );
    assert.ok(failedMessage, "not found failure message should be sent");
  } finally {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    global.__MLBB_BOT_STATS__ = originalStats;
    delete require.cache[modulePath];
    require("../api/bot.js");
  }
});

test("/limit_fullinfo grants quota additively for admins, hidden for non-admins", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const originalFetch = global.fetch;
  const originalStats = global.__MLBB_BOT_STATS__;
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    ADMIN_IDS: process.env.ADMIN_IDS,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MAIN_GROUP_ID: process.env.MAIN_GROUP_ID,
  };
  const payload = Buffer.from(
    JSON.stringify({ ref: "trybbxovootehqvaiydn", role: "service_role" })
  ).toString("base64url");
  const rpcCalls = [];
  const telegramCalls = [];
  let remainingAfterGrant = 13;

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);

    if (urlText.includes("supabase.co")) {
      rpcCalls.push({ url: urlText, body: JSON.parse(options.body || "{}") });

      if (urlText.includes("/rpc/add_full_info_quota")) {
        return new Response(
          JSON.stringify({ ok: true, user_id: "123", granted: 10, remaining: remainingAfterGrant }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (urlText.includes("api.telegram.org/bot")) {
      const method = urlText.split("/").pop();
      telegramCalls.push({ method, payload: JSON.parse(options.body) });

      return new Response(JSON.stringify({ ok: true, result: { message_id: 300 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.ADMIN_IDS = "5081175125";
    process.env.SUPABASE_URL = "https://trybbxovootehqvaiydn.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = `header.${payload}.signature`;
    process.env.MAIN_GROUP_ID = "-100999";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[modulePath];

    const freshHandler = require("../api/bot.js");

    // Admin: +10 limit beriladi, qoldiq 13.
    const res1 = createRes();
    await freshHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 71,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125, first_name: "Admin" },
            text: "/limit_fullinfo 123 10",
          },
        },
      },
      res1
    );

    const grantCall = rpcCalls.find((call) => call.url.includes("/rpc/add_full_info_quota"));
    assert.ok(grantCall, "add_full_info_quota rpc must be called");
    assert.equal(grantCall.body.p_user_id, "123");
    assert.equal(grantCall.body.p_amount, 10);

    const grantMessage = telegramCalls.find(
      (call) => call.method === "sendMessage" && /Limit qo'shildi/.test(call.payload.text)
    );
    assert.ok(grantMessage, "grant confirmation should be sent");
    assert.match(grantMessage.payload.text, /\+10/);
    assert.match(grantMessage.payload.text, /13/);

    // Limit olgan userga tabrik xabari borishi kerak (count=10, remaining=13).
    const grantedUserMessage = telegramCalls.find(
      (call) =>
        call.method === "sendMessage" &&
        String(call.payload.chat_id) === "123" &&
        /Tabriklayman/.test(call.payload.text)
    );
    assert.ok(grantedUserMessage, "target user should receive the congratulation message");
    assert.match(grantedUserMessage.payload.text, /<b>10 ta<\/b>/, "granted count must be shown");
    assert.match(grantedUserMessage.payload.text, /<b>13 ta<\/b>/, "total remaining must be shown");
    assert.match(grantedUserMessage.payload.text, /raxmat/, "thanks reminder must be included");
    assert.match(
      grantedUserMessage.payload.text,
      /<tg-emoji emoji-id="5316977222467206948">🙏<\/tg-emoji>/,
      "congratulation message must have premium emoji enrichment"
    );

    // Admin: format xato — grant RPC chaqirilmaydi.
    rpcCalls.length = 0;
    const res2 = createRes();
    await freshHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 72,
          message: {
            chat: { id: 5081175125, type: "private" },
            from: { id: 5081175125, first_name: "Admin" },
            text: "/limit_fullinfo abc",
          },
        },
      },
      res2
    );
    assert.equal(
      rpcCalls.filter((call) => call.url.includes("/rpc/add_full_info_quota")).length,
      0,
      "invalid input must not hit the grant rpc"
    );

    // Admin bo'lmagan: unknown javob, grant RPC chaqirilmaydi.
    telegramCalls.length = 0;
    const res3 = createRes();
    await freshHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 73,
          message: {
            chat: { id: 88803, type: "private" },
            from: { id: 88803, first_name: "Random" },
            text: "/limit_fullinfo 123 10",
          },
        },
      },
      res3
    );
    assert.equal(
      rpcCalls.filter((call) => call.url.includes("/rpc/add_full_info_quota")).length,
      0,
      "non-admin must not hit the grant rpc"
    );
    assert.ok(
      telegramCalls.some(
        (call) => call.method === "sendMessage" && /tushunmadim/.test(call.payload.text)
      ),
      "non-admin should get the unknown command reply"
    );
  } finally {
    global.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    global.__MLBB_BOT_STATS__ = originalStats;
    delete require.cache[modulePath];
    require("../api/bot.js");
  }
});

test("membership check: telegram errors throw, real non-member answers false", async () => {
  const { checkUserMembership } = handler.__private;
  const originalFetch = global.fetch;

  try {
    // 1) "user not found" — Telegram aniq "azo emas" dedi.
    global.fetch = async (url) => {
      const method = String(url).split("/").pop();

      if (method === "getChatMember") {
        return new Response(
          JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: user not found" }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    assert.equal(await checkUserMembership(-100123, 555), false);

    // 2) Boshqa xato (kanal topilmadi, timeout va h.k.) — throw qiladi;
    // "azo emas" deb qabul qilinmaydi va keshga tushmaydi.
    global.fetch = async (url) => {
      const method = String(url).split("/").pop();

      if (method === "getChatMember") {
        return new Response(
          JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await assert.rejects(() => checkUserMembership(-100123, 555));

    // 3) A'zo user — true.
    global.fetch = async (url) => {
      const method = String(url).split("/").pop();

      if (method === "getChatMember") {
        return new Response(
          JSON.stringify({ ok: true, result: { status: "member", user: { id: 555 } } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    assert.equal(await checkUserMembership(-100123, 555), true);

    // 4) restricted + is_member: false (kicklangan user) — false.
    global.fetch = async (url) => {
      const method = String(url).split("/").pop();

      if (method === "getChatMember") {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { status: "restricted", is_member: false, user: { id: 555 } },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    assert.equal(await checkUserMembership(-100123, 555), false);
  } finally {
    global.fetch = originalFetch;
  }
});
