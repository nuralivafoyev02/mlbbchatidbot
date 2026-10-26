const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const monitorUrl = pathToFileURL(require.resolve("../webhook-monitor.mjs")).href;
const workerUrl = pathToFileURL(require.resolve("../worker.mjs")).href;
const runnerUrl = pathToFileURL(require.resolve("../async-runner.mjs")).href;

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 25, 3, 0, 0);

function memoryStorage() {
  const store = new Map();

  return {
    store,
    async get(key) {
      return store.get(key);
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

// getWebhookInfo javobini `info()` dan oladi, sendMessage'larni yig'adi.
function fakeTelegram(info) {
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith("/getWebhookInfo")) {
      const result = typeof info === "function" ? info() : info;
      return new Response(JSON.stringify(result ? { ok: true, result } : { ok: false }));
    }

    if (url.endsWith("/sendMessage")) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }

    throw new Error(`unexpected ${url}`);
  };

  return { sent, fetchImpl };
}

const env = {
  TELEGRAM_BOT_TOKEN: "123:test",
  TELEGRAM_BOT_USERNAME: "devcheckmlbbidBot",
  ADMIN_IDS: "111,222",
};

test("healthy webhook sends nothing", async () => {
  const { runWebhookMonitor } = await import(monitorUrl);
  const storage = memoryStorage();
  const tg = fakeTelegram({ url: "https://x/tg", pending_update_count: 0 });

  const result = await runWebhookMonitor({ env, storage, fetchImpl: tg.fetchImpl, now: T0 });

  assert.equal(result.status, "up");
  assert.deepEqual(result.problems, []);
  assert.equal(tg.sent.length, 0);
});

test("one-off error does not alert, two in a row do, then recovery is reported once", async () => {
  const { runWebhookMonitor } = await import(monitorUrl);
  const storage = memoryStorage();
  let info = { url: "https://x/tg", pending_update_count: 0 };
  const tg = fakeTelegram(() => info);

  await runWebhookMonitor({ env, storage, fetchImpl: tg.fetchImpl, now: T0 });

  info = { url: "https://x/tg", pending_update_count: 3, last_error_date: (T0 + 5 * MIN) / 1000, last_error_message: "Read timeout expired" };
  let result = await runWebhookMonitor({ env, storage, fetchImpl: tg.fetchImpl, now: T0 + 10 * MIN });
  assert.equal(result.status, "up");
  assert.equal(tg.sent.length, 0);

  // Xato eski — yangi xato yo'q, demak bitta tasodif edi.
  result = await runWebhookMonitor({ env, storage, fetchImpl: tg.fetchImpl, now: T0 + 20 * MIN });
  assert.equal(result.status, "up");
  assert.equal(tg.sent.length, 0);

  info = { url: "https://x/tg", pending_update_count: 12, last_error_date: (T0 + 25 * MIN) / 1000, last_error_message: "Wrong response from the webhook: 404 Not Found" };
  await runWebhookMonitor({ env, storage, fetchImpl: tg.fetchImpl, now: T0 + 30 * MIN });
  info = { ...info, last_error_date: (T0 + 39 * MIN) / 1000 };
  result = await runWebhookMonitor({ env, storage, fetchImpl: tg.fetchImpl, now: T0 + 40 * MIN });

  assert.equal(result.status, "down");
  assert.equal(result.alerted, "down");
  assert.deepEqual(tg.sent.map((m) => m.chat_id), ["111", "222"]);
  assert.match(tg.sent[0].text, /@devcheckmlbbidBot webhook ishlamayapti/);
  assert.match(tg.sent[0].text, /404 Not Found/);

  // Hali ham buzuq, lekin 6 soat o'tmagan — qayta yozilmaydi.
  info = { ...info, last_error_date: (T0 + 49 * MIN) / 1000 };
  result = await runWebhookMonitor({ env, storage, fetchImpl: tg.fetchImpl, now: T0 + 50 * MIN });
  assert.equal(result.alerted, null);
  assert.equal(tg.sent.length, 2);

  info = { url: "https://x/tg", pending_update_count: 0, last_error_date: (T0 + 49 * MIN) / 1000, last_error_message: "old" };
  result = await runWebhookMonitor({ env, storage, fetchImpl: tg.fetchImpl, now: T0 + 60 * MIN });
  assert.equal(result.status, "up");
  assert.equal(result.alerted, "up");
  assert.equal(tg.sent.length, 4);
  assert.match(tg.sent[2].text, /webhook tiklandi/);
  assert.match(tg.sent[2].text, /30 daqiqa/);
});

test("long outage sends a reminder every 6 hours", async () => {
  const { runWebhookMonitor } = await import(monitorUrl);
  const storage = memoryStorage();
  let now = T0;
  const tg = fakeTelegram(() => ({ url: "https://x/tg", pending_update_count: 80, last_error_date: (now - MIN) / 1000, last_error_message: "404" }));

  for (let i = 0; i <= 38; i += 1) {
    now = T0 + i * 10 * MIN;
    await runWebhookMonitor({ env: { ...env, ADMIN_IDS: "111" }, storage, fetchImpl: tg.fetchImpl, now });
  }

  // 10-daqiqada "down", 6 soatdan keyin bitta "hali ham".
  assert.equal(tg.sent.length, 2);
  assert.match(tg.sent[1].text, /hali ham ishlamayapti/);
  assert.match(tg.sent[1].text, /6 soat/);
});

test("missing webhook url, big backlog and unreachable Telegram count as problems", async () => {
  const { evaluateWebhookInfo } = await import(monitorUrl);
  const opts = { lastCheckAt: T0, now: T0 + 10 * MIN, pendingThreshold: 50 };

  assert.deepEqual(evaluateWebhookInfo({ url: "", pending_update_count: 0 }, opts), ["Webhook o'rnatilmagan"]);
  assert.deepEqual(evaluateWebhookInfo({ url: "https://x", pending_update_count: 50 }, opts), ["Navbatda 50 ta update"]);
  assert.deepEqual(evaluateWebhookInfo(null, opts), ["getWebhookInfo javob bermadi"]);
});

test("alert text escapes HTML from Telegram error messages", async () => {
  const { formatMonitorAlert } = await import(monitorUrl);
  const text = formatMonitorAlert({ kind: "down", problems: ["Telegram xatosi: <b>bad</b> & co"] }, { botUsername: "bot" });

  assert.match(text, /&lt;b&gt;bad&lt;\/b&gt; &amp; co/);
});

test("scheduled: monitor cron goes to the monitor runner", async () => {
  const worker = (await import(workerUrl)).default;
  const { MONITOR_CRON } = await import(monitorUrl);
  const calls = [];
  const namespace = {
    idFromName(name) {
      return name;
    },
    get(id) {
      return {
        async fetch(url, init) {
          calls.push({ id, url, method: init?.method });
          return new Response("{}");
        },
      };
    },
  };

  await worker.scheduled({ cron: MONITOR_CRON }, { ASYNC_RUNNER: namespace }, {});

  assert.deepEqual(calls, [{ id: "monitor", url: "https://async-runner.internal/monitor", method: "POST" }]);
});

test("AsyncRunner only runs the monitor on the monitor object", async () => {
  const { AsyncRunner } = await import(runnerUrl);
  const storage = memoryStorage();
  const runner = new AsyncRunner({ id: { name: "bind:3" }, storage }, {});

  const response = await runner.fetch("https://async-runner.internal/monitor", { method: "POST", body: "{}" });

  assert.equal(response.status, 400);
});
