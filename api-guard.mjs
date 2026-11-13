// Ommaviy API (/v1) suiiste'mol kuzatuvi.
//
// public-api.mjs har isolate'da signallarni RAM'da yig'adi va ~30 s'da bir
// marta "monitor" AsyncRunner DO'siga (/api-guard) yuboradi. DO ularni
// daqiqalik bo'laklarda 10 daqiqa saqlaydi, qoidalarni tekshiradi va
// shubha aniqlansa MAIN_GROUP_ID + ADMIN_IDS'ga "bekor qilish" tugmasi bilan
// xabar yuboradi. Bir xil holat uchun qayta xabar — COOLDOWN'dan keyin.
import { getTelegramTimeoutMs, safeJson } from "./worker-runtime.mjs";
import { escapeHtml } from "./webhook-monitor.mjs";

export const GUARD_STATE_KEY = "api-guard";
export const REVOKE_CALLBACK_PREFIX = "apitok_revoke:";

const BUCKET_MS = 60 * 1000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_IPS = 30;
const MAX_ALERT_KEYS = 500;

export const GUARD_RULES = Object.freeze({
  rateAbuse: { limited: 10, cooldownMs: 60 * 60 * 1000 },
  rotation: { tokens: 3, tokensWhenLimited: 2, cooldownMs: 60 * 60 * 1000 },
  leak: { ips: 8, cooldownMs: 6 * 60 * 60 * 1000 },
  deadToken: { hits: 3, cooldownMs: 6 * 60 * 60 * 1000 },
  bruteforce: { bad: 15, cooldownMs: 60 * 60 * 1000 },
});

// ---------------------------------------------------------------------------
// Isolate tomonida yig'ish (public-api.mjs ishlatadi)
// ---------------------------------------------------------------------------
export function createGuardCollector() {
  let tokens = new Map();
  let ips = new Map();
  let dead = new Map();

  const ipEntry = (ip, country) => {
    let entry = ips.get(ip);
    if (!entry) {
      entry = { ip, country: country || null, tokens: new Set(), bad: 0 };
      ips.set(ip, entry);
    }
    return entry;
  };

  const tokenEntry = (map, info) => {
    let entry = map.get(info.id);
    if (!entry) {
      entry = { id: info.id, title: info.title || "", prefix: info.prefix || "", hits: 0, limited: 0, kind: info.kind, ips: new Set() };
      map.set(info.id, entry);
    }
    return entry;
  };

  return {
    // Tokeni to'g'ri so'rov (limited — 429 bo'ldimi).
    hit(info, ip, country, limited = false) {
      const entry = tokenEntry(tokens, info);
      entry.hits += 1;
      if (limited) entry.limited += 1;
      if (ip && entry.ips.size < MAX_IPS) entry.ips.add(ip);
      if (ip) ipEntry(ip, country).tokens.add(info.id);
    },
    // Bekor qilingan / muddati o'tgan token bilan kelgan so'rov.
    dead(info, ip) {
      const entry = tokenEntry(dead, info);
      entry.hits += 1;
      if (ip && entry.ips.size < MAX_IPS) entry.ips.add(ip);
    },
    // Mavjud bo'lmagan yoki noto'g'ri formatdagi token.
    bad(ip, country) {
      if (ip) ipEntry(ip, country).bad += 1;
    },
    isEmpty() {
      return !tokens.size && !ips.size && !dead.size;
    },
    drain() {
      const batch = {
        tokens: [...tokens.values()].map((t) => ({ ...t, ips: [...t.ips] })),
        dead: [...dead.values()].map((t) => ({ ...t, ips: [...t.ips] })),
        ips: [...ips.values()].map((i) => ({ ...i, tokens: [...i.tokens] })),
      };
      tokens = new Map();
      ips = new Map();
      dead = new Map();
      return batch;
    },
  };
}

// ---------------------------------------------------------------------------
// DO tomonida: oyna, qoidalar, xabar
// ---------------------------------------------------------------------------
export function mergeBatch(state = {}, batch = {}, now = Date.now()) {
  const bucketAt = now - (now % BUCKET_MS);
  const buckets = (state.buckets || []).filter((b) => b.at > now - WINDOW_MS);
  let bucket = buckets.find((b) => b.at === bucketAt);
  if (!bucket) {
    bucket = { at: bucketAt, tokens: {}, dead: {}, ips: {} };
    buckets.push(bucket);
  }

  for (const t of batch.tokens || []) mergeToken(bucket.tokens, t);
  for (const t of batch.dead || []) mergeToken(bucket.dead, t);
  for (const i of batch.ips || []) {
    const cur = bucket.ips[i.ip] || (bucket.ips[i.ip] = { ip: i.ip, country: i.country || null, tokens: [], bad: 0 });
    cur.bad += Number(i.bad) || 0;
    cur.tokens = union(cur.tokens, i.tokens);
    cur.country = cur.country || i.country || null;
  }

  return { ...state, buckets };
}

