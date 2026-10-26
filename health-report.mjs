// Kunlik holat hisoboti: har kuni HEALTH_REPORT_TIME (Toshkent, default 23:50)
// da MAIN_GROUP_ID'ga yuboriladi. Alohida cron yo'q — webhook kuzatuvi cron'i
// (*/10) "monitor" DO'sida shu vaqtni tekshiradi. Manbalar:
//   - Telegram getWebhookInfo + kuzatuv holati (bugungi uzilishlar);
//   - Cloudflare GraphQL Analytics (so'rovlar, yiqilganlar, CPU limiti) —
//     CF_ANALYTICS_TOKEN + CF_ACCOUNT_ID secret'lari bo'lsa;
//   - bot xato/limit hisoblagichlari (isolate'lardan DO'ga yig'iladi);
//   - Supabase: ping, foydalanuvchilar, funksiyalar, DB hajmi.
import { escapeHtml, formatDuration } from "./webhook-monitor.mjs";
import { getTelegramTimeoutMs, safeJson } from "./worker-runtime.mjs";

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REPORT_TIME = "23:50";
const WORKERS_FREE_DAILY_REQUESTS = 100_000;
const SUPABASE_FREE_DB_BYTES = 500 * 1024 * 1024;
const SLOW_DB_PING_MS = 1500;
const COUNTERS_KEY_PREFIX = "health:counters:";
const LAST_REPORT_KEY = "health:last-report";
// Cloudflare statuslari: shular "yiqilgan" emas.
const OK_STATUSES = new Set(["success", "clientDisconnected"]);
const LIMIT_STATUSES = new Set(["exceededResources", "exceededCpu", "exceededMemory"]);

