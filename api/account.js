// ---------------------------------------------------------------------------
// 🎮 Mening akkauntim — foydalanuvchining shaxsiy Telegram Mini App'i.
//
// GET  → account-miniapp.html (Mini App)
// POST → { action, initData, ... } JSON API
// POST ?hook=hamyon → Hamyon API callback (prepare_url / complete_url), imzo
//      md5(shop_id + payment_id + amount + shop_key) bilan tekshiriladi.
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
const shopOrders = require("./_shop-orders.js");
const walletLib = require("./_wallet.js");
const {
  createShopNotifier,
  buildFirstmailBuyText,
  buildWalletSaleText,
  buildTopupCreditedText,
} = require("./_shop-notify.js");
const { injectTelegramShell } = require("./_tg-shell.js");
const { injectArenaWeb } = require("./_arena-web.js");
const { enrichPremiumEmojis } = require("./_premium-emoji.js");

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
    linkSecret: arena.resolveLinkSecret(process.env),
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET" && req.query && req.query.asset === "bg") {
      return serveBackground(res);
    }

    if (req.method === "GET") {
      return isCabinetRequest(req) ? serveCabinet(res) : serveApp(res);
    }

    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "method_not_allowed" });
    }

    const config = getConfig();

    if (req.query && req.query.hook === "hamyon") {
      return await handleHamyonCallback(req, res, config);
    }
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
      // Arena so'rovlarini Mini App o'zi yuboradi (api/_arena-web.js) —
      // server faqat JWT'ni egasiga beradi.
      case "ml_session":
        return await handleMlSession(res, ctx);
      case "logout":
        return await handleLogout(res, ctx);
      // Shaxsiy kabinet (?view=cabinet)
      case "cabinet":
        return await handleCabinet(res, ctx);
      case "account_add":
        return await handleAccountAdd(res, ctx);
      case "account_remove":
        return await handleAccountRemove(res, ctx);
      case "ml_link":
        return await handleMlLink(res, ctx);
      case "firstmails":
        return await handleFirstmails(res, ctx);
      case "buy_limit":
        return await handleBuyLimit(res, ctx);
      case "buy_firstmail":
        return await handleBuyFirstmail(res, ctx);
      // Balans
      case "wallet":
        return await handleWallet(res, ctx);
      case "topup_create":
        return await handleTopupCreate(res, ctx);
      case "topup_check":
        return await handleTopupCheck(res, ctx);
      case "topup_cancel":
        return await handleTopupCancel(res, ctx);
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

// Logout: tokenni o'chiramiz (Arena sessiyasini Mini App o'zi yopadi —
// serverdan Arena'ga so'rov bloklanadi). Akkaunt ro'yxatda qoladi.
async function handleLogout(res, { config, user, body }) {
  const rowId = parseRowId(body.rowId);
  if (!rowId) {
    return json(res, 400, { ok: false, error: "invalid_account" });
  }

  const link = await supabaseRpc(config, "get_user_account_ml_link", { p_user_id: String(user.id), p_row_id: rowId });
  if (!link || link.ok !== true) {
    return json(res, 404, { ok: false, error: "not_found" });
  }

  const cleared = await supabaseRpc(config, "clear_user_account_ml_link", { p_user_id: String(user.id), p_row_id: rowId });
  return json(res, 200, { ok: Boolean(cleared && cleared.ok === true) });
}

