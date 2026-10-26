// bot.js xato/limit hisoblagichlari har isolate xotirasida (global
// __MLBB_BOT_STATS__) turadi. Har so'rov oxirida faqat yangi qo'shilganini
// (delta) "monitor" DO'siga yuboramiz — kunlik hisobot shu yig'indidan.
// Bir isolate'da parallel so'rovlar bo'lsa ham jami to'g'ri: "flushed" umumiy.
import { MONITOR_RUNNER_NAME } from "./webhook-monitor.mjs";

const RUNNER_URL = "https://async-runner.internal/health-counters";
const flushed = { errors: {}, limits: {} };

export function takeHealthDelta(stats = globalThis.__MLBB_BOT_STATS__) {
  const delta = { errors: {}, limits: {} };
  let changed = false;
  const sources = { errors: stats?.errorCounts || {}, limits: stats?.limitCounts || {} };

  for (const group of ["errors", "limits"]) {
    for (const [type, value] of Object.entries(sources[group])) {
      const diff = Number(value || 0) - Number(flushed[group][type] || 0);

      if (diff > 0) {
        delta[group][type] = diff;
        flushed[group][type] = Number(value);
        changed = true;
      }
    }
  }

  return changed ? delta : null;
}

// Yuborilmay qolgan delta keyingi safar qayta yuborilishi uchun qaytariladi.
function restoreDelta(delta) {
  for (const group of ["errors", "limits"]) {
    for (const [type, diff] of Object.entries(delta[group])) {
      flushed[group][type] = Number(flushed[group][type] || 0) - diff;
    }
  }
}

export async function flushHealthCounters(env) {
  const namespace = env?.ASYNC_RUNNER;
  const delta = takeHealthDelta();

  if (!delta) {
    return;
  }

  if (!namespace || typeof namespace.idFromName !== "function") {
    restoreDelta(delta);
    return;
  }

  try {
    const stub = namespace.get(namespace.idFromName(MONITOR_RUNNER_NAME));
    const response = await stub.fetch(RUNNER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delta }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    restoreDelta(delta);
    console.error("[HEALTH_COUNTERS_FLUSH_ERROR]", error?.message || error);
  }
}

export function __resetFlushedForTests() {
  flushed.errors = {};
  flushed.limits = {};
}
