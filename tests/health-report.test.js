const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const reportUrl = pathToFileURL(require.resolve("../health-report.mjs")).href;
const countersUrl = pathToFileURL(require.resolve("../health-counters.mjs")).href;
const monitorUrl = pathToFileURL(require.resolve("../webhook-monitor.mjs")).href;
const runnerUrl = pathToFileURL(require.resolve("../async-runner.mjs")).href;

const MIN = 60 * 1000;
// 2026-10-26 23:50 Toshkent = 18:50 UTC
const REPORT_AT = Date.UTC(2026, 9, 26, 18, 50, 0);

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
    async delete(key) {
      store.delete(key);
    },
  };
}

function cloudflareGraphql() {
  return {
    data: {
      viewer: {
        accounts: [
          {
            script: [
              { sum: { requests: 6500 }, quantiles: { cpuTimeP50: 1400, cpuTimeP99: 15000 }, dimensions: { status: "success" } },
              { sum: { requests: 10 }, quantiles: { cpuTimeP50: 9000, cpuTimeP99: 12000 }, dimensions: { status: "exceededResources" } },
              { sum: { requests: 3 }, quantiles: { cpuTimeP50: 2000, cpuTimeP99: 4000 }, dimensions: { status: "scriptThrewException" } },
            ],
            account: [{ sum: { requests: 5300 } }, { sum: { requests: 120 } }],
          },
        ],
      },
    },
  };
}

function fakeFetch({ webhook, graphql = cloudflareGraphql() } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });

    if (url.endsWith("/getWebhookInfo")) {
      return new Response(JSON.stringify({ ok: true, result: webhook }));
    }

    if (url.includes("/graphql")) {
      return new Response(JSON.stringify(graphql));
    }

    if (url.endsWith("/sendMessage")) {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }

    throw new Error(`unexpected ${url}`);
  };

  return { calls, fetchImpl };
}

const env = {
  TELEGRAM_BOT_TOKEN: "123:test",
  TELEGRAM_BOT_USERNAME: "checkmlbbidBot",
  MAIN_GROUP_ID: "-100500",
  CF_ANALYTICS_TOKEN: "cf-token",
  CF_ACCOUNT_ID: "acc",
  WORKER_NAME: "mlbbchatidbot",
};

test("report is due once a day, after 23:50 Tashkent", async () => {
  const { isReportDue } = await import(reportUrl);

  assert.equal(isReportDue(REPORT_AT - 10 * MIN, env, null), false);
  assert.equal(isReportDue(REPORT_AT, env, null), true);
  assert.equal(isReportDue(REPORT_AT, env, "2026-10-26 23:50"), false);
  assert.equal(isReportDue(REPORT_AT, env, "2026-10-25 23:50"), true);
  // Kunduzi sinov vaqti bilan yuborilgan bo'lsa ham, kechki hisobot ketadi.
  assert.equal(isReportDue(REPORT_AT, env, "2026-10-26 11:48"), true);
  // 00:00 Toshkent — yangi kun, lekin vaqti hali kelmagan.
  assert.equal(isReportDue(REPORT_AT + 10 * MIN, env, "2026-10-26 23:50"), false);
  assert.equal(isReportDue(Date.UTC(2026, 9, 26, 7, 0), { HEALTH_REPORT_TIME: "12:00" }, null), true);
});

