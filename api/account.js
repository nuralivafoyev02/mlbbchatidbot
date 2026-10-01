// ---------------------------------------------------------------------------
// 🎮 Mening akkauntim — foydalanuvchining shaxsiy Telegram Mini App'i.
//
// GET  → account-miniapp.html (Mini App)
// POST → { action, initData, ... } JSON API
//
// Autentifikatsiya: Telegram WebApp initData imzosi (TELEGRAM_BOT_TOKEN).
// Arena JWT faqat serverda ochiladi (user_accounts.ml_token) va hech qachon
// brauzerga yuborilmaydi; har bir so'rov rowId bo'yicha egasiga tekshiriladi
// (Supabase RPC'lar user_id + row id juftligi bilan ishlaydi).
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const arena = require("./_mlbb-arena.js");

const SUPPORTED_LANGS = ["uz", "ru", "en"];
const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

function cleanEnv(value) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function getConfig() {
  return {
    botToken: cleanEnv(process.env.TELEGRAM_BOT_TOKEN),
    botUsername: cleanEnv(process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME).replace(/^@/, ""),
    supabaseUrl: cleanEnv(process.env.SUPABASE_URL).replace(/\/+$/, ""),
    supabaseKey: resolveServiceKey(process.env),
    arenaUrl: cleanEnv(process.env.MLBB_ARENA_API_URL) || arena.DEFAULT_ARENA_API_URL,
    arenaTimeoutMs: Number(process.env.MLBB_ARENA_TIMEOUT_MS) > 0 ? Number(process.env.MLBB_ARENA_TIMEOUT_MS) : 12000,
    linkSecret: arena.resolveLinkSecret(process.env),
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return serveApp(res);
    }

    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "method_not_allowed" });
    }

    const config = getConfig();
    const body = parseBody(req.body);
    const auth = arena.verifyTelegramInitData(
      body.initData || req.headers?.["x-telegram-init-data"],
      config.botToken,
      { maxAgeSec: INIT_DATA_MAX_AGE_SEC }
    );

    if (!auth.ok) {
      return json(res, 401, { ok: false, error: "unauthorized" });
    }

    if (!config.supabaseUrl || !config.supabaseKey) {
      return json(res, 503, { ok: false, error: "not_configured" });
    }

    const ctx = { config, user: auth.user, body };
    const action = String(body.action || "");

    switch (action) {
      case "bootstrap":
        return await handleBootstrap(res, ctx);
      case "overview":
        return await withSession(res, ctx, handleOverview);
      case "matches":
        return await withSession(res, ctx, handleMatches);
      case "match_detail":
        return await withSession(res, ctx, handleMatchDetail);
      case "heroes":
        return await withSession(res, ctx, handleHeroes);
      case "hero_matches":
        return await withSession(res, ctx, handleHeroMatches);
      case "friends":
        return await withSession(res, ctx, handleFriends);
      case "privacy_set":
        return await withSession(res, ctx, handlePrivacySet);
      case "logout":
        return await handleLogout(res, ctx);
      default:
        return json(res, 400, { ok: false, error: "unknown_action" });
    }
  } catch (error) {
    console.error("[ACCOUNT_APP_ERROR]", error?.message || error);
    return json(res, 500, { ok: false, error: "server_error" });
  }
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function handleBootstrap(res, { config, user }) {
  const [accounts, lang] = await Promise.all([
    supabaseRpc(config, "list_user_accounts", { p_user_id: String(user.id) }),
    loadPreferredLanguage(config, user),
  ]);
  const list = (Array.isArray(accounts) ? accounts : []).map((acc) => ({
    id: String(acc.id),
    account_id: String(acc.account_id),
    zone_id: String(acc.zone_id),
    ml_linked: Boolean(acc.ml_linked),
    ml_nickname: acc.ml_nickname || null,
    ml_linked_at: acc.ml_linked_at || null,
  }));

  return json(res, 200, {
    ok: true,
    lang,
    botUsername: config.botUsername || null,
    user: { id: String(user.id), first_name: user.first_name || "", photo_url: user.photo_url || null },
    accounts: list,
  });
}

