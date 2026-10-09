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
const shop = require("./_shop.js");
const limitPrices = require("./_limit-prices.js");
const { createShopNotifier, buildFirstmailBuyText, buildLimitBuyText } = require("./_shop-notify.js");
const { injectTelegramShell } = require("./_tg-shell.js");

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
      return isCabinetRequest(req) ? serveCabinet(res) : serveApp(res);
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
      // Shaxsiy kabinet (?view=cabinet)
      case "cabinet":
        return await handleCabinet(res, ctx);
      case "account_add":
        return await handleAccountAdd(res, ctx);
      case "account_remove":
        return await handleAccountRemove(res, ctx);
      case "ml_send_code":
        return await handleMlSendCode(res, ctx);
      case "ml_verify":
        return await handleMlVerify(res, ctx);
      case "firstmails":
        return await handleFirstmails(res, ctx);
      case "buy_limit":
        return await handleBuyLimit(res, ctx);
      case "buy_firstmail":
        return await handleBuyFirstmail(res, ctx);
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
// 👤 Shaxsiy kabinet (?view=cabinet)
//
// Botdagi "Mening profilim" postidagi web_app tugmasi ochadi: limitlar,
// akkauntlar, kimlar tekshirgani, limitlar tarixi, MLBB'ga ulash, limit
// narxlari va Firstmail xaridi. To'lov hozircha qo'lda — xarid so'rovi
// do'kon egasiga boradi (api/_shop-notify.js).
// ---------------------------------------------------------------------------
const CABINET_HISTORY_LIMIT = 50;
const CABINET_FIRSTMAIL_PAGE = 30; // Do'kon: pastga aylantirganda 30 tadan
const ACCOUNT_MAX_COUNT = 5;
const ML_VC_KEY_PREFIX = "ml_vc:";
const ML_CODE_MAX_ATTEMPTS = 5;
const ML_CODE_TTL_MS = 5 * 60 * 1000;
const ML_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
const DEFAULT_ADMIN_IDS = "5081175125,8500085987,7396686285";

function storeRequest(config) {
  return (urlPath, options) => supabaseRequest(config, urlPath, options);
}

function isAdminUser(userId) {
  return String(process.env.ADMIN_IDS || DEFAULT_ADMIN_IDS)
    .split(/[\s,]+/)
    .includes(String(userId));
}

// Bitta bo'lim yiqilsa butun kabinet yiqilmasin — o'rniga null.
async function settle(promise, label) {
  try {
    return await promise;
  } catch (error) {
    console.error(`[CABINET_${label}]`, error?.message);
    return null;
  }
}

function quotaNumber(result) {
  return result && typeof result.remaining === "number" ? result.remaining : null;
}

function publicAccount(acc) {
  return {
    id: String(acc.id),
    account_id: String(acc.account_id),
    zone_id: String(acc.zone_id),
    created_at: acc.created_at || null,
    ml_linked: Boolean(acc.ml_linked),
    ml_nickname: acc.ml_nickname || null,
    ml_linked_at: acc.ml_linked_at || null,
  };
}

function publicViewer(event) {
  return {
    id: String(event.id),
    account_id: String(event.account_id || ""),
    zone_id: String(event.zone_id || ""),
    checker_id: event.checker_user_id ? String(event.checker_user_id) : null,
    checker_username: event.checker_username || null,
    checker_name: event.checker_first_name || null,
    action: event.action || "server_check",
    created_at: event.created_at || null,
  };
}

function publicHistory(row) {
  return {
    id: String(row.id),
    kind: row.kind,
    delta: Number(row.delta) || 0,
    source: row.source || "use",
    account_id: row.account_id || null,
    zone_id: row.zone_id || null,
    target: row.target || null,
    remaining: typeof row.remaining === "number" ? row.remaining : null,
    created_at: row.created_at || null,
  };
}

function publicFirstmail(item) {
  return {
    id: item.id,
    email: shop.maskShopEmail(item.email),
    price: shop.parseShopPriceNumber(item.price) || null,
    price_text: shop.formatShopPrice(item.price) || "",
    note: item.note || "",
  };
}

async function listUserAccounts(config, userId) {
  const rows = await supabaseRpc(config, "list_user_accounts", { p_user_id: String(userId) });
  return (Array.isArray(rows) ? rows : []).map(publicAccount);
}

