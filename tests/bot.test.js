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
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const handler = require("../api/bot.js");
const {
  buildRuntimeDailyReport,
  enrichPremiumEmojis,
  extractTelegramId,
  extractTelegramUsername,
  extractTelegramPhoneNumber,
  formatPhoneNumber,
  getAdminFeedbackText,
  getBindInfoResultText,
  getBindInfoWaitText,
  getCommandsText,
  getCustomEmojiIdText,
  getDailyReportText,
  getErrorsText,
  getFailedLookupText,
  getResultText,
  getStatsText,
  getUsersListText,
  getTelegramProfileText,
  getTelegramProfileByUsernameFailedText,
  isAdmin,
  isValidWebhookSecret,
  isKeyboardButton,
  isValidTelegramId,
  lookupMlbbBindInfo,
  maskPhoneNumber,
  normalizePhoneNumber,
  mainKeyboard,
  normalizeSecretEnv,
  normalizeBindInfoResponse,
  parseBengkelBindInfoText,
  parseContentRangeTotal,
  parseIdList,
  parseAdvancedRanges,
  parseMlbbInput,
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

test("telegram profile helpers parse ids and format profile text", () => {
  assert.equal(extractTelegramId("/tg 5081175125"), "5081175125");
  assert.equal(isValidTelegramId("5081175125"), true);
  assert.equal(isValidTelegramId("abc"), false);
  assert.equal(extractTelegramPhoneNumber("/tg 5081175125"), "");
  assert.equal(extractTelegramPhoneNumber("/tg +998 90 123 45 67"), "998901234567");
  assert.equal(normalizePhoneNumber("tel:+998 (90) 123-45-67"), "998901234567");
  assert.equal(formatPhoneNumber("998901234567"), "+998901234567");
  assert.equal(maskPhoneNumber("+998901234567"), "+99890*****67");
  
  // Username extraction tests
  assert.equal(extractTelegramUsername("/tg @ali_test"), "ali_test");
  assert.equal(extractTelegramUsername("/tg @username123"), "username123");
  assert.equal(extractTelegramUsername("/tg user_test"), "user_test");
  assert.equal(extractTelegramUsername("/tg start"), "");
  assert.equal(extractTelegramUsername("/tg help"), "");
  assert.equal(extractTelegramUsername("/tg @ab"), "");
  assert.equal(extractTelegramUsername("/tg 12345"), "");
  
  // Username failed text test
  const failedText = getTelegramProfileByUsernameFailedText("testuser");
  assert.match(failedText, /@testuser/);
  assert.match(failedText, /topilmadi/);

  const text = getTelegramProfileText({
    id: 5081175125,
    type: "private",
    first_name: "Ali",
    username: "ali_test",
    phone_number: "+998901234567",
  });

  assert.match(text, /5081175125/);
  assert.match(text, /@ali_test/);
  assert.match(text, /\+99890\*+67/);
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

test("TG profile button keeps profile lookup mode until server button is pressed", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    calls.push({ url: urlText, payload: JSON.parse(options.body) });

    if (urlText.endsWith("/getChat")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 5081175125,
            type: "private",
            first_name: "Ali",
            username: "ali_test",
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
    const chat = { id: 70025, type: "private" };
    const from = { id: 70025, first_name: "Ali" };

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 25,
          message: { chat, from, text: "👤 TG profil topish" },
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
          update_id: 26,
          message: { chat, from, text: "5081175125" },
        },
      },
      createRes()
    );

    assert.ok(calls.some((call) => call.url.endsWith("/getChat")));
    assert.match(calls.at(-1).payload.text, /@ali_test/);

    calls.length = 0;

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 27,
          message: { chat, from, text: "🔎 Server aniqlash" },
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
          update_id: 28,
          message: { chat, from, text: "5081175125" },
        },
      },
      createRes()
    );

    assert.equal(calls.some((call) => call.url.endsWith("/getChat")), false);
    assert.match(calls.at(-1).payload.text, /Server topilmadi/);
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

test("group /tg command works without mentioning the bot", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);

    if (!urlText.startsWith("https://api.telegram.org")) {
      throw new Error(`unexpected non-Telegram request: ${urlText}`);
    }

    calls.push({ url: urlText, payload: JSON.parse(options.body) });

    if (urlText.endsWith("/getChat")) {
      assert.equal(calls.at(-1).payload.chat_id, "5081175125");

      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 5081175125,
            type: "private",
            first_name: "Ali",
            username: "ali_test",
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
          update_id: 23,
          message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: 777, first_name: "Ali" },
            text: "/tg 5081175125",
            entities: [{ type: "bot_command", offset: 0, length: 3 }],
          },
        },
      },
      res
    );

    const finalMessage = calls.at(-1).payload;

    assert.equal(res.statusCode, 200);
    assert.ok(calls.some((call) => call.url.endsWith("/getChat")));
    assert.match(finalMessage.text, /Telegram profil/);
    assert.match(finalMessage.text, /@ali_test/);
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

