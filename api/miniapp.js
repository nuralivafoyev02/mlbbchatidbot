const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Config (same pattern as api/admin.js)
// ---------------------------------------------------------------------------
const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const COOKIE_NAME = "mlbb_miniapp_session";
const USERS_PAGE_SIZE = 20;

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = resolveServiceKey(process.env);
const ADMIN_PANEL_SECRET = (process.env.ADMIN_PANEL_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const ADMIN_IDS = parseIdList(process.env.ADMIN_IDS || "5081175125,7396686285");
const SUPPORT_USERNAME = (process.env.SUPPORT_USERNAME || "Ksava_org").replace(/^@/, "").trim();
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || "checkmlbbidBot").trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();

const DEFAULT_BIND_LIMIT = 10;
const DEFAULT_FULLINFO_QUOTA = 3;

// Premium emoji enrichment (same as bot.js)
let PREMIUM_EMOJIS = {};
try {
  const emojisRaw = fs.readFileSync(path.join(__dirname, "emojis.json"), "utf8");
  const emojisData = JSON.parse(emojisRaw);
  PREMIUM_EMOJIS = Object.freeze(emojisData.premium || {});
} catch (e) {
  console.error("[EMOJIS_LOAD_ERROR]", e.message);
}

function telegramEmoji(emoji, emojiId) {
  return `<tg-emoji emoji-id="${emojiId}">${emoji}</tg-emoji>`;
}

