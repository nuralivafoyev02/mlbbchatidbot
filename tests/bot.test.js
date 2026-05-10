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
  getResultText,
  getTelegramProfileText,
  isAdmin,
  isValidWebhookSecret,
  isKeyboardButton,
  isValidTelegramId,
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
    assert.match(calls[0].payload.text, /faqat adminlar/);
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
    assert.match(
      calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data,
      /^broadcast_confirm:/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