function mergeToken(target, t) {
  const cur = target[t.id] || (target[t.id] = { id: t.id, title: "", prefix: "", hits: 0, limited: 0, kind: t.kind, ips: [] });
  cur.title = t.title || cur.title;
  cur.prefix = t.prefix || cur.prefix;
  cur.kind = t.kind || cur.kind;
  cur.hits += Number(t.hits) || 0;
  cur.limited += Number(t.limited) || 0;
  cur.ips = union(cur.ips, t.ips).slice(0, MAX_IPS);
}

function union(a = [], b = []) {
  return [...new Set([...a, ...b])];
}

// Oynadagi barcha bo'laklarni bittaga yig'adi.
export function summarizeWindow(state = {}, now = Date.now()) {
  const tokens = {};
  const dead = {};
  const ips = {};
  for (const b of state.buckets || []) {
    if (b.at <= now - WINDOW_MS) continue;
    for (const t of Object.values(b.tokens || {})) mergeToken(tokens, t);
    for (const t of Object.values(b.dead || {})) mergeToken(dead, t);
    for (const i of Object.values(b.ips || {})) {
      const cur = ips[i.ip] || (ips[i.ip] = { ip: i.ip, country: i.country, tokens: [], bad: 0 });
      cur.bad += i.bad || 0;
      cur.tokens = union(cur.tokens, i.tokens);
    }
  }
  return { tokens, dead, ips };
}

export function detectIncidents(summary, rules = GUARD_RULES) {
  const incidents = [];
  const tokenInfo = (id) => summary.tokens[id] || { id, title: "", prefix: "" };

  for (const ip of Object.values(summary.ips)) {
    const used = ip.tokens.map(tokenInfo);
    const anyLimited = used.some((t) => t.limited > 0);
    if (used.length >= rules.rotation.tokens || (anyLimited && used.length >= rules.rotation.tokensWhenLimited)) {
      incidents.push({
        rule: "rotation",
        key: `rotation:${ip.ip}`,
        ip: ip.ip,
        country: ip.country,
        tokens: used,
        detail: `Bitta IP'dan ${used.length} ta token ishlatilmoqda${anyLimited ? ", ulardan biri limitga urilgan" : ""}`,
      });
    }

    if (ip.bad >= rules.bruteforce.bad) {
      incidents.push({
        rule: "bruteforce",
        key: `bruteforce:${ip.ip}`,
        ip: ip.ip,
        country: ip.country,
        tokens: [],
        detail: `${ip.bad} marta mavjud bo'lmagan token bilan urinish (token taxmin qilinayotgan bo'lishi mumkin)`,
      });
    }
  }

  for (const t of Object.values(summary.tokens)) {
    if (t.limited >= rules.rateAbuse.limited) {
      incidents.push({
        rule: "rateAbuse",
        key: `rateAbuse:${t.id}`,
        tokens: [t],
        ips: t.ips,
        detail: `10 daqiqada ${t.limited} marta limitdan oshdi (jami ${t.hits} so'rov)`,
      });
    }
    if (t.ips.length >= rules.leak.ips) {
      incidents.push({
        rule: "leak",
        key: `leak:${t.id}`,
        tokens: [t],
        ips: t.ips,
        detail: `${t.ips.length} ta turli IP'dan ishlatilmoqda — token oshkor bo'lgan bo'lishi mumkin`,
      });
    }
  }

  for (const t of Object.values(summary.dead)) {
    if (t.hits >= rules.deadToken.hits) {
      incidents.push({
        rule: "deadToken",
        key: `deadToken:${t.id}`,
        tokens: [],
        deadTokens: [t],
        ips: t.ips,
        detail: `${t.kind === "token_expired" ? "Muddati o'tgan" : "Bekor qilingan"} token bilan ${t.hits} marta so'rov yuborildi`,
      });
    }
  }

  return incidents;
}

const RULE_TITLES = {
  rotation: "Limitni chetlab o'tish (token rotatsiyasi)",
  bruteforce: "Token taxmin qilish (brute force)",
  rateAbuse: "Limitga qayta-qayta urilish",
  leak: "Token oshkor bo'lgan bo'lishi mumkin",
  deadToken: "Yaroqsiz token ishlatilmoqda",
};