function enrichPremiumEmojis(text) {
  const sourceText = String(text ?? "");
  if (!sourceText) return sourceText;

  const protectedParts = [];
  const protectedText = sourceText.replace(
    /<(?:tg-emoji|code|pre)\b[^>]*>.*?<\/(?:tg-emoji|code|pre)>/gis,
    (match) => {
      const token = `__PROTECTED_${protectedParts.length}__`;
      protectedParts.push(match);
      return token;
    }
  );

  const enrichedText = Object.entries(PREMIUM_EMOJIS).reduce(
    (value, [emoji, emojiId]) => {
      if (!emojiId) return value;
      return value.split(emoji).join(telegramEmoji(emoji, emojiId));
    },
    protectedText
  );

  return protectedParts.reduce(
    (value, part, index) => value.replace(`__PROTECTED_${index}__`, part),
    enrichedText
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET" && !isApiAction(req)) {
      const session = readSession(req);
      const authed = session ? await isAuthed(session) : false;
      if (authed) {
        return serveApp(req, res);
      }
      return serveApp(req, res); // Login is handled client-side
    }

    if (req.method === "POST") {
      const body = parseBody(req.body);
      const action = String(body.action || req.query?.action || "");

      switch (action) {
        case "login":
          return handleLogin(req, res, body);
        case "logout":
          return handleLogout(req, res);
        case "get_stats":
          return handleGetStats(req, res);
        case "get_users":
          return handleGetUsers(req, res, body);
        case "search_users":
          return handleSearchUsers(req, res, body);
        case "get_user":
          return handleGetUser(req, res, body);
        case "update_user":
          return handleUpdateUser(req, res, body);
        case "get_settings":
          return handleGetSettings(req, res);
        case "update_settings":
          return handleUpdateSettings(req, res, body);
        case "get_admins":
          return handleGetAdmins(req, res);
        case "update_admins":
          return handleUpdateAdmins(req, res, body);
        case "check_api_status":
          return handleCheckApiStatus(req, res);
        default:
          return json(res, 400, { ok: false, error: "unknown_action" });
      }
    }

    return json(res, 405, { ok: false, error: "method_not_allowed" });
  } catch (error) {
    console.error("[MINIAPP_ERROR]", error);
    return json(res, 500, { ok: false, error: "server_error" });
  }
};

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
function readSession(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const value = cookies[COOKIE_NAME];
  if (!value) return null;
  const [payloadB64, signature] = value.split(".");
  if (!payloadB64 || !signature) return null;
  const payload = safeJsonParse(base64Decode(payloadB64));
  if (!payload || typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  const expected = sign(payloadB64);
  if (!timingSafeEqualStr(expected, signature)) return null;
  return payload;
}

function sign(value) {
  return crypto.createHmac("sha256", ADMIN_PANEL_SECRET).update(String(value)).digest("base64url");
}

function createSession(res) {
  const payloadB64 = base64Encode(JSON.stringify({ sub: DEFAULT_ADMIN_USER, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS }));
  const value = `${payloadB64}.${sign(payloadB64)}`;
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${value}; HttpOnly; Path=/; SameSite=Lax`);
  return value;
}

function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

async function isAuthed(session) {
  if (!session || session.sub !== DEFAULT_ADMIN_USER) return false;
  return true;
}

async function checkPassword(password) {
  try {
    const rows = await supabaseRequest(`/admin_settings?key=eq.admin_password&select=value&limit=1`);
    if (Array.isArray(rows) && rows.length > 0 && rows[0]?.value) {
      const { salt, hash } = rows[0].value;
      const candidate = crypto.createHash("sha256").update(String(salt) + ":" + String(password)).digest("hex");
      return timingSafeEqualStr(candidate, hash);
    }
    return timingSafeEqualStr(password, DEFAULT_ADMIN_PASSWORD);
  } catch {
    return timingSafeEqualStr(password, DEFAULT_ADMIN_PASSWORD);
  }
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------
async function handleLogin(req, res, body) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "").trim();
  if (username !== DEFAULT_ADMIN_USER) {
    return json(res, 401, { ok: false, error: "invalid_credentials" });
  }
  const valid = await checkPassword(password);
  if (!valid) {
    return json(res, 401, { ok: false, error: "invalid_credentials" });
  }
  createSession(res);
  return json(res, 200, { ok: true });
}

function handleLogout(req, res) {
  clearSession(res);
  return json(res, 200, { ok: true });
}

async function handleGetStats(req, res) {
  if (!(await requireAuth(req, res))) return;

  const stats = { totalUsers: 0, monthlyUsers: 0, dailyUsers: 0, todayActions: 0, totalActions: 0 };

  try {
    // Total users
    const totalResult = await supabaseRequest("/bot_users?select=user_id&limit=1", { prefer: "count=exact", returnMeta: true });
    stats.totalUsers = Number(totalResult.count) || 0;
  } catch (e) {
    console.error("[STATS_TOTAL]", e.message);
  }

  try {
    // Monthly active users
    const monthly = await supabaseRequest("/bot_monthly_active_users?select=month,active_users,updates&order=month.desc&limit=6");
    if (Array.isArray(monthly) && monthly.length > 0) {
      stats.monthlyUsers = Number(monthly[0].active_users) || 0;
      stats.monthlyHistory = monthly;
    }
  } catch (e) {
    console.error("[STATS_MONTHLY]", e.message);
  }

  try {
    // Today's active users (Tashkent timezone)
    const bounds = getTashkentDayBounds();
    const todayResult = await supabaseRequest(
      `/bot_users?select=user_id&last_seen_at=gte.${bounds.startIso}&last_seen_at=lt.${bounds.endIso}&limit=1`,
      { prefer: "count=exact", returnMeta: true }
    );
    stats.dailyUsers = Number(todayResult.count) || 0;
  } catch (e) {
    console.error("[STATS_DAILY]", e.message);
  }

  try {
    // Today's actions breakdown by type
    const bounds = getTashkentDayBounds();
    const allTodayEvents = await supabaseRequest(
      `/bot_usage_events?select=action&created_at=gte.${bounds.startIso}&created_at=lt.${bounds.endIso}&limit=5000`
    );
    const events = Array.isArray(allTodayEvents) ? allTodayEvents : [];
    stats.todayActions = events.length;
    const breakdown = {};
    events.forEach(function(e) {
      const a = e.action || "unknown";
      breakdown[a] = (breakdown[a] || 0) + 1;
    });
    stats.todayBreakdown = breakdown;
  } catch (e) {
    console.error("[STATS_ACTIONS]", e.message);
    stats.todayBreakdown = {};
  }

  try {
    // Total actions
    const totalActionsResult = await supabaseRequest("/bot_usage_events?select=id&limit=1", { prefer: "count=exact", returnMeta: true });
    stats.totalActions = Number(totalActionsResult.count) || 0;
  } catch (e) {
    console.error("[STATS_TOTAL_ACTIONS]", e.message);
  }

  return json(res, 200, { ok: true, data: stats });
}

async function handleGetUsers(req, res, body) {
  if (!(await requireAuth(req, res))) return;

  const page = Math.max(0, parseInt(body.page, 10) || 0);
  const offset = page * USERS_PAGE_SIZE;

  try {
    const params = new URLSearchParams();
    params.set("select", "user_id,chat_id,username,first_name,last_name,custom_bind_limit,full_info_quota,bind_info_checks_today,last_bind_info_check_date,updates_count,first_seen_at,last_seen_at");
    params.set("order", "last_seen_at.desc.nullslast");
    params.set("limit", String(USERS_PAGE_SIZE));
    params.set("offset", String(offset));

    const result = await supabaseRequest(`/bot_users?${params.toString()}`, { prefer: "count=exact", returnMeta: true });
    return json(res, 200, {
      ok: true,
      data: {
        users: Array.isArray(result.data) ? result.data : [],
        total: Number(result.count) || 0,
        page,
        pageSize: USERS_PAGE_SIZE,
      },
    });
  } catch (e) {
    console.error("[GET_USERS]", e.message);
    return json(res, 200, { ok: true, data: { users: [], total: 0, page, pageSize: USERS_PAGE_SIZE } });
  }
}

async function handleSearchUsers(req, res, body) {
  if (!(await requireAuth(req, res))) return;

  const query = String(body.query || "").trim();
  if (!query) {
    return handleGetUsers(req, res, body);
  }

  try {
    const params = new URLSearchParams();
    params.set("select", "user_id,chat_id,username,first_name,last_name,custom_bind_limit,full_info_quota,bind_info_checks_today,last_bind_info_check_date,updates_count,first_seen_at,last_seen_at");
    params.set("order", "last_seen_at.desc.nullslast");
    params.set("limit", "50");

    // Search by username, first_name, or user_id
    if (/^\d+$/.test(query)) {
      params.set("or", `(user_id.eq.${query},username.ilike.*${encodeURIComponent(query)}*)`);
    } else {
      params.set("or", `(username.ilike.*${encodeURIComponent(query)}*,first_name.ilike.*${encodeURIComponent(query)}*)`);
    }

    const result = await supabaseRequest(`/bot_users?${params.toString()}`, { returnMeta: true });
    return json(res, 200, {
      ok: true,
      data: {
        users: Array.isArray(result.data) ? result.data : [],
        total: Array.isArray(result.data) ? result.data.length : 0,
        query,
      },
    });
  } catch (e) {
    console.error("[SEARCH_USERS]", e.message);
    return json(res, 200, { ok: true, data: { users: [], total: 0, query } });
  }
}

async function handleGetUser(req, res, body) {
  if (!(await requireAuth(req, res))) return;

  const userId = String(body.user_id || "").trim();
  if (!userId) {
    return json(res, 400, { ok: false, error: "user_id_required" });
  }

  try {
    const data = await supabaseRequest(
      `/bot_users?user_id=eq.${encodeURIComponent(userId)}&select=user_id,chat_id,username,first_name,last_name,custom_bind_limit,full_info_quota,bind_info_checks_today,last_bind_info_check_date,updates_count,first_seen_at,last_seen_at,phone_number&limit=1`
    );

    if (!Array.isArray(data) || data.length === 0) {
      return json(res, 404, { ok: false, error: "user_not_found" });
    }

    // Also get today's usage events
    let todayActions = [];
    try {
      const bounds = getTashkentDayBounds();
      const events = await supabaseRequest(
        `/bot_usage_events?user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${bounds.startIso}&created_at=lt.${bounds.endIso}&select=action,created_at&order=created_at.desc&limit=50`
      );
      todayActions = Array.isArray(events) ? events : [];
    } catch (e) {
      console.error("[GET_USER_ACTIONS]", e.message);
    }

    return json(res, 200, { ok: true, data: { ...data[0], todayActions } });
  } catch (e) {
    console.error("[GET_USER]", e.message);
    return json(res, 500, { ok: false, error: "server_error" });
  }
}

async function handleUpdateUser(req, res, body) {
  if (!(await requireAuth(req, res))) return;

  const userId = String(body.user_id || "").trim();
  const bindLimit = body.custom_bind_limit !== undefined ? parseInt(body.custom_bind_limit, 10) : undefined;
  const fullInfoAmount = body.full_info_amount !== undefined ? parseInt(body.full_info_amount, 10) : undefined;

  if (!userId) {
    return json(res, 400, { ok: false, error: "user_id_required" });
  }

  const updates = {};

  // Bind limit: set directly and notify user
  if (bindLimit !== undefined && !isNaN(bindLimit)) {
    try {
      await supabaseRpc("set_custom_bind_limit", {
        p_target_user_id: toPgBigint(userId),
        p_new_limit: bindLimit,
      });
      updates.custom_bind_limit = bindLimit;
      // Notify user via Telegram
      void sendTelegramMessage(userId,
        "\u2705 <b>Limit yangilandi!</b>\n\nUlanmalarni tekshirish kunlik limitingiz <b>" + bindLimit + "</b> ta ga o'zgartirildi.").catch(function() {});
    } catch (e) {
      console.error("[UPDATE_BIND_LIMIT]", e.message);
      return json(res, 500, { ok: false, error: "bind_limit_update_failed", detail: e.message });
    }
  }

  // Full info quota: ADD amount to current quota
  if (fullInfoAmount !== undefined && !isNaN(fullInfoAmount) && fullInfoAmount > 0) {
    try {
      const result = await supabaseRpc("add_full_info_quota", {
        p_user_id: toPgBigint(userId),
        p_amount: fullInfoAmount,
      });
      updates.full_info_quota = result?.remaining || 0;
      // Notify user via Telegram
      void sendTelegramMessage(userId,
        "\uD83C\uDF89 <b>Tabriklayman!</b>\n\nSizga <b>" + fullInfoAmount + " ta</b> to'liq ma'lumot tekshirish uchun paket berildi.\n\uD83D\uDCE6 Sizda jami <b>" + updates.full_info_quota + "</b> ta tekshirish imkoni mavjud.").catch(function() {});
    } catch (e) {
      console.error("[UPDATE_FULLINFO_QUOTA]", e.message);
      return json(res, 500, { ok: false, error: "fullinfo_quota_update_failed", detail: e.message });
    }
  }

  return json(res, 200, { ok: true, data: updates });
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  const enriched = enrichPremiumEmojis(text);
  try {
    await fetchWithTimeout(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: enriched,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        timeoutMs: 5000,
      }
    );
  } catch (e) {
    console.error("[TELEGRAM_NOTIFY_ERROR]", e.message);
  }
}

async function handleGetSettings(req, res) {
  if (!(await requireAuth(req, res))) return;

  const settings = { defaultBindLimit: DEFAULT_BIND_LIMIT, defaultFullinfoQuota: DEFAULT_FULLINFO_QUOTA };

  try {
    const rows = await supabaseRequest("/admin_settings?key=eq.miniapp_settings&select=value&limit=1");
    if (Array.isArray(rows) && rows.length > 0 && rows[0]?.value) {
      Object.assign(settings, rows[0].value);
    }
  } catch (e) {
    console.error("[GET_SETTINGS]", e.message);
  }

  return json(res, 200, { ok: true, data: settings });
}

async function handleUpdateSettings(req, res, body) {
  if (!(await requireAuth(req, res))) return;

  const defaultBindLimit = parseInt(body.defaultBindLimit, 10);
  const defaultFullinfoQuota = parseInt(body.defaultFullinfoQuota, 10);

  const settings = {};
  if (!isNaN(defaultBindLimit) && defaultBindLimit >= 0) settings.defaultBindLimit = defaultBindLimit;
  if (!isNaN(defaultFullinfoQuota) && defaultFullinfoQuota >= 0) settings.defaultFullinfoQuota = defaultFullinfoQuota;

  try {
    await supabaseRequest("/admin_settings?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: { key: "miniapp_settings", value: settings },
    });
    return json(res, 200, { ok: true, data: settings });
  } catch (e) {
    console.error("[UPDATE_SETTINGS]", e.message);
    return json(res, 500, { ok: false, error: "settings_update_failed" });
  }
}

async function handleGetAdmins(req, res) {
  if (!(await requireAuth(req, res))) return;

  try {
    const rows = await supabaseRequest("/admin_settings?key=eq.admin_ids&select=value&limit=1");
    const ids = (Array.isArray(rows) && rows.length > 0 && rows[0]?.value?.ids) ? rows[0].value.ids : ADMIN_IDS;
    return json(res, 200, { ok: true, data: { adminIds: ids } });
  } catch {
    return json(res, 200, { ok: true, data: { adminIds: ADMIN_IDS } });
  }
}

async function handleUpdateAdmins(req, res, body) {
  if (!(await requireAuth(req, res))) return;

  const ids = Array.isArray(body.adminIds) ? body.adminIds.map(String).filter(Boolean) : [];
  try {
    await supabaseRequest("/admin_settings?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: { key: "admin_ids", value: { ids } },
    });
    return json(res, 200, { ok: true, data: { adminIds: ids } });
  } catch (e) {
    return json(res, 500, { ok: false, error: "admins_update_failed" });
  }
}

async function handleCheckApiStatus(req, res) {
  if (!(await requireAuth(req, res))) return;

  const status = { supabase: false, telegram: false, fullInfoApi: false, bindInfoApi: false };

  // Check Supabase
  try {
    await supabaseRequest("/bot_users?select=user_id&limit=1");
    status.supabase = true;
  } catch (e) {
    status.supabaseError = String(e.message || "").slice(0, 100);
  }

  // Check Telegram Bot API
  if (TELEGRAM_BOT_TOKEN) {
    try {
      const resp = await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, { timeoutMs: 5000 });
      const data = await resp.json();
      status.telegram = data.ok === true;
      if (data.ok && data.result) {
        status.botUsername = data.result.username;
        status.botName = data.result.first_name;
      }
    } catch (e) {
      status.telegramError = String(e.message || "").slice(0, 100);
    }
  }

  // Check Full Info API
  const fullInfoApiUrl = process.env.FULL_INFO_API || "https://api.jebray.com";
  try {
    const resp = await fetchWithTimeout(`${fullInfoApiUrl}/health`, { timeoutMs: 5000 });
    status.fullInfoApi = resp.ok;
    status.fullInfoApiUrl = fullInfoApiUrl;
  } catch (e) {
    status.fullInfoApiUrl = fullInfoApiUrl;
    status.fullInfoApiError = String(e.message || "").slice(0, 100);
  }

  // Check Bind Info API
  const bindInfoApiUrl = process.env.MLBB_BIND_INFO_API_URL || "";
  if (bindInfoApiUrl) {
    try {
      const resp = await fetchWithTimeout(bindInfoApiUrl, { timeoutMs: 5000 });
      status.bindInfoApi = resp.ok || resp.status < 500;
      status.bindInfoApiUrl = bindInfoApiUrl;
    } catch (e) {
      status.bindInfoApiUrl = bindInfoApiUrl;
      status.bindInfoApiError = String(e.message || "").slice(0, 100);
    }
  }

  return json(res, 200, { ok: true, data: status });
}

// ---------------------------------------------------------------------------
// Mini App HTML
// ---------------------------------------------------------------------------
function serveApp(req, res) {
  try {
    const htmlPath = path.join(__dirname, "miniapp.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    return res
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send(html);
  } catch (e) {
    console.error("[MINIAPP_HTML_ERROR]", e.message);
    return res
      .status(500)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send("<h1>Mini App HTML topilmadi</h1><p>api/miniapp.html fayli mavjud emas.</p>");
  }
}

function isApiAction(req) {
  return req.query && typeof req.query.action === "string";
}

// ---------------------------------------------------------------------------
// Supabase helpers (adapted from admin.js and bot.js)
// ---------------------------------------------------------------------------
async function supabaseRequest(path, options = {}) {
  const { method = "GET", body, prefer, returnMeta = false } = options;
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL not configured");
  if (!SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_SERVICE_KEY not configured");

  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}: ${String(text).slice(0, 200)}`);
  }

  const data = text ? safeJsonParse(text) ?? text : null;

  if (returnMeta) {
    return { data, count: parseContentRangeTotal(response.headers.get("content-range")) };
  }
  return data;
}