async function handleCabinet(res, { config, user }) {
  const userId = String(user.id);
  const historyParams = new URLSearchParams({
    user_id: `eq.${userId}`,
    // Ulanmalar tekshiruvi botda yo'q — kabinetda faqat shu ikki limit.
    kind: "in.(full_info,reset_pw)",
    select: "id,kind,delta,source,account_id,zone_id,target,remaining,created_at",
    order: "created_at.desc",
    limit: String(CABINET_HISTORY_LIMIT),
  });

  const [lang, accounts, fullInfo, resetPw, viewers, history, prices, firstmails] = await Promise.all([
    loadPreferredLanguage(config, user),
    settle(listUserAccounts(config, userId), "ACCOUNTS"),
    settle(supabaseRpc(config, "get_full_info_quota", { p_user_id: userId }), "FULL_INFO"),
    settle(supabaseRpc(config, "get_reset_pw_quota", { p_user_id: userId }), "RESET_PW"),
    settle(supabaseRpc(config, "get_account_check_history", { p_user_id: userId, p_limit: CABINET_HISTORY_LIMIT }), "VIEWERS"),
    // 018 migratsiyasi qo'llanmagan bo'lsa — null, UI "tarix hali yo'q" deydi.
    settle(supabaseRequest(config, `/quota_usage_events?${historyParams.toString()}`), "HISTORY"),
    settle(limitPrices.createLimitPriceStore(storeRequest(config)).list(), "PRICES"),
    settle(loadFirstmailPage(config, 0), "FIRSTMAIL"),
  ]);

  return json(res, 200, {
    ok: true,
    lang,
    botUsername: config.botUsername || null,
    supportUsername: createShopNotifier({}).supportUsername,
    user: {
      id: userId,
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      username: user.username || null,
      photo_url: user.photo_url || null,
    },
    unlimited: isAdminUser(userId),
    limits: {
      full_info: { remaining: quotaNumber(fullInfo) },
      reset_pw: { remaining: quotaNumber(resetPw) },
    },
    accounts: accounts || [],
    accountMax: ACCOUNT_MAX_COUNT,
    viewers: (Array.isArray(viewers) ? viewers : []).map(publicViewer),
    history: Array.isArray(history) ? history.map(publicHistory) : [],
    historyAvailable: Array.isArray(history),
    prices: (prices || []).map(limitPrices.toPublicLimitPrice),
    firstmails: firstmails ? firstmails.items : [],
    firstmailTotal: firstmails ? firstmails.total : 0,
    firstmailHasMore: firstmails ? firstmails.hasMore : false,
  });
}

// Sotuvdagi pochtalarning bitta sahifasi (offset dan boshlab 30 ta).
async function loadFirstmailPage(config, offsetRaw) {
  const offset = Math.max(0, Math.min(Number.parseInt(offsetRaw, 10) || 0, 100000));
  const available = (await shop.createFirstmailStore(storeRequest(config)).list())
    .filter((item) => item.status === shop.SHOP_FM_STATUS_AVAILABLE);
  const items = available.slice(offset, offset + CABINET_FIRSTMAIL_PAGE).map(publicFirstmail);

  return { items, total: available.length, hasMore: offset + items.length < available.length };
}

async function handleFirstmails(res, { config, body }) {
  const page = await loadFirstmailPage(config, body.offset);
  return json(res, 200, { ok: true, ...page });
}

async function handleAccountAdd(res, { config, user, body }) {
  const accountId = String(body.account_id ?? "").replace(/\D/g, "");
  const zoneId = String(body.zone_id ?? "").replace(/\D/g, "");

  if (!/^\d{5,12}$/.test(accountId) || !/^\d{1,8}$/.test(zoneId)) {
    return json(res, 400, { ok: false, error: "invalid_input" });
  }

  const result = await supabaseRpc(config, "add_user_account", {
    p_user_id: String(user.id),
    p_account_id: accountId,
    p_zone_id: zoneId,
  });

  if (!result || result.ok !== true) {
    const error = ["limit_reached", "already_exists", "invalid_input"].includes(result?.error) ? result.error : "add_failed";
    return json(res, 400, { ok: false, error });
  }

  return json(res, 200, { ok: true, accounts: await listUserAccounts(config, user.id) });
}