export function getTashkentDate(now = Date.now()) {
  return new Date(now + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

export function getTashkentDayStart(now = Date.now()) {
  const local = now + TASHKENT_OFFSET_MS;

  return local - (local % DAY_MS) - TASHKENT_OFFSET_MS;
}

function parseReportTime(value) {
  const match = String(value || DEFAULT_REPORT_TIME).match(/^(\d{1,2}):(\d{2})$/);
  const [hours, minutes] = match ? [Number(match[1]), Number(match[2])] : [23, 50];

  return Math.min(23, hours) * 60 + Math.min(59, minutes);
}

// Cron har 10 daqiqada chaqiradi: belgilangan vaqtdan keyingi birinchi
// tekshiruvda, kuniga bir marta. Belgi sana + vaqt sozlamasi: vaqt
// o'zgartirilsa (masalan sinov uchun), shu kunning o'zida yana yuboriladi.
export function getReportMark(now, env = {}) {
  return `${getTashkentDate(now)} ${env.HEALTH_REPORT_TIME || DEFAULT_REPORT_TIME}`;
}

export function isReportDue(now, env = {}, lastReportMark = null) {
  const minutesOfDay = Math.floor((now - getTashkentDayStart(now)) / 60000);

  return lastReportMark !== getReportMark(now, env) && minutesOfDay >= parseReportTime(env.HEALTH_REPORT_TIME);
}

// ---- Bot hisoblagichlari (xato / limit) ----

export function countersKey(now = Date.now()) {
  return `${COUNTERS_KEY_PREFIX}${getTashkentDate(now)}`;
}

export function mergeCounters(current = {}, delta = {}) {
  const merged = { errors: { ...(current.errors || {}) }, limits: { ...(current.limits || {}) } };

  for (const group of ["errors", "limits"]) {
    for (const [type, count] of Object.entries(delta[group] || {})) {
      merged[group][type] = (merged[group][type] || 0) + Number(count || 0);
    }
  }

  return merged;
}

// ---- Yig'ish ----

export async function collectHealthReport({ env = {}, storage, monitorState = {}, botDb, fetchImpl = fetch, now = Date.now() } = {}) {
  const dayStart = getTashkentDayStart(now);
  const [webhook, cloudflare, db, counters] = await Promise.all([
    getWebhookInfo(env, fetchImpl),
    getCloudflareStats(env, fetchImpl, { dayStart, now }),
    botDb ? botDb(new Date(now)).catch((error) => ({ ok: false, error: error.message })) : null,
    storage?.get(countersKey(now)),
  ]);

  return {
    date: getTashkentDate(now),
    botUsername: env.TELEGRAM_BOT_USERNAME || "",
    webhook,
    monitor: summarizeIncidents(monitorState, dayStart, now),
    cloudflare,
    db,
    counters: counters || { errors: {}, limits: {} },
  };
}

export function summarizeIncidents(state = {}, dayStart, now) {
  let count = 0;
  let downtimeMs = 0;

  for (const incident of state.incidents || []) {
    const start = Number(incident.start);
    const end = Number(incident.end) || now;

    if (end < dayStart) {
      continue;
    }

    count += 1;
    downtimeMs += end - Math.max(start, dayStart);
  }

  return { status: state.status === "down" ? "down" : "up", count, downtimeMs };
}

async function getWebhookInfo(env, fetchImpl) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const data = await fetchJson(fetchImpl, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`, {}, getTelegramTimeoutMs(env));

  return data?.ok ? data.result : null;
}

async function getCloudflareStats(env, fetchImpl, { dayStart, now }) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID || !env.WORKER_NAME) {
    return { configured: false };
  }

  // Free plan limiti 00:00 UTC da yangilanadi — akkaunt jami shu paytdan.
  const utcStart = now - (now % DAY_MS);
  const query = `query($account: String!, $script: String!, $from: Time!, $utcFrom: Time!, $to: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      script: workersInvocationsAdaptive(limit: 50, filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }) {
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP99 }
        dimensions { status }
      }
      account: workersInvocationsAdaptive(limit: 50, filter: { datetime_geq: $utcFrom, datetime_leq: $to }) {
        sum { requests }
      }
    } }
  }`;
  const data = await fetchJson(fetchImpl, "https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        account: env.CF_ACCOUNT_ID,
        script: env.WORKER_NAME,
        from: new Date(dayStart).toISOString(),
        utcFrom: new Date(utcStart).toISOString(),
        to: new Date(now).toISOString(),
      },
    }),
  }, 10000);
  const account = data?.data?.viewer?.accounts?.[0];

  if (!account) {
    return { configured: true, ok: false, error: data?.errors?.[0]?.message || "javob yo'q" };
  }

  const byStatus = {};
  let requests = 0;
  let cpuP50 = 0;
  let cpuP99 = 0;

  for (const row of account.script || []) {
    const count = Number(row.sum?.requests || 0);
    byStatus[row.dimensions?.status || "unknown"] = (byStatus[row.dimensions?.status || "unknown"] || 0) + count;
    requests += count;
    // Status bo'yicha guruhlar ichidan eng og'ir qiymat (taxminiy, lekin xavfsiz tomonda).
    cpuP50 = Math.max(cpuP50, Number(row.quantiles?.cpuTimeP50 || 0));
    cpuP99 = Math.max(cpuP99, Number(row.quantiles?.cpuTimeP99 || 0));
  }

  const failed = Object.entries(byStatus).filter(([status]) => !OK_STATUSES.has(status));
  const accountRequests = (account.account || []).reduce((sum, row) => sum + Number(row.sum?.requests || 0), 0);

  return {
    configured: true,
    ok: true,
    requests,
    success: requests - failed.reduce((sum, [, count]) => sum + count, 0),
    failed: Object.fromEntries(failed),
    limitHits: failed.filter(([status]) => LIMIT_STATUSES.has(status)).reduce((sum, [, count]) => sum + count, 0),
    cpuP50Ms: cpuP50 / 1000,
    cpuP99Ms: cpuP99 / 1000,
    accountRequests,
  };
}

async function fetchJson(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await safeJson(await fetchImpl(url, { ...init, signal: controller.signal }));
  } catch (error) {
    console.error("[HEALTH_REPORT_FETCH_ERROR]", url.split("/bot")[0], error?.message || error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---- Matn ----

export function getOverallStatus(report) {
  const webhookBroken = !report.webhook || !report.webhook.url || report.monitor.status === "down";

  if (webhookBroken || report.db?.ok === false) {
    return "red";
  }

  const cf = report.cloudflare;
  const warnings = [
    report.monitor.count > 0,
    cf?.ok && Object.keys(cf.failed).length > 0,
    sumValues(report.counters.limits) > 0,
    Number(report.db?.pingMs) > SLOW_DB_PING_MS,
    cf?.ok && cf.accountRequests > WORKERS_FREE_DAILY_REQUESTS * 0.8,
  ];

  return warnings.some(Boolean) ? "yellow" : "green";
}

export function formatHealthReport(report, { now = Date.now() } = {}) {
  const status = getOverallStatus(report);
  const statusLine = {
    green: "🟢 Hammasi joyida",
    yellow: "🟡 Ishlayapti, lekin e'tibor talab qiladi",
    red: "🔴 Muammo bor",
  }[status];
  const bot = report.botUsername ? `@${escapeHtml(report.botUsername)}` : "Bot";

  return [
    `📊 <b>${bot} — kunlik holat</b> (${escapeHtml(report.date)})`,
    statusLine,
    "",
    ...formatWebhookSection(report, now),
    "",
    ...formatCloudflareSection(report.cloudflare),
    "",
    ...formatBotSection(report),
    "",
    ...formatDbSection(report.db),
  ].join("\n");
}

function formatWebhookSection({ webhook, monitor }, now) {
  const lines = ["🔗 <b>Webhook</b>"];

  if (!webhook) {
    lines.push("getWebhookInfo javob bermadi");
    return lines;
  }

  lines.push(`Manzil: ${webhook.url ? escapeHtml(hostOf(webhook.url)) : "o'rnatilmagan ❗"} · navbat: <b>${formatNumber(webhook.pending_update_count || 0)}</b>`);

  if (webhook.last_error_date) {
    const ago = now - webhook.last_error_date * 1000;
    lines.push(`Oxirgi xato: ${escapeHtml(webhook.last_error_message || "noma'lum")} (${formatDuration(ago)} oldin)`);
  }

  lines.push(
    monitor.count
      ? `Bugungi uzilishlar: <b>${monitor.count}</b> ta, jami ~${formatDuration(monitor.downtimeMs)}`
      : "Bugungi uzilishlar: yo'q"
  );

  return lines;
}

function formatCloudflareSection(cf) {
  const lines = ["🌐 <b>Server (Cloudflare)</b>"];

  if (!cf?.configured) {
    lines.push("Sozlanmagan — CF_ANALYTICS_TOKEN / CF_ACCOUNT_ID secret'lari kerak");
    return lines;
  }

  if (!cf.ok) {
    lines.push(`Statistika olinmadi: ${escapeHtml(cf.error)}`);
    return lines;
  }

  const failedTotal = sumValues(cf.failed);
  lines.push(`So'rovlar: <b>${formatNumber(cf.requests)}</b> · ✅ ${formatNumber(cf.success)} · ❌ ${formatNumber(failedTotal)}`);

  if (failedTotal) {
    lines.push(`Yiqilganlar: ${Object.entries(cf.failed).map(([status, count]) => `${escapeHtml(status)} ${formatNumber(count)}`).join(", ")}`);
  }

  if (cf.limitHits) {
    lines.push(`⛔ CPU/xotira limitiga urilgan: <b>${formatNumber(cf.limitHits)}</b>`);
  }

  lines.push(`CPU: p50 ${cf.cpuP50Ms.toFixed(1)} ms · p99 ${cf.cpuP99Ms.toFixed(1)} ms`);
  lines.push(`Akkaunt limiti: ${formatNumber(cf.accountRequests)} / ${formatNumber(WORKERS_FREE_DAILY_REQUESTS)} (${percent(cf.accountRequests, WORKERS_FREE_DAILY_REQUESTS)}, 00:00 UTC dan)`);

  return lines;
}

