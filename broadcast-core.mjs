import botHandler from "./api/bot.js";

const DEFAULT_TUNING = {
  ratePerSec: 25,
  batchSize: 25,
  maxSendsPerRun: 40,
  runBudgetMs: 10 * 60 * 1000,
};

const MAX_SUBREQUESTS_PER_RUN = 45;
const MAX_RATE_LIMITED_TRACKED = 500;

function readBoundedInt(env, key, fallback, min, max) {
  const value = Number(env?.[key]);

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function getBroadcastTuning(env = {}) {
  const ratePerSec = readBoundedInt(
    env,
    "BROADCAST_RATE_PER_SEC",
    DEFAULT_TUNING.ratePerSec,
    1,
    30
  );
  const batchSize = readBoundedInt(
    env,
    "BROADCAST_BATCH_SIZE",
    DEFAULT_TUNING.batchSize,
    1,
    MAX_SUBREQUESTS_PER_RUN
  );

  return {
    ratePerSec,
    batchSize,
    maxSendsPerRun: readBoundedInt(
      env,
      "BROADCAST_MAX_SENDS_PER_RUN",
      DEFAULT_TUNING.maxSendsPerRun,
      batchSize,
      MAX_SUBREQUESTS_PER_RUN
    ),
    runBudgetMs: DEFAULT_TUNING.runBudgetMs,
  };
}

export function emptyBroadcastCounts() {
  return { sent: 0, blocked: 0, inactive: 0, initiate: 0, errors: 0 };
}

export function addBroadcastCounts(base, extra) {
  const result = emptyBroadcastCounts();

  for (const key of Object.keys(result)) {
    result[key] = Number(base?.[key] || 0) + Number(extra?.[key] || 0);
  }

  return result;
}

export function normalizeBroadcastJob(body = {}) {
  const source = body || {};

  return {
    id: String(source.id || source.broadcastId || ""),
    payload: source.payload || null,
    adminChatId: source.adminChatId ? String(source.adminChatId) : "",
    chatIds: Array.isArray(source.chatIds) ? source.chatIds.map(String) : [],
    total: Number(source.total) || 0,
    sent: Number(source.sent) || 0,
    blocked: Number(source.blocked) || 0,
    inactive: Number(source.inactive) || 0,
    initiate: Number(source.initiate) || 0,
    errors: Number(source.errors) || 0,
    rateLimited: Array.isArray(source.rateLimited) ? source.rateLimited.map(String) : [],
    cooldownUntil: Number(source.cooldownUntil) || 0,
    updatedAt: Number(source.updatedAt) || Date.now(),
  };
}

export function getTelegramRetryAfterSeconds(error) {
  const message = String(error?.message || error || "");
  const body = message.slice(message.indexOf("{"));
  const match = body.match(/"retry_after"\s*:\s*(\d+)/);

  if (!match) {
    return 0;
  }

  return Math.max(0, Math.min(300, Number(match[1]) || 0));
}

export function isTelegramRateLimitError(error) {
  const message = String(error?.message || error || "");
  return /HTTP\s+429/.test(message);
}

async function sendBroadcastOne(handler, chatId, payload) {
  try {
    await handler.sendBroadcastPayload(chatId, payload);
    return { category: "sent" };
  } catch (error) {
    if (isTelegramRateLimitError(error)) {
      return { category: "rate_limited", retryAfter: getTelegramRetryAfterSeconds(error) || 1 };
    }

    return { category: handler.categorizeBroadcastSendError(error) };
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBroadcastSlice(options = {}) {
  const handler = options.handler || botHandler;
  const tune = options.tune || getBroadcastTuning(options.env || {});
  const sleep = options.sleep || defaultSleep;
  const job = options.job || {};
  const payload = job.payload || null;
  const chatIds = Array.isArray(job.chatIds) ? job.chatIds.map(String) : [];
  const rateLimited = new Set(
    (Array.isArray(job.rateLimited) ? job.rateLimited : []).map(String)
  );
  const deadlineAt = Number(options.deadlineAt) || 0;

  const counts = emptyBroadcastCounts();
  const retryQueue = [];
  const newlyRateLimited = [];
  let cursor = 0;
  let handled = 0;
  let cooldownUntil = Math.max(0, Number(options.cooldownUntil) || 0);

  if (!payload || chatIds.length === 0) {
    return {
      chatIds: [],
      counts,
      handled: 0,
      cooldownUntil,
      rateLimited: [],
      finished: true,
    };
  }

  while (handled < tune.maxSendsPerRun) {
    if (deadlineAt && Date.now() >= deadlineAt) {
      break;
    }

    if (cooldownUntil > Date.now()) {
      break;
    }

    const size = Math.min(
      tune.batchSize,
      tune.maxSendsPerRun - handled,
      chatIds.length - cursor
    );

    if (size <= 0) {
      break;
    }

    const batch = chatIds.slice(cursor, cursor + size);
    cursor += size;
    handled += batch.length;

    const results = await Promise.allSettled(
      batch.map((chatId) => sendBroadcastOne(handler, chatId, payload))
    );

    let retryAfter = 0;

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        counts.errors += 1;
        return;
      }

      const outcome = result.value || {};
      const category = outcome.category;

      if (category === "rate_limited") {
        const chatId = batch[index];
        retryAfter = Math.max(retryAfter, Number(outcome.retryAfter) || 1);

        if (rateLimited.has(chatId)) {
          counts.errors += 1;
          return;
        }

        rateLimited.add(chatId);
        newlyRateLimited.push(chatId);
        retryQueue.push(chatId);
        return;
      }

      counts[counts[category] != null ? category : "errors"] += 1;
    });

    if (retryAfter > 0) {
      cooldownUntil = Date.now() + retryAfter * 1000;
    }

    const hasMore =
      chatIds.length - cursor > 0 || retryQueue.length > 0;

    if (!hasMore || handled >= tune.maxSendsPerRun || cooldownUntil > Date.now()) {
      break;
    }

    const paceMs = Math.round((batch.length / tune.ratePerSec) * 1000);

    if (paceMs > 0) {
      await sleep(paceMs);
    }
  }

  const remaining = retryQueue.concat(chatIds.slice(cursor));

  return {
    chatIds: remaining,
    counts,
    handled,
    cooldownUntil,
    rateLimited: newlyRateLimited,
    finished: remaining.length === 0,
  };
}

export function mergeBroadcastJob(job, slice, updates = {}) {
  const base = normalizeBroadcastJob(job);
  const totals = addBroadcastCounts(base, slice?.counts);
  const tracked = base.rateLimited.concat(
    Array.isArray(slice?.rateLimited) ? slice.rateLimited : []
  );

  return {
    ...base,
    ...totals,
    ...updates,
    chatIds: Array.isArray(slice?.chatIds) ? slice.chatIds : base.chatIds,
    rateLimited: tracked.slice(-MAX_RATE_LIMITED_TRACKED),
    cooldownUntil: Math.max(0, Number(slice?.cooldownUntil) || 0),
    updatedAt: Date.now(),
  };
}

export function getBroadcastResultFromJob(job) {
  const merged = normalizeBroadcastJob(job);

  return {
    total: merged.total,
    sent: merged.sent,
    blocked: merged.blocked,
    inactive: merged.inactive,
    initiate: merged.initiate,
    errors: merged.errors,
  };
}
