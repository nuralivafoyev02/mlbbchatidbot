// Foydalanuvchi natijasi har doim birinchi; asosiy guruhga "#foydalanish"
// xabari undan keyin va (Worker'da) orqa fonda — webhook javobini ushlamaydi.
const assert = require("node:assert/strict");
const test = require("node:test");

const GROUP = "-1004434649076";

function loadBot() {
  process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.ADMIN_IDS = "1";
  process.env.MAIN_GROUP_ID = GROUP;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete require.cache[require.resolve("../api/bot.js")];
  return require("../api/bot.js");
}

function mockFetch() {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("api.telegram.org")) {
      const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ method: u.split("/").pop(), chatId: String(body.chat_id ?? ""), text: String(body.text || "") });
      return Response.json({ ok: true, result: { message_id: calls.length } });
    }
    return Response.json({ success: true, name: "Wader", country: "Uzbekistan" });
  };
  return calls;
}

const res = () => ({ status() { return this; }, setHeader() { return this; }, json() { return this; }, send() { return this; }, end() { return this; } });
const req = (body) => ({ method: "POST", headers: { "x-telegram-bot-api-secret-token": "test-secret" }, query: {}, body });

test("ID check: user gets the result before the group notice, which runs in waitUntil", async () => {
  const originalFetch = global.fetch;
  const bot = loadBot();
  const calls = mockFetch();
  const background = [];

  try {
    await bot(
      req({ update_id: 1, message: { message_id: 5, chat: { id: 777, type: "private" }, from: { id: 777, first_name: "Ali", username: "ali" }, text: "1290132154 (15246)" } }),
      res(),
      {},
      { waitUntil: (p) => background.push(p) }
    );

    const sends = () => calls.filter((c) => c.method === "sendMessage");
    assert.equal(sends()[0].chatId, "777");
    assert.match(sends()[0].text, /Wader/);
    assert.equal(background.length > 0, true, "group notice must be handed to waitUntil");

    await Promise.all(background);
    const order = sends().map((c) => c.chatId);
    assert.ok(order.indexOf("777") < order.indexOf(GROUP), `order was ${order.join(" → ")}`);
  } finally {
    global.fetch = originalFetch;
  }
});

test("inline check in another chat: private copy before the group notice", async () => {
  const originalFetch = global.fetch;
  const bot = loadBot();
  const calls = mockFetch();
  const background = [];

  try {
    await bot(
      req({ update_id: 2, inline_query: { id: "iq-1", from: { id: 888, first_name: "Vali" }, query: "1290132154 (15246)", chat_type: "supergroup" } }),
      res(),
      {},
      { waitUntil: (p) => background.push(p) }
    );
    await Promise.all(background);

    const order = calls.map((c) => (c.method === "sendMessage" ? c.chatId : c.method));
    const answered = order.indexOf("answerInlineQuery");
    const privateCopy = order.indexOf("888");
    const group = order.indexOf(GROUP);
    assert.ok(answered >= 0 && privateCopy > answered && group > privateCopy, `order was ${order.join(" → ")}`);
  } finally {
    global.fetch = originalFetch;
  }
});

test("without waitUntil (Durable Object) the group notice is still sent, after the result", async () => {
  const originalFetch = global.fetch;
  const bot = loadBot();
  const calls = mockFetch();

  try {
    await bot(
      req({ update_id: 3, message: { message_id: 6, chat: { id: 999, type: "private" }, from: { id: 999, first_name: "Sardor" }, text: "1290132154 (15246)" } }),
      res()
    );
    const order = calls.filter((c) => c.method === "sendMessage").map((c) => c.chatId);
    assert.deepEqual(order, ["999", GROUP]);
  } finally {
    global.fetch = originalFetch;
  }
});
