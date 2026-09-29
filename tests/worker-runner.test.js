const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.SUPPORT_USERNAME = "@Ksava_org";
process.env.ADMIN_IDS = "5081175125,8500085987,7396686285";
process.env.TELEGRAM_BOT_USERNAME = "mlbb_test_bot";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const botHandler = require("../api/bot.js");

const broadcastCoreUrl = pathToFileURL(require.resolve("../broadcast-core.mjs")).href;
const runnerUrl = pathToFileURL(require.resolve("../async-runner.mjs")).href;
const workerUrl = pathToFileURL(require.resolve("../worker.mjs")).href;

function noSleep() {
  return Promise.resolve();
}

function createFakeState(name) {
  const store = new Map();
  const alarms = [];

  return {
    id: { name },
    alarms,
    waitUntil() {},
    storage: {
      async get(key) {
        return store.get(key);
      },
      async put(key, value) {
        store.set(key, value);
      },
      async delete(key) {
        store.delete(key);
      },
      async setAlarm(time) {
        alarms.push(time);
      },
      dump() {
        return store;
      },
    },
  };
}

function createRunnerStub() {
  const submitted = [];

  return {
    submitted,
    namespace: {
      idFromName(name) {
        return { name };
      },
      get() {
        return {
          async fetch(url, init = {}) {
            submitted.push({
              url: String(url),
              body: init.body ? JSON.parse(init.body) : null,
            });

            return new Response(JSON.stringify({ ok: true, queued: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        };
      },
    },
  };
}

function telegramOk() {
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("broadcast tuning: defaults stay inside Workers Free subrequest limit", async () => {
  const { getBroadcastTuning } = await import(broadcastCoreUrl);
  const tune = getBroadcastTuning({});

  assert.equal(tune.ratePerSec, 25);
  assert.equal(tune.batchSize, 25);
  assert.equal(tune.maxSendsPerRun, 40);
  assert.ok(tune.maxSendsPerRun <= 45, "must leave room for the continuation subrequest");
});

test("broadcast tuning: env overrides are clamped", async () => {
  const { getBroadcastTuning } = await import(broadcastCoreUrl);
  const tune = getBroadcastTuning({
    BROADCAST_RATE_PER_SEC: "999",
    BROADCAST_BATCH_SIZE: "999",
    BROADCAST_MAX_SENDS_PER_RUN: "999",
  });

  assert.equal(tune.ratePerSec, 30, "Telegram global limit is 30 msg/s");
  assert.ok(tune.batchSize <= 45);
  assert.ok(tune.maxSendsPerRun <= 45);
});

test("broadcast tuning: invalid env falls back to defaults", async () => {
  const { getBroadcastTuning } = await import(broadcastCoreUrl);
  const tune = getBroadcastTuning({ BROADCAST_RATE_PER_SEC: "abc" });

  assert.equal(tune.ratePerSec, 25);
});

test("retry_after is parsed from Telegram 429 payloads", async () => {
  const { getTelegramRetryAfterSeconds, isTelegramRateLimitError } = await import(broadcastCoreUrl);
  const error = new Error(
    'Telegram API error: HTTP 429 {"ok":false,"error_code":429,"description":"Too Many Requests: retry after 12","parameters":{"retry_after":12}}'
  );

  assert.equal(isTelegramRateLimitError(error), true);
  assert.equal(getTelegramRetryAfterSeconds(error), 12);
  assert.equal(getTelegramRetryAfterSeconds(new Error("Telegram API error: HTTP 500 {}")), 0);
});

test("runBroadcastSlice stops at maxSendsPerRun and returns the remainder", async () => {
  const { runBroadcastSlice } = await import(broadcastCoreUrl);
  const sent = [];
  const handler = {
    async sendBroadcastPayload(chatId) {
      sent.push(chatId);
    },
    categorizeBroadcastSendError() {
      return "errors";
    },
  };
  const chatIds = Array.from({ length: 100 }, (_, index) => String(1000 + index));
  const result = await runBroadcastSlice({
    handler,
    sleep: noSleep,
    tune: { ratePerSec: 25, batchSize: 25, maxSendsPerRun: 40, runBudgetMs: 60000 },
    job: { payload: { kind: "text", text: "hi" }, chatIds },
  });

  assert.equal(result.handled, 40);
  assert.equal(sent.length, 40);
  assert.equal(result.chatIds.length, 60);
  assert.equal(result.finished, false);
  assert.equal(result.counts.sent, 40);
});

test("runBroadcastSlice classifies blocked/inactive/deleted recipients", async () => {
  const { runBroadcastSlice } = await import(broadcastCoreUrl);
  const handler = {
    async sendBroadcastPayload(chatId) {
      if (chatId === "1") {
        throw new Error("Telegram API error: HTTP 403 {\"ok\":false,\"description\":\"Forbidden: bot was blocked by the user\"}");
      }

      if (chatId === "2") {
        throw new Error("Telegram API error: HTTP 400 {\"ok\":false,\"description\":\"Bad Request: chat not found\"}");
      }
    },
    categorizeBroadcastSendError(error) {
      return /blocked/.test(error.message) ? "blocked" : "inactive";
    },
  };
  const result = await runBroadcastSlice({
    handler,
    sleep: noSleep,
    tune: { ratePerSec: 25, batchSize: 25, maxSendsPerRun: 40, runBudgetMs: 60000 },
    job: { payload: { kind: "text", text: "hi" }, chatIds: ["1", "2", "3"] },
  });

  assert.equal(result.finished, true);
  assert.deepEqual(result.counts, { sent: 1, blocked: 1, inactive: 1, initiate: 0, errors: 0 });
});

test("runBroadcastSlice defers 429 sends instead of blind-retrying", async () => {
  const { runBroadcastSlice } = await import(broadcastCoreUrl);
  const attempts = [];
  const handler = {
    async sendBroadcastPayload(chatId) {
      attempts.push(chatId);
      throw new Error(
        'Telegram API error: HTTP 429 {"ok":false,"error_code":429,"description":"Too Many Requests: retry after 3","parameters":{"retry_after":3}}'
      );
    },
    categorizeBroadcastSendError() {
      return "errors";
    },
  };
  const result = await runBroadcastSlice({
    handler,
    sleep: noSleep,
    tune: { ratePerSec: 25, batchSize: 25, maxSendsPerRun: 40, runBudgetMs: 60000 },
    job: { payload: { kind: "text", text: "hi" }, chatIds: ["1", "2"] },
  });

  assert.deepEqual(attempts, ["1", "2"], "no immediate retry per message");
  assert.deepEqual(result.chatIds, ["1", "2"], "rate-limited recipients are re-queued");
  assert.equal(result.finished, false);
  assert.ok(result.cooldownUntil > Date.now() - 1, "global cooldown set from retry_after");
  assert.deepEqual(result.rateLimited, ["1", "2"]);
});

test("runBroadcastSlice counts a recipient as failed after two rate-limit hits", async () => {
  const { runBroadcastSlice } = await import(broadcastCoreUrl);
  const handler = {
    async sendBroadcastPayload() {
      throw new Error(
        'Telegram API error: HTTP 429 {"ok":false,"error_code":429,"parameters":{"retry_after":1}}'
      );
    },
    categorizeBroadcastSendError() {
      return "errors";
    },
  };
  const result = await runBroadcastSlice({
    handler,
    sleep: noSleep,
    cooldownUntil: 0,
    tune: { ratePerSec: 25, batchSize: 25, maxSendsPerRun: 40, runBudgetMs: 60000 },
    job: { payload: { kind: "text", text: "hi" }, chatIds: ["1"], rateLimited: ["1"] },
  });

  assert.equal(result.finished, true);
  assert.equal(result.counts.errors, 1);
});

test("runBroadcastSlice honours the wall-clock budget", async () => {
  const { runBroadcastSlice } = await import(broadcastCoreUrl);
  const handler = {
    async sendBroadcastPayload() {},
    categorizeBroadcastSendError() {
      return "errors";
    },
  };
  const result = await runBroadcastSlice({
    handler,
    sleep: noSleep,
    tune: { ratePerSec: 25, batchSize: 5, maxSendsPerRun: 40, runBudgetMs: 60000 },
    deadlineAt: Date.now() - 1,
    job: { payload: { kind: "text", text: "hi" }, chatIds: ["1", "2", "3"] },
  });

  assert.equal(result.handled, 0);
  assert.equal(result.finished, false);
  assert.deepEqual(result.chatIds, ["1", "2", "3"]);
});

test("mergeBroadcastJob accumulates counters and keeps the cursor", async () => {
  const { mergeBroadcastJob, normalizeBroadcastJob } = await import(broadcastCoreUrl);
  const job = normalizeBroadcastJob({ payload: { kind: "text", text: "hi" }, chatIds: ["1", "2"] });
  const merged = mergeBroadcastJob(job, {
    chatIds: ["2"],
    counts: { sent: 1, blocked: 0, inactive: 0, initiate: 0, errors: 0 },
    rateLimited: [],
    cooldownUntil: 0,
  });

  assert.equal(merged.sent, 1);
  assert.deepEqual(merged.chatIds, ["2"]);

  const second = mergeBroadcastJob(merged, {
    chatIds: [],
    counts: { sent: 1, blocked: 1, inactive: 0, initiate: 0, errors: 0 },
    rateLimited: [],
    cooldownUntil: 0,
  });

  assert.equal(second.sent, 2);
  assert.equal(second.blocked, 1);
  assert.deepEqual(second.chatIds, []);
});

test("bind runner names are deterministic and spread over shards", async () => {
  const { getBindRunnerName } = await import(runnerUrl);

  assert.equal(getBindRunnerName(7041), getBindRunnerName(7041));
  assert.match(getBindRunnerName(7041), /^bind:\d{1,2}$/);

  const shards = new Set();

  for (let index = 0; index < 500; index += 1) {
    shards.add(getBindRunnerName(7000 + index));
  }

  assert.ok(shards.size > 10, `expected spread across shards, got ${shards.size}`);
});

test("async runner: /bind stores the update and arms an alarm", async () => {
  const { AsyncRunner } = await import(runnerUrl);
  const state = createFakeState("bind:3");
  const runner = new AsyncRunner(state, { TELEGRAM_BOT_TOKEN: "123456:test-token" });
  const response = await runner.fetch(
    new Request("https://async-runner.internal/bind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update: { update_id: 9001, message: { text: "hi" } } }),
    })
  );
  const body = await response.json();

  assert.equal(body.queued, true);
  assert.equal(state.alarms.length, 1);

  const duplicate = await runner.fetch(
    new Request("https://async-runner.internal/bind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update: { update_id: 9001, message: { text: "hi" } } }),
    })
  );

  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(state.storage.dump().get("bind:tasks").length, 1);
});

test("async runner: broadcast start, slicing and final report", async () => {
  const { AsyncRunner } = await import(runnerUrl);
  const state = createFakeState("broadcast");
  const runner = new AsyncRunner(state, { TELEGRAM_BOT_TOKEN: "123456:test-token" });
  const sent = [];
  const reports = [];
  const originals = {
    getBroadcastChatIds: botHandler.getBroadcastChatIds,
    sendBroadcastPayload: botHandler.sendBroadcastPayload,
    sendBroadcastReport: botHandler.sendBroadcastReport,
  };

  botHandler.getBroadcastChatIds = async () => ["1", "2", "3", "4"];
  botHandler.sendBroadcastPayload = async (chatId) => {
    sent.push(chatId);
  };
  botHandler.sendBroadcastReport = async (chatId, result) => {
    reports.push({ chatId, result });
  };

  try {
    const response = await runner.fetch(
      new Request("https://async-runner.internal/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "bcast-1",
          adminChatId: "42",
          payload: { kind: "text", text: " Salom" },
        }),
      })
    );
    const body = await response.json();

    assert.equal(body.queued, true);
    assert.equal(body.total, 4);

    let guard = 0;

    while (state.storage.dump().has("broadcast:job") && guard < 20) {
      guard += 1;
      await runner.alarm();
    }

    assert.equal(guard < 20, true, "broadcast must terminate");
    assert.deepEqual(sent, ["1", "2", "3", "4"]);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].chatId, "42");
    assert.equal(reports[0].result.total, 4);
    assert.equal(reports[0].result.sent, 4);

    const status = await runner.fetch(new Request("https://async-runner.internal/"));

    assert.equal((await status.json()).job, null);
  } finally {
    Object.assign(botHandler, originals);
  }
});

