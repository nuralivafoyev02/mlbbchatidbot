const assert = require("node:assert/strict");
const test = require("node:test");

const tgButtons = require("../api/_tg-buttons.js");
const launch = require("../api/_cabinet-launch.js");

const BOT_TOKEN = "123456:test-token";
const CABINET = "https://mini.example.test/api/account?view=cabinet";

test("buttons: leading emoji becomes a premium icon; ✅/❌/💰 pick a colour unless one is set", () => {
  const markup = tgButtons.decorateReplyMarkup({
    inline_keyboard: [
      [{ text: "✅ Tasdiqlash", callback_data: "a" }, { text: "❌ Bekor qilish", callback_data: "b" }],
      [{ text: "💰 Balansni to'ldirish", url: "https://t.me/x" }, { text: "⬅️ Orqaga", callback_data: "c", style: "primary" }],
      [{ text: "🇺🇿 O'zbek", callback_data: "d" }, { text: "Keyingi ➡️", callback_data: "e", style: "bogus" }],
    ],
  });
  const [a, b, c, d, e, f] = markup.inline_keyboard.flat();

  assert.equal(a.text, "Tasdiqlash");
  assert.equal(a.style, "success");
  assert.match(a.icon_custom_emoji_id, /^\d+$/);
  assert.equal(b.style, "danger");
  assert.equal(c.text, "Balansni to'ldirish");
  assert.equal(c.style, "success");
  assert.equal(d.text, "Orqaga");
  assert.equal(d.style, "primary", "explicit style wins");
  assert.equal(e.text, "🇺🇿 O'zbek", "no icon for unmapped emoji");
  assert.equal(e.icon_custom_emoji_id, undefined);
  assert.equal(f.style, undefined, "unknown styles are dropped");

  const plain = tgButtons.plainReplyMarkup({ keyboard: [[{ text: "🔎 Server aniqlash", style: "primary", icon_custom_emoji_id: "1" }]] });
  assert.deepEqual(plain.keyboard[0][0], { text: "🔎 Server aniqlash" });
  assert.deepEqual(tgButtons.buttonLabelVariants("🔎 Server aniqlash"), ["🔎 Server aniqlash", "Server aniqlash"]);
});

test("cabinet launch: token is signed per user and only added for a private chat", () => {
  const token = launch.createCabinetLaunchToken(5081175125, BOT_TOKEN);
  assert.deepEqual(launch.verifyCabinetLaunchToken(token, BOT_TOKEN).userId, "5081175125");
  assert.equal(launch.verifyCabinetLaunchToken(token, "1:other").ok, false);
  assert.equal(launch.verifyCabinetLaunchToken(`${token}0`, BOT_TOKEN).ok, false);

  const markup = { keyboard: [[{ text: "💼 Shaxsiy kabinet", web_app: { url: CABINET } }], [{ text: "Til" }]], resize_keyboard: true };
  const own = launch.withCabinetLaunchTokens(markup, 7700, { botToken: BOT_TOKEN, cabinetUrl: CABINET });
  const url = new URL(own.keyboard[0][0].web_app.url);
  assert.equal(url.searchParams.get("view"), "cabinet");
  assert.equal(launch.verifyCabinetLaunchToken(url.searchParams.get("lt"), BOT_TOKEN).userId, "7700");
  assert.equal(markup.keyboard[0][0].web_app.url, CABINET, "input markup is not mutated");

  assert.equal(launch.withCabinetLaunchTokens(markup, -100123, { botToken: BOT_TOKEN, cabinetUrl: CABINET }), markup, "groups get no token");
  const inline = { inline_keyboard: [[{ text: "x", web_app: { url: CABINET } }]] };
  assert.equal(launch.withCabinetLaunchTokens(inline, 7700, { botToken: BOT_TOKEN, cabinetUrl: CABINET }), inline);
});

function loadBot() {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.ACCOUNT_MINIAPP_URL = "https://mini.example.test/api/account";
  delete process.env.SUPABASE_URL;
  delete process.env.MAIN_GROUP_ID;
  delete global.__MLBB_BOT_STATS__;
  delete require.cache[require.resolve("../api/bot.js")];
  return require("../api/bot.js");
}

function createRes() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; }, send() { return this; }, setHeader() { return this; } };
}

test("bot: icon buttons send text without the emoji and still work; a rejected decoration falls back to plain buttons", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let rejectDecorated = false;

  global.fetch = async (url, options = {}) => {
    const payload = JSON.parse(options.body || "{}");
    calls.push({ method: String(url).split("/").pop(), payload });
    const decorated = JSON.stringify(payload.reply_markup || {}).includes("icon_custom_emoji_id");
    if (rejectDecorated && decorated) {
      return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: invalid button icon custom emoji" }), { status: 400 });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  };

  const send = (bot, updateId, text) => bot({
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "test-secret" },
    query: {},
    body: { update_id: updateId, message: { message_id: updateId, chat: { id: 7701, type: "private" }, from: { id: 7701, first_name: "Ali" }, text } },
  }, createRes());

  try {
    const bot = loadBot();

    // "🌐 Til" ikonkali tugma — bosilganda botga "Til" keladi.
    await send(bot, 1, "Til");
    const picker = calls.find((c) => c.method === "sendMessage" && /Tilni tanlang/i.test(c.payload.text || ""));
    assert.ok(picker, "language picker should open from the icon button text");

    // Asosiy klaviatura: ikonka + rang, kabinet tugmasida shu chat egasining kaliti.
    await send(bot, 2, "/start");
    const start = [...calls].reverse().find((c) => c.method === "sendMessage" && c.payload.reply_markup?.keyboard);
    const buttons = start.payload.reply_markup.keyboard.flat();
    assert.equal(buttons[0].text, "Server aniqlash");
    assert.equal(buttons[0].style, "primary");
    const cabinet = buttons.find((b) => b.web_app);
    const lt = new URL(cabinet.web_app.url).searchParams.get("lt");
    assert.equal(launch.verifyCabinetLaunchToken(lt, BOT_TOKEN).userId, "7701");

    // Telegram bezakni rad etsa — o'sha xabar oddiy tugmalar bilan qayta yuboriladi.
    rejectDecorated = true;
    calls.length = 0;
    await send(bot, 3, "/start");
    const sent = calls.filter((c) => c.method === "sendMessage" && c.payload.reply_markup?.keyboard);
    assert.equal(sent.length, 2, "decorated attempt + plain retry");
    assert.equal(sent[1].payload.reply_markup.keyboard[0][0].text, "🔎 Server aniqlash");
    assert.ok(!JSON.stringify(sent[1].payload.reply_markup).includes("icon_custom_emoji_id"));
    assert.match(sent[1].payload.reply_markup.keyboard.flat().find((b) => b.web_app).web_app.url, /lt=7701\./);

    // Keyingi xabarlar darhol oddiy ko'rinishda (qayta urinishsiz).
    calls.length = 0;
    await send(bot, 4, "/start");
    assert.equal(calls.filter((c) => c.method === "sendMessage" && c.payload.reply_markup?.keyboard).length, 1);
  } finally {
    global.fetch = originalFetch;
    delete process.env.ACCOUNT_MINIAPP_URL;
    delete global.__MLBB_BOT_STATS__;
    delete require.cache[require.resolve("../api/bot.js")];
  }
});