// "Mening akkauntim": egasiga uning Arena JWT'si (Mini App Arena'ga o'zi boradi).
async function handleMlSession(res, { config, user, body }) {
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

  return json(res, 200, { ok: true, token, account: publicLink(link) });
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
// narxlari va Firstmail xaridi. Xaridlar balansdan (api/_wallet.js,
// supabase/020_wallet.sql); balans karta orqali to'ldiriladi va to'lov
// Hamyon API orqali tekshiriladi (api/_hamyon.js). Narxi kelishiladigan pochta —
// eski yo'l: so'rov do'kon egasiga boradi (api/_shop-notify.js).
// ---------------------------------------------------------------------------
const CABINET_HISTORY_LIMIT = 50;
const CABINET_FIRSTMAIL_PAGE = 30; // Do'kon: pastga aylantirganda 30 tadan
const ACCOUNT_MAX_COUNT = 5;
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

  const wallet = createWalletFor(config);
  // Oyna yopilib qolgan to'lovlar — balansni ko'rsatishdan oldin yoziladi.
  await settle(syncUserTopups(config, wallet, user), "TOPUP_SYNC");
  const [lang, accounts, fullInfo, resetPw, viewers, history, prices, firstmails, orders, balance, walletConfig, topup, paidTopups] = await Promise.all([
    loadPreferredLanguage(config, user),
    settle(listUserAccounts(config, userId), "ACCOUNTS"),
    settle(supabaseRpc(config, "get_full_info_quota", { p_user_id: userId }), "FULL_INFO"),
    settle(supabaseRpc(config, "get_reset_pw_quota", { p_user_id: userId }), "RESET_PW"),
    settle(supabaseRpc(config, "get_account_check_history", { p_user_id: userId, p_limit: CABINET_HISTORY_LIMIT }), "VIEWERS"),
    // 018 migratsiyasi qo'llanmagan bo'lsa — null, UI "tarix hali yo'q" deydi.
    settle(supabaseRequest(config, `/quota_usage_events?${historyParams.toString()}`), "HISTORY"),
    settle(limitPrices.createLimitPriceStore(storeRequest(config)).list(), "PRICES"),
    settle(loadFirstmailPage(config, 0), "FIRSTMAIL"),
    // 019 migratsiyasi qo'llanmagan bo'lsa — null, UI "tarix hali yo'q" deydi.
    settle(shopOrders.listUserShopOrders(storeRequest(config), userId, CABINET_HISTORY_LIMIT), "ORDERS"),
    // 020 migratsiyasi qo'llanmagan bo'lsa — null, UI balansni ko'rsatmaydi.
    settle(wallet.getBalance(userId), "WALLET"),
    settle(wallet.getConfig(), "WALLET_CONFIG"),
    settle(wallet.getActiveTopup(userId), "TOPUP"),
    settle(wallet.listPaidTopups(userId, CABINET_HISTORY_LIMIT), "TOPUPS"),
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
    orders: orders || [],
    ordersAvailable: Array.isArray(orders),
    wallet: typeof balance === "number" && walletConfig
      ? { balance, config: wallet.publicConfig(walletConfig), topup: topup || null }
      : null,
    // Tarix: balansga tushgan to'ldirishlar (xaridlar bilan bitta lentada).
    topups: Array.isArray(paidTopups) ? paidTopups : [],
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

async function findUnlinkedAccount(config, user, rowIdRaw) {
  const rowId = parseRowId(rowIdRaw);
  const accounts = await listUserAccounts(config, user.id);
  const account = accounts.find((acc) => acc.id === rowId);

  if (!account) return { error: "not_found" };
  if (account.ml_linked) return { error: "already_linked" };
  return { account };
}

// Kabinet: Mini App Arena'da kod bilan kirib, olingan JWT'ni yuboradi.
// Serverdan Arena'ga so'rov yuborib bo'lmaydi (bloklangan), shuning uchun
// token formati va (bo'lsa) undagi role/zone tekshiriladi, keyin shifrlab
// saqlanadi. `ml_linked` faqat egasining o'ziga ko'rinadigan belgi.
async function handleMlLink(res, { config, user, body }) {
  const { account, error } = await findUnlinkedAccount(config, user, body.rowId);
  if (!account) {
    return json(res, error === "not_found" ? 404 : 409, { ok: false, error });
  }

  const token = String(body.token ?? "").trim();
  if (!isArenaJwtFor(token, account)) {
    return json(res, 400, { ok: false, error: "invalid_token" });
  }

  const nickname = String(body.nickname ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 64);
  const saved = await supabaseRpc(config, "set_user_account_ml_link", {
    p_user_id: String(user.id),
    p_row_id: account.id,
    p_token: arena.sealArenaToken(token, config.linkSecret),
    p_nickname: nickname || null,
  }).catch((saveError) => {
    console.error("[CABINET_ML_SAVE]", saveError?.message);
    return null;
  });

  if (!saved || saved.ok !== true) {
    return json(res, 500, { ok: false, error: "save_failed" });
  }

  return json(res, 200, { ok: true, accounts: await listUserAccounts(config, user.id) });
}

// JWT ko'rinishi (header.payload.signature). Payload'da role/zone bo'lsa —
// shu akkauntniki bo'lishi shart (boshqa akkaunt tokeni bilan ulab bo'lmaydi).
function isArenaJwtFor(token, account) {
  if (token.length < 20 || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token)) {
    return false;
  }
  let claims = null;
  try {
    claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    claims = null;
  }
  if (!claims || typeof claims !== "object") return true;
  const pick = (...keys) => keys.map((k) => claims[k]).find((v) => v !== undefined && v !== null && v !== "");
  const role = pick("roleid", "role_id", "roleId");
  const zone = pick("zoneid", "zone_id", "zoneId");
  if (role !== undefined && String(role) !== String(account.account_id)) return false;
  if (zone !== undefined && String(zone) !== String(account.zone_id)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 💰 Balans: to'ldirish va balansdan xarid
// ---------------------------------------------------------------------------
function createWalletFor(config) {
  return walletLib.createWallet(storeRequest(config));
}

// Pul bilan bog'liq RPC xatosi (masalan 020 migratsiyasi yo'q) — 503.
function walletUnavailable(res, error, label) {
  console.error(`[WALLET_${label}]`, error?.message);
  return json(res, 503, { ok: false, error: "wallet_unavailable" });
}

// To'lab, kabinetni yopib qo'ygan foydalanuvchi pulini yo'qotmasin.
async function syncUserTopups(config, wallet, user) {
  const credited = await wallet.syncRecentTopups({ userId: user.id, limit: 5 });
  for (const item of credited) {
    await notifyTopupCredited(config, user, { pay_amount: item.amount }, item.balance);
  }
}

async function handleWallet(res, { config, user }) {
  const wallet = createWalletFor(config);
  try {
    await settle(syncUserTopups(config, wallet, user), "TOPUP_SYNC");
    const [balance, walletConfig, topup, transactions] = await Promise.all([
      wallet.getBalance(user.id),
      wallet.getConfig(),
      wallet.getActiveTopup(user.id),
      wallet.listTransactions(user.id),
    ]);
    return json(res, 200, { ok: true, balance, config: wallet.publicConfig(walletConfig), topup, transactions });
  } catch (error) {
    return walletUnavailable(res, error, "GET");
  }
}

async function handleTopupCreate(res, { config, user, body }) {
  try {
    const result = await createWalletFor(config).createTopup(user.id, body.amount);
    return json(res, result.ok ? 200 : 400, result);
  } catch (error) {
    return walletUnavailable(res, error, "TOPUP_CREATE");
  }
}

async function handleTopupCancel(res, { config, user, body }) {
  try {
    return json(res, 200, await createWalletFor(config).cancelTopup(user.id, body.id));
  } catch (error) {
    return walletUnavailable(res, error, "TOPUP_CANCEL");
  }
}

async function handleTopupCheck(res, { config, user, body }) {
  let result;
  try {
    result = await createWalletFor(config).checkTopup(user.id, body.id);
  } catch (error) {
    return walletUnavailable(res, error, "TOPUP_CHECK");
  }

  if (result.credited) {
    await notifyTopupCredited(config, user, result.topup, result.balance);
  }
  return json(res, result.ok ? 200 : result.error === "not_found" ? 404 : 502, result);
}

// Hamyon to'lov holatini o'zi yuboradi (initData yo'q — imzo tekshiriladi).
// Body application/x-www-form-urlencoded; Vercel uni obyektga aylantiradi.
async function handleHamyonCallback(req, res, config) {
  if (!config.supabaseUrl || !config.supabaseKey) {
    return json(res, 503, { error: "not_configured" });
  }

  const fields = parseFormBody(req.body);
  let outcome;
  try {
    outcome = await createWalletFor(config).handleProviderCallback(fields);
  } catch (error) {
    // 2xx bo'lmasa Hamyon qayta yuboradi — vaqtinchalik xatoda shu kerak.
    console.error("[WALLET_HAMYON_CALLBACK]", error?.message);
    return json(res, 500, { error: "temporary" });
  }

  console.log("[WALLET_HAMYON_CALLBACK]", fields.status || "-", fields.payment_id || "-", outcome.httpStatus, outcome.status || "-");
  if (outcome.credited && outcome.userId) {
    await notifyTopupCredited(config, { id: outcome.userId }, { pay_amount: outcome.amount }, outcome.result?.balance);
  }
  if (outcome.httpStatus !== 200) {
    return json(res, outcome.httpStatus, { error: "rejected" });
  }
  return json(res, 200, { result: "ok" });
}

function parseFormBody(body) {
  if (!body) return {};
  if (typeof body === "object" && !Buffer.isBuffer(body)) return body;
  const text = String(body);
  const parsed = safeJsonParse(text);
  if (parsed && typeof parsed === "object") return parsed;
  return Object.fromEntries(new URLSearchParams(text));
}

// Foydalanuvchiga bot orqali "balans to'ldirildi" xabari (best effort).
async function notifyTopupCredited(config, user, topup, balance) {
  if (!config.botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(user.id),
        // ✅ ➕ 💳 — premium (custom) emoji ko'rinishida (api/emojis.json).
        text: enrichPremiumEmojis(buildTopupCreditedText(topup.paid_amount || topup.pay_amount, balance)),
        parse_mode: "HTML",
      }),
    });
  } catch (error) {
    console.error("[WALLET_NOTIFY_USER]", error?.message);
  }
}

