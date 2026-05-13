const assert = require("node:assert/strict");
const test = require("node:test");

process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.SUPPORT_USERNAME = "@Oblto_org";
process.env.ADMIN_IDS = "5081175125,8500085987";
process.env.TELEGRAM_BOT_USERNAME = "mlbb_test_bot";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const handler = require("../api/bot.js");
const {
  extractTelegramId,
  getAdminFeedbackText,
  getCommandsText,
  getErrorsText,
  getFailedLookupText,
  getResultText,
  getStatsText,
  getUsersListText,
  getTelegramProfileText,
  isAdmin,
  isValidWebhookSecret,
  isKeyboardButton,
  isValidTelegramId,
  mainKeyboard,
  normalizeSecretEnv,
  parseContentRangeTotal,
  parseIdList,
  parseAdvancedRanges,
  parseMlbbInput,
  parseRequestBody,
  resolveSupabaseConfig,
  sanitizeTelegramUsername,
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

  const text = getTelegramProfileText({
    id: 5081175125,
    type: "private",
    first_name: "Ali",
    username: "ali_test",
  });

  assert.match(text, /5081175125/);
  assert.match(text, /@ali_test/);
});

test("commands text includes admin commands only for admins", () => {
  assert.match(getCommandsText({ id: 5081175125 }), /\/message/);
  assert.doesNotMatch(getCommandsText({ id: 777 }), /\/message/);
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

test("main keyboard has no placeholder and hides admin buttons from users", () => {
  const userKeyboard = mainKeyboard({ id: 777 });
  const adminKeyboard = mainKeyboard({ id: 5081175125 });
  const userKeyboardText = JSON.stringify(userKeyboard);

  assert.equal(userKeyboard.input_field_placeholder, undefined);
  assert.doesNotMatch(userKeyboardText, /📊|📣|👥|⚠️|Statistika|Xabar yuborish|Foydalanuvchilar|Xatoliklar/);
  assert.match(userKeyboardText, /💬 Fikr va izohlar/);
  assert.match(JSON.stringify(adminKeyboard), /📊 Statistika/);
  assert.match(JSON.stringify(adminKeyboard), /👥 Foydalanuvchilar/);
  assert.match(JSON.stringify(adminKeyboard), /⚠️ Xatoliklar/);
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

test("feedback button sends user comments to all admins", async () => {
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
            text: "💬 Fikr va izohlar",
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

    const adminMessages = calls.filter((call) =>
      ["5081175125", "8500085987"].includes(String(call.payload.chat_id))
    );
    const userAck = calls.find((call) => call.payload.chat_id === 777);

    assert.equal(adminMessages.length, 2);
    assert.ok(userAck);
    assert.match(adminMessages[0].payload.text, /Feedback ID/);
    assert.match(adminMessages[0].payload.text, /User ID: <code>777<\/code>/);
    assert.match(adminMessages[0].payload.text, /Botga reyting funksiyasi kerak/);
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
            from: { id: 5081175125, first_name: "Admin" },
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
    assert.match(userReply.payload.text, /Admin javobi/);
    assert.match(userReply.payload.text, /Taklif qabul qilindi/);
    assert.ok(adminAck);
    assert.match(adminAck.payload.text, /Javob userga yuborildi/);
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