async function handleOverview(res, { client, token, lang, link }) {
  const [info, stats, seasons, privacy] = await Promise.allSettled([
    client.getInfo(token, lang),
    client.getStats(token, lang),
    client.getSeasons(token, lang),
    client.getPrivacy(token, lang),
  ]);

  // Sessiya yaroqsiz bo'lsa — barchasi unauthorized bilan tushadi.
  const failures = [info, stats, seasons, privacy].filter((r) => r.status === "rejected");
  const unauthorized = failures.find((r) => r.reason?.reason === "unauthorized");
  if (unauthorized && info.status === "rejected") {
    throw unauthorized.reason;
  }

  if (info.status === "rejected" && stats.status === "rejected") {
    throw info.reason;
  }

  const infoData = info.status === "fulfilled" ? info.value || {} : null;
  const isUnavailable = (result) => result.status === "rejected" && result.reason?.reason === "unavailable";
  const seasonList = seasons.status === "fulfilled" ? seasons.value : [];

  return json(res, 200, {
    ok: true,
    account: publicLink(link),
    info: infoData,
    rank: infoData ? arena.formatRankLevel(infoData.rank_level) : null,
    highestRank: infoData ? arena.formatRankLevel(infoData.history_rank_level) : null,
    stats: stats.status === "fulfilled" ? stats.value || {} : null,
    seasons: seasonList.length ? seasonList : (Array.isArray(stats.value?.sids) ? stats.value.sids : []),
    privacy: privacy.status === "fulfilled" ? privacy.value || null : null,
    // Moonton tomonidan o'chirilgan bo'limlar — UI "vaqtincha mavjud emas" deb ko'rsatadi.
    unavailable: {
      stats: isUnavailable(stats),
      seasons: isUnavailable(seasons),
      privacy: isUnavailable(privacy),
    },
  });
}

async function handleMatches(res, { client, token, lang, body }) {
  const data = await client.getMatches(token, { sid: body.sid, limit: body.limit || 10, cursor: body.cursor, lang });
  return json(res, 200, { ok: true, data: data || {} });
}

async function handleMatchDetail(res, { client, token, lang, body }) {
  const data = await client.getMatchDetail(token, { matchId: body.matchId, sid: body.sid, lang });
  return json(res, 200, { ok: true, data: data || {} });
}

async function handleHeroes(res, { client, token, lang, body }) {
  const data = await client.getFrequentHeroes(token, { sid: body.sid, limit: body.limit || 20, cursor: body.cursor, lang });
  return json(res, 200, { ok: true, data: data || {} });
}

async function handleHeroMatches(res, { client, token, lang, body }) {
  const data = await client.getMatchesByHero(token, { heroId: body.heroId, sid: body.sid, limit: body.limit || 10, cursor: body.cursor, lang });
  return json(res, 200, { ok: true, data: data || {} });
}

async function handleFriends(res, { client, token, lang, body }) {
  const data = await client.getFriends(token, { sid: body.sid, lang });
  return json(res, 200, { ok: true, data: data || {} });
}

async function handlePrivacySet(res, { client, token, lang, body }) {
  const data = await client.setPrivacy(token, body.visible === true || body.visible === "true", lang);
  return json(res, 200, { ok: true, data: data || null });
}

// Logout: Arena sessiyasini yopamiz (xato bo'lsa ham) va tokenni o'chiramiz.
// Akkaunt "Mening profilim" ro'yxatida qoladi.
async function handleLogout(res, { config, user, body }) {
  const rowId = parseRowId(body.rowId);
  if (!rowId) {
    return json(res, 400, { ok: false, error: "invalid_account" });
  }

  const link = await supabaseRpc(config, "get_user_account_ml_link", { p_user_id: String(user.id), p_row_id: rowId });
  if (!link || link.ok !== true) {
    return json(res, 404, { ok: false, error: "not_found" });
  }

  const token = arena.openArenaToken(link.ml_token, config.linkSecret);
  if (token) {
    try {
      await createClient(config).logout(token);
    } catch (error) {
      console.error("[ACCOUNT_APP_LOGOUT_ARENA]", error?.message);
    }
  }

  const cleared = await supabaseRpc(config, "clear_user_account_ml_link", { p_user_id: String(user.id), p_row_id: rowId });
  return json(res, 200, { ok: Boolean(cleared && cleared.ok === true) });
}