async function handleAccountRemove(res, { config, user, body }) {
  const rowId = parseRowId(body.rowId);
  const accounts = await listUserAccounts(config, user.id);
  const target = accounts.find((acc) => acc.id === rowId);

  if (!target) {
    return json(res, 404, { ok: false, error: "not_found" });
  }

  // Bot kabi: ulangan bo'lsa avval Arena sessiyasini yopamiz.
  if (target.ml_linked) {
    try {
      const link = await supabaseRpc(config, "get_user_account_ml_link", { p_user_id: String(user.id), p_row_id: rowId });
      const token = arena.openArenaToken(link?.ml_token, config.linkSecret);
      if (token) await createClient(config).logout(token);
    } catch (error) {
      console.error("[CABINET_REMOVE_LOGOUT]", error?.message);
    }
  }

  const result = await supabaseRpc(config, "remove_user_account", {
    p_user_id: String(user.id),
    p_account_id: target.account_id,
    p_zone_id: target.zone_id,
  });

  if (!result || result.ok !== true) {
    return json(res, 404, { ok: false, error: "not_found" });
  }

  return json(res, 200, { ok: true, accounts: accounts.filter((acc) => acc.id !== rowId) });
}

// Tasdiqlash kodi holati: bot_settings → ml_vc:<userId> = { rowId, sentAt, attempts }.
// Urinishlar serverda sanaladi — kod tanlab topishning (brute force) oldi olinadi.
function mlVcKey(userId) {
  return `${ML_VC_KEY_PREFIX}${userId}`;
}

async function readMlVcState(config, userId) {
  const rows = await supabaseRequest(
    config,
    `/bot_settings?key=eq.${encodeURIComponent(mlVcKey(userId))}&select=value&limit=1`
  );
  const value = Array.isArray(rows) && rows[0] ? rows[0].value : null;
  return value && typeof value === "object" ? value : null;
}

function writeMlVcState(config, userId, value) {
  return supabaseRequest(config, "/bot_settings?on_conflict=key", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { key: mlVcKey(userId), value, updated_at: new Date().toISOString() },
  });
}

function clearMlVcState(config, userId) {
  return supabaseRequest(config, `/bot_settings?key=eq.${encodeURIComponent(mlVcKey(userId))}`, { method: "DELETE" });
}

function arenaErrorCode(error) {
  return ["send_failed", "rate_limit", "invalid_input", "invalid_code", "timeout"].includes(error?.reason)
    ? error.reason
    : "service_down";
}

async function findUnlinkedAccount(config, user, rowIdRaw) {
  const rowId = parseRowId(rowIdRaw);
  const accounts = await listUserAccounts(config, user.id);
  const account = accounts.find((acc) => acc.id === rowId);

  if (!account) return { error: "not_found" };
  if (account.ml_linked) return { error: "already_linked" };
  return { account };
}

async function handleMlSendCode(res, { config, user, body }) {
  const { account, error } = await findUnlinkedAccount(config, user, body.rowId);
  if (!account) {
    return json(res, error === "not_found" ? 404 : 409, { ok: false, error });
  }

  const previous = await readMlVcState(config, user.id).catch(() => null);
  const since = previous && previous.rowId === account.id ? Date.now() - Number(previous.sentAt || 0) : Infinity;

  if (since < ML_CODE_RESEND_COOLDOWN_MS) {
    return json(res, 429, { ok: false, error: "cooldown", wait: Math.ceil((ML_CODE_RESEND_COOLDOWN_MS - since) / 1000) });
  }

  try {
    await createClient(config).sendVerificationCode(account.account_id, account.zone_id);
  } catch (sendError) {
    console.error("[CABINET_ML_SEND]", sendError?.message);
    return json(res, 502, { ok: false, error: arenaErrorCode(sendError) });
  }

  await writeMlVcState(config, user.id, { rowId: account.id, sentAt: Date.now(), attempts: 0 });
  return json(res, 200, { ok: true, ttl: ML_CODE_TTL_MS / 1000, cooldown: ML_CODE_RESEND_COOLDOWN_MS / 1000 });
}