test("/tg looks up a Telegram profile with getChat", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });

    if (url.endsWith("/getChat")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 5081175125,
            type: "private",
            first_name: "Ali",
            username: "ali_test",
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
          update_id: 5,
          message: {
            chat: { id: 777, type: "private" },
            from: { id: 777 },
            text: "/tg 5081175125",
          },
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.ok(calls.some((call) => call.url.endsWith("/getChat")));
    assert.match(calls.at(-1).payload.text, /@ali_test/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("contact with Telegram user_id saves phone mapping and returns profile", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    const urlText = String(url);
    calls.push({ url: urlText, payload: JSON.parse(options.body) });

    if (urlText.endsWith("/getChat")) {
      assert.equal(calls.at(-1).payload.chat_id, "5081175125");

      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 5081175125,
            type: "private",
            first_name: "Ali",
            username: "ali_test",
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
    const chat = { id: 70050, type: "private" };
    const from = { id: 70050, first_name: "Vali" };

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 5001,
          message: {
            chat,
            from,
            contact: {
              phone_number: "+998 90 123 45 67",
              first_name: "Ali",
              user_id: 5081175125,
            },
          },
        },
      },
      createRes()
    );

    assert.ok(calls.some((call) => call.url.endsWith("/getChat")));
    assert.match(calls.at(-1).payload.text, /@ali_test/);
    assert.match(calls.at(-1).payload.text, /\+99890\*+67/);

    calls.length = 0;

    await handler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 5002,
          message: {
            chat,
            from,
            text: "/tg +998901234567",
          },
        },
      },
      createRes()
    );

    assert.ok(calls.some((call) => call.url.endsWith("/getChat")));
    assert.match(calls.at(-1).payload.text, /Telegram profil/);
    assert.match(calls.at(-1).payload.text, /@ali_test/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("contact without Telegram user_id returns a phone profile open link", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url: String(url), payload: JSON.parse(options.body) });
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
          update_id: 5003,
          message: {
            chat: { id: 70051, type: "private" },
            from: { id: 70051, first_name: "Vali" },
            contact: {
              phone_number: "+998 93 123 45 67",
              first_name: "NoId",
            },
          },
        },
      },
      createRes()
    );

    assert.equal(calls.some((call) => call.url.endsWith("/getChat")), false);
    assert.match(calls.at(-1).payload.text, /Telegram profil/);
    assert.match(calls.at(-1).payload.text, /\+99893\*+67/);
    assert.match(calls.at(-1).payload.text, /tg:\/\/resolve\?phone=998931234567/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("/tg phone without saved mapping returns a phone profile open link", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url: String(url), payload: JSON.parse(options.body) });
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
          update_id: 5005,
          message: {
            chat: { id: 70053, type: "private" },
            from: { id: 70053, first_name: "Vali" },
            text: "/tg +998908065775",
          },
        },
      },
      createRes()
    );

    assert.equal(calls.some((call) => call.url.endsWith("/getChat")), false);
    assert.match(calls.at(-1).payload.text, /Telegram profil/);
    assert.match(calls.at(-1).payload.text, /\+99890\*+75/);
    assert.match(calls.at(-1).payload.text, /tg:\/\/resolve\?phone=998908065775/);
    assert.doesNotMatch(calls.at(-1).payload.text, /topilmadi|avval shu kontakt/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("/tg phone can resolve a profile from Supabase phone mapping", async () => {
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
  };
  const payload = Buffer.from(
    JSON.stringify({ ref: "trybbxovootehqvaiydn", role: "service_role" })
  ).toString("base64url");
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlText = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlText, payload: body });

    if (urlText.endsWith("/rpc/find_bot_user_by_phone")) {
      assert.equal(body.p_phone_number, "998991112233");

      return new Response(
        JSON.stringify([
          {
            user_id: "5081175125",
            chat_id: "5081175125",
            chat_type: "private",
            username: "cached_ali",
            first_name: "Ali",
            last_name: "Cached",
            phone_number: "998991112233",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    if (urlText.endsWith("/rpc/track_bot_user")) {
      return new Response(null, {
        status: 204,
        headers: { "content-type": "application/json" },
      });
    }

    if (urlText.endsWith("/getChat")) {
      assert.equal(body.chat_id, "5081175125");

      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 5081175125,
            type: "private",
            first_name: "Ali",
            username: "ali_live",
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
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.ADMIN_IDS = "5081175125";
    process.env.SUPABASE_URL = "https://trybbxovootehqvaiydn.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = `header.${payload}.signature`;
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
          update_id: 5004,
          message: {
            chat: { id: 70052, type: "private" },
            from: { id: 70052, first_name: "Vali" },
            text: "/tg +998991112233",
          },
        },
      },
      createRes()
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(calls.some((call) => call.url.endsWith("/rpc/find_bot_user_by_phone")));
    assert.ok(calls.some((call) => call.url.endsWith("/getChat")));
    const sent = calls.find((call) => /@ali_live/.test(call.payload?.text || ""));

    assert.ok(sent);
    assert.match(sent.payload.text, /\+99899\*+33/);
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

test("bare Telegram ID falls back to profile lookup without relying on memory", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });

    if (url.endsWith("/getChat")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 5081175125,
            type: "private",
            first_name: "Ali",
            username: "ali_test",
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
          update_id: 29,
          message: {
            chat: { id: 70029, type: "private" },
            from: { id: 70029 },
            text: "5081175125",
          },
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.ok(calls.some((call) => call.url.endsWith("/getChat")));
    assert.match(calls.at(-1).payload.text, /@ali_test/);
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