const FIRSTMAIL_DELIVERY_TEXT = {
  uz: (d) => [
    "✅ <b>Firstmail xaridingiz</b>",
    "",
    `✉️ Pochta: <code>${d.email}</code>`,
    `🔑 Parol: <code>${d.password}</code>`,
    "",
    `💳 Balansdan yechildi: <b>${d.price}</b>`,
    `🧾 Buyurtma: <code>#${d.order}</code>`,
    "",
    "Ma'lumotlar Shaxsiy kabinet → Do'kon → Tarix bo'limida ham saqlanadi.",
  ],
  ru: (d) => [
    "✅ <b>Ваша покупка Firstmail</b>",
    "",
    `✉️ Почта: <code>${d.email}</code>`,
    `🔑 Пароль: <code>${d.password}</code>`,
    "",
    `💳 Списано с баланса: <b>${d.price}</b>`,
    `🧾 Заказ: <code>#${d.order}</code>`,
    "",
    "Данные также сохранены в Личном кабинете → Магазин → История.",
  ],
  en: (d) => [
    "✅ <b>Your Firstmail purchase</b>",
    "",
    `✉️ Email: <code>${d.email}</code>`,
    `🔑 Password: <code>${d.password}</code>`,
    "",
    `💳 Charged from balance: <b>${d.price}</b>`,
    `🧾 Order: <code>#${d.order}</code>`,
    "",
    "The details are also saved in Personal cabinet → Shop → History.",
  ],
};

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Sotib olingan pochta login/paroli bot chatiga ham yuboriladi (best effort —
// ma'lumot kabinet tarixida baribir saqlangan).
async function sendFirstmailToUser(config, user, result, langRaw) {
  if (!config.botToken) return;
  const lang = SUPPORTED_LANGS.includes(langRaw) ? langRaw : "uz";
  const unit = lang === "uz" ? "so'm" : lang === "ru" ? "сум" : "UZS";
  const text = FIRSTMAIL_DELIVERY_TEXT[lang]({
    email: escapeHtml(result.email),
    password: escapeHtml(result.password || "—"),
    price: `${String(Math.round(Number(result.price) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${unit}`,
    order: escapeHtml(result.order_id),
  }).join("\n");

  try {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(user.id), text, parse_mode: "HTML" }),
    });
  } catch (error) {
    console.error("[WALLET_FM_DELIVERY]", error?.message);
  }
}