async function handleMlVerify(res, { config, user, body }) {
  const code = String(body.code ?? "").replace(/[\s-]/g, "");
  if (!arena.isValidVerificationCode(code)) {
    return json(res, 400, { ok: false, error: "invalid_format" });
  }

  const { account, error } = await findUnlinkedAccount(config, user, body.rowId);
  if (!account) {
    return json(res, error === "not_found" ? 404 : 409, { ok: false, error });
  }

  const vc = await readMlVcState(config, user.id);
  if (!vc || vc.rowId !== account.id || Date.now() - Number(vc.sentAt || 0) > ML_CODE_TTL_MS) {
    return json(res, 410, { ok: false, error: "code_expired" });
  }

  const attempts = Number(vc.attempts || 0);
  if (attempts >= ML_CODE_MAX_ATTEMPTS) {
    return json(res, 429, { ok: false, error: "too_many" });
  }

  const client = createClient(config);
  let session;
  try {
    session = await client.login(account.account_id, account.zone_id, code);
  } catch (loginError) {
    if (loginError?.reason === "invalid_code") {
      const used = attempts + 1;
      await writeMlVcState(config, user.id, { ...vc, attempts: used });
      return json(res, 400, { ok: false, error: used >= ML_CODE_MAX_ATTEMPTS ? "too_many" : "wrong_code", left: ML_CODE_MAX_ATTEMPTS - used });
    }
    console.error("[CABINET_ML_LOGIN]", loginError?.message);
    return json(res, 502, { ok: false, error: arenaErrorCode(loginError) });
  }

  const lang = SUPPORTED_LANGS.includes(body.lang) ? body.lang : "en";
  const info = await client.getInfo(session.jwt, lang).catch(() => ({}));
  const saved = await supabaseRpc(config, "set_user_account_ml_link", {
    p_user_id: String(user.id),
    p_row_id: account.id,
    p_token: arena.sealArenaToken(session.jwt, config.linkSecret),
    p_nickname: info && info.name ? String(info.name).slice(0, 64) : null,
  }).catch((saveError) => {
    console.error("[CABINET_ML_SAVE]", saveError?.message);
    return null;
  });

  await clearMlVcState(config, user.id).catch(() => {});

  if (!saved || saved.ok !== true) {
    void client.logout(session.jwt).catch(() => {});
    return json(res, 500, { ok: false, error: "save_failed" });
  }

  return json(res, 200, { ok: true, accounts: await listUserAccounts(config, user.id) });
}

async function handleBuyLimit(res, { config, user, body }) {
  const item = await limitPrices.createLimitPriceStore(storeRequest(config)).get(String(body.id || ""));
  if (!item) {
    return json(res, 404, { ok: false, error: "not_available" });
  }

  const notifier = createShopNotifier({ botToken: config.botToken, requestFn: storeRequest(config) });
  const delivered = await notifier.notify(buildLimitBuyText(user, item), user.id);
  return json(res, delivered ? 200 : 502, { ok: delivered, error: delivered ? undefined : "notify_failed", supportUsername: notifier.supportUsername });
}

async function handleBuyFirstmail(res, { config, user, body }) {
  const item = await shop.createFirstmailStore(storeRequest(config)).get(String(body.id || ""));
  if (!item || item.status !== shop.SHOP_FM_STATUS_AVAILABLE) {
    return json(res, 404, { ok: false, error: "not_available" });
  }

  const notifier = createShopNotifier({ botToken: config.botToken, requestFn: storeRequest(config) });
  const text = buildFirstmailBuyText(user, item, shop.formatShopPrice(item.price) || "kelishiladi");
  const delivered = await notifier.notify(text, user.id);
  return json(res, delivered ? 200 : 502, { ok: delivered, error: delivered ? undefined : "notify_failed", supportUsername: notifier.supportUsername });
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
// Yo'llar literal yoziladi — Vercel (nft) HTML fayllarni bundle'ga shundan topadi.
function serveApp(res) {
  return serveHtml(res, path.join(__dirname, "account-miniapp.html"), "#0b1020");
}

function serveCabinet(res) {
  return serveHtml(res, path.join(__dirname, "cabinet-miniapp.html"), "#0a0e1a");
}

// /api/account?view=cabinet — shaxsiy kabinet; boshqasi — "Mening akkauntim".
function isCabinetRequest(req) {
  const fromQuery = req.query && req.query.view;
  if (fromQuery) return String(fromQuery) === "cabinet";

  try {
    return new URL(String(req.url || ""), "http://local").searchParams.get("view") === "cabinet";
  } catch {
    return false;
  }
}

function serveHtml(res, filePath, color) {
  const fileName = path.basename(filePath);
  try {
    const html = injectTelegramShell(fs.readFileSync(filePath, "utf8"), { color });
    return res
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send(html);
  } catch (error) {
    console.error("[ACCOUNT_APP_HTML]", fileName, error?.message);
    return res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8").send(`${fileName} topilmadi`);
  }
}

// ---------------------------------------------------------------------------
// Supabase / util
// ---------------------------------------------------------------------------
async function supabaseRequest(config, urlPath, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

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