test("async runner: refuses a second concurrent broadcast", async () => {
  const { AsyncRunner } = await import(runnerUrl);
  const state = createFakeState("broadcast");
  const runner = new AsyncRunner(state, {});
  const originals = { getBroadcastChatIds: botHandler.getBroadcastChatIds };

  botHandler.getBroadcastChatIds = async () => ["1", "2"];

  try {
    const request = () =>
      new Request("https://async-runner.internal/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { kind: "text", text: "x" } }),
      });

    assert.equal((await runner.fetch(request())).status, 200);
    assert.equal((await runner.fetch(request())).status, 409);
  } finally {
    Object.assign(botHandler, originals);
  }
});

test("async runner: reports an empty audience instead of looping", async () => {
  const { AsyncRunner } = await import(runnerUrl);
  const state = createFakeState("broadcast");
  const runner = new AsyncRunner(state, {});
  const reports = [];
  const originals = {
    getBroadcastChatIds: botHandler.getBroadcastChatIds,
    sendBroadcastReport: botHandler.sendBroadcastReport,
  };

  botHandler.getBroadcastChatIds = async () => [];
  botHandler.sendBroadcastReport = async (chatId, result) => {
    reports.push({ chatId, result });
  };

  try {
    const response = await runner.fetch(
      new Request("https://async-runner.internal/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminChatId: "42", payload: { kind: "text", text: "x" } }),
      })
    );

    assert.equal((await response.json()).started, false);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].result.total, 0);
  } finally {
    Object.assign(botHandler, originals);
  }
});