// Sotuv haqida do'kon egasiga xabar (best effort — xarid allaqachon bajarilgan).
async function notifyWalletSale(config, user, details) {
  try {
    const notifier = createShopNotifier({ botToken: config.botToken, requestFn: storeRequest(config) });
    await notifier.notify(buildWalletSaleText(user, details), user.id);
  } catch (error) {
    console.error("[WALLET_NOTIFY_SALE]", error?.message);
  }
}

function purchaseFailure(res, result) {
  const error = ["insufficient_funds", "not_available"].includes(result?.error) ? result.error : "purchase_failed";
  const status = error === "insufficient_funds" ? 402 : error === "not_available" ? 404 : 500;
  return json(res, status, {
    ok: false,
    error,
    balance: typeof result?.balance === "number" ? result.balance : undefined,
    price: typeof result?.price === "number" ? result.price : undefined,
  });
}

async function loadOrder(config, userId, orderId) {
  const orders = await shopOrders.listUserShopOrders(storeRequest(config), userId, 5).catch(() => []);
  return orders.find((order) => String(order.id) === String(orderId)) || null;
}

async function handleBuyLimit(res, { config, user, body }) {
  const item = await limitPrices.createLimitPriceStore(storeRequest(config)).get(String(body.id || ""));
  if (!item) {
    return json(res, 404, { ok: false, error: "not_available" });
  }

  let result;
  try {
    result = await createWalletFor(config).buyLimit(user.id, item.id);
  } catch (error) {
    return walletUnavailable(res, error, "BUY_LIMIT");
  }

  if (!result || result.ok !== true) {
    return purchaseFailure(res, result);
  }

  await notifyWalletSale(config, user, { kind: "limit", item, orderId: result.order_id, price: result.price });

  return json(res, 200, {
    ok: true,
    balance: result.balance,
    limit: { kind: result.kind, amount: result.amount, remaining: result.remaining },
    order: await loadOrder(config, user.id, result.order_id),
  });
}