// rowId → egasini tekshirish → tokenni ochish → handler. Arena xatolari
// clientga do'stona kodlar bilan qaytariladi.
async function withSession(res, { config, user, body }, handlerFn) {
  const rowId = parseRowId(body.rowId);
  if (!rowId) {
    return json(res, 400, { ok: false, error: "invalid_account" });
  }

  const link = await supabaseRpc(config, "get_user_account_ml_link", { p_user_id: String(user.id), p_row_id: rowId });
  if (!link || link.ok !== true) {
    return json(res, 404, { ok: false, error: "not_found" });
  }

  const token = arena.openArenaToken(link.ml_token, config.linkSecret);
  if (!token) {
    return json(res, 409, { ok: false, error: "not_linked" });
  }

  const lang = SUPPORTED_LANGS.includes(body.lang) ? body.lang : "en";

  try {
    return await handlerFn(res, { client: createClient(config), token, lang, body, link });
  } catch (error) {
    if (error instanceof arena.ArenaError) {
      const status = { unauthorized: 401, invalid_input: 400, rate_limit: 429, timeout: 504, unavailable: 503 }[error.reason] || 502;
      const code = error.reason === "unauthorized" ? "session_expired" : error.reason;
      console.error("[ACCOUNT_APP_ARENA]", error.message);
      return json(res, status, { ok: false, error: code });
    }
    throw error;
  }
}

function publicLink(link) {
  return {
    id: String(link.id),
    account_id: String(link.account_id),
    zone_id: String(link.zone_id),
    ml_nickname: link.ml_nickname || null,
    ml_linked_at: link.ml_linked_at || null,
  };
}

function createClient(config) {
  return arena.createArenaClient({ baseUrl: config.arenaUrl, timeoutMs: config.arenaTimeoutMs });
}

function parseRowId(value) {
  const text = String(value ?? "").trim();
  return /^\d{1,19}$/.test(text) ? text : null;
}

async function loadPreferredLanguage(config, user) {
  try {
    const rows = await supabaseRequest(config, `/bot_users?user_id=eq.${encodeURIComponent(String(user.id))}&select=preferred_language&limit=1`);
    const stored = Array.isArray(rows) ? rows[0]?.preferred_language : null;
    if (SUPPORTED_LANGS.includes(stored)) return stored;
  } catch (error) {
    console.error("[ACCOUNT_APP_LANG]", error?.message);
  }

  const code = String(user.language_code || "").toLowerCase();
  if (code.startsWith("ru")) return "ru";
  if (code.startsWith("en")) return "en";
  return "uz";
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
function serveApp(res) {
  try {
    const html = fs.readFileSync(path.join(__dirname, "account-miniapp.html"), "utf8");
    return res
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send(html);
  } catch (error) {
    console.error("[ACCOUNT_APP_HTML]", error?.message);
    return res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8").send("account-miniapp.html topilmadi");
  }
}

// ---------------------------------------------------------------------------
// Supabase / util
// ---------------------------------------------------------------------------
async function supabaseRequest(config, urlPath, { method = "GET", body } = {}) {
  const headers = {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/rest/v1${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}: ${String(text).slice(0, 200)}`);
  }
  return text ? safeJsonParse(text) : null;
}

function supabaseRpc(config, name, args) {
  return supabaseRequest(config, `/rpc/${encodeURIComponent(name)}`, { method: "POST", body: args });
}

function resolveServiceKey(env) {
  for (const key of [env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_KEY, env.SUPABASE_SECRET_KEY]) {
    if (key && String(key).trim()) return String(key).trim();
  }
  return "";
}

function json(res, status, payload) {
  return res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "no-store")
    .send(JSON.stringify(payload));
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  return safeJsonParse(String(body)) || {};
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
