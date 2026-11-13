const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const guardUrl = pathToFileURL(require.resolve("../api-guard.mjs")).href;
const publicApiUrl = pathToFileURL(require.resolve("../public-api.mjs")).href;

const ENV = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  TELEGRAM_BOT_USERNAME: "checkmlbbidBot",
  MAIN_GROUP_ID: "-1004434649076",
  ADMIN_IDS: "5081175125,7396686285",
};

function memoryStorage() {
  const map = new Map();
  return {
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, JSON.parse(JSON.stringify(value))); },
  };
}

function telegramSink() {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ method: String(url).split("/").pop(), payload: JSON.parse(init.body) });
    return Response.json({ ok: true, result: {} });
  };
  return { sent, fetchImpl };
}

const tok = (id, extra = {}) => ({ id, title: `client-${id}`, prefix: `mlbb_${id}abc...`, ...extra });

test("token rotation from one IP alerts the main group and every admin once", async () => {
  const { createGuardCollector, runApiGuard } = await import(guardUrl);
  const storage = memoryStorage();
  const { sent, fetchImpl } = telegramSink();

  const c = createGuardCollector();
  c.hit(tok(1), "1.2.3.4", "UZ");
  c.hit(tok(2), "1.2.3.4", "UZ", true); // ikkinchi token limitga urildi
  const result = await runApiGuard({ env: ENV, storage, batch: c.drain(), fetchImpl, now: 1_000_000 });

  assert.deepEqual(result.alerted, ["rotation:1.2.3.4"]);
  assert.deepEqual(sent.map((m) => m.payload.chat_id), ["-1004434649076", "5081175125", "7396686285"]);
  const msg = sent[0].payload;
  assert.match(msg.text, /Limitni chetlab o'tish/);
  assert.match(msg.text, /1\.2\.3\.4/);
  assert.match(msg.text, /Kalitlar \(o'chirish uchun\)/);
  assert.match(msg.text, /<b>client-1<\/b> — #1 · <code>mlbb_1abc\.\.\.<\/code>/);
  assert.equal(msg.reply_markup.inline_keyboard[0][0].text, "⛔ client-1 (#1) — o'chirish");
  assert.deepEqual(msg.reply_markup.inline_keyboard.map((r) => r[0].callback_data), ["apitok_revoke:1", "apitok_revoke:2"]);

  // Cooldown ichida qayta xabar yo'q.
  const again = createGuardCollector();
  again.hit(tok(1), "1.2.3.4", "UZ");
  await runApiGuard({ env: ENV, storage, batch: again.drain(), fetchImpl, now: 1_060_000 });
  assert.equal(sent.length, 3);
});

test("two tokens without a 429 are not treated as rotation", async () => {
  const { createGuardCollector, runApiGuard } = await import(guardUrl);
  const { sent, fetchImpl } = telegramSink();
  const c = createGuardCollector();
  c.hit(tok(1), "9.9.9.9");
  c.hit(tok(2), "9.9.9.9");
  const result = await runApiGuard({ env: ENV, storage: memoryStorage(), batch: c.drain(), fetchImpl });
  assert.equal(result.incidents, 0);
  assert.equal(sent.length, 0);
});

test("signals accumulate across batches inside the 10 minute window", async () => {
  const { createGuardCollector, runApiGuard } = await import(guardUrl);
  const storage = memoryStorage();
  const { sent, fetchImpl } = telegramSink();
  const start = 5_000_000;

  for (let i = 0; i < 5; i += 1) {
    const c = createGuardCollector();
    c.hit(tok(7), "5.5.5.5", "DE", true);
    c.hit(tok(7), "5.5.5.5", "DE", true);
    await runApiGuard({ env: ENV, storage, batch: c.drain(), fetchImpl, now: start + i * 60_000 });
  }

  assert.equal(sent.length, 3);
  assert.match(sent[0].payload.text, /Limitga qayta-qayta urilish/);
  assert.match(sent[0].payload.text, /10 marta limitdan oshdi/);

  // 11 daqiqadan keyin eski signallar oynadan chiqadi.
  const later = createGuardCollector();
  later.hit(tok(7), "5.5.5.5", "DE", true);
  const result = await runApiGuard({ env: ENV, storage, batch: later.drain(), fetchImpl, now: start + 15 * 60_000 });
  assert.equal(result.incidents, 0);
});

test("brute force, leaked and revoked tokens are reported", async () => {
  const { createGuardCollector, runApiGuard } = await import(guardUrl);
  const { sent, fetchImpl } = telegramSink();
  const c = createGuardCollector();

  for (let i = 0; i < 15; i += 1) c.bad("6.6.6.6", "RU", `mlbb_guess${i % 7}...`);
  for (let i = 0; i < 8; i += 1) c.hit(tok(3), `10.0.0.${i}`);
  for (let i = 0; i < 3; i += 1) c.dead(tok(4, { kind: "token_revoked" }), "7.7.7.7");

  const result = await runApiGuard({ env: { ...ENV, ADMIN_IDS: "" }, storage: memoryStorage(), batch: c.drain(), fetchImpl });
  assert.deepEqual(result.alerted.sort(), ["bruteforce:6.6.6.6", "deadToken:4", "leak:3"]);
  const texts = sent.map((m) => m.payload.text).join("\n---\n");
  assert.match(texts, /brute force/);
  assert.match(texts, /oshkor bo'lgan bo'lishi mumkin/);
  assert.match(texts, /Bekor qilingan token bilan 3 marta/);
  // Brute force'da bekor qilinadigan token yo'q — tugma ham yo'q, sinalgan kalitlar ko'rsatiladi.
  const brute = sent.find((m) => /brute force/.test(m.payload.text)).payload;
  assert.equal(brute.reply_markup, undefined);
  assert.match(brute.text, /Sinab ko'rilgan kalitlar — tizimda yo'q/);
  assert.equal((brute.text.match(/mlbb_guess\d\.\.\./g) || []).length, 5);
  assert.match(brute.text, /o'chiradigan narsa yo'q/);
  assert.match(texts, /Kalit \(allaqachon yaroqsiz\):[\s\S]*<b>client-4<\/b> — #4/);
});

test("recipients are de-duplicated and HTML is escaped", async () => {
  const { guardRecipients, formatIncident } = await import(guardUrl);
  assert.deepEqual(guardRecipients({ MAIN_GROUP_ID: "-1", ADMIN_IDS: "5, 5,-1" }), ["-1", "5"]);
  const text = formatIncident({ rule: "leak", detail: "x", tokens: [tok(1, { title: "<b>evil</b>", hits: 1, ips: [] })], ips: [] });
  assert.ok(!text.includes("<b>evil</b>"));
  assert.match(text, /&lt;b&gt;evil/);
});

test("public API forwards guard signals to the monitor Durable Object", async () => {
  const crypto = require("node:crypto");
  const api = await import(publicApiUrl);
  api.resetPublicApiState();
  globalThis.caches = undefined;

  const TOKEN = `mlbb_${"b".repeat(40)}`;
  const hash = crypto.createHash("sha256").update(TOKEN).digest("hex");
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api_tokens?token_hash=")) {
      assert.ok(u.includes(hash));
      return Response.json([{ id: 11, title: "shop", token_prefix: "mlbb_bbbb...", expires_at: "2099-01-01T00:00:00Z", is_revoked: true }]);
    }
    throw new Error(`unexpected ${u}`);
  };

  const posted = [];
  const env = {
    SUPABASE_URL: "https://db.test",
    SUPABASE_SERVICE_KEY: "k",
    API_GUARD_FLUSH_DELAY_MS: 0,
    ASYNC_RUNNER: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: async (url, init) => {
          posted.push({ id, url, body: JSON.parse(init.body) });
          return Response.json({ ok: true });
        },
      }),
    },
  };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const res = await api.handlePublicApi(new Request("https://mlbb.nurali.uz/v1/check?id=1&zone=1", {
    headers: { authorization: `Bearer ${TOKEN}`, "cf-connecting-ip": "8.8.8.8" },
  }), env, ctx);
  await Promise.all(waits);

  assert.equal(res.status, 401);
  assert.equal(posted.length, 1);

  // Keyingi signallar ham (yangi so'rov kutilmasdan) bitta paketda yetib boradi.
  for (let i = 0; i < 3; i += 1) {
    await api.handlePublicApi(new Request("https://mlbb.nurali.uz/v1/check?id=1&zone=1", {
      headers: { authorization: `Bearer ${TOKEN}`, "cf-connecting-ip": "8.8.8.8" },
    }), env, ctx);
  }
  await Promise.all(waits);
  const later = posted.slice(1).flatMap((p) => p.body.batch.dead);
  assert.equal(later.reduce((sum, t) => sum + t.hits, 0), 3);
  assert.equal(posted[0].id, "monitor");
  assert.match(posted[0].url, /\/api-guard$/);
  assert.deepEqual(posted[0].body.batch.dead.map((t) => [t.id, t.kind, t.ips]), [[11, "token_revoked", ["8.8.8.8"]]]);
});