function formatBotSection({ db, counters }) {
  const lines = ["🤖 <b>Bot</b>"];
  const actions = Array.isArray(db?.actions) ? db.actions : null;

  if (actions) {
    const total = actions.reduce((sum, entry) => sum + entry.count, 0);
    lines.push(`Muvaffaqiyatli amallar: <b>${formatNumber(total)}</b>`);
    // Belgilar bot.js'da allaqachon HTML-xavfsiz.
    lines.push(...actions.slice(0, 6).map((entry) => `  ${entry.label}: ${formatNumber(entry.count)}`));
  }

  const errorTotal = sumValues(counters.errors);
  const limitTotal = sumValues(counters.limits);
  lines.push(`Xatolar: <b>${formatNumber(errorTotal)}</b>${errorTotal ? ` (${topEntries(counters.errors)})` : ""}`);
  lines.push(`Limitga urilish: <b>${formatNumber(limitTotal)}</b>${limitTotal ? ` (${topEntries(counters.limits)})` : ""}`);

  return lines;
}

function formatDbSection(db) {
  const lines = ["🗄 <b>Baza (Supabase)</b>"];

  if (!db) {
    lines.push("Tekshirilmadi");
    return lines;
  }

  if (!db.ok) {
    lines.push(`❗ Ulanib bo'lmadi: ${escapeHtml(db.error || "noma'lum")}`);
    return lines;
  }

  lines.push(`Ping: ${formatNumber(db.pingMs)} ms${db.pingMs > SLOW_DB_PING_MS ? " 🐢" : ""}`);

  if (db.totalUsers !== null && db.totalUsers !== undefined) {
    lines.push(`Foydalanuvchilar: <b>${formatNumber(db.totalUsers)}</b>${db.newUsers !== undefined && db.newUsers !== null ? ` (+${formatNumber(db.newUsers)} bugun)` : ""}`);
  }

  if (db.dbBytes) {
    lines.push(`Hajmi: ${formatBytes(db.dbBytes)} / 500 MB (${percent(db.dbBytes, SUPABASE_FREE_DB_BYTES)})${db.connections ? ` · ulanishlar: ${db.connections}` : ""}`);
  } else if (db.dbHealthMissing) {
    lines.push("Hajmi: noma'lum (025_db_health.sql migratsiyasi kerak)");
  }

  return lines;
}

// ---- Yordamchilar ----

function sumValues(map = {}) {
  return Object.values(map).reduce((sum, value) => sum + Number(value || 0), 0);
}

function topEntries(map, limit = 3) {
  return Object.entries(map)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([type, count]) => `${escapeHtml(type)} ${formatNumber(count)}`)
    .join(", ");
}

function hostOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return String(url);
  }
}

function formatNumber(value) {
  return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function percent(part, whole) {
  const value = (Number(part) / whole) * 100;

  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export { COUNTERS_KEY_PREFIX, LAST_REPORT_KEY };
