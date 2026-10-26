// Telegram webhook kuzatuvi. Cron har 10 daqiqada getWebhookInfo'ni so'raydi
// va holat o'zgarganda (buzildi / tiklandi) ADMIN_IDS'ga yozadi. Ogohlantirish
// chiquvchi sendMessage bilan ketadi — webhook buzilgan bo'lsa ham yetib boradi.
// Holat "monitor" nomli AsyncRunner DO'sida saqlanadi (spam bo'lmasligi uchun).
import { getTelegramTimeoutMs, safeJson } from "./worker-runtime.mjs";

export const MONITOR_CRON = "*/10 * * * *";
export const MONITOR_RUNNER_NAME = "monitor";

export const MONITOR_STATE_KEY = "monitor:webhook";
const DEFAULT_PENDING_THRESHOLD = 50;
// Telegram ba'zan bir martalik "Read timeout" beradi — bitta yomon tekshiruv
// signal emas, ketma-ket ikkitasi kerak.
const BAD_CHECKS_BEFORE_ALERT = 2;
const REMIND_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_WINDOW_MS = 11 * 60 * 1000;
// Kunlik hisobot uchun uzilishlar tarixi (oxirgilari).
const MAX_INCIDENTS = 20;

export function getPendingThreshold(env = {}) {
  const value = Number(env.WEBHOOK_MONITOR_PENDING);

  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PENDING_THRESHOLD;
}

// Bitta tekshiruv natijasi: muammolar ro'yxati (bo'sh — hammasi joyida).
export function evaluateWebhookInfo(info, { lastCheckAt, now, pendingThreshold }) {
  if (!info) {
    return ["getWebhookInfo javob bermadi"];
  }

  const problems = [];

  if (!info.url) {
    problems.push("Webhook o'rnatilmagan");
  }

  const errorAt = Number(info.last_error_date || 0) * 1000;
  const since = Number(lastCheckAt) || now - FIRST_CHECK_WINDOW_MS;

  if (errorAt && errorAt > since) {
    problems.push(`Telegram xatosi: ${info.last_error_message || "noma'lum"}`);
  }

  const pending = Number(info.pending_update_count || 0);

  if (pending >= pendingThreshold) {
    problems.push(`Navbatda ${pending} ta update`);
  }

  return problems;
}

// Holat mashinasi: qanday xabar yuborish kerakligini va yangi holatni qaytaradi.
export function nextMonitorState(prev = {}, problems = [], now = Date.now()) {
  const state = {
    status: prev.status === "down" ? "down" : "up",
    badChecks: Number(prev.badChecks) || 0,
    firstBadAt: prev.firstBadAt || null,
    downSince: prev.downSince || null,
    lastAlertAt: prev.lastAlertAt || null,
    lastCheckAt: now,
    incidents: Array.isArray(prev.incidents) ? prev.incidents.map((item) => ({ ...item })) : [],
  };

  if (!problems.length) {
    const recovered = state.status === "down";
    const downSince = state.downSince;
    const open = state.incidents[state.incidents.length - 1];

    if (recovered && open && !open.end) {
      open.end = now;
    }

    return {
      state: { status: "up", badChecks: 0, firstBadAt: null, downSince: null, lastAlertAt: recovered ? now : state.lastAlertAt, lastCheckAt: now, incidents: state.incidents },
      alert: recovered ? { kind: "up", downSince } : null,
    };
  }

  state.badChecks += 1;
  state.firstBadAt = state.firstBadAt || now;

  if (state.status === "up") {
    if (state.badChecks < BAD_CHECKS_BEFORE_ALERT) {
      return { state, alert: null };
    }

    state.status = "down";
    state.downSince = state.firstBadAt;
    state.lastAlertAt = now;
    state.incidents = [...state.incidents, { start: state.downSince }].slice(-MAX_INCIDENTS);
    return { state, alert: { kind: "down", problems } };
  }

  if (now - Number(state.lastAlertAt || 0) >= REMIND_EVERY_MS) {
    state.lastAlertAt = now;
    return { state, alert: { kind: "still", problems, downSince: state.downSince } };
  }

  return { state, alert: null };
}

export function formatMonitorAlert(alert, { botUsername, now = Date.now() } = {}) {
  const bot = botUsername ? `@${escapeHtml(botUsername)}` : "Bot";
  const problems = (alert.problems || []).map((item) => `• ${escapeHtml(item)}`);

  if (alert.kind === "up") {
    return [
      `✅ <b>${bot} webhook tiklandi</b>`,
      alert.downSince ? `To'xtab turgan vaqt: ~${formatDuration(now - alert.downSince)}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    alert.kind === "still"
      ? `⚠️ <b>${bot} webhook hali ham ishlamayapti</b> (~${formatDuration(now - alert.downSince)})`
      : `🚨 <b>${bot} webhook ishlamayapti</b>`,
    "",
    ...problems,
  ].join("\n");
}

export async function runWebhookMonitor({ env = {}, storage, fetchImpl = fetch, now = Date.now() } = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN missing" };
  }

  const prev = (await storage?.get(MONITOR_STATE_KEY)) || {};
  const info = await getWebhookInfo(token, env, fetchImpl);
  const problems = evaluateWebhookInfo(info, {
    lastCheckAt: prev.lastCheckAt,
    now,
    pendingThreshold: getPendingThreshold(env),
  });
  const { state, alert } = nextMonitorState(prev, problems, now);

  await storage?.put(MONITOR_STATE_KEY, state);

  if (alert) {
    const text = formatMonitorAlert(alert, { botUsername: env.TELEGRAM_BOT_USERNAME, now });
    await sendToAdmins(text, token, env, fetchImpl);
  }

  return { ok: true, status: state.status, problems, alerted: alert?.kind || null, state };
}

async function getWebhookInfo(token, env, fetchImpl) {
  const data = await callTelegram(fetchImpl, token, "getWebhookInfo", null, env);

  return data?.ok ? data.result : null;
}

async function sendToAdmins(text, token, env, fetchImpl) {
  const adminIds = String(env.ADMIN_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const chatId of adminIds) {
    const data = await callTelegram(fetchImpl, token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }, env);

    if (!data?.ok) {
      console.error("[WEBHOOK_MONITOR_SEND_ERROR]", chatId, data?.description || "no response");
    }
  }
}

async function callTelegram(fetchImpl, token, method, payload, env) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTelegramTimeoutMs(env));

  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });

    return await safeJson(response);
  } catch (error) {
    console.error("[WEBHOOK_MONITOR_TELEGRAM_ERROR]", method, error?.message || error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatDuration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));

  if (minutes < 60) {
    return `${minutes} daqiqa`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest ? `${hours} soat ${rest} daqiqa` : `${hours} soat`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
}
