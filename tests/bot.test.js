const assert = require("node:assert/strict");
const test = require("node:test");

process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.SUPPORT_USERNAME = "@Oblto_org";
process.env.ADMIN_IDS = "5081175125,8500085987";

const handler = require("../api/bot.js");
const {
  extractTelegramId,
  getCommandsText,
  getFailedLookupText,
  getResultText,
  getStatsText,
  getTelegramProfileText,
  isAdmin,
  isValidWebhookSecret,
  isKeyboardButton,
  isValidTelegramId,
  mainKeyboard,
  parseIdList,
  parseAdvancedRanges,
  parseMlbbInput,
  parseRequestBody,
  sanitizeTelegramUsername,
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

test("main keyboard has no placeholder and hides admin buttons from users", () => {
  const userKeyboard = mainKeyboard({ id: 777 });
  const adminKeyboard = mainKeyboard({ id: 5081175125 });
  const userKeyboardText = JSON.stringify(userKeyboard);

  assert.equal(userKeyboard.input_field_placeholder, undefined);
  assert.doesNotMatch(userKeyboardText, /📊|📣|Statistika|Xabar yuborish/);
  assert.match(JSON.stringify(adminKeyboard), /📊 Statistika/);
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
    assert.match(getStatsText(), /mlbb_lookup_failed/);
    assert.match(getStatsText(), /status=500/);
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