test("bot: revoke button works only for admins", async () => {
  const modulePath = require.resolve("../api/bot.js");
  const saved = { ...process.env };
  process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.ADMIN_IDS = "5081175125";
  process.env.SUPABASE_URL = "https://testproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test-role-key";
  delete process.env.SUPABASE_SERVICE_KEY;
  delete require.cache[modulePath];
  const bot = require("../api/bot.js");

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    return Response.json(u.includes("supabase") ? [{ title: "shop.uz", token_prefix: "mlbb_42ab..." }] : { ok: true, result: true });
  };

  const press = (fromId) => bot(
    {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "test-secret" },
      query: {},
      body: {
        update_id: Date.now(),
        callback_query: {
          id: `cb-${fromId}`,
          data: "apitok_revoke:42",
          from: { id: fromId, username: "boss" },
          message: {
            message_id: 9,
            chat: { id: -1004434649076, type: "supergroup" },
            reply_markup: { inline_keyboard: [[{ text: "x", callback_data: "apitok_revoke:42" }], [{ text: "y", callback_data: "apitok_revoke:43" }]] },
          },
        },
      },
    },
    { status() { return this; }, setHeader() { return this; }, json() { return this; }, send() { return this; }, end() { return this; } }
  );

  try {
    await press(111);
    assert.ok(!calls.some((c) => c.method === "PATCH"), "non-admin must not revoke");
    assert.match(calls.find((c) => /answerCallbackQuery$/.test(c.url)).body.text, /faqat adminlar/);

    calls.length = 0;
    await press(5081175125);
    const patch = calls.find((c) => c.method === "PATCH");
    assert.match(patch.url, /api_tokens\?id=eq\.42&select=title,token_prefix$/);
    assert.deepEqual(patch.body, { is_revoked: true });
    const markup = calls.find((c) => /editMessageReplyMarkup$/.test(c.url)).body.reply_markup;
    assert.deepEqual(markup.inline_keyboard.map((r) => r[0].callback_data), ["apitok_revoke:43"]);
    assert.match(calls.find((c) => /answerCallbackQuery$/.test(c.url)).body.text, /«shop\.uz» \(#42\) kaliti o'chirildi/);
    const note = calls.find((c) => /sendMessage$/.test(c.url) && /Kalit o'chirildi/.test(c.body.text)).body.text;
    assert.match(note, /<b>shop\.uz<\/b> — #42 · <code>mlbb_42ab\.\.\.<\/code>/);
    assert.match(note, /@boss/);
  } finally {
    global.fetch = originalFetch;
    process.env = saved;
    delete require.cache[modulePath];
  }
});
