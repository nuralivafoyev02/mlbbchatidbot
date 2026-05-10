const assert = require("node:assert/strict");
const test = require("node:test");

process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.SUPPORT_USERNAME = "@Oblto_org";

const handler = require("../api/bot.js");
const {
  isValidWebhookSecret,
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