test("worker prefers the Async Runner over the bind-info queue", async () => {
  const originalFetch = global.fetch;
  const queued = [];
  const runner = createRunnerStub();
  const worker = await import(`${workerUrl}?test=${Date.now()}-runner`);

  global.fetch = async () => telegramOk();

  try {
    const response = await worker.default.fetch(
      new Request("https://example.test/api/bot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify({
          update_id: 7777,
          message: {
            chat: { id: 7041, type: "private" },
            from: { id: 7041, first_name: "Ali" },
            text: "/info 1006613098 13019",
          },
        }),
      }),
      {
        TELEGRAM_BOT_TOKEN: "123456:test-token",
        TELEGRAM_WEBHOOK_SECRET: "test-secret",
        ASYNC_RUNNER: runner.namespace,
        BIND_INFO_QUEUE: {
          async send(payload) {
            queued.push(payload);
          },
        },
      },
      { waitUntil() {} }
    );

    assert.equal((await response.json()).queued, true);
    assert.equal(queued.length, 0, "queue must stay untouched when the runner is available");
    assert.equal(runner.submitted.length, 1);
    assert.match(runner.submitted[0].url, /\/bind$/);
    assert.equal(runner.submitted[0].body.update.__skip_bind_wait, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("worker falls back to the queue when the runner is unavailable", async () => {
  const originalFetch = global.fetch;
  const queued = [];
  const worker = await import(`${workerUrl}?test=${Date.now()}-fallback`);

  global.fetch = async () => telegramOk();

  try {
    const response = await worker.default.fetch(
      new Request("https://example.test/api/bot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify({
          update_id: 7778,
          message: {
            chat: { id: 7041, type: "private" },
            from: { id: 7041, first_name: "Ali" },
            text: "/info 1006613098 13019",
          },
        }),
      }),
      {
        TELEGRAM_BOT_TOKEN: "123456:test-token",
        TELEGRAM_WEBHOOK_SECRET: "test-secret",
        BIND_INFO_QUEUE: {
          async send(payload) {
            queued.push(payload);
          },
        },
      },
      { waitUntil() {} }
    );

    assert.equal((await response.json()).queued, true);
    assert.equal(queued.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("worker falls back to the queue when the runner rejects the task", async () => {
  const originalFetch = global.fetch;
  const queued = [];
  const worker = await import(`${workerUrl}?test=${Date.now()}-reject`);

  global.fetch = async () => telegramOk();

  try {
    const response = await worker.default.fetch(
      new Request("https://example.test/api/bot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify({
          update_id: 7779,
          message: {
            chat: { id: 7041, type: "private" },
            from: { id: 7041, first_name: "Ali" },
            text: "/info 1006613098 13019",
          },
        }),
      }),
      {
        TELEGRAM_BOT_TOKEN: "123456:test-token",
        TELEGRAM_WEBHOOK_SECRET: "test-secret",
        ASYNC_RUNNER: {
          idFromName(name) {
            return { name };
          },
          get() {
            return {
              async fetch() {
                return new Response(JSON.stringify({ ok: false }), { status: 429 });
              },
            };
          },
        },
        BIND_INFO_QUEUE: {
          async send(payload) {
            queued.push(payload);
          },
        },
      },
      { waitUntil() {} }
    );

    assert.equal((await response.json()).queued, true);
    assert.equal(queued.length, 1, "a busy runner must not silently drop the task");
  } finally {
    global.fetch = originalFetch;
  }
});