async function supabaseRpc(functionName, args) {
  return supabaseRequest(`/rpc/${encodeURIComponent(functionName)}`, { method: "POST", body: args });
}

function parseContentRangeTotal(contentRange) {
  const match = String(contentRange || "").match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return null;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : null;
}

function toPgBigint(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return String(Math.trunc(n));
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------
function getTashkentDayBounds(now = new Date()) {
  const tashkentOffsetMs = 5 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + tashkentOffsetMs);
  const startMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - tashkentOffsetMs;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { startMs, endMs, startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

function json(res, status, body) {
  return res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(body));
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  const raw = String(body);
  if (raw.charAt(0) === "{" || raw.charAt(0) === "[") {
    try { return JSON.parse(raw); } catch { /* fall */ }
  }
  const out = {};
  for (const part of raw.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) { out[safeDecode(part)] = ""; continue; }
    out[safeDecode(part.slice(0, eq))] = safeDecode(part.slice(eq + 1));
  }
  return out;
}

function safeDecode(value) {
  try { return decodeURIComponent(value.replace(/\+/g, " ")); } catch { return value; }
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) { try { out[k] = decodeURIComponent(v.join("=")); } catch { out[k] = v.join("="); } }
  }
  return out;
}

function base64Encode(value) { return Buffer.from(String(value), "utf8").toString("base64url"); }
function base64Decode(value) { return Buffer.from(value, "base64url").toString("utf8"); }
function safeJsonParse(value) { try { return JSON.parse(value); } catch { return null; } }

function timingSafeEqualStr(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function resolveServiceKey(env) {
  for (const key of [env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_KEY, env.SUPABASE_SECRET_KEY]) {
    if (key && String(key).trim()) return String(key).trim();
  }
  return "";
}

function parseIdList(value) {
  return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function safeErrorMessage(error) {
  try { return String(error?.message || error || "").slice(0, 220); } catch { return "xatolik"; }
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = 5000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...rest, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function requireAuth(req, res) {
  const session = readSession(req);
  if (!(await isAuthed(session))) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