async function handleBuyFirstmail(res, { config, user, body }) {
  const store = shop.createFirstmailStore(storeRequest(config));
  const item = await store.get(String(body.id || ""));
  if (!item || item.status !== shop.SHOP_FM_STATUS_AVAILABLE) {
    return json(res, 404, { ok: false, error: "not_available" });
  }

  // Narxi kelishiladigan pochta — balansdan sotib bo'lmaydi, eski so'rov yo'li.
  if (!shop.parseShopPriceNumber(item.price)) {
    return requestFirstmailManually(res, config, user, item);
  }

  let result;
  try {
    result = await createWalletFor(config).buyFirstmail(user.id, item.id);
  } catch (error) {
    return walletUnavailable(res, error, "BUY_FIRSTMAIL");
  }

  if (result && result.error === "price_not_set") {
    return requestFirstmailManually(res, config, user, item);
  }

  if (!result || result.ok !== true) {
    return purchaseFailure(res, result);
  }

  await notifyWalletSale(config, user, { kind: "firstmail", item, orderId: result.order_id, price: result.price });
  await sendFirstmailToUser(config, user, result, body.lang);

  return json(res, 200, {
    ok: true,
    balance: result.balance,
    delivery: { email: result.email, password: result.password },
    order: await loadOrder(config, user.id, result.order_id),
  });
}

async function requestFirstmailManually(res, config, user, item) {
  const notifier = createShopNotifier({ botToken: config.botToken, requestFn: storeRequest(config) });
  const text = buildFirstmailBuyText(user, item, shop.formatShopPrice(item.price) || "kelishiladi");
  const delivered = await notifier.notify(text, user.id);
  const order = delivered
    ? await shopOrders.recordShopOrder(storeRequest(config), {
      userId: user.id,
      kind: "firstmail",
      itemId: item.id,
      title: shop.maskShopEmail(item.email),
      price: shop.parseShopPriceNumber(item.price),
      priceText: shop.formatShopPrice(item.price),
    })
    : null;
  return json(res, delivered ? 200 : 502, {
    ok: delivered,
    manual: true,
    error: delivered ? undefined : "notify_failed",
    supportUsername: notifier.supportUsername,
    order,
  });
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

// Kabinet orqa foni — admin paneldagi rasm (api/miniapp.js → ?asset=bg bilan bir xil).
function serveBackground(res) {
  try {
    const image = fs.readFileSync(path.join(__dirname, "mlbblogo-bg.png"));
    const isJpeg = image[0] === 0xff && image[1] === 0xd8;
    return res
      .status(200)
      .setHeader("Content-Type", isJpeg ? "image/jpeg" : "image/png")
      .setHeader("Cache-Control", "public, max-age=604800, immutable")
      .send(image);
  } catch (error) {
    console.error("[CABINET_BG_ERROR]", error?.message);
    return res.status(404).setHeader("Content-Type", "text/plain; charset=utf-8").send("not found");
  }
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
    const html = injectArenaWeb(injectTelegramShell(fs.readFileSync(filePath, "utf8"), { color }));
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