test("broadcast confirm dispatches to the Async Runner before the queue", async () => {
  const originalFetch = global.fetch;
  const runner = createRunnerStub();
  const queued = [];
  const calls = [];
  const adminId = "5081175125";

  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });

    if (String(url).includes("answerCallbackQuery") || String(url).includes("editMessageText")) {
      return telegramOk();
    }

    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 501, reply_markup: body?.reply_markup } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const env = {
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    ASYNC_RUNNER: runner.namespace,
    BROADCAST_QUEUE: {
      async send(payload) {
        queued.push(payload);
      },
    },
  };

  try {
    await botHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 8801,
          message: {
            chat: { id: 7041, type: "private" },
            from: { id: Number(adminId), first_name: "Admin" },
            text: "/message Salom hammaga",
          },
        },
      },
      createRes(),
      env,
      null
    );

    const confirmButton = calls
      .flatMap((call) => call.body?.reply_markup?.inline_keyboard || [])
      .flat()
      .find((button) => String(button.callback_data || "").startsWith("broadcast_confirm:"));

    assert.ok(confirmButton, "confirm button expected");

    const [, broadcastId, token] = String(confirmButton.callback_data).split(":");

    await botHandler(
      {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
        query: {},
        body: {
          update_id: 8802,
          callback_query: {
            id: "cb-1",
            data: `broadcast_confirm:${broadcastId}:${token}`,
            from: { id: Number(adminId), first_name: "Admin" },
            message: { message_id: 501, chat: { id: 7041, type: "private" } },
          },
        },
      },
      createRes(),
      env,
      null
    );

    assert.equal(queued.length, 0, "queue must stay untouched when the runner is available");
    assert.equal(runner.submitted.length, 1);
    assert.match(runner.submitted[0].url, /\/broadcast$/);
    assert.equal(runner.submitted[0].body.adminChatId, "7041");
    assert.equal(runner.submitted[0].body.payload.text, "Salom hammaga");
  } finally {
    global.fetch = originalFetch;
  }
});

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = JSON.stringify(payload);
      return this;
    },
    send(payload) {
      this.body = typeof payload === "string" ? payload : JSON.stringify(payload);
      return this;
    },
    end(payload = "") {
      if (payload) {
        this.send(payload);
      }

      return this;
    },
  };
}