test("full report: Cloudflare numbers, counters, DB and incidents", async () => {
  const { collectHealthReport, countersKey, formatHealthReport, getOverallStatus } = await import(reportUrl);
  const storage = memoryStorage();
  await storage.put(countersKey(REPORT_AT), {
    errors: { mlbb_lookup_failed: 7, mlbb_full_info_failed: 2 },
    limits: { mlbb_full_info_failed: 2 },
  });
  const tg = fakeFetch({ webhook: { url: "https://mlbb.nurali.uz/tg", pending_update_count: 0 } });
  const monitorState = {
    status: "up",
    incidents: [
      { start: REPORT_AT - 30 * 60 * MIN, end: REPORT_AT - 29 * 60 * MIN }, // kecha
      { start: REPORT_AT - 120 * MIN, end: REPORT_AT - 95 * MIN },
    ],
  };
  const botDb = async () => ({
    ok: true,
    pingMs: 240,
    totalUsers: 12345,
    newUsers: 56,
    actions: [{ label: "🔍 Server", count: 900 }, { label: "ℹ️ Full info", count: 40 }],
    dbBytes: 120 * 1024 * 1024,
    connections: 9,
  });

  const report = await collectHealthReport({ env, storage, monitorState, botDb, fetchImpl: tg.fetchImpl, now: REPORT_AT });
  const text = formatHealthReport(report, { now: REPORT_AT });

  const graphqlCall = tg.calls.find((call) => call.url.includes("/graphql"));
  assert.equal(graphqlCall.body.variables.script, "mlbbchatidbot");
  assert.equal(graphqlCall.body.variables.from, "2026-10-25T19:00:00.000Z");
  assert.equal(graphqlCall.body.variables.utcFrom, "2026-10-26T00:00:00.000Z");

  assert.equal(report.cloudflare.requests, 6513);
  assert.equal(report.cloudflare.success, 6500);
  assert.equal(report.cloudflare.limitHits, 10);
  assert.equal(report.monitor.count, 1);
  assert.equal(getOverallStatus(report), "yellow");

  assert.match(text, /@checkmlbbidBot — kunlik holat<\/b> \(2026-10-26\)/);
  assert.match(text, /So'rovlar: <b>6 513<\/b> · ✅ 6 500 · ❌ 13/);
  assert.match(text, /CPU\/xotira limitiga urilgan: <b>10<\/b>/);
  assert.match(text, /Akkaunt limiti: 5 420 \/ 100 000 \(5\.4%/);
  assert.match(text, /Bugungi uzilishlar: <b>1<\/b> ta, jami ~25 daqiqa/);
  assert.match(text, /Muvaffaqiyatli amallar: <b>940<\/b>/);
  assert.match(text, /Xatolar: <b>9<\/b> \(mlbb_lookup_failed 7, mlbb_full_info_failed 2\)/);
  assert.match(text, /Limitga urilish: <b>2<\/b>/);
  assert.match(text, /Foydalanuvchilar: <b>12 345<\/b> \(\+56 bugun\)/);
  assert.match(text, /Hajmi: 120\.0 MB \/ 500 MB \(24%\) · ulanishlar: 9/);
  assert.ok(text.length < 4096);
});

test("missing Cloudflare token, DB down and broken webhook are reported, not thrown", async () => {
  const { collectHealthReport, formatHealthReport, getOverallStatus } = await import(reportUrl);
  const tg = fakeFetch({ webhook: { url: "", pending_update_count: 300, last_error_date: (REPORT_AT - 5 * MIN) / 1000, last_error_message: "Wrong response from the webhook: 404 Not Found" } });

  const report = await collectHealthReport({
    env: { ...env, CF_ANALYTICS_TOKEN: "" },
    storage: memoryStorage(),
    monitorState: { status: "down", incidents: [{ start: REPORT_AT - 60 * MIN }] },
    botDb: async () => { throw new Error("timeout"); },
    fetchImpl: tg.fetchImpl,
    now: REPORT_AT,
  });
  const text = formatHealthReport(report, { now: REPORT_AT });

  assert.equal(getOverallStatus(report), "red");
  assert.match(text, /🔴 Muammo bor/);
  assert.match(text, /o'rnatilmagan ❗ · navbat: <b>300<\/b>/);
  assert.match(text, /404 Not Found \(5 daqiqa oldin\)/);
  assert.match(text, /Bugungi uzilishlar: <b>1<\/b> ta, jami ~1 soat/);
  assert.match(text, /Sozlanmagan — CF_ANALYTICS_TOKEN/);
  assert.match(text, /Ulanib bo'lmadi: timeout/);
  assert.equal(tg.calls.some((call) => call.url.includes("/graphql")), false);
});

test("healthy day is green and says when db_health migration is missing", async () => {
  const { collectHealthReport, formatHealthReport, getOverallStatus } = await import(reportUrl);
  const graphql = cloudflareGraphql();
  graphql.data.viewer.accounts[0].script = [{ sum: { requests: 100 }, quantiles: { cpuTimeP50: 1000, cpuTimeP99: 3000 }, dimensions: { status: "success" } }];
  const tg = fakeFetch({ webhook: { url: "https://mlbb.nurali.uz/tg", pending_update_count: 0 }, graphql });

  const report = await collectHealthReport({
    env,
    storage: memoryStorage(),
    botDb: async () => ({ ok: true, pingMs: 200, totalUsers: 10, newUsers: 0, dbHealthMissing: true }),
    fetchImpl: tg.fetchImpl,
    now: REPORT_AT,
  });

  assert.equal(getOverallStatus(report), "green");
  assert.match(formatHealthReport(report, { now: REPORT_AT }), /025_db_health\.sql migratsiyasi kerak/);
});

test("counter deltas: only new increments are sent, failed flush is retried", async (t) => {
  const { takeHealthDelta, flushHealthCounters, __resetFlushedForTests } = await import(countersUrl);
  __resetFlushedForTests();
  const stats = { errorCounts: { a: 2 }, limitCounts: {} };

  assert.deepEqual(takeHealthDelta(stats), { errors: { a: 2 }, limits: {} });
  assert.equal(takeHealthDelta(stats), null);
  stats.errorCounts.a = 5;
  stats.limitCounts.a = 1;
  assert.deepEqual(takeHealthDelta(stats), { errors: { a: 3 }, limits: { a: 1 } });

  __resetFlushedForTests();
  const realStats = globalThis.__MLBB_BOT_STATS__;
  t.after(() => {
    globalThis.__MLBB_BOT_STATS__ = realStats;
  });
  globalThis.__MLBB_BOT_STATS__ = { errorCounts: { b: 4 }, limitCounts: {} };
  let fail = true;
  const sent = [];
  const namespace = {
    idFromName: (name) => name,
    get: (id) => ({
      async fetch(url, init) {
        if (fail) {
          return new Response("no", { status: 500 });
        }
        sent.push({ id, url, body: JSON.parse(init.body) });
        return new Response("{}");
      },
    }),
  };

  await flushHealthCounters({ ASYNC_RUNNER: namespace });
  assert.equal(sent.length, 0);
  fail = false;
  await flushHealthCounters({ ASYNC_RUNNER: namespace });
  assert.deepEqual(sent, [{ id: "monitor", url: "https://async-runner.internal/health-counters", body: { delta: { errors: { b: 4 }, limits: {} } } }]);
});

test("monitor runner merges counters and sends the daily report once", async () => {
  const { AsyncRunner } = await import(runnerUrl);
  const { countersKey } = await import(reportUrl);
  const storage = memoryStorage();
  const runner = new AsyncRunner({ id: { name: "monitor" }, storage }, { ...env, CF_ANALYTICS_TOKEN: "" });

  await runner.fetch("https://async-runner.internal/health-counters", { method: "POST", body: JSON.stringify({ delta: { errors: { x: 1 }, limits: {} } }) });
  await runner.fetch("https://async-runner.internal/health-counters", { method: "POST", body: JSON.stringify({ delta: { errors: { x: 2 }, limits: { x: 1 } } }) });
  assert.deepEqual(storage.store.get(countersKey()), { errors: { x: 3 }, limits: { x: 1 } });

  const realFetch = globalThis.fetch;
  const tg = fakeFetch({ webhook: { url: "https://mlbb.nurali.uz/tg", pending_update_count: 0 } });
  globalThis.fetch = tg.fetchImpl;

  try {
    assert.equal(await runner.sendDailyHealthReportIfDue({}, REPORT_AT - 20 * MIN), null);
    assert.equal(await runner.sendDailyHealthReportIfDue({}, REPORT_AT), "sent");
    assert.equal(await runner.sendDailyHealthReportIfDue({}, REPORT_AT + 5 * MIN), null);
  } finally {
    globalThis.fetch = realFetch;
  }

  const sends = tg.calls.filter((call) => call.url.endsWith("/sendMessage"));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].body.chat_id, "-100500");
  assert.match(sends[0].body.text, /kunlik holat/);
  // Supabase sozlanmagan test muhitida ham hisobot chiqadi.
  assert.match(sends[0].body.text, /Ulanib bo'lmadi/);
});

test("monitor keeps an incident log for the report", async () => {
  const { nextMonitorState } = await import(monitorUrl);
  let { state } = nextMonitorState({}, ["x"], 1000);
  ({ state } = nextMonitorState(state, ["x"], 2000));
  assert.deepEqual(state.incidents, [{ start: 1000 }]);
  ({ state } = nextMonitorState(state, [], 5000));
  assert.deepEqual(state.incidents, [{ start: 1000, end: 5000 }]);
});

test("bot recordError counts rate limits separately", () => {
  const bot = require("../api/bot.js");
  const stats = globalThis.__MLBB_BOT_STATS__;
  const before = { ...stats.limitCounts };

  bot.__private.recordError("mlbb_full_info_failed", "full_info_provider_rate_limited");
  bot.__private.recordError("mlbb_lookup_failed", "timeout", { status: 429 });
  bot.__private.recordError("mlbb_lookup_failed", "not found", { status: 404 });

  assert.equal(stats.limitCounts.mlbb_full_info_failed - (before.mlbb_full_info_failed || 0), 1);
  assert.equal(stats.limitCounts.mlbb_lookup_failed - (before.mlbb_lookup_failed || 0), 1);
});

test("/statistics works only in the main group and respects @username", async () => {
  const { isStatisticsCommand } = await import(pathToFileURL(require.resolve("../worker.mjs")).href);
  const msg = (text, chatId = -100500) => ({ message: { message_id: 7, text, chat: { id: chatId } } });

  assert.equal(isStatisticsCommand(msg("/statistics"), env), true);
  assert.equal(isStatisticsCommand(msg("/statistics@checkmlbbidBot"), env), true);
  assert.equal(isStatisticsCommand(msg("/statistics@devcheckmlbbidBot"), env), false);
  assert.equal(isStatisticsCommand(msg("/statistics", -100999), env), false);
  assert.equal(isStatisticsCommand(msg("/statistics", 5081175125), env), false);
  assert.equal(isStatisticsCommand(msg("/statisticsx"), env), false);
});

test("/statistics in the main group goes to the monitor runner and replies there", async () => {
  const worker = (await import(pathToFileURL(require.resolve("../worker.mjs")).href)).default;
  const calls = [];
  const waits = [];
  const namespace = {
    idFromName: (name) => name,
    get: (id) => ({
      async fetch(url, init) {
        calls.push({ id, url, body: JSON.parse(init.body) });
        return new Response("{}");
      },
    }),
  };
  const request = new Request("https://mlbb.nurali.uz/tg", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "s3" },
    body: JSON.stringify({ update_id: 1, message: { message_id: 7, text: "/statistics", chat: { id: -100500 } } }),
  });

  const response = await worker.fetch(request, { ...env, TELEGRAM_WEBHOOK_SECRET: "s3", ASYNC_RUNNER: namespace }, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ id: "monitor", url: "https://async-runner.internal/health-report", body: { chatId: -100500, replyTo: 7 } }]);
});

test("manual report has a 30 s cooldown", async () => {
  const { AsyncRunner } = await import(runnerUrl);
  const runner = new AsyncRunner({ id: { name: "monitor" }, storage: memoryStorage() }, { ...env, CF_ANALYTICS_TOKEN: "" });
  const realFetch = globalThis.fetch;
  const tg = fakeFetch({ webhook: { url: "https://mlbb.nurali.uz/tg", pending_update_count: 0 } });
  globalThis.fetch = tg.fetchImpl;

  try {
    const first = await (await runner.handleHealthReportRequest({ chatId: -100500, replyTo: 7 }, REPORT_AT)).json();
    const second = await (await runner.handleHealthReportRequest({ chatId: -100500, replyTo: 8 }, REPORT_AT + 10_000)).json();
    const third = await (await runner.handleHealthReportRequest({ chatId: -100500, replyTo: 9 }, REPORT_AT + 31_000)).json();

    assert.deepEqual([first.result, second.result, third.result], ["sent", "cooldown", "sent"]);
  } finally {
    globalThis.fetch = realFetch;
  }

  const sends = tg.calls.filter((call) => call.url.endsWith("/sendMessage"));
  assert.equal(sends[0].body.reply_parameters.message_id, 7);
});