export function formatIncident(incident, { botUsername } = {}) {
  const lines = [
    `🚨 <b>Ommaviy API: shubhali faollik</b>`,
    `<b>${escapeHtml(RULE_TITLES[incident.rule] || incident.rule)}</b>`,
    escapeHtml(incident.detail),
    "",
  ];

  if (incident.ip) {
    lines.push(`🌐 IP: <code>${escapeHtml(incident.ip)}</code>${incident.country ? ` (${escapeHtml(incident.country)})` : ""}`);
  } else if (incident.ips?.length) {
    const shown = incident.ips.slice(0, 5).map((ip) => `<code>${escapeHtml(ip)}</code>`).join(", ");
    lines.push(`🌐 IP: ${shown}${incident.ips.length > 5 ? ` va yana ${incident.ips.length - 5} ta` : ""}`);
  }

  for (const t of [...(incident.tokens || []), ...(incident.deadTokens || [])]) {
    const label = t.title ? escapeHtml(t.title) : "nomsiz";
    lines.push(`🔑 #${escapeHtml(t.id)} · ${label}${t.prefix ? ` · <code>${escapeHtml(t.prefix)}</code>` : ""} · ${t.hits} so'rov${t.limited ? `, ${t.limited} ta 429` : ""}`);
  }

  lines.push("", "<i>Oxirgi 10 daqiqa bo'yicha.</i>");
  if (incident.tokens?.length) {
    lines.push("<i>Tugma faqat adminlar uchun; bekor qilish 1 daqiqada kuchga kiradi.</i>");
  }
  if (botUsername) lines.push(`<i>@${escapeHtml(botUsername)}</i>`);
  return lines.join("\n");
}

export function incidentKeyboard(incident) {
  const rows = (incident.tokens || []).slice(0, 5).map((t) => [{
    text: `⛔ #${t.id}${t.title ? ` ${String(t.title).slice(0, 24)}` : ""} — bekor qilish`,
    callback_data: `${REVOKE_CALLBACK_PREFIX}${t.id}`,
    style: "danger",
  }]);
  return rows.length ? { inline_keyboard: rows } : null;
}

// DO ichida: batch qo'shiladi, yangi holatlar uchun xabar yuboriladi.
export async function runApiGuard({ env = {}, storage, batch, fetchImpl = fetch, now = Date.now() } = {}) {
  const prev = (await storage?.get(GUARD_STATE_KEY)) || {};
  const state = mergeBatch(prev, batch, now);
  const incidents = detectIncidents(summarizeWindow(state, now));

  const alerted = { ...(state.alerted || {}) };
  const fresh = incidents.filter((inc) => {
    const cooldown = GUARD_RULES[inc.rule]?.cooldownMs || 60 * 60 * 1000;
    return !(alerted[inc.key] && now - alerted[inc.key] < cooldown);
  });

  for (const inc of fresh) alerted[inc.key] = now;
  state.alerted = pruneAlerted(alerted, now);
  await storage?.put(GUARD_STATE_KEY, state);

  for (const inc of fresh) {
    await sendIncident(inc, env, fetchImpl);
  }

  return { ok: true, incidents: incidents.length, alerted: fresh.map((i) => i.key) };
}

function pruneAlerted(alerted, now) {
  const entries = Object.entries(alerted).filter(([, at]) => now - at < 24 * 60 * 60 * 1000);
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, MAX_ALERT_KEYS));
}

export function guardRecipients(env = {}) {
  const ids = [env.MAIN_GROUP_ID, ...String(env.ADMIN_IDS || "").split(",")]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

async function sendIncident(incident, env, fetchImpl) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[API_GUARD] TELEGRAM_BOT_TOKEN missing");
    return;
  }

  const text = formatIncident(incident, { botUsername: env.TELEGRAM_BOT_USERNAME });
  const keyboard = incidentKeyboard(incident);

  for (const chatId of guardRecipients(env)) {
    const payload = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
    if (keyboard) payload.reply_markup = keyboard;

    let data = await callTelegram(fetchImpl, token, "sendMessage", payload, env);
    // Rangli tugma rad etilsa — oddiy tugma bilan qayta.
    if (!data?.ok && keyboard && /button|style|reply markup/i.test(String(data?.description))) {
      payload.reply_markup = { inline_keyboard: keyboard.inline_keyboard.map((row) => row.map(({ style, ...rest }) => rest)) };
      data = await callTelegram(fetchImpl, token, "sendMessage", payload, env);
    }
    if (!data?.ok) {
      console.error("[API_GUARD_SEND_ERROR]", chatId, data?.description || "no response");
    }
  }
}

async function callTelegram(fetchImpl, token, method, payload, env) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTelegramTimeoutMs(env));
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return await safeJson(response);
  } catch (error) {
    console.error("[API_GUARD_TELEGRAM_ERROR]", method, error?.message || error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
