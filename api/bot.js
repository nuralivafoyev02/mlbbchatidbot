const crypto = require("node:crypto");
// --- i18n: Load from locale JSON files ---
const SUPPORTED_LANGS = ["uz", "ru", "en"];
const DEFAULT_LANG = "uz";

const translations = {
  uz: require("./locales/uz.json"),
  ru: require("./locales/ru.json"),
  en: require("./locales/en.json"),
};

function t(key, lang, params = {}) {
  const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
  let text = translations[safeLang]?.[key] || translations[DEFAULT_LANG]?.[key] || key;

  for (const [param, value] of Object.entries(params)) {
    // Funksiya-replacer: qiymatdagi "$1", "$&" kabi belgilar maxsus ma'no olmasin.
    const replacement = String(value ?? "");
    text = text.replace(new RegExp(`\{${param}\}`, "g"), () => replacement);
  }

  return text;
}

function getUserLang(userId) {
  return (stats.languageCache && stats.languageCache.get(String(userId))) || DEFAULT_LANG;
}

function setUserLang(userId, lang) {
  if (!stats.languageCache) {
    stats.languageCache = new Map();
  }
  const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
  stats.languageCache.set(String(userId), safeLang);
}

async function loadUserLangFromSupabase(userId) {
  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return null;
  }
  try {
    const data = await supabaseRequest(
      `/bot_users?user_id=eq.${toPgBigint(userId)}&select=preferred_language&limit=1`
    );
    if (Array.isArray(data) && data[0]?.preferred_language) {
      return SUPPORTED_LANGS.includes(data[0].preferred_language) ? data[0].preferred_language : null;
    }
  } catch (error) {
    console.error("[LOAD_LANG_ERROR]", error.message);
  }
  return null;
}

function inferTranslationsLang(languageCode = "") {
  const code = String(languageCode || "").toLowerCase();
  if (code.startsWith("en")) return "en";
  if (code.startsWith("ru")) return "ru";
  if (code.startsWith("uz")) return "uz";
  return DEFAULT_LANG;
}

async function saveUserLangToSupabase(userId, lang) {
  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }
  try {
    await supabaseRpc("set_user_preferred_language", {
      p_user_id: toPgBigint(userId),
      p_language: lang,
    });
  } catch (error) {
    console.error("[SAVE_LANG_ERROR]", error.message);
  }
}

const TELEGRAM_BOT_TOKEN = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_WEBHOOK_SECRET = cleanEnv(process.env.TELEGRAM_WEBHOOK_SECRET);
const SUPPORT_USERNAME = sanitizeTelegramUsername(
  process.env.SUPPORT_USERNAME || "vafoyev_n"
);
const TELEGRAM_BOT_USERNAME = sanitizeOptionalTelegramUsername(
  process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME
);
const ADMIN_IDS = parseIdList(process.env.ADMIN_IDS || "5081175125,8500085987,7396686285");
const MAIN_GROUP_ID =
  process.env.MAIN_GROUP_ID === undefined || process.env.MAIN_GROUP_ID === null
    ? "-1003832186200"
    : cleanEnv(process.env.MAIN_GROUP_ID);
const BROADCAST_USER_IDS = parseIdList(process.env.BROADCAST_USER_IDS);
const BROADCAST_TTL_MS = 15 * 60 * 1000;
const ASYNC_RUNNER_BASE_URL = "https://async-runner.internal";
const BROADCAST_RUNNER_NAME = "broadcast";
const BUTTON_LANGUAGE = "🌐 Til almashtirish";
const BUTTON_CHECK = "🔎 Server aniqlash";
const BUTTON_BIND_INFO = "🔗 Ulanmalar";
const BUTTON_STATS = "📊 Statistika";
const BUTTON_USERS = "👥 Foydalanuvchilar";
const BUTTON_ERRORS = "⚠️ Xatoliklar";
const BUTTON_FEEDBACK = "💬 Fikr va izohlar";
const BUTTON_BROADCAST = "📣 Xabar yuborish";
const BUTTON_COMMANDS = "📋 Buyruqlar";
const BUTTON_HELP = "ℹ️ Yordam";
const BUTTON_MENU = "🏠 Menyu";
const BUTTON_CHECK_AGAIN = "🔍 Yana tekshirish";
const BUTTON_MANDATORY_SETUP = "⚙️ Majburiylikni sozlash";
const BUTTON_ADMIN_PANEL = "🎛️ Admin Panel";
const MINIAPP_URL = cleanEnv(process.env.MINIAPP_URL) || `https://${cleanEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL || "mlbbchatidbot.vercel.app")}/api/miniapp`;
// Foydalanuvchining shaxsiy Mini App'i ("🎮 Mening akkauntim") — api/account.js.
const ACCOUNT_MINIAPP_URL = cleanEnv(process.env.ACCOUNT_MINIAPP_URL) || `https://${cleanEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL || "mlbbchatidbot.vercel.app")}/api/account`;
// Shaxsiy kabinet — o'sha Vercel funksiyasi, ?view=cabinet bilan.
const CABINET_MINIAPP_URL = `${ACCOUNT_MINIAPP_URL}${ACCOUNT_MINIAPP_URL.includes("?") ? "&" : "?"}view=cabinet`;
const BOT_LOGO_URL =
  cleanEnv(process.env.BOT_LOGO_URL) ||
  `https://${cleanEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL || "mlbbchatidbot.vercel.app")}/logo.jpg`;
const USERS_PAGE_SIZE = 10;
const BROADCAST_USERS_PAGE_SIZE = 1000;
const KNOWN_USERS_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const FEEDBACK_PENDING_TTL_MS = 30 * 60 * 1000;
const FEEDBACK_MAX_LENGTH = 3000;
const FEATURE_ACTIONS = Object.freeze({
  START: "start",
  SERVER_CHECK: "server_check",
  BIND_INFO: "bind_info",
  FULL_INFO: "full_info",
  RESET_PW: "reset_pw",
  FEEDBACK: "feedback",
  ML_LINK: "ml_link",
});
const DAILY_REPORT_ACTION_KEYS = Object.freeze({
  start: "label_start",
  server_check: "label_server_check",
  bind_info: "label_bind_info",
  full_info: "label_full_info",
  reset_pw: "label_reset_pw",
  feedback: "label_feedback",
  ml_link: "label_ml_link",
});
function getDailyReportActionLabel(action, lang) {
  const key = DAILY_REPORT_ACTION_KEYS[action];
  return key ? t(key, lang || DEFAULT_LANG) : escapeHtml(String(action || ""));
}
const EMOJIS = require("./emojis.json");
const shop = require("./_shop.js");
const arena = require("./_mlbb-arena.js");
const quotaLog = require("./_quota-log.js");

const PREMIUM_EMOJIS = Object.freeze(EMOJIS.premium || {});
const PREMIUM_BIND_PROVIDER_EMOJIS = Object.freeze(EMOJIS.bindProviders || {});
const STATIC_EMOJIS = Object.freeze(EMOJIS.static || {});

function staticEmoji(name, fallback = "") {
  return STATIC_EMOJIS[name] || fallback;
}

const MLBB_LOOKUP_API_URL =
  process.env.MLBB_LOOKUP_API_URL || "https://api.isan.eu.org/nickname/ml";
const MLBB_BIND_INFO_PROVIDER = cleanEnv(process.env.MLBB_BIND_INFO_PROVIDER).toLowerCase();
const MLBB_BIND_INFO_SHOW_DEVICES = !isFalseyEnv(process.env.MLBB_BIND_INFO_SHOW_DEVICES);
const MLBB_BIND_INFO_BENGKEL_BOT_USERNAME =
  sanitizeOptionalTelegramUsername(
    process.env.MLBB_BIND_INFO_BENGKEL_BOT_USERNAME || "bengkelmlbb_bot"
  ) || "bengkelmlbb_bot";
const MLBB_BIND_INFO_BENGKEL_MESSAGE_TEMPLATE =
  cleanEnv(process.env.MLBB_BIND_INFO_BENGKEL_MESSAGE_TEMPLATE) ||
  "/info {account_id} {zone_id}";
const MLBB_BIND_INFO_API_KEY = cleanEnv(
  process.env.MLBB_BIND_INFO_API_KEY ||
    process.env.MLBB_STALKER_API_KEY ||
    process.env.MLBB_API_KEY
);
const MLBB_BIND_INFO_API_URL = cleanEnv(
  process.env.MLBB_BIND_INFO_API_URL ||
    (MLBB_BIND_INFO_PROVIDER === "zite" ? "https://zite.lol/" : "") ||
    (MLBB_BIND_INFO_API_KEY ? "https://api.mlbbstalker.pro/bind" : "")
);
const MLBB_BIND_INFO_API_METHOD = normalizeHttpMethod(
  process.env.MLBB_BIND_INFO_API_METHOD ||
    (["zite", "bengkel", "bengkelmlbb", "bengkelmlbb_bot"].includes(
      MLBB_BIND_INFO_PROVIDER
    ) || MLBB_BIND_INFO_API_KEY
      ? "POST"
      : "GET")
);
const MLBB_BIND_INFO_API_KEY_FIELD =
  cleanEnv(process.env.MLBB_BIND_INFO_API_KEY_FIELD) || "x_key";
const MLBB_BRIDGE_URL = cleanEnv(process.env.MLBB_BRIDGE_URL || process.env.MLBB_BIND_INFO_API_URL);
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL).replace(/\/+$/, "");
const SUPABASE_CONFIG = resolveSupabaseConfig(process.env, SUPABASE_URL);
const SUPABASE_SERVICE_KEY = SUPABASE_CONFIG.serviceKey;
const SUPABASE_KEY_TYPE = SUPABASE_CONFIG.keyType;
const SUPABASE_TIMEOUT_MS = parseBoundedNumber(
  process.env.SUPABASE_TIMEOUT_MS,
  1500,
  300,
  5000
);
const TELEGRAM_TIMEOUT_MS = parseBoundedNumber(
  process.env.TELEGRAM_TIMEOUT_MS,
  5000,
  1000,
  10000
);
const MLBB_LOOKUP_TIMEOUT_MS = parseBoundedNumber(
  process.env.MLBB_LOOKUP_TIMEOUT_MS,
  6000,
  800,
  10000
);
const MLBB_BIND_INFO_TIMEOUT_MS = parseBoundedNumber(
  process.env.MLBB_BIND_INFO_TIMEOUT_MS,
  isZiteBindInfoProvider() || isBengkelBindInfoProvider()
    ? 120000
    : MLBB_LOOKUP_TIMEOUT_MS,
  800,
  120000
);
// Inline mode faqat server aniqlash uchun ishlaydi va imkon qadar tez javob
// berishi kerak, shuning uchun umumiy MLBB_LOOKUP_TIMEOUT_MS dan qisqaroq,
// alohida cheklovga ega.
const INLINE_SERVER_LOOKUP_TIMEOUT_MS = parseBoundedNumber(
  process.env.INLINE_SERVER_LOOKUP_TIMEOUT_MS,
  Math.min(MLBB_LOOKUP_TIMEOUT_MS, 3500),
  800,
  MLBB_LOOKUP_TIMEOUT_MS
);
// Inline rejimda Ulanmalar tekshiruvi ham parallel bajariladi, lekin bot javobini
// sekinlatmasligi uchun alohida (server aniqlashga nisbatan kengroq, lekin to'liq
// hisobdagi 120 soniyagacha emas) cheklangan timeout ishlatiladi.
const INLINE_BIND_LOOKUP_TIMEOUT_MS = parseBoundedNumber(
  process.env.INLINE_BIND_LOOKUP_TIMEOUT_MS,
  Math.min(MLBB_BIND_INFO_TIMEOUT_MS, 15000),
  800,
  MLBB_BIND_INFO_TIMEOUT_MS
);
const FULL_INFO_API_URL = cleanEnv(process.env.FULL_INFO_API) || "https://api.jebray.com";
const FULL_INFO_API_KEY = cleanEnv(process.env.FULL_INFO_API_KEY);
// Mobile Legends akkauntini ulash — Rone Arena API (send-vc / login / user/*).
const MLBB_ARENA_API_URL = cleanEnv(process.env.MLBB_ARENA_API_URL) || arena.DEFAULT_ARENA_API_URL;
const MLBB_ARENA_TIMEOUT_MS = parseBoundedNumber(
  process.env.MLBB_ARENA_TIMEOUT_MS,
  12000,
  1000,
  60000
);
const FULL_INFO_TIMEOUT_MS = parseBoundedNumber(
  process.env.FULL_INFO_TIMEOUT_MS,
  30000,
  800,
  120000
);
const TELEGRAPH_TIMEOUT_MS = parseBoundedNumber(
  process.env.TELEGRAPH_TIMEOUT_MS,
  10000,
  800,
  30000
);
const TELEGRAPH_ACCESS_TOKEN = cleanEnv(process.env.TELEGRAPH_ACCESS_TOKEN);
const FULL_INFO_RETRIES = parseBoundedNumber(
  process.env.FULL_INFO_RETRIES,
  2,
  0,
  3
);
// Moonton parolni tiklash endpoint'i Moonton serveriga ulanib xat yuboradi va
// odatda 12-30 soniya davom etadi (502 bo'lsa ~30 s). Shu sabab timeout keng.
const RESET_PW_TIMEOUT_MS = parseBoundedNumber(
  process.env.RESET_PW_TIMEOUT_MS,
  45000,
  800,
  120000
);
const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

if (!global.__MLBB_BOT_STATS__) {
  global.__MLBB_BOT_STATS__ = {
    starts: 0,
    checks: 0,
    successChecks: 0,
    failedChecks: 0,
    users: new Set(),
    broadcastChats: new Set(BROADCAST_USER_IDS),
    pendingBroadcasts: new Map(),
    pendingFeedbacks: new Map(),
    membershipCache: new Map(),
    inlineDedup: new Map(),
    userModes: new Map(),
    userProfiles: new Map(),
    errors: [],
    errorCounts: {},
    featureCounts: {},
    userActionCounts: new Map(),
    startNotifiedUsers: new Set(),
    languageCache: new Map(),
    commandsRegistered: false,
    startedAt: new Date().toISOString(),
    lastCheckAt: null,
    lastKnownUsersSyncAt: 0,
    supabaseAuthDisabledUntil: 0,
    supabaseLastAuthError: null,
    telegraphToken: null,
  };
}

if (!global.__MLBB_BOT_SETTINGS__) {
  global.__MLBB_BOT_SETTINGS__ = {
    mandatoryChannel: null,
    lastFetchedAt: 0,
  };
}

const stats = global.__MLBB_BOT_STATS__;
const botSettings = global.__MLBB_BOT_SETTINGS__;

// So'nggi so'rovning rejim do'koni. Vercel'da null (faqat RAM ishlaydi).
let activeUserModeStore = null;
stats.users ||= new Set();
stats.broadcastChats ||= new Set();
stats.pendingBroadcasts ||= new Map();
stats.membershipCache ||= new Map();
stats.inlineDedup ||= new Map();
if (!(stats.pendingFeedbacks instanceof Map)) {
  stats.pendingFeedbacks = new Map(Object.entries(stats.pendingFeedbacks || {}));
}
if (!(stats.userModes instanceof Map)) {
  stats.userModes = new Map(Object.entries(stats.userModes || {}));
}
if (!(stats.userProfiles instanceof Map)) {
  stats.userProfiles = new Map(Object.entries(stats.userProfiles || {}));
}
stats.errors ||= [];
stats.errorCounts ||= {};
stats.featureCounts ||= {};
if (!(stats.userActionCounts instanceof Map)) {
  stats.userActionCounts = new Map(Object.entries(stats.userActionCounts || {}));
}
stats.lastKnownUsersSyncAt ||= 0;
stats.supabaseAuthDisabledUntil ||= 0;
stats.supabaseLastAuthError ||= null;
if (!(stats.startNotifiedUsers instanceof Set)) {
  stats.startNotifiedUsers = new Set(Object.entries(stats.startNotifiedUsers || {}));
}
if (!(stats.languageCache instanceof Map)) {
  stats.languageCache = new Map();
}
BROADCAST_USER_IDS.forEach((chatId) => stats.broadcastChats.add(chatId));
BROADCAST_USER_IDS.forEach((chatId) => rememberKnownPrivateChat(chatId));

module.exports = async function handler(req, res, env = {}, ctx = null, extra = {}) {
  let update = null;

  activeUserModeStore = extra.userModeStore || null;

  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "TELEGRAM_BOT_TOKEN env topilmadi",
      });
    }

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        service: "MLBB Server Detector Bot",
        endpoint: "/api/bot",
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed",
      });
    }

    const secretHeader = getFirstHeader(
      req.headers,
      "x-telegram-bot-api-secret-token"
    );
    const secretQuery = getFirstValue(req.query?.secret);

    if (TELEGRAM_WEBHOOK_SECRET && !isValidWebhookSecret(secretHeader, secretQuery)) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized webhook request",
      });
    }

    update = parseRequestBody(req.body);
    await processUpdate(update, { env, ctx });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[BOT_ERROR]", error);
    recordError("bot_error", error.message, {
      chatId: getChatIdFromUpdate(update),
      updateId: update?.update_id,
    });

    const chatId = getChatIdFromUpdate(update);

    if (chatId) {
      await safeSendMessage(chatId, getErrorText(DEFAULT_LANG), mainKeyboard());
    }

    return res.status(200).json({
      ok: false,
      error: error.message,
    });
  }
};

async function processUpdate(update, options = {}) {
  if (!update || typeof update !== "object") {
    return;
  }

  const messageEntry = [
    ["message", update.message],
    ["edited_message", update.edited_message],
    ["channel_post", update.channel_post],
    ["edited_channel_post", update.edited_channel_post],
  ].find(([, value]) => value);

  if (messageEntry) {
    await handleMessage(messageEntry[1], {
      updateId: update.update_id,
      updateType: messageEntry[0],
      skipBindWait: update.__skip_bind_wait === true,
      bindWaitMessage: normalizeBindWaitMessage(update.__bind_wait_message),
      ctx: options.ctx || null,
    });
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(
      update.callback_query,
      {
        updateId: update.update_id,
        updateType: "callback_query",
      },
      options
    );
    return;
  }

  // Inline rejim: istalgan chatda @botusername + ID/server yozilsa tekshiradi.
  // Faqat Ulanmalar (bind) tekshiruvi — to'liq ma'lumot inline orqali qo'llab-quvvatlanmaydi.
  if (update.inline_query) {
    await handleInlineQuery(update.inline_query, {
      updateId: update.update_id,
      updateType: "inline_query",
      ctx: options.ctx || null,
    });
    return;
  }

  // Bot guruh/kanalga qo'shilganda yoki chiqarilganda
  if (update.my_chat_member) {
    await handleMyChatMemberUpdate(update.my_chat_member, update.update_id);
    return;
  }
}
const MEMBERSHIP_STATUS_OK = new Set(["creator", "administrator", "member"]);

async function checkUserMembership(chatId, userId) {
  try {
    const res = await telegram("getChatMember", { chat_id: chatId, user_id: userId });
    const member = res.result || {};

    // "restricted" statusi kick qilingan userlarda ham qaytadi (is_member: false),
    // shuning uchun alohida tekshiriladi.
    if (member.status === "restricted") {
      return member.is_member === true;
    }

    return MEMBERSHIP_STATUS_OK.has(member.status);
  } catch (err) {
    const message = String(err?.message || "");

    // Telegram aniq "user kanalda yo'q" dedi — bu haqiqiy "azo emas" javobi.
    if (/user not found|participant.*not found/i.test(message)) {
      return false;
    }

    // Boshqa barcha xatolar (timeout, 429, bot kanaldan chiqarilgan, kanal topilmadi,
    // noto'g'ri kanal ID) — bu config/infra muammo, user aybdor emas.
    // Xato sifatida yozamiz va xavfsizlik nuqtayi nazaridan "azo emas" deb hisoblaymiz,
    // LEKIN keshlamaymiz — keyingi so'rov yana tekshiradi.
    console.error("[CHECK_MEMBERSHIP_ERROR]", message);
    recordError("membership_check_failed", message, { chatId, userId });
    throw err;
  }
}

const MEMBERSHIP_CACHE_TTL_MS = 30 * 60 * 1000;
const MEMBERSHIP_CACHE_NEGATIVE_TTL_MS = 60 * 1000;

function getCachedUserAccess(userId) {
  const key = String(userId || "");
  const entry = stats.membershipCache.get(key);

  if (!entry) {
    return null;
  }

  const ttl = entry.member ? MEMBERSHIP_CACHE_TTL_MS : MEMBERSHIP_CACHE_NEGATIVE_TTL_MS;

  if (Date.now() - entry.at >= ttl) {
    stats.membershipCache.delete(key);
    return null;
  }

  return entry;
}

function cacheUserAccess(userId, { member, admin, at }) {
  const key = String(userId || "");

  if (!key) {
    return;
  }

  stats.membershipCache.set(key, {
    member: !!member,
    admin: !!admin,
    at: at || Date.now(),
  });
}

function prewarmUserAccess(user) {
  if (!user?.id || isAdmin(user.id)) {
    return Promise.resolve(true);
  }

  return enforceMandatoryMembership(null, user, { silent: true });
}
async function enforceMandatoryMembership(chatId, user, options = {}) {
  const silent = options.silent === true;

  if (isAdmin(user.id)) {
    cacheUserAccess(user.id, { member: true, admin: true });
    return true;
  }

  const cached = getCachedUserAccess(user.id);
  if (cached) {
    if (cached.member) {
      return true;
    }
    if (silent) {
      return false;
    }
  }

  const mandatoryChannel = await getMandatoryChannel();
  if (!mandatoryChannel) {
    cacheUserAccess(user.id, { member: true, admin: isAdmin(user.id) });
    return true;
  }

  let isMember = false;
  try {
    isMember = await checkUserMembership(mandatoryChannel.id, user.id);
  } catch (error) {
    // Telegram API muammosi — user aybdor emas, keshlamasdan o'tkazib yuboramiz.
    // Keyingi xabarda yana tekshiriladi.
    return true;
  }

  cacheUserAccess(user.id, { member: isMember, admin: isAdmin(user.id) });
  if (isMember) return true;

  if (silent) {
    return false;
  }

  const text = `⚠️ <b>Botdan foydalanish uchun guruhga qo'shilishingiz majburiy!</b>\n\nIltimos, quyidagi guruhga qo'shiling va botdan to'liq foydalanish imkoniga ega bo'ling.`;
  const keyboard = {
    inline_keyboard: [
      [{ text: "📣 A'zo bo'lish", url: mandatoryChannel.invite_link || `https://t.me/${mandatoryChannel.username}` }],
      [{ text: "✅ Qo'shilib keldim", callback_data: "check_membership" }]
    ]
  };

  await sendMessage(chatId, text, keyboard);
  return false;
}
async function handleMessage(message, updateMeta = {}) {
  if (!message?.chat?.id) {
    return;
  }

  const chatId = message.chat.id;
  const text = String(message.text || "").trim();
  const user = message.from || {};
  const skipBindWait = updateMeta.skipBindWait === true;
  const bindWaitMessage = updateMeta.bindWaitMessage || null;
  const ctx = updateMeta.ctx || null;

  trackUser(user, message.chat, {
    ...updateMeta,
  });

  // Load user's preferred language from cache or Supabase.
  // SQL NULL (preferred_language) means the user never chose a language;
  // a stored value (including "uz") means an explicit choice that must win
  // over the Telegram language_code.
  if (user.id && !stats.languageCache.has(String(user.id))) {
    const storedLang = await loadUserLangFromSupabase(user.id);
    const lang = storedLang || inferTranslationsLang(user.language_code);
    setUserLang(user.id, lang || DEFAULT_LANG);
  }

  if (!isGroupChat(message.chat)) {
    const isAllowed = await enforceMandatoryMembership(chatId, user);
    if (!isAllowed) return;
  }

  // "Akkaunt qo'shish" rejimi — foydalanuvchi User ID + Zone ID yuboradi.
  // Reply qilish shart emas: oddiy xabar ham qabul qilinadi.
  if (!isGroupChat(message.chat) && text) {
    const userMode = await resolveUserMode(user.id);
    const isProfileAdd = userMode === "profile_add" || isProfileAddPromptReply(message);

    if (isProfileAdd && !/^[/!.]/.test(text) && !isCommandLike(text)) {
      await handleProfileAddAccount(chatId, user, text);
      return;
    }

    if (isProfileAdd && (/^[/!.]/.test(text) || isCommandLike(text))) {
      clearUserMode(user.id);
    }

    // "Mobile Legends'ga ulash" — o'yin pochtasiga kelgan kod kutilmoqda.
    // Faqat raqamli xabar kod deb olinadi; boshqa matn/tugma rejimni yopadi.
    const mlCodeState = parseMlCodeMode(userMode);
    if (mlCodeState) {
      if (/^[\d\s-]+$/.test(text)) {
        await handleMlCodeInput(chatId, user, text, mlCodeState);
        return;
      }
      clearUserMode(user.id);
    }
  }

  const checkUserMatch = text.match(/(?:@(\w+)|\b(\d+)\b)\s+user botdan foydalanganmi\?/i);
  if (checkUserMatch) {
    if (!isAdmin(user.id) || String(chatId) !== MAIN_GROUP_ID) {
      return;
    }
    
    const targetUsername = checkUserMatch[1];
    const targetId = checkUserMatch[2];
    
    let queryPath = "";
    if (targetUsername) {
      queryPath = `/bot_users?username=ilike.${encodeURIComponent(targetUsername)}&select=updates_count,last_seen_at&limit=1`;
    } else if (targetId) {
      queryPath = `/bot_users?user_id=eq.${encodeURIComponent(targetId)}&select=updates_count,last_seen_at&limit=1`;
    }

    if (queryPath) {
      void safeSendChatAction(chatId, "typing");
      try {
        const data = await supabaseRequest(queryPath);
        const userStat = Array.isArray(data) ? data[0] : null;
        
        if (userStat) {
          const updatesCount = userStat.updates_count || 0;
          const lastSeen = userStat.last_seen_at ? new Date(userStat.last_seen_at).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" }) : "Noma'lum";
          await sendMessage(chatId, `📊 Foydalanuvchi botdan <b>${updatesCount}</b> marta foydalangan.\n🕒 Oxirgi faollik: <b>${lastSeen}</b> (Toshkent vaqti)`, null);
        } else {
          await sendMessage(chatId, "❌ Foydalanuvchi topilmadi yoxud u hali botdan foydalanmagan.", null);
        }
      } catch (err) {
        console.error("[CHECK_USER_STAT_ERROR]", err);
        await sendMessage(chatId, "⚠️ Ma'lumotni olishda xatolik yuz berdi.", null);
      }
      return;
    }
  }

  // {username/tgid} user haqida malumot — faqat main guruhda
  const userInfoMatch = text.match(/(?:@(\w+)|\b(\d+)\b)\s+user\s+haqida\s+malumot/i);
  if (userInfoMatch && String(chatId) === MAIN_GROUP_ID) {
    const targetUsername = userInfoMatch[1];
    const targetId = userInfoMatch[2];

    let queryPath = "";
    if (targetUsername) {
      queryPath = `/bot_users?username=ilike.${encodeURIComponent(targetUsername)}&select=user_id,updates_count,last_seen_at,username,first_name&limit=1`;
    } else if (targetId) {
      queryPath = `/bot_users?user_id=eq.${encodeURIComponent(targetId)}&select=user_id,updates_count,last_seen_at,username,first_name&limit=1`;
    }

    if (queryPath) {
      void safeSendChatAction(chatId, "typing");
      try {
        const data = await supabaseRequest(queryPath);
        const userStat = Array.isArray(data) ? data[0] : null;

        if (!userStat) {
          await sendMessage(chatId, "\u274c Foydalanuvchi topilmadi yoxud u hali botdan foydalanmagan.", null);
          return;
        }

        const targetUserId = userStat.user_id;
        const displayName = userStat.first_name || targetUsername || String(targetUserId);
        const updatesCount = userStat.updates_count || 0;

        // Parolni tiklash (reset pw) qoldig'i
        let resetPwRemaining = "N/A";
        try {
          const resetPwQuota = await supabaseRpc("get_reset_pw_quota", {
            p_user_id: toPgBigint(targetUserId),
          });
          if (resetPwQuota && typeof resetPwQuota.remaining === "number") {
            resetPwRemaining = resetPwQuota.remaining;
          }
        } catch (err) {
          console.error("[USER_INFO_RESET_PW_ERROR]", err.message);
        }

        // To'liq malumot (full info) qoldig'i
        let fullInfoRemaining = "N/A";
        try {
          const fullInfoQuota = await supabaseRpc("get_full_info_quota", {
            p_user_id: toPgBigint(targetUserId),
          });
          if (fullInfoQuota && typeof fullInfoQuota.remaining === "number") {
            fullInfoRemaining = fullInfoQuota.remaining;
          }
        } catch (err) {
          console.error("[USER_INFO_FULL_INFO_ERROR]", err.message);
        }

        const lines = [
          `\ud83d\udccc <b>${escapeHtml(displayName)}</b> haqida ma'lumot`,
          "",
          `\ud83d\udc64 <b>Telegram ID:</b> <code>${targetUserId}</code>`,
          targetUsername ? `\ud83d\udc64 <b>Username:</b> @${escapeHtml(targetUsername)}` : null,
          "",
          `\ud83d\udcca <b>Jami tekshirishlar:</b> ${updatesCount}`,
          `\ud83d\udd10 <b>Parolni tiklash qoldig'i:</b> ${resetPwRemaining}`,
          `\ud83d\udccb <b>To'liq malumot qoldig'i:</b> ${fullInfoRemaining}`,
        ].filter(Boolean);

        await sendMessage(chatId, lines.join("\n"), null);
      } catch (err) {
        console.error("[USER_INFO_ERROR]", err);
        await sendMessage(chatId, "\u26a0\ufe0f Malumotni olishda xatolik yuz berdi.", null);
      }
      return;
    }
  }

  // Feedback javobi — guruhda ham ishlashi kerak (admin reply qilganda)
  if (isFeedbackAdminReply(message)) {
    await handleFeedbackAdminReply(chatId, user, message);
    return;
  }

  if (isGroupChat(message.chat)) {
    const addressing = getGroupAddressing(message);
    const addressedText = addressing.commandText || addressing.input;

    if (!addressing.addressed) {
      return;
    }

    // Guruhda botdan foydalanayotgan foydalanuvchi majburiy guruh/kanalga
    // obuna bo'lganligi ham tekshiriladi — obuna bo'lmaguncha bot ishlatilmaydi.
    const isAllowed = await enforceMandatoryMembership(chatId, user);
    if (!isAllowed) return;

    if (isBindInfoCommand(addressedText) || isBindInfoCommand(addressing.input)) {
      const bindInput = stripBindInfoCommand(addressedText);

      if (!bindInput) {
        const promptPromise = sendMessage(chatId, getBindInfoPromptText(), null);
        await warnIfBindLimitReached(chatId, user, null);
        await promptPromise;
        return;
      }

      await handleBindInfoRequest(chatId, bindInput, user, {
        replyMarkup: null,
        skipWait: skipBindWait,
        waitMessage: bindWaitMessage,
        ctx,
      });
      return;
    }

    if (isFullInfoCommand(addressedText) || isFullInfoCommand(addressing.input)) {
      const fullInput = stripFullInfoCommand(addressedText);

      if (!fullInput) {
        await sendMessage(chatId, getFullInfoPromptText(getUserLang(user.id)), null);
        return;
      }

      await handleFullInfoRequest(chatId, fullInput, user, {
        replyMarkup: null,
        skipWait: skipBindWait,
        waitMessage: bindWaitMessage,
        ctx,
      });
      return;
    }

    if (isResetPwCommand(addressedText) || isResetPwCommand(addressing.input)) {
      const resetInput = stripResetPwCommand(addressedText);

      if (!resetInput) {
        await sendMessage(chatId, getResetPwPromptText(getUserLang(user.id)), null);
        return;
      }

      await handleResetPwRequest(chatId, resetInput, user, {
        replyMarkup: null,
        skipWait: skipBindWait,
        waitMessage: bindWaitMessage,
        ctx,
      });
      return;
    }

    if (!addressing.input) {
      await sendMessage(chatId, getCheckPromptText(), null);
      return;
    }

    await detectAndReply(chatId, addressing.input, user, {
      replyMarkup: null,
      ctx,
    });
    return;
  }

  if (isFeedbackSubmissionMessage(message, user)) {
    await handleFeedbackSubmission(chatId, user, message);
    return;
  }

  // Do'kon: tugmalari va "shop" rejimi. Rejimda oddiy matn (ID + server)
  // tekshiruvga yuborilmaydi — boshqa funksiyalar o'chiq turadi.
  if (text && (await handleShopMessage(chatId, user, text))) {
    return;
  }

  if (!text) {
    await sendMessage(chatId, getCheckPromptText(), checkKeyboard(user));
    return;
  }

  if (isCommand(text, "start")) {
    stats.starts += 1;
    trackFeatureUse(user, message.chat, FEATURE_ACTIONS.START, updateMeta);
    maybeRegisterBotCommands();

    // Foydalanuvchi ma'lumotlarini oldindan cache'ga to'ldiramiz (admin/member
    // holati) — keyingi so'rovlar Telegram API ga murojaat qilmay tez ishlaydi.
    void prewarmUserAccess(user).catch(() => {});

    await sendMessage(chatId, getStartText(user), mainKeyboard(user));
    
    // Yangi foydalanuvchi bildirishnomasi — fonda (webhook kechiktirmasdan)
    if (MAIN_GROUP_ID && String(chatId) !== MAIN_GROUP_ID) {
      void notifyMainGroupIfNewUser(user).catch(() => {});
    }
    
    return;
  }

  if (isCommand(text, "help")) {
    await sendMessage(chatId, getHelpText(user), mainKeyboard(user));
    return;
  }

  if (isCommand(text, "commands")) {
    await sendMessage(chatId, getCommandsText(user), mainKeyboard(user));
    return;
  }

  if (isCommand(text, "language") || isCommand(text, "til")) {
    await handleLanguageCommand(chatId, user);
    return;
  }

  if (isCommand(text, "stat") || isCommand(text, "stats")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleStatsRequest(chatId, user, 0);
    return;
  }

  if (isCommand(text, "users") || isCommand(text, "foydalanuvchilar")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleUsersListRequest(chatId, user, 0);
    return;
  }

  if (isCommand(text, "errors") || isCommand(text, "xatoliklar")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleErrorsRequest(chatId, user);
    return;
  }

  if (isCommand(text, "emoji")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleEmojiIdRequest(chatId, user, message);
    return;
  }

  if (isCommand(text, "feedback") || isCommand(text, "fikr")) {
    await handleFeedbackPrompt(chatId, user);
    return;
  }

  if (isCommand(text, "cancel") || isCommand(text, "bekor")) {
    if (clearPendingFeedback(user.id)) {
      await sendMessage(chatId, "Fikr yuborish bekor qilindi.", mainKeyboard(user));
      return;
    }
  }

  if (isCommand(text, "message")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleMessageCommand(chatId, user, message);
    return;
  }

  if (isCommand(text, "check")) {
    const input = stripCommand(text, "check");
    rememberUserMode(user.id, "server_check");

    if (!input) {
      await sendMessage(chatId, getCheckPromptText(), checkKeyboard(user));
      return;
    }

    await detectAndReply(chatId, input, user, { ctx });
    return;
  }

  if (isCommand(text, "limit_fullinfo")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleLimitFullInfoCommand(chatId, user, stripCommand(text, "limit_fullinfo"));
    return;
  }

  if (isCommand(text, "limit_resetpw")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleLimitResetPwCommand(chatId, user, stripCommand(text, "limit_resetpw"));
    return;
  }

  if (isFullInfoCommand(text)) {
    const input = stripFullInfoCommand(text);
    rememberUserMode(user.id, "full_info");

    if (!input) {
      await sendMessage(chatId, getFullInfoPromptText(getUserLang(user.id)), fullInfoForceReply(getUserLang(user.id)));
      return;
    }

    await handleFullInfoRequest(chatId, input, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
    });
    return;
  }

  if (isResetPwCommand(text)) {
    const input = stripResetPwCommand(text);
    rememberUserMode(user.id, "reset_pw");

    if (!input) {
      await sendMessage(chatId, getResetPwPromptText(getUserLang(user.id)), resetPwForceReply(getUserLang(user.id)));
      return;
    }

    await handleResetPwRequest(chatId, input, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
    });
    return;
  }

  if (isBindInfoCommand(text)) {
    const input = stripBindInfoCommand(text);

    if (!input) {
      rememberUserMode(user.id, "bind_info");
      const promptPromise = sendMessage(chatId, getBindInfoPromptText(), mainKeyboard(user));
      await warnIfBindLimitReached(chatId, user, mainKeyboard(user));
      await promptPromise;
      return;
    }

    rememberUserMode(user.id, "bind_info");
    await handleBindInfoRequest(chatId, input, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
    });
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_check") || isTranslatedKeyboardButton(text, "btn_check_again")) {
    rememberUserMode(user.id, "server_check");
    await sendMessage(chatId, getCheckPromptText(), mainKeyboard(user));
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_bind_info")) {
    rememberUserMode(user.id, "bind_info");
    const promptPromise = sendMessage(chatId, getBindInfoPromptText(), bindInfoForceReply(getUserLang(user.id)));
    await warnIfBindLimitReached(chatId, user, mainKeyboard(user));
    await promptPromise;
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_full_info")) {
    rememberUserMode(user.id, "full_info");
    await sendMessage(chatId, getFullInfoPromptText(getUserLang(user.id)), fullInfoForceReply(getUserLang(user.id)));
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_reset_pw")) {
    rememberUserMode(user.id, "reset_pw");
    await sendMessage(chatId, getResetPwPromptText(getUserLang(user.id)), resetPwForceReply(getUserLang(user.id)));
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_feedback")) {
    await handleFeedbackPrompt(chatId, user);
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_help")) {
    await sendMessage(chatId, getHelpText(user), mainKeyboard(user));
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_commands")) {
    await sendMessage(chatId, getCommandsText(user), mainKeyboard(user));
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_menu")) {
    await sendMessage(chatId, getStartText(user), mainKeyboard(user));
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_language")) {
    await handleLanguageCommand(chatId, user);
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_stats")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleStatsRequest(chatId, user, 0);
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_users")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleUsersListRequest(chatId, user, 0);
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_errors")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleErrorsRequest(chatId, user);
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_broadcast")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await sendMessage(chatId, getBroadcastUsageText(), mainKeyboard(user));
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_my_profile")) {
    await handleMyProfileRequest(chatId, user);
    return;
  }

  if (isCommand(text, "unset_mandatory")) {
    if (!isAdmin(user.id)) return;
    await setMandatoryChannel(null);
    await sendMessage(chatId, "✅ Majburiy guruh o'chirildi.", mainKeyboard(user));
    return;
  }

  if (isTranslatedKeyboardButton(text, "btn_mandatory_setup")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }
    rememberUserMode(user.id, "mandatory_setup");
    const current = await getMandatoryChannel();
    let msg = "<b>⚙️ Majburiy guruh sozlamalari</b>\n\n";
    if (current) {
      msg += `Hozirgi guruh: <b>${current.title}</b> (${current.id})\n\n`;
      msg += "Yangi guruhni o'rnatish uchun guruh ID sini (yoki @username) yuboring. O'chirish uchun /unset_mandatory buyrug'ini bosing.";
    } else {
      msg += "Hozirda hech qanday guruh majburiy emas.\n\nGuruhni o'rnatish uchun uning ID sini (yoki @username) yuboring. Eslatma: Bot o'sha guruh yoki kanalda admin bo'lishi shart!";
    }
    await sendMessage(chatId, msg, mainKeyboard(user));
    return;
  }

  if (getUserMode(user.id) === "mandatory_setup") {
    if (!isAdmin(user.id)) return;
    clearUserMode(user.id);
    try {
      const res = await telegram("getChat", { chat_id: text });
      const chat = res.result;
      const confirmText = `<b>${chat.title}</b> (${chat.id}) guruhini majburiy qilib belgilansinmi?`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ Ha", callback_data: `confirm_mandatory:${chat.id}` },
            { text: "❌ Yo'q", callback_data: "cancel_mandatory" }
          ]
        ]
      };
      await sendMessage(chatId, confirmText, keyboard);
    } catch (err) {
      await sendMessage(chatId, `❌ Guruh topilmadi yoki bot u yerda admin emas:\n<code>${err.message}</code>`, mainKeyboard(user));
    }
    return;
  }

  if (isBindInfoPromptReply(message)) {
    rememberUserMode(user.id, "bind_info");
    await handleBindInfoRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
      ctx,
    });
    return;
  }

  if (getUserMode(user.id) === "bind_info") {
    await handleBindInfoRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
      ctx,
    });
    return;
  }

  if (isFullInfoPromptReply(message)) {
    rememberUserMode(user.id, "full_info");
    await handleFullInfoRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
      ctx,
    });
    return;
  }

  if (getUserMode(user.id) === "full_info") {
    await handleFullInfoRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
      ctx,
    });
    return;
  }

  if (isResetPwPromptReply(message)) {
    rememberUserMode(user.id, "reset_pw");
    await handleResetPwRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
      ctx,
    });
    return;
  }

  if (getUserMode(user.id) === "reset_pw") {
    await handleResetPwRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
      ctx,
    });
    return;
  }

  // Shaxsiy chatda to'g'ridan-to'g'ri email yuborilsa ham parol tiklashni
  // boshlaymiz (force_reply'siz holatlar uchun qulaylik).
  if (!isGroupChat(message.chat) && isValidEmailFormat(text)) {
    rememberUserMode(user.id, "reset_pw");
    await handleResetPwRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
      ctx,
    });
    return;
  }

  if (getUserMode(user.id) === "server_check") {
    await detectAndReply(chatId, text, user, { ctx });
    return;
  }

  const parsed = parseMlbbInput(text);

  if (parsed.ok) {
    await detectAndReply(chatId, text, user, { ctx });
    return;
  }

  await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
}

async function handleMyChatMemberUpdate(chatMember, updateId) {
  const chat = chatMember.chat || {};
  const newMember = chatMember.new_chat_member || {};
  const oldMember = chatMember.old_chat_member || {};

  const botId = newMember.user?.id || oldMember.user?.id;
  if (!botId) return;

  const chatId = chat.id;
  const chatTitle = chat.title || "Noma'lum guruh";

  const wasAdmin = oldMember.status === "administrator" || oldMember.status === "creator";
  const isAdmin = newMember.status === "administrator" || newMember.status === "creator";
  const wasMember = oldMember.status !== "left" && oldMember.status !== "kicked";
  const isMember = newMember.status !== "left" && newMember.status !== "kicked";

  // Bot qo'shilgan
  if (!wasMember && isMember) {
    console.log(`[BOT_ADDED] Bot ${chatTitle} (${chatId}) guruhiga qo'shildi. Admin: ${isAdmin}`);

    // Majburiy guruh sifatida o'rnatilgan bo'lsa, adminlikni tekshiramiz
    const mandatory = await getMandatoryChannel();
    if (mandatory && String(mandatory.id) === String(chatId)) {
      if (!isAdmin) {
        // Admin emasligini xabar qilamiz
        const adminIds = await getAdminIds();
        for (const adminId of adminIds) {
          try {
            await sendMessage(
              adminId,
              `⚠️ <b>${escapeHtml(chatTitle)}</b> guruhida bot admin emas!\n\nMajburiy guruh sifatida ishlashi uchun botni guruhda admin qiling.\n\nGuruh ID: <code>${chatId}</code>`
            );
          } catch (e) {
            // Xabarni yuborib bo'lmadi
          }
        }
      }
    }
    return;
  }

  // Bot chiqarilgan
  if (wasMember && !isMember) {
    console.log(`[BOT_REMOVED] Bot ${chatTitle} (${chatId}) guruhidan chiqarildi.`);

    // Majburiy guruh bo'lsa, o'chiramiz
    const mandatory = await getMandatoryChannel();
    if (mandatory && String(mandatory.id) === String(chatId)) {
      try {
        await setMandatoryChannel(null);
        console.log(`[MANDATORY_CLEARED] Majburiy guruh o'chirildi: bot chiqarildi`);
      } catch (e) {
        console.error("[MANDATORY_CLEAR_ERROR]", e.message);
      }
    }
    return;
  }

  // Adminlik holati o'zgargan
  if (wasAdmin !== isAdmin) {
    console.log(`[BOT_ADMIN_CHANGED] Bot ${chatTitle} (${chatId}) adminlik: ${wasAdmin} → ${isAdmin}`);

    const mandatory = await getMandatoryChannel();
    if (mandatory && String(mandatory.id) === String(chatId)) {
      const adminIds = await getAdminIds();
      for (const adminId of adminIds) {
        try {
          await sendMessage(
            adminId,
            isAdmin
              ? `✅ <b>${escapeHtml(chatTitle)}</b> guruhida bot endi admin!`
              : `⚠️ <b>${escapeHtml(chatTitle)}</b> guruhida bot adminlikdan chiqarildi!\nMajburiy guruh sifatida ishlashi uchun botni admin qiling.`
          );
        } catch (e) {
          // Xabarni yuborib bo'lmadi
        }
      }
    }
  }
}

async function getAdminIds() {
  try {
    const data = await supabaseRequest(`/admin_settings?key=eq.admin_ids&select=value&limit=1`);
    if (Array.isArray(data) && data.length > 0 && data[0]?.value?.ids) {
      return data[0].value.ids;
    }
  } catch (e) {
    // ignore
  }
  return ADMIN_IDS || [];
}

async function handleCallbackQuery(callbackQuery, updateMeta = {}, options = {}) {
  if (!callbackQuery?.id) {
    return;
  }

  const data = String(callbackQuery.data || "");
  const chatId = callbackQuery.message?.chat?.id;
  const user = callbackQuery.from || {};

  trackUser(user, callbackQuery.message?.chat, {
    ...updateMeta,
  });

  if (data === "check_membership") {
    const mandatoryChannel = await getMandatoryChannel();
    if (mandatoryChannel) {
      let isMember = false;
      try {
        isMember = await checkUserMembership(mandatoryChannel.id, user.id);
      } catch (error) {
        // Telegram API muammosi — userga noto'g'ri "azo emas" demaymiz.
        await telegram("answerCallbackQuery", {
          callback_query_id: callbackQuery.id,
          text: "⚠️ Tekshiruvda vaqtincha xatolik. Birozdan keyin yana bosing.",
          show_alert: true,
        });
        return;
      }

      if (isMember) {
        cacheUserAccess(user.id, { member: true, admin: isAdmin(user.id) });
        await safeDeleteMessage(chatId, callbackQuery.message?.message_id);
        await telegram("answerCallbackQuery", { callback_query_id: callbackQuery.id, text: "✅ A'zolik tasdiqlandi!" });
        await sendMessage(chatId, "✅ Guruhga a'zo bo'lganingiz tasdiqlandi. Botdan bemalol foydalanishingiz mumkin!", mainKeyboard(user));
        await sendMessage(chatId, getStartText(user), mainKeyboard(user));
        if (MAIN_GROUP_ID) {
          const userLink = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${escapeHtml(user.first_name) || 'Foydalanuvchi'}</a>`;
          await sendMessage(MAIN_GROUP_ID, `#yangi_obunachi\n\n🆕 <b>Yangi a'zo:</b> ${userLink}\nUshbu foydalanuvchi majburiy guruhga a'zo bo'ldi va botdan foydalanish huquqiga ega bo'ldi.`);
        }
      } else {
        await telegram("answerCallbackQuery", { callback_query_id: callbackQuery.id, text: "❌ Siz hali guruhga a'zo bo'lmadingiz! Iltimos guruhga qo'shiling.", show_alert: true });
      }
    } else {
       await safeDeleteMessage(chatId, callbackQuery.message?.message_id);
       await answerCallbackQuery(callbackQuery.id);
    }
    return;
  }

  if (callbackQuery.message) {
    const inGroup = isGroupChat(callbackQuery.message.chat);
    const isAllowed = await enforceMandatoryMembership(chatId, user, { silent: inGroup });
    if (!isAllowed) {
      if (inGroup) {
        await telegram("answerCallbackQuery", {
          callback_query_id: callbackQuery.id,
          text: "⚠️ Botdan foydalanish uchun majburiy guruh/kanalga a'zo bo'ling.",
          show_alert: true,
        });
      } else {
        await answerCallbackQuery(callbackQuery.id);
      }
      return;
    }
  }

  await answerCallbackQuery(callbackQuery.id);

  if (!chatId) {
    return;
  }

  if (data.startsWith("confirm_mandatory:")) {
    if (!isAdmin(user.id)) return;
    const targetChatId = data.split(":")[1];
    try {
      const res = await telegram("getChat", { chat_id: targetChatId });
      const chat = res.result;
      const inviteLink = chat.invite_link || (chat.username ? `https://t.me/${chat.username}` : null);
      if (!inviteLink) {
         await telegram("answerCallbackQuery", { callback_query_id: callbackQuery.id, text: "❌ Guruhning public username yoki invite linki yo'q. Avval link yarating.", show_alert: true });
         return;
      }
      await setMandatoryChannel({ id: chat.id, title: chat.title, invite_link: inviteLink, username: chat.username, chatType: chat.type });
      await safeDeleteMessage(chatId, callbackQuery.message?.message_id);
      await sendMessage(chatId, `✅ <b>${chat.title}</b> majburiy guruh etib belgilandi!`, mainKeyboard(user));
    } catch (err) {
      await telegram("answerCallbackQuery", { callback_query_id: callbackQuery.id, text: "Xatolik: " + err.message, show_alert: true });
    }
    return;
  }

  if (data === "cancel_mandatory") {
    if (!isAdmin(user.id)) return;
    await safeDeleteMessage(chatId, callbackQuery.message?.message_id);
    await sendMessage(chatId, "Bekor qilindi.", mainKeyboard(user));
    return;
  }

  if (data.startsWith("broadcast_confirm:")) {
    await handleBroadcastConfirm(chatId, user, data, options);
    return;
  }

  if (data.startsWith("broadcast_cancel:")) {
    await handleBroadcastCancel(chatId, user, data);
    return;
  }

  if (data === "detect_server" || data === "check_again") {
    await sendMessage(chatId, getCheckPromptText(), checkKeyboard(user));
    return;
  }

  if (data === "stats") {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleStatsRequest(chatId, user, 0, callbackQuery.message?.message_id);
    return;
  }

  if (data.startsWith("stats_today_page:")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleStatsRequest(
      chatId,
      user,
      parsePageFromCallback(data, "stats_today_page"),
      callbackQuery.message?.message_id
    );
    return;
  }

  if (data.startsWith("users_page:")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleUsersListRequest(
      chatId,
      user,
      parsePageFromCallback(data, "users_page"),
      callbackQuery.message?.message_id
    );
    return;
  }

  if (data === "errors") {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    await handleErrorsRequest(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data === "menu") {
    await sendMessage(chatId, getStartText(user), mainKeyboard(user));
    return;
  }

  if (data.startsWith("lang_select:")) {
    const selectedLang = data.split(":")[1];
    if (SUPPORTED_LANGS.includes(selectedLang) && user.id) {
      setUserLang(user.id, selectedLang);
      void saveUserLangToSupabase(user.id, selectedLang);
      void registerBotCommands();
      await telegram("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: t("lang_changed", selectedLang, { langName: t(`lang_${selectedLang}`, selectedLang) }),
      });
      if (callbackQuery.message) {
        await safeDeleteMessage(chatId, callbackQuery.message.message_id);
      }
      await sendMessage(chatId, t("lang_changed", selectedLang, { langName: t(`lang_${selectedLang}`, selectedLang) }), mainKeyboard(user));
    } else {
      await telegram("answerCallbackQuery", { callback_query_id: callbackQuery.id });
    }
    return;
  }

  if (data === "my_profile") {
    await handleMyProfileRequest(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data === "profile_add") {
    await handleProfileAddPrompt(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data === "profile_add_cancel") {
    clearUserMode(user.id);
    await handleMyProfileRequest(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data === "profile_menu") {
    clearUserMode(user.id);
    await handleMyProfileRequest(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data === "profile_unlink") {
    await handleProfileUnlinkMenu(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data.startsWith("profile_unlink:")) {
    const accountId = data.split(":")[1];
    await handleProfileUnlinkConfirm(chatId, user, accountId, callbackQuery.message?.message_id);
    return;
  }

  if (data === "profile_viewers") {
    await handleProfileViewersRequest(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data === "ml_link_menu") {
    await handleMlLinkMenu(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data.startsWith("ml_link:")) {
    await handleMlLinkStart(chatId, user, data.slice("ml_link:".length), callbackQuery.message?.message_id);
    return;
  }

  if (data === "ml_link_no") {
    await handleMlLinkDecline(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data === "ml_link_cancel") {
    clearUserMode(user.id);
    await handleMyProfileRequest(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data.startsWith("shop_")) {
    await handleShopCallback(chatId, user, data, callbackQuery.message?.message_id);
    return;
  }
}

async function handleMyProfileRequest(chatId, user, messageId = null) {
  const lang = getUserLang(user.id);
  const displayName = user.first_name || user.username || String(user.id);

  void safeSendChatAction(chatId, "typing");

  // 1. Parolni tiklash (reset pw) qoldig'i
  let resetPwRemaining = "N/A";
  try {
    const resetPwQuota = await supabaseRpc("get_reset_pw_quota", {
      p_user_id: toPgBigint(user.id),
    });
    if (resetPwQuota && typeof resetPwQuota.remaining === "number") {
      resetPwRemaining = resetPwQuota.remaining;
    }
  } catch (err) {
    console.error("[MY_PROFILE_RESET_PW_ERROR]", err.message);
  }

  // 2. To'liq malumot (full info) qoldig'i
  let fullInfoRemaining = "N/A";
  try {
    const fullInfoQuota = await supabaseRpc("get_full_info_quota", {
      p_user_id: toPgBigint(user.id),
    });
    if (fullInfoQuota && typeof fullInfoQuota.remaining === "number") {
      fullInfoRemaining = fullInfoQuota.remaining;
    }
  } catch (err) {
    console.error("[MY_PROFILE_FULLINFO_ERROR]", err.message);
  }

  // 3. Akkauntlar ro'yxati
  let accounts = [];
  try {
    const accResult = await supabaseRpc("list_user_accounts", {
      p_user_id: toPgBigint(user.id),
    });
    accounts = Array.isArray(accResult) ? accResult : [];
  } catch (err) {
    console.error("[MY_PROFILE_ACCOUNTS_ERROR]", err.message);
    accounts = [];
  }

  const lines = [
    t("profile_title", lang, { name: escapeHtml(displayName) }),
    "",
  ];

  // Akkauntlar bo'limi
  lines.push(t("profile_accounts_title", lang, { count: accounts.length, max: ACCOUNT_MAX_COUNT }));
  if (accounts.length === 0) {
    lines.push(t("profile_accounts_empty", lang));
  } else {
    accounts.forEach(function (acc, index) {
      const item = t("profile_account_item", lang, {
        index: index + 1,
        accountId: acc.account_id,
        zoneId: acc.zone_id,
      });
      lines.push(acc.ml_linked
        ? `${item} ${t("ml_linked_badge", lang, { nickname: escapeHtml(acc.ml_nickname || "") }).trim()}`
        : item);
    });
  }

  lines.push(
    "",
    t("profile_reset_pw", lang, { remaining: resetPwRemaining }),
    t("profile_full_info", lang, { remaining: fullInfoRemaining })
  );

  await sendOrEditAdminMessage(chatId, messageId, lines.join("\n"), buildMyProfileKeyboard(lang, accounts, chatId));
}

// Profil postida faqat "Shaxsiy kabinet" tugmasi — akkaunt qo'shish/uzish,
// MLBB'ga ulash, kimlar tekshirgani va h.k. hammasi kabinetning ichida.
// Eski postlardagi callback tugmalari (profile_add, ml_link_menu, ...) baribir
// ishlab turadi.
function buildMyProfileKeyboard(lang, accounts = [], chatId = null) {
  // web_app inline tugmasi faqat shaxsiy chatda ishlaydi — guruhda botning
  // shaxsiy chatiga havola beriladi.
  if (Number(chatId) > 0) {
    return { inline_keyboard: [[{ text: t("profile_cabinet_btn", lang), web_app: { url: CABINET_MINIAPP_URL } }]] };
  }

  if (TELEGRAM_BOT_USERNAME) {
    return { inline_keyboard: [[{ text: t("profile_cabinet_btn", lang), url: `https://t.me/${TELEGRAM_BOT_USERNAME}` }]] };
  }

  return { inline_keyboard: [] };
}

// ---------------------------------------------------------------------------
// 🛒 Do'kon (shop)
// ---------------------------------------------------------------------------
const SHOP_MODE = "shop";
const SHOP_FM_PAGE_SIZE = 10;

// Asosiy klaviatura tugmalari: shop rejimida bosilsa, user do'kondan chiqib
// o'sha funksiyaga o'tadi (eski klaviatura qolib ketgan holatlar uchun).
const SHOP_EXIT_BUTTON_KEYS = [
  "btn_check",
  "btn_check_again",
  "btn_bind_info",
  "btn_full_info",
  "btn_reset_pw",
  "btn_language",
  "btn_stats",
  "btn_users",
  "btn_my_profile",
  "btn_menu",
  "btn_help",
  "btn_commands",
  "btn_feedback",
];

function shopKeyboard(user = {}) {
  const lang = getUserLang(user.id);

  return {
    keyboard: [
      [{ text: t("btn_shop_firstmail", lang) }],
      [{ text: t("btn_shop_back", lang) }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

let firstmailStore = null;

function getFirstmailStore() {
  if (!firstmailStore) {
    firstmailStore = shop.createFirstmailStore((path, options) => supabaseRequest(path, options));
  }

  return firstmailStore;
}

async function handleShopMessage(chatId, user, text) {
  if (isTranslatedKeyboardButton(text, "btn_shop")) {
    await handleShopOpen(chatId, user);
    return true;
  }

  if (isTranslatedKeyboardButton(text, "btn_shop_firstmail")) {
    rememberUserMode(user.id, SHOP_MODE);
    await handleShopFirstmailList(chatId, user, 0);
    return true;
  }

  if (isTranslatedKeyboardButton(text, "btn_shop_back")) {
    clearUserMode(user.id);
    await sendMessage(chatId, t("shop_left", getUserLang(user.id)), mainKeyboard(user));
    return true;
  }

  const mode = await resolveUserMode(user.id);

  if (mode !== SHOP_MODE) {
    return false;
  }

  // Buyruqlar (/start, /check, ...) va asosiy menyu tugmalari — aniq niyat:
  // do'kondan chiqamiz va xabarni odatdagidek ishlashga qo'yamiz.
  if (isCommandLike(text) || SHOP_EXIT_BUTTON_KEYS.some((key) => isTranslatedKeyboardButton(text, key))) {
    clearUserMode(user.id);
    return false;
  }

  await sendMessage(chatId, t("shop_mode_blocked", getUserLang(user.id)), shopKeyboard(user));
  return true;
}

async function handleShopOpen(chatId, user) {
  rememberUserMode(user.id, SHOP_MODE);
  await sendMessage(chatId, t("shop_welcome", getUserLang(user.id)), shopKeyboard(user));
}

async function loadShopFirstmails() {
  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return null;
  }

  try {
    return await getFirstmailStore().list();
  } catch (error) {
    console.error("[SHOP_FM_LIST_ERROR]", error);
    recordError("shop_fm_list_failed", error.message);
    return null;
  }
}

function getShopPriceText(item, lang) {
  return shop.formatShopPrice(item?.price, lang === "uz" ? "so'm" : lang === "ru" ? "сум" : "UZS") ||
    t("shop_fm_price_none", lang);
}

// Post matnida pochtalar ro'yxati chiqmaydi — faqat qisqa ko'rsatma.
// Sotuvdagi pochtalar pastdagi inline tugmalar bo'lib turadi; sotilganlari
// botda umuman ko'rsatilmaydi.
function buildShopFirstmailListView(items, page, lang) {
  const all = Array.isArray(items) ? items : [];
  const available = all.filter((item) => item.status === shop.SHOP_FM_STATUS_AVAILABLE);
  const pages = Math.max(1, Math.ceil(available.length / SHOP_FM_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const pageItems = available.slice(safePage * SHOP_FM_PAGE_SIZE, (safePage + 1) * SHOP_FM_PAGE_SIZE);
  const lines = [t("shop_fm_title", lang), ""];
  const rows = [];

  if (available.length === 0) {
    lines.push(all.length > 0 ? t("shop_fm_all_sold", lang) : t("shop_fm_empty", lang));
  } else {
    lines.push(t("shop_fm_hint", lang));

    if (pages > 1) {
      lines.push("", t("shop_fm_page", lang, { page: safePage + 1, pages }));
    }

    pageItems.forEach((item) => {
      rows.push([{
        text: `📧 ${shop.maskShopEmail(item.email)} · ${getShopPriceText(item, lang)}`.slice(0, 60),
        callback_data: `shop_fm:${item.id}`,
      }]);
    });
  }

  const nav = [];

  if (safePage > 0) {
    nav.push({ text: t("shop_fm_prev_btn", lang), callback_data: `shop_fm_list:${safePage - 1}` });
  }

  if (safePage + 1 < pages) {
    nav.push({ text: t("shop_fm_next_btn", lang), callback_data: `shop_fm_list:${safePage + 1}` });
  }

  if (nav.length) {
    rows.push(nav);
  }

  rows.push([{ text: t("shop_fm_refresh_btn", lang), callback_data: `shop_fm_list:${safePage}` }]);

  return {
    text: lines.join("\n"),
    replyMarkup: { inline_keyboard: rows },
    page: safePage,
    pages,
  };
}

async function handleShopFirstmailList(chatId, user, page = 0, messageId = null) {
  const lang = getUserLang(user.id);
  void safeSendChatAction(chatId, "typing");

  const items = await loadShopFirstmails();

  if (!items) {
    await sendOrEditAdminMessage(chatId, messageId, t("shop_unavailable", lang), messageId ? null : shopKeyboard(user));
    return;
  }

  const view = buildShopFirstmailListView(items, page, lang);
  await sendOrEditAdminMessage(chatId, messageId, view.text, view.replyMarkup);
}

function buildShopFirstmailDetail(item, lang) {
  const note = item.note ? t("shop_fm_note_line", lang, { note: escapeHtml(item.note) }) : "";

  return {
    text: t("shop_fm_detail", lang, {
      email: escapeHtml(shop.maskShopEmail(item.email)),
      price: escapeHtml(getShopPriceText(item, lang)),
      note,
    }),
    replyMarkup: {
      inline_keyboard: [
        [{ text: t("shop_fm_buy_btn", lang), callback_data: `shop_fm_buy:${item.id}` }],
        [{ text: t("shop_fm_back_btn", lang), callback_data: "shop_fm_list:0" }],
      ],
    },
  };
}

function shopNotAvailableMarkup(lang) {
  return { inline_keyboard: [[{ text: t("shop_fm_back_btn", lang), callback_data: "shop_fm_list:0" }]] };
}

async function getAvailableShopFirstmail(id) {
  if (!shop.isValidShopItemId(id) || !isSupabaseConfigured()) {
    return null;
  }

  try {
    const item = await getFirstmailStore().get(id);
    return item && item.status === shop.SHOP_FM_STATUS_AVAILABLE ? item : null;
  } catch (error) {
    console.error("[SHOP_FM_GET_ERROR]", error);
    recordError("shop_fm_get_failed", error.message, { id });
    return null;
  }
}

async function handleShopFirstmailDetail(chatId, user, id, messageId = null) {
  const lang = getUserLang(user.id);
  const item = await getAvailableShopFirstmail(id);

  if (!item) {
    await sendOrEditAdminMessage(chatId, messageId, t("shop_fm_not_available", lang), shopNotAvailableMarkup(lang));
    return;
  }

  const view = buildShopFirstmailDetail(item, lang);
  await sendOrEditAdminMessage(chatId, messageId, view.text, view.replyMarkup);
}

function getShopContactUrl() {
  return SUPPORT_USERNAME ? `https://t.me/${SUPPORT_USERNAME}` : null;
}

function getShopBuyAdminText(user, item) {
  const buyer = user.username
    ? `@${escapeHtml(user.username)}`
    : `<a href="tg://user?id=${user.id}">${escapeHtml(user.first_name || "Foydalanuvchi")}</a>`;

  return [
    "#dokon_sorov",
    "",
    "🛒 <b>Yangi xarid so'rovi — Firstmail</b>",
    "",
    `👤 Xaridor: ${buyer} (<code>${escapeHtml(String(user.id || ""))}</code>)`,
    `✉️ Pochta: <code>${escapeHtml(item.email)}</code>`,
    `💰 Narx: <b>${escapeHtml(getShopPriceText(item, "uz"))}</b>`,
    `🆔 Mahsulot ID: <code>${escapeHtml(item.id)}</code>`,
    "",
    "Sotilgach admin paneldagi <b>Do'kon → Firstmail</b> bo'limida «Sotildi» tugmasini bosing.",
  ].join("\n");
}

// Xarid so'rovi faqat do'kon egasiga (SUPPORT_USERNAME, default @Ksava_org)
// boradi. Bot API username orqali shaxsiy chatga yoza olmaydi — shu sabab
// raqamli ID kerak: SHOP_NOTIFY_CHAT_ID env, aks holda bot_users jadvalidan
// username bo'yicha topiladi (u botga /start bosgan bo'lishi kerak).
let shopNotifyChatIdCache = null;

async function getShopNotifyChatId() {
  const fromEnv = String(process.env.SHOP_NOTIFY_CHAT_ID || "").trim();

  if (/^-?\d{1,20}$/.test(fromEnv)) {
    return fromEnv;
  }

  if (shopNotifyChatIdCache) {
    return shopNotifyChatIdCache;
  }

  if (!SUPPORT_USERNAME || !isSupabaseConfigured()) {
    return null;
  }

  try {
    const rows = await supabaseRequest(
      `/bot_users?username=ilike.${encodeURIComponent(SUPPORT_USERNAME)}&select=user_id,chat_id,username&limit=5`
    );
    const match = (Array.isArray(rows) ? rows : []).find(
      (row) => String(row.username || "").toLowerCase() === SUPPORT_USERNAME.toLowerCase()
    );
    const chatId = match ? String(match.chat_id || match.user_id || "") : "";

    if (/^-?\d{1,20}$/.test(chatId)) {
      shopNotifyChatIdCache = chatId;
      return chatId;
    }
  } catch (error) {
    console.error("[SHOP_NOTIFY_LOOKUP_ERROR]", error);
  }

  return null;
}

async function sendShopNotify(chatId, text, buyerId) {
  const writeButton = { inline_keyboard: [[{ text: "💬 Xaridorga yozish", url: `tg://user?id=${buyerId}` }]] };

  try {
    await sendMessage(chatId, text, writeButton);
    return true;
  } catch (error) {
    // tg://user tugmasi xaridorning maxfiylik sozlamasi sabab rad etilishi mumkin.
    console.error("[SHOP_NOTIFY_SEND_ERROR]", chatId, error.message);
  }

  try {
    await sendMessage(chatId, text, null);
    return true;
  } catch (error) {
    console.error("[SHOP_NOTIFY_SEND_ERROR]", chatId, error.message);
    recordError("shop_buy_notify_failed", error.message, { chatId });
    return false;
  }
}

async function notifyShopBuyRequest(user, item) {
  const text = getShopBuyAdminText(user, item);
  const ownerChatId = await getShopNotifyChatId();

  if (ownerChatId && (await sendShopNotify(ownerChatId, text, user.id))) {
    return true;
  }

  // Egasini topib/yozib bo'lmasa so'rov yo'qolmasin — zaxira sifatida adminlarga.
  recordError(
    "shop_buy_notify_owner_unreachable",
    ownerChatId
      ? `@${SUPPORT_USERNAME} ga yuborib bo'lmadi`
      : `@${SUPPORT_USERNAME} bot_users da topilmadi (botga /start bosmagan) — SHOP_NOTIFY_CHAT_ID qo'ying`,
    { itemId: item.id }
  );

  let delivered = false;

  for (const adminId of ADMIN_IDS || []) {
    if (await sendShopNotify(adminId, text, user.id)) {
      delivered = true;
    }
  }

  return delivered;
}

async function handleShopFirstmailBuy(chatId, user, id, messageId = null) {
  const lang = getUserLang(user.id);
  const item = await getAvailableShopFirstmail(id);

  if (!item) {
    await sendOrEditAdminMessage(chatId, messageId, t("shop_fm_not_available", lang), shopNotAvailableMarkup(lang));
    return;
  }

  await notifyShopBuyRequest(user, item);

  const contactUrl = getShopContactUrl();
  const rows = [];

  if (contactUrl) {
    rows.push([{ text: t("shop_fm_contact_btn", lang), url: contactUrl }]);
  }

  rows.push([{ text: t("shop_fm_back_btn", lang), callback_data: "shop_fm_list:0" }]);

  await sendOrEditAdminMessage(
    chatId,
    messageId,
    t("shop_fm_buy_sent", lang, {
      email: escapeHtml(shop.maskShopEmail(item.email)),
      price: escapeHtml(getShopPriceText(item, lang)),
    }),
    { inline_keyboard: rows }
  );
}

async function handleShopCallback(chatId, user, data, messageId = null) {
  // Inline tugma bosilishi ham do'kon ichida ekanini bildiradi.
  rememberUserMode(user.id, SHOP_MODE);

  if (data.startsWith("shop_fm_list:")) {
    await handleShopFirstmailList(chatId, user, parsePageFromCallback(data, "shop_fm_list"), messageId);
    return;
  }

  if (data.startsWith("shop_fm_buy:")) {
    await handleShopFirstmailBuy(chatId, user, data.slice("shop_fm_buy:".length), messageId);
    return;
  }

  if (data.startsWith("shop_fm:")) {
    await handleShopFirstmailDetail(chatId, user, data.slice("shop_fm:".length), messageId);
  }
}

const ACCOUNT_MAX_COUNT = 5;

function buildProfileUnlinkKeyboard(lang, accounts) {
  const buttons = accounts.map(function (acc, index) {
    return [{
      text: t("profile_account_item", lang, {
        index: index + 1,
        accountId: acc.account_id,
        zoneId: acc.zone_id,
      }).replace(/<code>|<\/code>/g, ""),
      callback_data: `profile_unlink:${acc.id}`,
    }];
  });
  buttons.push([{ text: t("profile_back_btn", lang), callback_data: "profile_menu" }]);
  return { inline_keyboard: buttons };
}

function buildProfileViewersKeyboard(lang) {
  return {
    inline_keyboard: [[{ text: t("profile_back_btn", lang), callback_data: "profile_menu" }]],
  };
}

function formatProfileEventTime(iso) {
  try {
    return new Date(iso).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
  } catch (err) {
    return String(iso || "");
  }
}

async function handleProfileAddPrompt(chatId, user, messageId = null) {
  rememberUserMode(user.id, "profile_add");
  const lang = getUserLang(user.id);
  const replyMarkup = {
    inline_keyboard: [[{ text: t("profile_add_cancel", lang), callback_data: "profile_add_cancel" }]],
  };
  await sendOrEditAdminMessage(chatId, messageId, t("profile_add_prompt", lang), replyMarkup);
}

async function handleProfileUnlinkMenu(chatId, user, messageId = null) {
  const lang = getUserLang(user.id);

  let accounts = [];
  try {
    const accResult = await supabaseRpc("list_user_accounts", {
      p_user_id: toPgBigint(user.id),
    });
    accounts = Array.isArray(accResult) ? accResult : [];
  } catch (err) {
    console.error("[MY_PROFILE_UNLINK_ERROR]", err.message);
    accounts = [];
  }

  if (accounts.length === 0) {
    await sendOrEditAdminMessage(chatId, messageId, t("profile_unlink_empty", lang), mainKeyboard(user));
    return;
  }

  await sendOrEditAdminMessage(chatId, messageId, t("profile_unlink_title", lang), buildProfileUnlinkKeyboard(lang, accounts));
}

async function handleProfileUnlinkConfirm(chatId, user, accountId, messageId = null) {
  const lang = getUserLang(user.id);
  const unlinkId = String(accountId || "").trim();
  if (!/^\d+$/.test(unlinkId)) {
    await sendOrEditAdminMessage(chatId, messageId, t("profile_unlink_not_found", lang), mainKeyboard(user));
    return;
  }

  let accounts = [];
  try {
    const accResult = await supabaseRpc("list_user_accounts", {
      p_user_id: toPgBigint(user.id),
    });
    accounts = Array.isArray(accResult) ? accResult : [];
  } catch (err) {
    console.error("[MY_PROFILE_UNLINK_ERROR]", err.message);
    accounts = [];
  }

  const target = listUserAccountById(accounts, unlinkId);
  if (!target) {
    await sendOrEditAdminMessage(chatId, messageId, t("profile_unlink_not_found", lang), mainKeyboard(user));
    return;
  }

  // Ulangan o'yin sessiyasi bo'lsa — avval Arena'dan chiqamiz (best-effort).
  if (target.ml_linked) {
    await logoutMlLinkSilently(user.id, target.id);
  }

  try {
    const result = await supabaseRpc("remove_user_account", {
      p_user_id: toPgBigint(user.id),
      p_account_id: target.account_id,
      p_zone_id: target.zone_id,
    });

    console.log("[REMOVE_USER_ACCOUNT_RESULT]", JSON.stringify(result));

    if (result && result.ok === true) {
      await sendOrEditAdminMessage(chatId, messageId, t("profile_unlink_success", lang, {
        accountId: target.account_id,
        zoneId: target.zone_id,
      }), mainKeyboard(user));
      await handleMyProfileRequest(chatId, user);
    } else {
      await sendOrEditAdminMessage(chatId, messageId, t("profile_unlink_not_found", lang), mainKeyboard(user));
    }
  } catch (err) {
    console.error("[REMOVE_USER_ACCOUNT_ERROR]", err);
    recordError("remove_user_account_failed", err.message, { accountId: target.account_id });
    await sendOrEditAdminMessage(chatId, messageId, t("profile_unlink_not_found", lang), mainKeyboard(user));
  }
}

function listUserAccountById(accounts, id) {
  return accounts.find(function (acc) { return String(acc.id) === String(id); }) || null;
}

async function handleProfileAddAccount(chatId, user, text, messageId = null) {
  const lang = getUserLang(user.id);
  const parsed = parseMlbbInput(text);

  if (!parsed.ok) {
    await sendOrEditAdminMessage(chatId, messageId, t("profile_add_invalid", lang), mainKeyboard(user));
    return;
  }

  if (!isSupabaseConfigured()) {
    await sendOrEditAdminMessage(chatId, messageId, t("profile_add_failed", lang), mainKeyboard(user));
    return;
  }

  try {
    const result = await supabaseRpc("add_user_account", {
      p_user_id: toPgBigint(user.id),
      p_account_id: parsed.accountId,
      p_zone_id: parsed.zoneId,
    });

    console.log("[ADD_USER_ACCOUNT_RESULT]", JSON.stringify(result));

    if (!result || typeof result !== "object" || Array.isArray(result) || result.ok !== true) {
      const errorKey = {
        invalid_user: "profile_add_failed",
        limit_reached: "profile_add_limit_reached",
        already_exists: "profile_add_already_exists",
      }[result?.error] || "profile_add_failed";
      await sendOrEditAdminMessage(chatId, messageId, t(errorKey, lang), mainKeyboard(user));
      return;
    }

    await sendOrEditAdminMessage(
      chatId,
      messageId,
      t("profile_add_success", lang, {
        accountId: parsed.accountId,
        zoneId: parsed.zoneId,
      }),
      mainKeyboard(user)
    );
    clearUserMode(user.id);

    // Akkaunt qo'shildi — endi uni o'yin bilan ulashni taklif qilamiz.
    if (/^\d+$/.test(String(result.id ?? ""))) {
      await sendMessage(chatId, getMlLinkAskText(lang, parsed.accountId, parsed.zoneId), buildMlLinkAskKeyboard(lang, result.id));
    } else {
      await handleMyProfileRequest(chatId, user);
    }
  } catch (err) {
    console.error("[ADD_USER_ACCOUNT_ERROR]", err);
    recordError("add_user_account_failed", err.message, {
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
    });
    await sendOrEditAdminMessage(chatId, messageId, t("profile_add_failed", lang), mainKeyboard(user));
  }
}

async function handleProfileViewersRequest(chatId, user, messageId = null) {
  const lang = getUserLang(user.id);

  let viewers = [];
  try {
    const history = await supabaseRpc("get_account_check_history", {
      p_user_id: toPgBigint(user.id),
      p_limit: 10,
    });
    viewers = Array.isArray(history) ? history : [];
  } catch (err) {
    console.error("[MY_PROFILE_VIEWERS_ERROR]", err.message);
    viewers = [];
  }

  const actionLabels = {
    server_check: t("profile_viewers_action_check", lang),
    full_info: t("profile_viewers_action_full_info", lang),
    bind_info: t("profile_viewers_action_bind_info", lang),
  };

  const lines = [t("profile_viewers_title", lang), ""];

  if (viewers.length === 0) {
    lines.push(t("profile_viewers_empty", lang));
  } else {
    viewers.forEach(function (v) {
      const checker = v.checker_username
        ? `@${escapeHtml(v.checker_username)}`
        : `<a href="tg://user?id=${v.checker_user_id}">${escapeHtml(v.checker_first_name || "Foydalanuvchi")}</a>`;
      lines.push(t("profile_viewers_item", lang, {
        checker,
        accountId: v.account_id,
        zoneId: v.zone_id,
        action: actionLabels[v.action] || v.action,
        time: formatProfileEventTime(v.created_at),
      }));
      lines.push("");
    });
  }

  await sendOrEditAdminMessage(chatId, messageId, lines.join("\n"), buildProfileViewersKeyboard(lang));
}

// ---------------------------------------------------------------------------
// 🎮 Mobile Legends akkauntini ulash (Rone Arena API)
//
// Oqim: profilga akkaunt qo'shilgach "Mobile Legendsga ham ulaysizmi?" →
// Ha → send-vc (o'yin ichidagi pochtaga kod) → user kodni yuboradi → login →
// JWT shifrlanib user_accounts.ml_token ga yoziladi → "🎮 Mening akkauntim"
// (api/account.js Mini App) ochiladi.
//
// Kod kutish holati DO rejimida saqlanadi: "mlc:<rowId>:<urinish>:<sentAt36>"
// (rejim 32 belgigacha). Urinishlar soni cheklangan — 4 xonali kodni
// tanlab topib bo'lmasin; qayta yuborishda cooldown — boshqa odamning
// o'yin pochtasini spam qilib bo'lmasin.
// ---------------------------------------------------------------------------
const ML_CODE_MODE_PREFIX = "mlc:";
const ML_CODE_MAX_ATTEMPTS = 5;
const ML_CODE_TTL_MS = 5 * 60 * 1000;
const ML_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
const ML_HIGHLIGHT_KEYS = Object.freeze(["hk", "ma", "ms", "mtd", "mdt", "mg"]);

function getArenaClient() {
  return arena.createArenaClient({ baseUrl: MLBB_ARENA_API_URL, timeoutMs: MLBB_ARENA_TIMEOUT_MS });
}

function getMlLinkSecret() {
  return arena.resolveLinkSecret(process.env);
}

function buildMlCodeMode(rowId, attempts, sentAtMs) {
  return `${ML_CODE_MODE_PREFIX}${rowId}:${attempts}:${Math.floor(sentAtMs / 1000).toString(36)}`;
}

function parseMlCodeMode(mode) {
  const match = /^mlc:(\d{1,19}):(\d{1,2}):([0-9a-z]{1,10})$/.exec(String(mode || ""));

  if (!match) {
    return null;
  }

  return {
    rowId: match[1],
    attempts: Number(match[2]),
    sentAt: parseInt(match[3], 36) * 1000,
  };
}

async function fetchUserAccounts(userId) {
  try {
    const result = await supabaseRpc("list_user_accounts", { p_user_id: toPgBigint(userId) });
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.error("[ML_LINK_ACCOUNTS_ERROR]", err.message);
    return [];
  }
}

function formatMlNumber(value, digits = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  const [whole, fraction] = number.toFixed(digits).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function getMlLinkAskText(lang, accountId, zoneId) {
  return t("ml_link_ask", lang, { accountId: escapeHtml(accountId), zoneId: escapeHtml(zoneId) });
}

function buildMlLinkAskKeyboard(lang, rowId) {
  return {
    inline_keyboard: [[
      { text: t("ml_link_yes_btn", lang), callback_data: `ml_link:${rowId}` },
      { text: t("ml_link_no_btn", lang), callback_data: "ml_link_no" },
    ]],
  };
}

function buildMlCodePromptKeyboard(lang, rowId) {
  return {
    inline_keyboard: [
      [{ text: t("ml_code_resend_btn", lang), callback_data: `ml_link:${rowId}` }],
      [{ text: t("profile_add_cancel", lang), callback_data: "ml_link_cancel" }],
    ],
  };
}

function buildMlLinkedKeyboard(lang, chatId) {
  const rows = [];

  if (Number(chatId) > 0) {
    rows.push([{ text: t("ml_my_account_btn", lang), web_app: { url: ACCOUNT_MINIAPP_URL } }]);
  }

  rows.push([{ text: t("profile_back_btn", lang), callback_data: "my_profile" }]);
  return { inline_keyboard: rows };
}

function getMlArenaErrorText(lang, error) {
  const key = {
    send_failed: "ml_link_send_failed",
    rate_limit: "ml_link_rate_limited",
    invalid_input: "ml_link_send_failed",
  }[error?.reason] || "ml_link_service_down";
  return t(key, lang);
}

async function handleMlLinkMenu(chatId, user, messageId = null) {
  const lang = getUserLang(user.id);
  const accounts = await fetchUserAccounts(user.id);
  const unlinked = accounts.filter((acc) => !acc.ml_linked);

  if (!unlinked.length) {
    await sendOrEditAdminMessage(chatId, messageId, t(accounts.length ? "ml_link_menu_all_linked" : "profile_accounts_empty", lang), {
      inline_keyboard: [[{ text: t("profile_back_btn", lang), callback_data: "my_profile" }]],
    });
    return;
  }

  const rows = unlinked.map((acc) => [{
    text: `🎮 ${acc.account_id} (${acc.zone_id})`,
    callback_data: `ml_link:${acc.id}`,
  }]);
  rows.push([{ text: t("profile_back_btn", lang), callback_data: "my_profile" }]);

  await sendOrEditAdminMessage(chatId, messageId, t("ml_link_menu_title", lang), { inline_keyboard: rows });
}

async function handleMlLinkDecline(chatId, user, messageId = null) {
  const lang = getUserLang(user.id);
  await sendOrEditAdminMessage(chatId, messageId, t("ml_link_declined", lang), {
    inline_keyboard: [[{ text: t("profile_back_btn", lang), callback_data: "my_profile" }]],
  });
}

async function handleMlLinkStart(chatId, user, rowIdRaw, messageId = null) {
  const lang = getUserLang(user.id);
  const rowId = String(rowIdRaw || "").trim();
  const backKeyboard = { inline_keyboard: [[{ text: t("profile_back_btn", lang), callback_data: "my_profile" }]] };

  if (!/^\d{1,19}$/.test(rowId)) {
    await sendOrEditAdminMessage(chatId, messageId, t("profile_unlink_not_found", lang), backKeyboard);
    return;
  }

  const accounts = await fetchUserAccounts(user.id);
  const account = listUserAccountById(accounts, rowId);

  if (!account) {
    await sendOrEditAdminMessage(chatId, messageId, t("profile_unlink_not_found", lang), backKeyboard);
    return;
  }

  if (account.ml_linked) {
    clearUserMode(user.id);
    await sendOrEditAdminMessage(chatId, messageId, t("ml_link_already", lang, {
      accountId: escapeHtml(account.account_id),
      zoneId: escapeHtml(account.zone_id),
    }), buildMlLinkedKeyboard(lang, chatId));
    return;
  }

  // Qayta yuborish cooldown'i (bir xil akkaunt uchun).
  const pending = parseMlCodeMode(await resolveUserMode(user.id));
  const sinceLastSend = pending && pending.rowId === rowId ? Date.now() - pending.sentAt : Infinity;

  if (sinceLastSend < ML_CODE_RESEND_COOLDOWN_MS) {
    const seconds = Math.ceil((ML_CODE_RESEND_COOLDOWN_MS - sinceLastSend) / 1000);
    await sendOrEditAdminMessage(
      chatId,
      messageId,
      `${t("ml_code_prompt", lang, { accountId: escapeHtml(account.account_id), zoneId: escapeHtml(account.zone_id) })}\n\n${t("ml_code_resend_wait", lang, { seconds })}`,
      buildMlCodePromptKeyboard(lang, rowId)
    );
    return;
  }

  void safeSendChatAction(chatId, "typing");

  try {
    await getArenaClient().sendVerificationCode(account.account_id, account.zone_id);
  } catch (error) {
    console.error("[ML_LINK_SEND_VC_ERROR]", error.message);
    recordError("ml_link_send_vc_failed", error.message, { reason: error.reason, accountId: account.account_id });
    await sendOrEditAdminMessage(chatId, messageId, getMlArenaErrorText(lang, error), {
      inline_keyboard: [
        [{ text: t("ml_code_retry_btn", lang), callback_data: `ml_link:${rowId}` }],
        [{ text: t("profile_back_btn", lang), callback_data: "my_profile" }],
      ],
    });
    return;
  }

  rememberUserMode(user.id, buildMlCodeMode(rowId, 0, Date.now()));
  await sendOrEditAdminMessage(
    chatId,
    messageId,
    t("ml_code_prompt", lang, { accountId: escapeHtml(account.account_id), zoneId: escapeHtml(account.zone_id) }),
    buildMlCodePromptKeyboard(lang, rowId)
  );
}

async function handleMlCodeInput(chatId, user, text, state) {
  const lang = getUserLang(user.id);
  const code = String(text || "").replace(/[\s-]/g, "");
  const resendKeyboard = {
    inline_keyboard: [
      [{ text: t("ml_code_resend_btn", lang), callback_data: `ml_link:${state.rowId}` }],
      [{ text: t("profile_add_cancel", lang), callback_data: "ml_link_cancel" }],
    ],
  };

  if (Date.now() - state.sentAt > ML_CODE_TTL_MS) {
    clearUserMode(user.id);
    await sendMessage(chatId, t("ml_code_expired", lang), resendKeyboard);
    return;
  }

  if (!arena.isValidVerificationCode(code)) {
    await sendMessage(chatId, t("ml_code_invalid_format", lang), buildMlCodePromptKeyboard(lang, state.rowId));
    return;
  }

  const accounts = await fetchUserAccounts(user.id);
  const account = listUserAccountById(accounts, state.rowId);

  if (!account) {
    clearUserMode(user.id);
    await sendMessage(chatId, t("profile_unlink_not_found", lang), mainKeyboard(user));
    return;
  }

  void safeSendChatAction(chatId, "typing");

  let session;
  try {
    session = await getArenaClient().login(account.account_id, account.zone_id, code);
  } catch (error) {
    if (error?.reason === "invalid_code") {
      const attempts = state.attempts + 1;

      if (attempts >= ML_CODE_MAX_ATTEMPTS) {
        clearUserMode(user.id);
        await sendMessage(chatId, t("ml_code_too_many", lang), resendKeyboard);
        return;
      }

      rememberUserMode(user.id, buildMlCodeMode(state.rowId, attempts, state.sentAt));
      await sendMessage(chatId, t("ml_code_wrong", lang, { left: ML_CODE_MAX_ATTEMPTS - attempts }), buildMlCodePromptKeyboard(lang, state.rowId));
      return;
    }

    console.error("[ML_LINK_LOGIN_ERROR]", error?.message);
    recordError("ml_link_login_failed", error?.message, { reason: error?.reason, accountId: account.account_id });
    await sendMessage(chatId, getMlArenaErrorText(lang, error), buildMlCodePromptKeyboard(lang, state.rowId));
    return;
  }

  const client = getArenaClient();
  const [infoResult, statsResult] = await Promise.allSettled([
    client.getInfo(session.jwt, lang),
    client.getStats(session.jwt, lang),
  ]);
  const info = infoResult.status === "fulfilled" ? infoResult.value || {} : {};
  const statsData = statsResult.status === "fulfilled" ? statsResult.value || {} : {};

  let saved = false;
  try {
    const result = await supabaseRpc("set_user_account_ml_link", {
      p_user_id: toPgBigint(user.id),
      p_row_id: toPgBigint(account.id),
      p_token: arena.sealArenaToken(session.jwt, getMlLinkSecret()),
      p_nickname: cleanTextValue(info.name, 64),
    });
    saved = Boolean(result && result.ok === true);
  } catch (err) {
    console.error("[ML_LINK_SAVE_ERROR]", err.message);
    recordError("ml_link_save_failed", err.message, { accountId: account.account_id });
  }

  clearUserMode(user.id);

  if (!saved) {
    void client.logout(session.jwt).catch(() => {});
    await sendMessage(chatId, t("ml_link_save_failed", lang), mainKeyboard(user));
    return;
  }

  trackFeatureUse(user, { id: chatId }, FEATURE_ACTIONS.ML_LINK);
  await sendMessage(
    chatId,
    getMlAccountSummaryText(lang, { accountId: account.account_id, zoneId: account.zone_id, info, stats: statsData }),
    buildMlLinkedKeyboard(lang, chatId)
  );
}

function getMlAccountSummaryText(lang, { accountId, zoneId, info = {}, stats: data = {} } = {}) {
  const lines = [t("ml_link_success_title", lang), ""];
  const push = (key, params) => lines.push(t(key, lang, params));

  if (info.name) push("ml_summary_name", { value: escapeHtml(info.name) });
  push("ml_summary_id", { accountId: escapeHtml(accountId), zoneId: escapeHtml(zoneId) });
  if (Number.isFinite(Number(info.level)) && info.level !== null) push("ml_summary_level", { value: formatMlNumber(info.level) });

  const rank = arena.formatRankLevel(info.rank_level);
  if (rank) push("ml_summary_rank", { value: rank.label });
  const highest = arena.formatRankLevel(info.history_rank_level);
  if (highest) push("ml_summary_highest_rank", { value: highest.label });
  if (info.reg_country) push("ml_summary_country", { value: escapeHtml(String(info.reg_country).toUpperCase()) });

  const total = Number(data.tc);
  if (Number.isFinite(total) && data.tc !== null && data.tc !== undefined) {
    const wins = Number(data.wc) || 0;
    lines.push("", t("ml_summary_stats_title", lang));
    push("ml_summary_matches", {
      total: formatMlNumber(total),
      wins: formatMlNumber(wins),
      winrate: total > 0 ? formatMlNumber((wins / total) * 100, 1) : "0",
    });
    if (data.mvpc !== undefined && data.mvpc !== null) push("ml_summary_mvp", { value: formatMlNumber(data.mvpc) });
    if (data.as !== undefined && data.as !== null) push("ml_summary_avg_score", { value: formatMlNumber(Number(data.as) / 100, 2) });
    if (data.wsc !== undefined && data.wsc !== null) push("ml_summary_streak", { value: formatMlNumber(data.wsc) });
    if (data.gt !== undefined && data.gt !== null) push("ml_summary_play_time", { value: formatMlNumber(data.gt, 1) });
  }

  const highlights = ML_HIGHLIGHT_KEYS
    .map((key) => {
      const item = data[key];
      const hero = item?.hid_e?.n;

      if (!item || !hero || item.v === undefined || item.v === null) {
        return null;
      }

      const value = key === "ms" ? formatMlNumber(Number(item.v) / 100, 2) : formatMlNumber(item.v);
      return t(`ml_hl_${key}`, lang, { hero: escapeHtml(hero), value });
    })
    .filter(Boolean);

  if (highlights.length) {
    lines.push("", t("ml_summary_highlights_title", lang), ...highlights);
  }

  lines.push("", t("ml_summary_footer", lang));
  return lines.join("\n");
}

// Akkaunt profildan uzilganda Arena sessiyasini ham yopamiz (xato bo'lsa — jim).
async function logoutMlLinkSilently(userId, rowId) {
  try {
    const link = await supabaseRpc("get_user_account_ml_link", {
      p_user_id: toPgBigint(userId),
      p_row_id: toPgBigint(rowId),
    });
    const token = arena.openArenaToken(link?.ml_token, getMlLinkSecret());

    if (token) {
      await getArenaClient().logout(token);
    }
  } catch (err) {
    console.error("[ML_LINK_LOGOUT_ERROR]", err.message);
  }
}

async function handleLanguageCommand(chatId, user) {
  const lang = getUserLang(user.id);
  const langNames = {};
  for (const l of SUPPORTED_LANGS) {
    langNames[l] = t(`btn_lang_${l}`, lang);
  }
  const currentLangName = langNames[lang] || langNames[DEFAULT_LANG];

  const lines = [
    t("lang_title", lang),
    "",
    t("lang_current", lang, { currentLang: currentLangName }),
    "",
    t("lang_select", lang),
  ];

  const keyboard = {
    inline_keyboard: SUPPORTED_LANGS.map((l) => [{
      text: `${langNames[l]}${l === lang ? " ✓" : ""}`,
      callback_data: `lang_select:${l}`,
    }]),
  };

  await sendMessage(chatId, lines.join("\n"), keyboard);
}

async function handleStatsRequest(chatId, user, todayPage = 0, messageId = null) {
  const dbStats = await getSupabaseStats({ todayPage });
  const text = getStatsText(dbStats, getUserLang(user.id));
  const replyMarkup = dailyUsersPaginationKeyboard({ ...dbStats, lang: getUserLang(user.id) });

  await sendOrEditAdminMessage(chatId, messageId, text, replyMarkup || mainKeyboard(user));
}

async function handleUsersListRequest(chatId, user, page = 0, messageId = null) {
  const syncResult = await syncKnownUsersToSupabase();
  const pageData = await getUsersPageData(page);
  const text = getUsersListText(pageData, syncResult, getUserLang(user.id));
  const replyMarkup = usersPaginationKeyboard({ ...pageData, lang: getUserLang(user.id) }) || mainKeyboard(user);

  await sendOrEditAdminMessage(chatId, messageId, text, replyMarkup);
}

async function handleErrorsRequest(chatId, user, messageId = null) {
  await sendOrEditAdminMessage(
    chatId,
    messageId,
    getErrorsText(getUserLang(user.id)),
    errorsRefreshKeyboard(getUserLang(user.id)) || mainKeyboard(user)
  );
}

async function handleEmojiIdRequest(chatId, user, message = {}) {
  await sendMessage(chatId, getCustomEmojiIdText(message), mainKeyboard(user), {
    premiumEmoji: false,
  });
}

async function handleFeedbackPrompt(chatId, user) {
  cleanupPendingFeedbacks();

  const response = await sendMessage(chatId, getFeedbackPromptText(getUserLang(user.id)), feedbackForceReply(getUserLang(user.id)));
  const promptMessageId = response?.result?.message_id || null;

  rememberPendingFeedback(user.id, chatId, promptMessageId);
}

async function handleFeedbackSubmission(chatId, user, message) {
  const feedbackText = getFeedbackMessageText(message);

  if (!feedbackText) {
    await sendMessage(chatId, getFeedbackTextRequiredText(getUserLang(user.id)), mainKeyboard(user));
    return;
  }

  if (feedbackText.length > FEEDBACK_MAX_LENGTH) {
    await sendMessage(chatId, getFeedbackTooLongText(getUserLang(user.id)), mainKeyboard(user));
    return;
  }

  clearPendingFeedback(user.id);
  trackFeatureUse(user, { id: chatId }, FEATURE_ACTIONS.FEEDBACK);

  const feedback = {
    id: createFeedbackId(),
    userId: String(user.id || chatId),
    chatId: String(chatId),
    user,
    text: feedbackText,
    createdAt: new Date().toISOString(),
  };
  const result = await sendFeedbackToAdmins(feedback);

  await sendMessage(chatId, getFeedbackThanksText(result, getUserLang(user.id)), mainKeyboard(user));
}

async function handleFeedbackAdminReply(chatId, admin, message) {
  const target = parseFeedbackAdminReplyTarget(message.reply_to_message);
  const replyPayload = createFeedbackAdminReplyPayload(message, admin);

  if (!target) {
    return;
  }

  if (!replyPayload) {
    await sendMessage(chatId, getFeedbackAdminReplyTextRequiredText(getUserLang(admin.id)), mainKeyboard(admin));
    return;
  }

  try {
    if (replyPayload.kind === "copy") {
      await copyMessage(target.chatId || target.userId, chatId, message.message_id);
    } else {
      await sendMessage(
        target.chatId || target.userId,
        replyPayload.text,
        mainKeyboard({ id: target.userId }),
        {
          entities: replyPayload.entities,
          plain: true,
        }
      );
    }
  } catch (error) {
    console.error("[FEEDBACK_REPLY_ERROR]", error);
    recordError("feedback_reply_failed", error.message, {
      adminId: admin.id,
      userId: target.userId,
      feedbackId: target.feedbackId,
    });

    await sendMessage(
      chatId,
      getFeedbackReplyFailedText(target, error.message),
      mainKeyboard(admin)
    );
    return;
  }

  await sendMessage(chatId, getFeedbackReplySentText(target), mainKeyboard(admin));
}

async function handleMessageCommand(chatId, user, message) {
  const broadcastPayload = createBroadcastPayload(message);

  if (!broadcastPayload) {
    await sendMessage(chatId, getBroadcastUsageText(), mainKeyboard(user));
    return;
  }

  if (broadcastPayload.kind === "text" && broadcastPayload.text.length > 3500) {
    await sendMessage(chatId, getBroadcastTooLongText(getUserLang(user.id)), mainKeyboard(user));
    return;
  }

  await cleanupPendingBroadcasts();

  const broadcastId = createBroadcastId();
  const confirmToken = createBroadcastToken();
  const recipientStats = await getBroadcastRecipientStats();

  await persistPendingBroadcast(broadcastId, {
    adminId: String(user.id),
    chatId: String(chatId),
    payload: broadcastPayload,
    tokenHash: hashBroadcastToken(confirmToken),
    createdAt: Date.now(),
    status: "pending",
    recipientCount: recipientStats.privateCount,
  });

  await sendMessage(
    chatId,
    getBroadcastConfirmText(broadcastPayload, recipientStats, getUserLang(user.id)),
    broadcastConfirmKeyboard(broadcastId, confirmToken, getUserLang(user.id))
  );
}

async function warnIfBindLimitReached(chatId, user, replyMarkup) {
  if (isAdmin(user.id) || !isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }

  try {
    const limitResult = await supabaseRpc("check_bind_limit_only", {
      p_user_id: toPgBigint(user.id),
      p_limit: 10,
    });

    if (limitResult && limitResult.allowed === false) {
      await sendMessage(chatId, getBindInfoLimitReachedText(getUserLang(user.id)), replyMarkup);
    }
  } catch (error) {
    console.error("[BIND_LIMIT_PRECHECK_ERROR]", error);
  }
}

async function handleBindInfoRequest(chatId, input, user = {}, options = {}) {
  const parsed = parseMlbbInput(input);
  const replyMarkup =
    Object.hasOwn(options, "replyMarkup") ? options.replyMarkup : resultKeyboard(user);
  let waitMessage = options.waitMessage || null;

  if (!parsed.ok) {
    await sendMessage(chatId, getInvalidBindInfoInputText(getUserLang(user.id)), replyMarkup);
    await safeDeleteBindWaitMessage(chatId, waitMessage);
    return;
  }

  let limitData = null;
  if (!isAdmin(user.id) && isSupabaseConfigured() && !isSupabaseAuthTemporarilyDisabled()) {
    try {
      const limitResult = await supabaseRpc("check_and_consume_bind_limit", {
        p_user_id: toPgBigint(user.id),
        p_limit: 10
      });
      if (limitResult && limitResult.allowed === false) {
        await safeDeleteBindWaitMessage(chatId, waitMessage);
        await sendMessage(chatId, getBindInfoLimitReachedText(getUserLang(user.id)), replyMarkup);
        return;
      }
      if (limitResult && typeof limitResult.remaining === "number") {
        limitData = limitResult;
      }
    } catch (error) {
      console.error("[BIND_LIMIT_CHECK_ERROR]", error);
    }
  }

  void safeSendChatAction(chatId, "typing");

  if (!options.skipWait) {
    const waitResponse = await safeSendMessage(chatId, getBindInfoWaitText(getUserLang(user.id)), replyMarkup);
    waitMessage = normalizeBindWaitMessage({
      chatId,
      messageId: waitResponse?.result?.message_id,
    });
  }

  const bindInfo = await lookupMlbbBindInfo(parsed.accountId, parsed.zoneId);
  trackFeatureUse(user, { id: chatId }, FEATURE_ACTIONS.BIND_INFO);

  if (!bindInfo.ok) {
    recordError("mlbb_bind_info_failed", bindInfo.technicalReason || bindInfo.reason, {
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
      status: bindInfo.status,
    });

    await sendMessage(chatId, getBindInfoFailedText(bindInfo.reason, getUserLang(user.id)), replyMarkup);
    await safeDeleteBindWaitMessage(chatId, waitMessage);
    return;
  }

  await sendMessage(
    chatId,
    getBindInfoResultText({
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
      ...bindInfo.data,
    }, limitData),
    replyMarkup
  );
  await safeDeleteBindWaitMessage(chatId, waitMessage);
  runAccountOwnerNotify(options.ctx, user, parsed.accountId, parsed.zoneId, FEATURE_ACTIONS.BIND_INFO);

  if (MAIN_GROUP_ID && String(chatId) !== MAIN_GROUP_ID) {
    const userMention = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name || "Foydalanuvchi"}</a>`;
    const notificationText = `#foydalanish\n${userMention} <b>${parsed.accountId} (${parsed.zoneId})</b> ni ulanmalarini tekshirdi.`;
    const inlineKeyboard = {
      inline_keyboard: [[{ text: t("btn_open_profile", getUserLang(user.id)), url: `tg://user?id=${user.id}` }]]
    };
    await safeSendMessage(MAIN_GROUP_ID, notificationText, inlineKeyboard);
  }
}

const INLINE_DEDUP_TTL_MS = 30 * 1000;

async function answerInlineQuery(inlineQueryId, results, options = {}) {
  return telegram("answerInlineQuery", {
    inline_query_id: inlineQueryId,
    results,
    cache_time: 0,
    is_personal: true,
    ...options,
  });
}

function buildInlineMessageResult(title, text) {
  const cleanText = String(text ?? "");
  return {
    type: "article",
    id: `msg:${Date.now()}`,
    title: String(title ?? cleanText).replace(/\s+/g, " ").trim().slice(0, 128),
    description: cleanText.replace(/\s+/g, " ").trim().slice(0, 200),
    thumbnail_url: BOT_LOGO_URL,
    thumbnail_width: 64,
    thumbnail_height: 64,
    input_message_content: {
      message_text: cleanText,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
  };
}

function buildInlineHintResult(lang) {
  const title = t("inline_hint_title", lang);
  const description = t("inline_hint_description", lang);
  return {
    type: "article",
    id: "hint",
    title: title,
    description: description,
    thumbnail_url: BOT_LOGO_URL,
    thumbnail_width: 64,
    thumbnail_height: 64,
    input_message_content: {
      message_text: title + "\n\n" + description,
      parse_mode: "HTML",
    },
  };
}

async function notifyInlineUsage(user, accountId, zoneId, feature) {
  if (!MAIN_GROUP_ID) return;
  const userMention = user.username
    ? `@${user.username}`
    : `<a href="tg://user?id=${user.id}">${user.first_name || "Foydalanuvchi"}</a>`;
  const actionWord =
    feature === FEATURE_ACTIONS.SERVER_CHECK
      ? "ni check qildi."
      : "ni ulanmalarini tekshirdi.";
  const notificationText = `#foydalanish\n${userMention} <b>${accountId} (${zoneId})</b> ${actionWord}`;
  const inlineKeyboard = {
    inline_keyboard: [[{ text: t("btn_open_profile", getUserLang(user.id)), url: `tg://user?id=${user.id}` }]],
  };
  try {
    await safeSendMessage(MAIN_GROUP_ID, notificationText, inlineKeyboard);
  } catch (error) {
    console.error("[INLINE_MAIN_GROUP_NOTIFY_FAILED]", error.message);
  }
}

async function handleInlineQuery(inlineQuery, options = {}) {
  const queryId = inlineQuery?.id;
  if (!queryId) return;

  const from = inlineQuery.from || {};
  const userId = from.id;
  const lang = getUserLang(userId);
  const text = String(inlineQuery.query || "").trim();
  const chatType = String(inlineQuery.chat_type || "");
  const isPrivate = chatType === "private";

  const user = {
    id: from.id,
    first_name: from.first_name || "",
    last_name: from.last_name || "",
    username: from.username || "",
  };

  try {
    const parsed = parseMlbbInput(text);
    if (!parsed.ok) {
      return await answerInlineQuery(queryId, [buildInlineHintResult(lang)]);
    }

    const dedupKey = `${userId}:${parsed.accountId}:${parsed.zoneId}`;
    const recent = stats.inlineDedup.get(dedupKey);
    const now = Date.now();

    // Telegram bir xil inline so'rovni bir necha marta qayta yuborishi mumkin.
    // Qisqa muddat ichida bir xil ID-tekshiruv qaytarilsa — keshlangan natijani
    // qaytaramiz (API va kvota takror sarflanmaydi).
    if (recent && now - recent.at < INLINE_DEDUP_TTL_MS) {
      return await answerInlineQuery(queryId, recent.results);
    }

    // Server aniqlash — inline rejim hozircha faqat shu funksiya uchun ishlaydi.
    // Ulanmalar (bind info) tekshiruvi keyinchalik qo'shiladi.
    const serverLookup = await lookupMlbbAccount(parsed.accountId, parsed.zoneId, {
      timeoutMs: INLINE_SERVER_LOOKUP_TIMEOUT_MS,
    });

    const results = [];
    const privateCopies = [];

    if (serverLookup.ok) {
      trackFeatureUse(user, { id: userId }, FEATURE_ACTIONS.SERVER_CHECK);
      const serverResultText = enrichPremiumEmojis(getResultText({
        accountId: parsed.accountId,
        zoneId: parsed.zoneId,
        nickname: serverLookup.nickname,
        region: serverLookup.region,
        serverType: detectServerType(parsed.zoneId),
        status: "Profil topildi",
        rawProvider: serverLookup.provider,
      }, lang));
      results.push({
        type: "article",
        id: `server:${userId}:${parsed.accountId}:${parsed.zoneId}`,
        title: t("inline_server_title", lang, { accountId: parsed.accountId, zoneId: parsed.zoneId }),
        description: t("inline_server_description", lang),
        thumbnail_url: BOT_LOGO_URL,
        thumbnail_width: 64,
        thumbnail_height: 64,
        input_message_content: {
          message_text: serverResultText,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
      });
      privateCopies.push(serverResultText);
    } else {
      recordError("mlbb_lookup_failed", serverLookup.technicalReason || serverLookup.reason, {
        accountId: parsed.accountId,
        zoneId: parsed.zoneId,
        status: serverLookup.status,
      });
    }

    // Server aniqlash muvaffaqiyatsiz bo'lsa — yagona xato karta.
    if (results.length === 0) {
      results.push(buildInlineMessageResult(
        t("failed_lookup_title", lang),
        getFailedLookupText(null, { reason: serverLookup.reason }, lang)
      ));
    }

    stats.inlineDedup.set(dedupKey, { at: now, results });

    await answerInlineQuery(queryId, results);

    // Main guruhga foydalanish xabari — muvaffaqiyatli tekshiruv uchun.
    if (serverLookup.ok) {
      await notifyInlineUsage(user, parsed.accountId, parsed.zoneId, FEATURE_ACTIONS.SERVER_CHECK);
      runAccountOwnerNotify(options.ctx, user, parsed.accountId, parsed.zoneId, FEATURE_ACTIONS.SERVER_CHECK);
    }

    // Inline boshqa chatda ishlatilgan bo'lsa — natijalarni userni bot bilan
    // shaxsiy chatiga ham yuboramiz.
    if (!isPrivate) {
      for (const resultText of privateCopies) {
        try {
          await sendMessage(userId, resultText, resultKeyboard(user));
        } catch (error) {
          console.error("[INLINE_PRIVATE_COPY_FAILED]", error.message);
        }
      }
    }
  } catch (error) {
    // MUHIM: Bu yerda xatolikni faqat logga yozib qo'yib, Telegramga hech
    // qanday javob bermasdan chiqib ketish "aylanib turadigan" charxni
    // keltirib chiqargan asosiy sabab edi — Telegram klienti javobni
    // cheksiz kutib qoladi. Shu sabab har doim (hatto kutilmagan xatoda
    // ham) queryId uchun fallback javob qaytaramiz.
    recordError("inline_query_unhandled", error?.message || String(error), {
      userId,
      text,
    });
    console.error("[INLINE_QUERY_ERROR]", error);

    try {
      await answerInlineQuery(queryId, [
        buildInlineMessageResult(
          t("failed_lookup_title", lang),
          getFailedLookupText(null, { reason: "unexpected_error" }, lang)
        ),
      ]);
    } catch (fallbackError) {
      console.error("[INLINE_QUERY_FALLBACK_FAILED]", fallbackError);
    }
  }
}

const SKIN_RARITY_LABELS = Object.freeze({
  common: "Common",
  deluxe: "Deluxe",
  exceptional: "Exceptional",
  exquisite: "Exquisite",
  grand: "Grand",
  legend: "Legend",
});

async function handleFullInfoRequest(chatId, input, user = {}, options = {}) {
  const parsed = parseMlbbInput(input);
  const replyMarkup =
    Object.hasOwn(options, "replyMarkup") ? options.replyMarkup : resultKeyboard(user);
  let waitMessage = options.waitMessage || null;

  if (!parsed.ok) {
    await sendMessage(chatId, getInvalidFullInfoInputText(getUserLang(user.id)), replyMarkup);
    await safeDeleteBindWaitMessage(chatId, waitMessage);
    return;
  }

  // Paket (limit) tizimi: admin bo'lmagan userlar faqat qolgan paket qoldig'i
  //cha tekshirishi mumkin. Kunlik reset YO'Q — admin limit qo'shib turadi.
  // Boshlang'ich paket (5 ta) bazada full_info_quota default'i bilan beriladi.
  // Supabase sozlanmagan yoki javob bermasa — admin bo'lmaganlar uchun bloklanadi
  // (fail-closed): pullik paketni bepul berib yubormaslik uchun.
  let quotaData = null;
  if (!isAdmin(user.id)) {
    if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
      recordError("full_info_quota_unavailable", "Supabase sozlanmagan yoki vaqtincha bloklangan", {
        userId: user.id,
      });
      await safeDeleteBindWaitMessage(chatId, waitMessage);
      await sendMessage(
        chatId,
        t("full_info_service_unavailable", getUserLang(user.id), {
          supportUsername: SUPPORT_USERNAME,
        }),
        replyMarkup
      );
      return;
    }

    try {
      const quotaResult = await supabaseRpc("get_full_info_quota", {
        p_user_id: toPgBigint(user.id),
      });

      if (!quotaResult || quotaResult.allowed !== true || !(quotaResult.remaining > 0)) {
        await safeDeleteBindWaitMessage(chatId, waitMessage);
        await sendMessage(
          chatId,
          getFullInfoLimitReachedText(getUserLang(user.id), {
            supportUsername: SUPPORT_USERNAME,
          }),
          replyMarkup
        );
        return;
      }

      quotaData = quotaResult;
    } catch (error) {
      console.error("[FULL_INFO_QUOTA_CHECK_ERROR]", error);
      recordError("full_info_quota_check_failed", error.message, { userId: user.id });
      await safeDeleteBindWaitMessage(chatId, waitMessage);
      await sendMessage(
        chatId,
        t("full_info_service_unavailable", getUserLang(user.id), {
          supportUsername: SUPPORT_USERNAME,
        }),
        replyMarkup
      );
      return;
    }
  }

  void safeSendChatAction(chatId, "typing");

  if (!options.skipWait) {
    const waitResponse = await safeSendMessage(chatId, getFullInfoWaitText(getUserLang(user.id)), replyMarkup);
    waitMessage = normalizeBindWaitMessage({
      chatId,
      messageId: waitResponse?.result?.message_id,
    });
  }

  const fullInfo = await lookupMlbbFullInfo(parsed.accountId, parsed.zoneId);
  trackFeatureUse(user, { id: chatId }, FEATURE_ACTIONS.FULL_INFO);

  if (!fullInfo.ok) {
    // Xatolik bo'lsa limit kamaymaydi — hech narsa iste'mol qilinmadi.
    recordError("mlbb_full_info_failed", fullInfo.technicalReason || fullInfo.reason, {
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
      status: fullInfo.status,
    });

    await sendMessage(chatId, getFullInfoFailedText(fullInfo.reason, getUserLang(user.id)), replyMarkup);
    await safeDeleteBindWaitMessage(chatId, waitMessage);
    return;
  }

  let pageUrl = null;
  try {
    const content = buildFullInfoTelegraphContent(fullInfo.data);
    const page = await createTelegraphPage(
      getFullInfoPageTitle(fullInfo.data, getUserLang(user.id)),
      content
    );
    pageUrl = page?.url || null;
  } catch (error) {
    recordError("telegraph_page_failed", error.message, {
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
    });
  }

  if (!pageUrl) {
    await sendMessage(chatId, getFullInfoFailedText("telegraph_error", getUserLang(user.id)), replyMarkup);
    await safeDeleteBindWaitMessage(chatId, waitMessage);
    return;
  }

  // Natija tayyor bo'lgandagina 1 birlik paketdan yeiladi. Supabase ishlamasa,
  // tekshiruv baribir yuboriladi (limit noma'lum).
  let remainingAfter = null;
  if (quotaData && !isAdmin(user.id)) {
    try {
      const consumeResult = await supabaseRpc("consume_full_info_quota", {
        p_user_id: toPgBigint(user.id),
        p_action: "consume",
        p_amount: 1,
      });

      if (consumeResult && typeof consumeResult.remaining === "number") {
        remainingAfter = consumeResult.remaining;
      }
    } catch (error) {
      console.error("[FULL_INFO_QUOTA_CONSUME_ERROR]", error);
    }

    await recordQuotaEvent({
      userId: user.id,
      kind: "full_info",
      delta: -1,
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
      remaining: remainingAfter,
    });
  }

  const lang = getUserLang(user.id);
  const resultText = getFullInfoPostText(
    { accountId: parsed.accountId, zoneId: parsed.zoneId, data: fullInfo.data },
    pageUrl,
    lang,
    { remaining: null }
  );
  const resultKeyboardMarkup = {
    inline_keyboard: [
      [{ text: t("btn_view_result", lang), url: pageUrl }],
    ],
  };

  await sendFullInfoResult(chatId, resultText, resultKeyboardMarkup);
  await safeDeleteBindWaitMessage(chatId, waitMessage);
  runAccountOwnerNotify(options.ctx, user, parsed.accountId, parsed.zoneId, FEATURE_ACTIONS.FULL_INFO);

  // Paket qoldig'ini alohida xabar qilib yuboramiz — keyboard bilan
  if (typeof remainingAfter === "number") {
    await safeSendMessage(chatId, t("full_info_quota_remaining", lang, { remaining: remainingAfter }), mainKeyboard(user));
  }

  // Main group'ga faqat MUVAFFAQIYATLI tekshiruv haqida xabar boradi;
  // xatolik bo'lsa limit ham kamaymaydi, group'ga ham yozilmaydi.
  if (MAIN_GROUP_ID && String(chatId) !== MAIN_GROUP_ID) {
    const userMention = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name || "Foydalanuvchi"}</a>`;
    const notificationText = `#foydalanish\n${userMention} <b>${parsed.accountId} (${parsed.zoneId})</b> akkauntining to'liq ma'lumotlarini oldi.`;
    const inlineKeyboard = {
      inline_keyboard: [[{ text: t("btn_open_profile", getUserLang(user.id)), url: `tg://user?id=${user.id}` }]]
    };
    await safeSendMessage(MAIN_GROUP_ID, notificationText, inlineKeyboard);
  }
}

async function handleLimitFullInfoCommand(chatId, user, input) {
  const args = String(input || "").trim().split(/\s+/).filter(Boolean);
  const targetUserId = (args[0] || "").replace(/^@/, "");
  const amount = Number.parseInt(args[1], 10);

  if (!/^\d{1,20}$/.test(targetUserId) || !Number.isInteger(amount) || amount === 0) {
    await sendMessage(
      chatId,
      [
        "❌ Format xato.",
        "",
        "To'g'ri ko'rinish:",
        "<code>/limit_fullinfo [tgid] [miqdor]</code>",
        "",
        "Musbat qiymat — qo'shish, manfiy — kamaytirish.",
        "",
        "Namuna (qo'shish): <code>/limit_fullinfo 123456789 10</code>",
        "Namuna (kamaytirish): <code>/limit_fullinfo 123456789 -5</code>",
      ].join("\n"),
      mainKeyboard(user)
    );
    return;
  }

  if (!isSupabaseConfigured()) {
    await sendMessage(chatId, "❌ Supabase sozlanmagan — limit berish imkoni yo'q.", mainKeyboard(user));
    return;
  }

  try {
    let result = null;
    const isNegative = amount < 0;

    if (isNegative) {
      result = await supabaseRpc("consume_full_info_quota", {
        p_user_id: toPgBigint(targetUserId),
        p_action: "consume",
        p_amount: Math.abs(amount),
      });
    } else {
      result = await supabaseRpc("add_full_info_quota", {
        p_user_id: toPgBigint(targetUserId),
        p_amount: amount,
      });
    }

    if (!result || (result.ok !== true && result.error)) {
      throw new Error(result?.error || "limit o'zgartirishda xatolik");
    }

    await recordQuotaEvent({
      userId: targetUserId,
      kind: "full_info",
      delta: amount,
      source: "admin",
      remaining: typeof result.remaining === "number" ? result.remaining : null,
    });

    const absAmount = Math.abs(amount);
    const lines = [
      isNegative ? `✅ <b>Limit kamaytirildi.</b>` : `✅ <b>Limit qo'shildi.</b>`,
      "",
      `👤 User ID: <code>${escapeHtml(targetUserId)}</code>`,
      isNegative ? `➖ Kamaytirildi: <b>${absAmount}</b> ta` : `➕ Qo'shildi: <b>+${amount}</b> ta`,
    ];

    if (typeof result.remaining === "number") {
      lines.push(`📦 Jami qoldiq: <b>${result.remaining}</b> ta`);
    }

    await sendMessage(chatId, lines.join("\n"), mainKeyboard(user));

    // Limit o'zgargan userga xabar yuborish (bot bilan chat ochgan bo'lsa).
    const targetChatId = Number(targetUserId);
    if (Number.isFinite(targetChatId) && targetChatId !== Number(user.id)) {
      const targetLang = await loadUserLangFromSupabase(targetUserId).catch(() => DEFAULT_LANG);
      let notifyText = "";

      if (isNegative) {
        notifyText = t("full_info_quota_reduced_user", targetLang, {
          count: absAmount,
          remaining: typeof result.remaining === "number" ? result.remaining : 0,
        });
      } else {
        notifyText = t("full_info_quota_granted_user", targetLang, {
          count: amount,
          remaining: typeof result.remaining === "number" ? result.remaining : amount,
        });
      }

      try {
        await sendMessage(targetChatId, notifyText, null);
      } catch (notifyError) {
        console.error("[FULL_INFO_QUOTA_NOTIFY_ERROR]", notifyError.message);
      }
    }
  } catch (error) {
    recordError("full_info_quota_grant_failed", error.message, {
      targetUserId,
      amount,
    });

    await sendMessage(
      chatId,
      `❌ Limit berishda xatolik:\n<code>${escapeHtml(error.message)}</code>`,
      mainKeyboard(user)
    );
  }
}

async function handleLimitResetPwCommand(chatId, user, input) {
  const args = String(input || "").trim().split(/\s+/).filter(Boolean);
  const targetUserId = (args[0] || "").replace(/^@/, "");
  const amount = Number.parseInt(args[1], 10);

  if (!/^\d{1,20}$/.test(targetUserId) || !Number.isInteger(amount) || amount === 0) {
    await sendMessage(
      chatId,
      [
        "❌ Format xato.",
        "",
        "To'g'ri ko'rinish:",
        "<code>/limit_resetpw [tgid] [miqdor]</code>",
        "",
        "Musbat qiymat — qo'shish, manfiy — kamaytirish.",
        "",
        "Namuna (qo'shish): <code>/limit_resetpw 123456789 10</code>",
        "Namuna (kamaytirish): <code>/limit_resetpw 123456789 -5</code>",
      ].join("\n"),
      mainKeyboard(user)
    );
    return;
  }

  if (!isSupabaseConfigured()) {
    await sendMessage(chatId, "❌ Supabase sozlanmagan — limit berish imkoni yo'q.", mainKeyboard(user));
    return;
  }

  try {
    let result = null;
    const isNegative = amount < 0;

    if (isNegative) {
      result = await supabaseRpc("consume_reset_pw_quota", {
        p_user_id: toPgBigint(targetUserId),
        p_action: "consume",
        p_amount: Math.abs(amount),
      });
    } else {
      result = await supabaseRpc("add_reset_pw_quota", {
        p_user_id: toPgBigint(targetUserId),
        p_amount: amount,
      });
    }

    if (!result || (result.ok !== true && result.error)) {
      throw new Error(result?.error || "limit o'zgartirishda xatolik");
    }

    await recordQuotaEvent({
      userId: targetUserId,
      kind: "reset_pw",
      delta: amount,
      source: "admin",
      remaining: typeof result.remaining === "number" ? result.remaining : null,
    });

    const absAmount = Math.abs(amount);
    const lines = [
      isNegative ? `✅ <b>Limit kamaytirildi.</b>` : `✅ <b>Limit qo'shildi.</b>`,
      "",
      `👤 User ID: <code>${escapeHtml(targetUserId)}</code>`,
      isNegative ? `➖ Kamaytirildi: <b>${absAmount}</b> ta` : `➕ Qo'shildi: <b>+${amount}</b> ta`,
    ];

    if (typeof result.remaining === "number") {
      lines.push(`📦 Jami qoldiq: <b>${result.remaining}</b> ta`);
    }

    await sendMessage(chatId, lines.join("\n"), mainKeyboard(user));

    const targetChatId = Number(targetUserId);
    if (Number.isFinite(targetChatId) && targetChatId !== Number(user.id)) {
      const targetLang = await loadUserLangFromSupabase(targetUserId).catch(() => DEFAULT_LANG);
      let notifyText = "";

      if (isNegative) {
        notifyText = t("reset_pw_quota_reduced_user", targetLang, {
          count: absAmount,
          remaining: typeof result.remaining === "number" ? result.remaining : 0,
        });
      } else {
        notifyText = t("reset_pw_quota_granted_user", targetLang, {
          count: amount,
          remaining: typeof result.remaining === "number" ? result.remaining : amount,
        });
      }

      try {
        await sendMessage(targetChatId, notifyText, null);
      } catch (notifyError) {
        console.error("[RESET_PW_QUOTA_NOTIFY_ERROR]", notifyError.message);
      }
    }
  } catch (error) {
    recordError("reset_pw_quota_grant_failed", error.message, {
      targetUserId,
      amount,
    });

    await sendMessage(
      chatId,
      `❌ Limit berishda xatolik:\n<code>${escapeHtml(error.message)}</code>`,
      mainKeyboard(user)
    );
  }
}

async function handleResetPwRequest(chatId, input, user = {}, options = {}) {
  const email = String(input || "").trim();
  const replyMarkup =
    Object.hasOwn(options, "replyMarkup") ? options.replyMarkup : mainKeyboard(user);
  let waitMessage = options.waitMessage || null;

  if (!isValidEmailFormat(email)) {
    await sendMessage(chatId, getInvalidResetPwEmailText(getUserLang(user.id)), replyMarkup);
    await safeDeleteBindWaitMessage(chatId, waitMessage);
    return;
  }

  const isAdminUser = isAdmin(user.id);

  // Paket tizimi full_info bilan bir xil: admin bo'lmagan userlar qolgan paket
  // hisobidan foydalanadi. Supabase sozlanmagan/ishlamasa — fail-closed blok.
  let quotaData = null;
  if (!isAdminUser) {
    if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
      recordError("reset_pw_quota_unavailable", "Supabase sozlanmagan yoki vaqtincha bloklangan", {
        userId: user.id,
      });
      await safeDeleteBindWaitMessage(chatId, waitMessage);
      await sendMessage(
        chatId,
        t("reset_pw_service_unavailable", getUserLang(user.id), {
          supportUsername: SUPPORT_USERNAME,
        }),
        replyMarkup
      );
      return;
    }

    try {
      const quotaResult = await supabaseRpc("get_reset_pw_quota", {
        p_user_id: toPgBigint(user.id),
      });

      if (!quotaResult || quotaResult.allowed !== true || !(quotaResult.remaining > 0)) {
        await safeDeleteBindWaitMessage(chatId, waitMessage);
        await sendMessage(
          chatId,
          getResetPwLimitReachedText(getUserLang(user.id), {
            supportUsername: SUPPORT_USERNAME,
          }),
          replyMarkup
        );
        return;
      }

      quotaData = quotaResult;
    } catch (error) {
      console.error("[RESET_PW_QUOTA_CHECK_ERROR]", error);
      recordError("reset_pw_quota_check_failed", error.message, { userId: user.id });
      await safeDeleteBindWaitMessage(chatId, waitMessage);
      await sendMessage(
        chatId,
        t("reset_pw_service_unavailable", getUserLang(user.id), {
          supportUsername: SUPPORT_USERNAME,
        }),
        replyMarkup
      );
      return;
    }
  }

  void safeSendChatAction(chatId, "typing");

  if (!options.skipWait) {
    const waitResponse = await safeSendMessage(chatId, getResetPwWaitText(getUserLang(user.id)), replyMarkup);
    waitMessage = normalizeBindWaitMessage({
      chatId,
      messageId: waitResponse?.result?.message_id,
    });
  }

  const resetResult = await lookupResetPassword(email);
  trackFeatureUse(user, { id: chatId }, FEATURE_ACTIONS.RESET_PW);

  if (!resetResult.ok) {
    // Xatolik bo'lsa paket kamaymaydi — email yuborilmadi.
    recordError("reset_pw_failed", resetResult.technicalReason || resetResult.reason, {
      status: resetResult.status,
    });

    await sendMessage(chatId, getResetPwFailedText(resetResult.reason, getUserLang(user.id)), replyMarkup);
    await safeDeleteBindWaitMessage(chatId, waitMessage);
    return;
  }

  // Faqat email muvaffaqiyatli yuborilgandan keyin 1 birlik paketdan yechiladi.
  let remainingAfter = null;
  if (quotaData && !isAdminUser) {
    try {
      const consumeResult = await supabaseRpc("consume_reset_pw_quota", {
        p_user_id: toPgBigint(user.id),
        p_action: "consume",
        p_amount: 1,
      });

      if (consumeResult && typeof consumeResult.remaining === "number") {
        remainingAfter = consumeResult.remaining;
      }
    } catch (error) {
      console.error("[RESET_PW_QUOTA_CONSUME_ERROR]", error);
    }

    await recordQuotaEvent({
      userId: user.id,
      kind: "reset_pw",
      delta: -1,
      target: quotaLog.maskEmail(resetResult.data?.email || email),
      remaining: remainingAfter,
    });
  }

  const lang = getUserLang(user.id);
  const resultEmail = resetResult.data?.email || email;

  await sendMessage(
    chatId,
    getResetPwSuccessText(lang, { email: escapeHtml(resultEmail) }),
    replyMarkup
  );
  await safeDeleteBindWaitMessage(chatId, waitMessage);

  if (typeof remainingAfter === "number") {
    await safeSendMessage(chatId, t("reset_pw_quota_remaining", lang, { remaining: remainingAfter }), mainKeyboard(user));
  }

  // Main group'ga faqat MUVAFFAQIYATLI so'rov haqida xabar boradi.
  if (MAIN_GROUP_ID && String(chatId) !== MAIN_GROUP_ID) {
    const userMention = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name || "Foydalanuvchi"}</a>`;
    const notificationText = `#foydalanish\n${userMention} <b>${escapeHtml(resultEmail)}</b> uchun parolni tiklash xatini yubordi.`;
    const inlineKeyboard = {
      inline_keyboard: [[{ text: t("btn_open_profile", getUserLang(user.id)), url: `tg://user?id=${user.id}` }]]
    };
    await safeSendMessage(MAIN_GROUP_ID, notificationText, inlineKeyboard);
  }
}

function getFullInfoLimitReachedText(lang, params = {}) {
  lang = lang || DEFAULT_LANG;
  return t("full_info_limit_reached", lang, params);
}

async function sendFullInfoResult(chatId, text, replyMarkup, options = {}) {
  // Premium emoji enrichment (tg-emoji) global sendMessage'da ishlaydi —
  // bu yerda uni o'chirish shart emas.
  return sendMessage(chatId, text, replyMarkup, options);
}

async function lookupMlbbFullInfo(accountId, zoneId) {
  // Provider (api.jebray.com) vaqtincha 404/5xx/timeout qaytarishi mumkin —
  // o'tkinchi xatolarda qisqa kutish bilan qayta urinamiz.
  const attempts = FULL_INFO_RETRIES + 1;
  const delays = [0, 800, 1500];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await lookupMlbbFullInfoOnce(accountId, zoneId);

    if (result.ok) {
      return result;
    }

    if (attempt >= FULL_INFO_RETRIES || !isRetriableFullInfoFailure(result.reason)) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, delays[attempt + 1] || 1000));
  }

  return { ok: false, provider: "full_info_api", reason: "full_info_provider_unavailable" };
}

function isRetriableFullInfoFailure(reason = "") {
  if (/not_found|down|timeout|unavailable|generic/i.test(reason)) {
    return true;
  }

  return false;
}

async function lookupMlbbFullInfoOnce(accountId, zoneId) {
  if (!FULL_INFO_API_KEY) {
    return {
      ok: false,
      provider: "full_info_api",
      reason: "full_info_api_not_configured",
      technicalReason: "FULL_INFO_API_KEY env sozlanmagan",
    };
  }

  try {
    const url = `${FULL_INFO_API_URL.replace(/\/+$/, "")}/tools/check`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": FULL_INFO_API_KEY,
      },
      body: JSON.stringify({
        player_id: Number(accountId),
        zone_id: Number(zoneId),
      }),
      timeoutMs: FULL_INFO_TIMEOUT_MS,
    });

    const bodyText = await response.text();
    const data = safeJsonParse(bodyText);

    if (!response.ok) {
      return {
        ok: false,
        provider: "full_info_api",
        reason: getFriendlyFullInfoReason({ status: response.status, data }),
        technicalReason: `Full info API HTTP ${response.status}: ${clipText(
          bodyText || response.statusText,
          180
        )}`,
        status: response.status,
        data,
      };
    }

    if (!data || data.success !== true || !data.data) {
      return {
        ok: false,
        provider: "full_info_api",
        reason: getFriendlyFullInfoReason({ status: response.status, data }),
        technicalReason: bodyText
          ? clipText(bodyText, 180)
          : "Akkaunt to'liq ma'lumoti topilmadi",
        status: response.status,
        data,
      };
    }

    return {
      ok: true,
      provider: "full_info_api",
      data: data.data,
      raw: data,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "full_info_api",
      reason: getFriendlyFullInfoReason({ error }),
      technicalReason: error.message || "Full info API ishlamadi",
    };
  }
}

function getFriendlyFullInfoReason({ status, data, error } = {}) {
  if (error) {
    if (/abort|timeout/i.test(error.message || "")) {
      return "full_info_provider_timeout";
    }
    return "full_info_provider_unavailable";
  }

  if (status === 401) return "full_info_provider_auth_required";
  if (status === 403) return "full_info_provider_quota_exceeded";
  if (status === 404) return "full_info_provider_not_found";
  if (status === 429) return "full_info_provider_rate_limited";
  if (status >= 500) return "full_info_provider_down";
  return "full_info_provider_generic";
}

function fullInfoProviderErrorReason(reason = "") {
  if (/not_configured/i.test(reason)) return "full_info_not_configured";
  if (/auth_required/i.test(reason)) return "full_info_provider_auth_required";
  if (/quota_exceeded/i.test(reason)) return "full_info_provider_quota_exceeded";
  if (/rate_limited/i.test(reason)) return "full_info_provider_rate_limited";
  if (/timeout/i.test(reason)) return "full_info_provider_timeout";
  if (/unavailable/i.test(reason)) return "full_info_provider_unavailable";
  if (/not_found/i.test(reason)) return "full_info_provider_not_found";
  if (/down/i.test(reason)) return "full_info_provider_down";
  return "full_info_provider_generic";
}

// Moonton parolni tiklash: bir marta chaqiriladi (retry YO'Q). Sabab: endpoint
// email yuborish kabi yon ta'sirga ega; 502/timeout bo'lsa qayta urinish
// foydalanuvchiga bir nechta xat yuborib qo'yishi mumkin.
async function lookupResetPassword(email) {
  if (!FULL_INFO_API_KEY) {
    return {
      ok: false,
      provider: "reset_pw",
      reason: "reset_pw_api_not_configured",
      technicalReason: "FULL_INFO_API_KEY env sozlanmagan",
    };
  }

  try {
    const url = `${FULL_INFO_API_URL.replace(/\/+$/, "")}/tools/reset-pw`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": FULL_INFO_API_KEY,
      },
      body: JSON.stringify({ email }),
      timeoutMs: RESET_PW_TIMEOUT_MS,
    });

    const bodyText = await response.text();
    const data = safeJsonParse(bodyText);

    if (!response.ok) {
      return {
        ok: false,
        provider: "reset_pw",
        reason: getFriendlyResetPwReason({ status: response.status, data }),
        technicalReason: `Reset PW API HTTP ${response.status}: ${clipText(
          bodyText || response.statusText,
          180
        )}`,
        status: response.status,
        data,
      };
    }

    if (!data || data.success !== true) {
      return {
        ok: false,
        provider: "reset_pw",
        reason: getFriendlyResetPwReason({ status: response.status, data }),
        technicalReason: bodyText
          ? clipText(bodyText, 180)
          : "Parolni tiklash javobi bo'sh",
        status: response.status,
        data,
      };
    }

    return {
      ok: true,
      provider: "reset_pw",
      data,
      raw: data,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "reset_pw",
      reason: getFriendlyResetPwReason({ error }),
      technicalReason: error.message || "Reset PW API ishlamadi",
    };
  }
}

function getFriendlyResetPwReason({ status, data, error } = {}) {
  if (error) {
    if (/abort|timeout/i.test(error.message || "")) {
      return "reset_pw_timeout";
    }
    return "reset_pw_unavailable";
  }

  const rawMessage = String(data?.raw_message || data?.rawMessage || "");
  const errorText = String(data?.error || data?.message || "");

  if (/Error_FailedTooMuch/i.test(rawMessage) || /too many/i.test(errorText)) {
    return "reset_pw_too_many";
  }

  if (/Error_NoAccount/i.test(rawMessage) || /invalid email/i.test(errorText)) {
    return "reset_pw_no_account";
  }

  if (status === 401) return "reset_pw_auth_required";
  if (status === 403) return "reset_pw_quota_exceeded";
  if (status === 429) return "reset_pw_rate_limited";
  if (status >= 500) return "reset_pw_provider_down";
  return "reset_pw_generic";
}

function getInvalidFullInfoInputText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("full_info_invalid_input", lang);
}

function getFullInfoPageTitle(data = {}, lang) {
  lang = lang || DEFAULT_LANG;
  const nickname = escapeHtml(data.nickname || "MLBB Player");
  const date = getTashkentDateString();
  return t("full_info_page_title", lang, { nickname, date });
}

async function getTelegraphAccessToken() {
  if (stats.telegraphToken) {
    return stats.telegraphToken;
  }

  if (TELEGRAPH_ACCESS_TOKEN) {
    stats.telegraphToken = TELEGRAPH_ACCESS_TOKEN;
    return TELEGRAPH_ACCESS_TOKEN;
  }

  if (isSupabaseConfigured()) {
    try {
      const data = await supabaseRequest(`/bot_settings?key=eq.telegraph_token&select=value`);
      const token = data?.[0]?.value?.token;
      if (token) {
        stats.telegraphToken = token;
        return token;
      }
    } catch (error) {
      console.error("[TELEGRAPH_TOKEN_READ_ERROR]", error);
    }
  }

  const account = await createTelegraphAccount();
  const token = account?.access_token;

  if (!token) {
    throw new Error("telegraph_account_creation_failed");
  }

  stats.telegraphToken = token;

  if (isSupabaseConfigured()) {
    try {
      await supabaseRequest(`/bot_settings?on_conflict=key`, {
        method: "POST",
        prefer: "resolution=merge-duplicates",
        body: { key: "telegraph_token", value: { token } },
      });
    } catch (error) {
      console.error("[TELEGRAPH_TOKEN_SAVE_ERROR]", error);
    }
  }

  return token;
}

async function createTelegraphAccount() {
  const params = new URLSearchParams();
  params.set("short_name", "checkmlbbidbot");
  params.set("author_name", "MLBB Chat ID Bot");
  params.set("author_url", "https://t.me/checkmlbbidBot");

  const response = await fetchWithTimeout(`https://api.telegra.ph/createAccount?${params}`, {
    method: "POST",
    timeoutMs: TELEGRAPH_TIMEOUT_MS,
  });

  const bodyText = await response.text();
  const data = safeJsonParse(bodyText);

  if (!response.ok || !data?.ok || !data?.result?.access_token) {
    throw new Error(`Telegraph createAccount failed: ${clipText(bodyText, 180)}`);
  }

  return data.result;
}

async function createTelegraphPage(title, content, authorName = "MLBB Chat ID Bot") {
  const token = await getTelegraphAccessToken();
  const params = new URLSearchParams();
  params.set("access_token", token);
  params.set("title", title);
  params.set("author_name", authorName);
  params.set("content", JSON.stringify(content));
  params.set("return_content", "true");

  // content JSON 8KB+ bo'lishi mumkin — nginx 8KB dan uzun so'rov qatorini
  // (URL) 400 bilan qaytaradi. Shuning uchun parametrlarni URL'ga emas,
  // POST body'ga (form-urlencoded) joylaymiz — telegra.ph API buni qo'llab-quvvatlaydi.
  const response = await fetchWithTimeout("https://api.telegra.ph/createPage", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    timeoutMs: TELEGRAPH_TIMEOUT_MS,
  });

  const bodyText = await response.text();
  const data = safeJsonParse(bodyText);

  if (!response.ok || !data?.ok || !data?.result?.url) {
    throw new Error(`Telegraph createPage failed: ${clipText(bodyText, 180)}`);
  }

  return data.result;
}

function buildFullInfoTelegraphContent(data = {}) {
  const nodes = [];

  // Faqat profil rasmi chiqadi — hero rasmlari (recent_battles.hero_image va h.k.)
  // UI ga yuborilmaydi.
  const avatarUrl = data.avatar || data.avatar_url || "";
  if (avatarUrl) {
    nodes.push(
      telegraphNode("figure", [telegraphNode("img", undefined, { src: avatarUrl })])
    );
  }

  const fields = [
    {
      header: `${staticEmoji("fullInfoSectionMain", "🔵")} Asosiy ma'lumotlar`,
      rows: [
        ["Nickname", data.nickname],
        ["Player ID", data.player_id],
        ["Server ID", data.server_id],
        ["Level", data.level],
        ["Rank", data.rank],
        ["Eng yuqori rank", data.highest_rank],
        ["Mavsum", data.season],
        ["Akkaunt yaratilgan", data.creation_date],
        ["Mamlakat", data.create_role_country],
        ["Oxirgi kirish", data.last_login],
        ["Oxirgi kirish mamlakati", data.last_login_country],
        ["Manzil", Array.isArray(data.location) && data.location.length ? data.location.join(", ") : null],
        ["Squad", buildReadableSquad(data.squad)],
        ["Oxirgi o'ynalgan qahramonlar", Array.isArray(data.last_use_hero) && data.last_use_hero.length ? buildReadableHeroNames(data.last_use_hero) : null],
      ],
    },
    {
      header: `${staticEmoji("fullInfoSectionCollection", "🟡")} Kolleksiya`,
      condition: data.collection,
      rows: [
        ["Kolleksiya ballari", data.collection?.collection_point],
        ["Kolleksiya darajasi", data.collection?.collection_title],
        ["Qahramonlar soni", data.collection?.heroes],
        ["Skinlar soni", data.collection?.skins],
        ["Bo'yalgan skinlar", data.collection?.painted_skins],
        ["Oxirgi qahramon xaridi", Array.isArray(data.collection?.last_heroes_purchase) && data.collection.last_heroes_purchase.length ? data.collection.last_heroes_purchase.join(", ") : null],
        ["Oxirgi skin xaridi", data.collection?.latest_skin_purchase],
      ],
    },
    {
      header: `${staticEmoji("fullInfoSectionBattle", "🔴")} Jangovor statistika`,
      condition: data.combat,
      rows: [
        ["Jami janglar", data.combat?.total_matches],
        ["Klassik / Ranked janglar", data.combat?.classic_ranked_matches],
        ["G'alaba foizi", Number.isFinite(data.combat?.win_rate) ? `${data.combat.win_rate}%` : null],
        ["MVP", data.combat?.mvp],
        ["MVP (mag'lubiyat)", data.combat?.mvp_loss],
        ["Savage", data.combat?.savage],
        ["Maniac", data.combat?.maniac],
        ["Legendary", data.combat?.legendary],
        ["Triple Kill", data.combat?.triple_kill],
        ["Double Kill", data.combat?.double_kill],
        ["First Blood", data.combat?.first_blood],
        ["Eng ko'p kill", data.combat?.most_kills],
        ["Eng ko'p assist", data.combat?.most_assists],
        ["Eng uzun g'alaba seriyasi", data.combat?.longest_win_streak],
        ["Eng yuqori DMG / min", data.combat?.highest_dmg_per_min],
        ["Eng yuqori qabul qilingan DMG / min", data.combat?.highest_dmg_taken_per_min],
        ["Eng yuqori gold / min", data.combat?.highest_gold_per_min],
      ],
    },
  ];

  for (const section of fields) {
    if (section.condition === undefined || section.condition) {
      appendTelegraphSection(nodes, section);
    }
  }

  if (data.collection?.skin_rarity) {
    appendTelegraphSection(nodes, {
      header: `${staticEmoji("fullInfoSectionCollection", "🟡")} Skin raritylari`,
      rows: Object.entries(SKIN_RARITY_LABELS).map(([key, label]) => [label, data.collection.skin_rarity[key]]),
    });
  }

  const favorite = data.favorite_heroes;
  if (favorite) {
    if (Array.isArray(favorite.all_time) && favorite.all_time.length) {
      nodes.push(telegraphNode("h3", [telegraphText(`${staticEmoji("fullInfoSectionHeroes", "🟢")} Sevimli qahramonlar — barcha davr`)]));
      for (const hero of favorite.all_time) {
        nodes.push(buildTelegraphHeroLine(hero));
      }
    }
    if (Array.isArray(favorite.current_season) && favorite.current_season.length) {
      nodes.push(telegraphNode("h3", [telegraphText(`${staticEmoji("fullInfoSectionHeroes", "🟢")} Sevimli qahramonlar — joriy mavsum`)]));
      for (const hero of favorite.current_season) {
        nodes.push(buildTelegraphHeroLine(hero));
      }
    }
  }

  if (Array.isArray(data.recent_battles) && data.recent_battles.length) {
    nodes.push(telegraphNode("h3", [telegraphText(`${staticEmoji("fullInfoSectionRecent", "🟠")} So'nggi janglar`)]));
    for (const battle of data.recent_battles) {
      nodes.push(buildTelegraphBattleLine(battle));
    }
  }

  if (data.social) {
    appendTelegraphSection(nodes, {
      header: `${staticEmoji("fullInfoSectionSocial", "🟣")} Ijtimoiy ko'rsatkichlar`,
      rows: [
        ["Yutuqlar (achievement)", data.social?.achievement],
        ["Kredit bali", data.social?.credit_score],
        ["Obunachilar", data.social?.followers],
        ["Yoqtirishlar", data.social?.likes],
        ["Mashhurlik", data.social?.popularity],
        ["Ma'lumot", data.social?.status],
      ],
    });
  }

const footer = [
    telegraphNode("h3", [telegraphText(`${staticEmoji("fullInfoSource", "🤖")} Ma'lumot manbai`)]),
    telegraphNode("p", [
      telegraphText("Ushbu ma'lumotlar MLBB Chat ID Bot orqali yig'ildi. "),
      telegraphNode("a", [telegraphText(`@${TELEGRAM_BOT_USERNAME || "checkmlbbidBot"}`)], { href: `https://t.me/${TELEGRAM_BOT_USERNAME || "checkmlbbidBot"}` }),
    ]),
    telegraphNode("p", [
      telegraphText("Bot admin: "),
      telegraphNode("a", [telegraphText(`@${SUPPORT_USERNAME}`)], { href: `https://t.me/${SUPPORT_USERNAME}` }),
    ]),
  ];
  nodes.push(...footer);

  return nodes;
}

function buildReadableSquad(squad = {}) {
  const name = String(squad.name || "").trim();
  if (!name || /^\d+$/.test(name)) {
    return null;
  }
  const tag = String(squad.tag || "").trim();

  return `${name}${tag && !/^\d+$/.test(tag) ? ` (${tag})` : ""}`;
}

function buildReadableHeroNames(heroes = []) {
  const readable = heroes.map(readableHeroName).filter(Boolean);
  return readable.length ? readable.join(", ") : null;
}

// Raqamli ID lar (masalan "294", "296") o'qilmaydigan — ularni yashirib,
// faqat haqiqiy qahramon nomini qaytaradi.
function readableHeroName(hero) {
  const name = String(hero ?? "").trim();
  if (!name || /^\d+$/.test(name)) return null;
  return name;
}

function appendTelegraphSection(nodes, section) {
  const rows = (section.rows || []).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!rows.length) {
    return;
  }
  if (nodes.some((node) => node.tag === "h3")) {
    nodes.push(telegraphNode("hr"));
  }
  nodes.push(telegraphNode("h3", [telegraphText(section.header)]));
  for (const [label, value] of rows) {
    nodes.push(
      telegraphNode("p", [
        telegraphNode("strong", [telegraphText(`${label}:`)]),
        telegraphText(` ${String(value)}`),
      ])
    );
  }
}

function buildTelegraphHeroLine(hero = {}) {
  const parts = [`${hero.name || "Qahramon"}`];
  if (Number.isFinite(hero.matches)) parts.push(`${hero.matches} o'yin`);
  if (Number.isFinite(hero.win_rate)) parts.push(`${hero.win_rate}% g'alaba`);
  if (Number.isFinite(hero.hero_power)) parts.push(`${hero.hero_power} kuch`);

  return telegraphNode("p", [
    telegraphNode("strong", [telegraphText(parts.join(" | "))]),
  ]);
}

function buildTelegraphBattleLine(battle = {}) {
  const resultEmoji = String(battle.result || "").toLowerCase() === "victory" ? "✅" : "❌";
  const resultLabel = String(battle.result || "Noma'lum");
  const heroName = readableHeroName(battle.hero) || "Noma'lum qahramon";
  const firstLine = `${resultEmoji} ${heroName} — ${battle.mode || "Rejim noma'lum"} (${resultLabel})`;
  const statsLine = `Kill: ${battle.kills ?? "?"} | Death: ${battle.deaths ?? "?"} | Assist: ${battle.assists ?? "?"}`;
  const detailLine = [
    battle.date ? `Sana: ${battle.date}` : null,
    battle.duration ? `Davomiylik: ${battle.duration}` : null,
  ].filter(Boolean).join(" | ");

  return telegraphNode("p", [
    telegraphNode("strong", [telegraphText(firstLine)]),
    telegraphNode("br", []),
    telegraphText(statsLine),
    telegraphNode("br", []),
    telegraphText(detailLine),
  ]);
}

async function handleBroadcastConfirm(chatId, user, data, options = {}) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
    return;
  }

  const { broadcastId, token } = parseBroadcastCallback(data, "broadcast_confirm");
  const pending = await loadPendingBroadcast(broadcastId);

  if (
    !pending ||
    pending.status !== "pending" ||
    pending.adminId !== String(user.id) ||
    pending.chatId !== String(chatId) ||
    pending.tokenHash !== hashBroadcastToken(token)
  ) {
    await sendMessage(chatId, getBroadcastExpiredText(), mainKeyboard(user));
    return;
  }

  pending.status = "confirmed";
  await deletePendingBroadcast(broadcastId);
  await sendMessage(chatId, "📣 <b>Xabar yuborish boshlandi.</b>", mainKeyboard(user));

  const broadcastBody = {
    id: broadcastId,
    payload: pending.payload,
    adminChatId: String(chatId),
  };
  const broadcastRunner = getAsyncRunnerStub(options.env, BROADCAST_RUNNER_NAME);

  if (broadcastRunner) {
    try {
      const response = await broadcastRunner.fetch(`${ASYNC_RUNNER_BASE_URL}/broadcast`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(broadcastBody),
      });

      if (response.ok) {
        await sendMessage(
          chatId,
          getBroadcastQueuedText(pending.recipientCount, getUserLang(user.id)),
          mainKeyboard(user)
        );
        return;
      }

      throw new Error(`AsyncRunner broadcast start failed: ${response.status}`);
    } catch (error) {
      console.error("[BROADCAST_RUNNER_SUBMIT_ERROR]", error);
      recordError("broadcast_runner_failed", error.message);
    }
  }

  const broadcastQueue = options.env?.BROADCAST_QUEUE;

  if (broadcastQueue && typeof broadcastQueue.send === "function") {
    try {
      await broadcastQueue.send(broadcastBody);
      await sendMessage(
        chatId,
        getBroadcastQueuedText(pending.recipientCount, getUserLang(user.id)),
        mainKeyboard(user)
      );
    } catch (error) {
      console.error("[BROADCAST_ENQUEUE_ERROR]", error);
      recordError("broadcast_enqueue_failed", error.message);
      await sendMessage(chatId, getBroadcastQueuedErrorText(getUserLang(user.id)), mainKeyboard(user));
    }

    return;
  }

  const result = await broadcastMessage(pending.payload);

  await sendMessage(
    chatId,
    getBroadcastResultText(result),
    mainKeyboard(user)
  );
}

function getAsyncRunnerStub(env, name) {
  const namespace = env?.ASYNC_RUNNER;

  if (!namespace || typeof namespace.idFromName !== "function") {
    return null;
  }

  try {
    return namespace.get(namespace.idFromName(name));
  } catch (error) {
    console.error("[ASYNC_RUNNER_ID_ERROR]", error);
    return null;
  }
}

async function handleBroadcastCancel(chatId, user, data) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
    return;
  }

  const { broadcastId, token } = parseBroadcastCallback(data, "broadcast_cancel");
  const pending = await loadPendingBroadcast(broadcastId);

  if (pending?.adminId === String(user.id) && pending.tokenHash === hashBroadcastToken(token)) {
    await deletePendingBroadcast(broadcastId);
  }

  await sendMessage(chatId, "Bekor qilindi.", mainKeyboard(user));
}

async function detectAndReply(chatId, input, user = {}, options = {}) {
  const parsed = parseMlbbInput(input);
  const replyMarkup =
    Object.hasOwn(options, "replyMarkup") ? options.replyMarkup : resultKeyboard(user);

  if (!parsed.ok) {
    stats.failedChecks += 1;
    recordError("mlbb_input_invalid", parsed.reason, {
      input: clipText(String(input || ""), 120),
    });

    await sendMessage(
      chatId,
      getInvalidMlbbInputText(getUserLang(user.id)),
      Object.hasOwn(options, "replyMarkup") ? options.replyMarkup : checkKeyboard(user)
    );

    return;
  }

  void safeSendChatAction(chatId, "typing");

  const lookup = await lookupMlbbAccount(parsed.accountId, parsed.zoneId);

  stats.checks += 1;
  stats.lastCheckAt = new Date().toISOString();
  trackFeatureUse(user, { id: chatId }, FEATURE_ACTIONS.SERVER_CHECK);

  if (!lookup.ok) {
    stats.failedChecks += 1;
    recordError("mlbb_lookup_failed", lookup.technicalReason || lookup.reason, {
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
      status: lookup.status,
    });

    await sendMessage(
      chatId,
      getFailedLookupText(parsed, lookup, getUserLang(user.id)),
      replyMarkup
    );

    return;
  }

  stats.successChecks += 1;

  const result = {
    accountId: parsed.accountId,
    zoneId: parsed.zoneId,
    nickname: lookup.nickname,
    region: lookup.region,
    serverType: detectServerType(parsed.zoneId),
    status: "Profil topildi",
    rawProvider: lookup.provider,
  };

  await sendMessage(chatId, getResultText(result, getUserLang(user.id)), replyMarkup);
  runAccountOwnerNotify(options.ctx, user, parsed.accountId, parsed.zoneId, FEATURE_ACTIONS.SERVER_CHECK);

  if (MAIN_GROUP_ID && String(chatId) !== MAIN_GROUP_ID) {
    const userMention = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name || "Foydalanuvchi"}</a>`;
    const notificationText = `#foydalanish\n${userMention} <b>${parsed.accountId} (${parsed.zoneId})</b> ni check qildi.`;
    const inlineKeyboard = {
      inline_keyboard: [[{ text: t("btn_open_profile", getUserLang(user.id)), url: `tg://user?id=${user.id}` }]]
    };
    await safeSendMessage(MAIN_GROUP_ID, notificationText, inlineKeyboard);
  }
}

async function lookupMlbbAccount(accountId, zoneId, options = {}) {
  try {
    const url = new URL(MLBB_LOOKUP_API_URL);
    url.searchParams.set("id", accountId);
    url.searchParams.set("zone", zoneId);

    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "MLBB-Server-Detector-Bot/1.0",
      },
      timeoutMs: options.timeoutMs || MLBB_LOOKUP_TIMEOUT_MS,
    });

    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();

    let data = null;

    if (contentType.includes("application/json")) {
      data = safeJsonParse(bodyText);
    } else {
      data = safeJsonParse(bodyText) || { raw: bodyText };
    }

    if (!response.ok) {
      return {
        ok: false,
        provider: "external_api",
        reason: getFriendlyLookupReason({
          status: response.status,
          data,
        }),
        technicalReason: `Lookup API HTTP ${response.status}`,
        status: response.status,
        data,
      };
    }

    const normalized = normalizeLookupResponse(data);

    if (!normalized.ok) {
      return {
        ok: false,
        provider: "external_api",
        reason: getFriendlyLookupReason({
          reason: normalized.reason,
          data,
        }),
        technicalReason: normalized.reason || "Akkaunt topilmadi yoki server ID noto‘g‘ri",
        data,
      };
    }

    return {
      ok: true,
      provider: "external_api",
      nickname: normalized.nickname,
      region: normalized.region,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "external_api",
      reason: getFriendlyLookupReason({ error }),
      technicalReason: error.message || "Lookup API ishlamadi",
    };
  }
}

async function lookupMlbbBindInfo(accountId, zoneId, options = {}) {
  const timeoutMs = options.timeoutMs || MLBB_BIND_INFO_TIMEOUT_MS;

  // 1) Jebray (api.jebray.com) — birinchi urinish
  const jebrayResult = await lookupJebrayMlbbBindInfo(accountId, zoneId, timeoutMs);
  if (jebrayResult.ok) {
    return jebrayResult;
  }

  // 2) Bengkel fallback — Jebray natija bermasa
  if (isBengkelBindInfoProvider()) {
    const bengkelResult = await lookupBengkelMlbbBindInfo(accountId, zoneId, timeoutMs);
    if (bengkelResult.ok) {
      return bengkelResult;
    }
    // Jebray faqat sozlanmaganligi sababli ishlamagan bo'lsa, bengkel xatosini
    // ko'rsatamiz (aniqroq xabar). Aks holda birinchi (Jebray) xatosini qaytaramiz.
    if (jebrayResult.reason === "bind_info_api_not_configured") {
      return bengkelResult;
    }
    return jebrayResult;
  }

  // 3) Default API (MLBB_BIND_INFO_API_URL) — Bengkel sozlanmagan bo'lsa
  if (!MLBB_BIND_INFO_API_URL) {
    return jebrayResult;
  }

  try {
    const request = buildBindInfoRequest(accountId, zoneId);

    const response = await fetchWithTimeout(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeoutMs,
    });

    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();
    const data = contentType.includes("application/json")
      ? safeJsonParse(bodyText)
      : safeJsonParse(bodyText) || null;

    if (!response.ok) {
      const reason = getFriendlyBindInfoReason({
        status: response.status,
        contentType,
        bodyText,
        data,
      });

      return {
        ok: false,
        provider: "bind_info_api",
        reason,
        technicalReason: `Bind info API HTTP ${response.status}: ${clipText(
          bodyText || response.statusText,
          180
        )}`,
        status: response.status,
        data,
      };
    }

    const normalized = normalizeBindInfoResponse(data);

    if (!normalized.ok) {
      return {
        ok: false,
        provider: "bind_info_api",
        reason: getFriendlyBindInfoReason({
          contentType,
          bodyText,
          data,
          fallback: normalized.reason,
        }),
        technicalReason: normalized.reason,
        data,
      };
    }

    return {
      ok: true,
      provider: "bind_info_api",
      data: normalized.data,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "bind_info_api",
      reason: getFriendlyBindInfoReason({ error }),
      technicalReason: error.message || "Bind info API ishlamadi",
    };
  }
}

async function lookupBengkelMlbbBindInfo(accountId, zoneId, timeoutMs = MLBB_BIND_INFO_TIMEOUT_MS) {
  if (!MLBB_BIND_INFO_API_URL || isTelegramBotApiUrl(MLBB_BIND_INFO_API_URL)) {
    return {
      ok: false,
      provider: "bengkel_bot",
      reason: "bengkel_bridge_not_configured",
      technicalReason:
        "Bengkel provider uchun Telegram userbot/bridge HTTP endpointi kerak. Bot API boshqa botdan javob ola olmaydi.",
    };
  }

  try {
    const request = buildBengkelBindInfoRequest(accountId, zoneId);

    const response = await fetchWithTimeout(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeoutMs,
    });

    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();
    const data = contentType.includes("application/json")
      ? safeJsonParse(bodyText)
      : safeJsonParse(bodyText) || null;

    if (!response.ok) {
      const reason = getFriendlyBindInfoReason({
        status: response.status,
        contentType,
        bodyText,
        data,
      });

      return {
        ok: false,
        provider: "bengkel_bot",
        reason,
        technicalReason: `Bengkel bridge HTTP ${response.status}: ${clipText(
          bodyText || response.statusText,
          180
        )}`,
        status: response.status,
        data,
      };
    }

    const normalized = normalizeBengkelBindInfoResponse(data, bodyText);

    if (!normalized.ok) {
      return {
        ok: false,
        provider: "bengkel_bot",
        reason: normalized.reason,
        technicalReason: normalized.reason,
        data,
      };
    }

    return {
      ok: true,
      provider: "bengkel_bot",
      data: normalized.data,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "bengkel_bot",
      reason: getFriendlyBindInfoReason({ error }),
      technicalReason: error.message || "Bengkel bridge ishlamadi",
    };
  }
}

async function lookupJebrayMlbbBindInfo(accountId, zoneId, timeoutMs = FULL_INFO_TIMEOUT_MS) {
  if (!FULL_INFO_API_KEY) {
    return {
      ok: false,
      provider: "jebray_bind",
      reason: "bind_info_api_not_configured",
      technicalReason: "FULL_INFO_API_KEY env sozlanmagan (Jebray bind uchun)",
    };
  }

  try {
    const url = `${FULL_INFO_API_URL.replace(/\/+$/, "")}/tools/cek-bind`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": FULL_INFO_API_KEY,
      },
      body: JSON.stringify({
        player_id: Number(accountId),
        zone_id: Number(zoneId),
      }),
      timeoutMs,
    });

    const bodyText = await response.text();
    const data = safeJsonParse(bodyText);

    if (!response.ok) {
      const reason = getFriendlyBindInfoReason({
        status: response.status,
        data,
      });

      return {
        ok: false,
        provider: "jebray_bind",
        reason,
        technicalReason: `Jebray bind API HTTP ${response.status}: ${clipText(
          bodyText || response.statusText,
          180
        )}`,
        status: response.status,
        data,
      };
    }

    if (!data || data.success !== true || !data.data) {
      return {
        ok: false,
        provider: "jebray_bind",
        reason: getFriendlyBindInfoReason({
          status: response.status,
          data,
          fallback: "Jebray bind API muvaffaqiyatsiz",
        }),
        technicalReason: bodyText
          ? clipText(bodyText, 180)
          : "Jebray bind API bo\'sh javob qaytardi",
        status: response.status,
        data,
      };
    }

    const normalized = normalizeBindInfoResponse(data);

    if (!normalized.ok) {
      return {
        ok: false,
        provider: "jebray_bind",
        reason: normalized.reason,
        technicalReason: normalized.reason,
        data,
      };
    }

    return {
      ok: true,
      provider: "jebray_bind",
      data: normalized.data,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "jebray_bind",
      reason: getFriendlyBindInfoReason({ error }),
      technicalReason: error.message || "Jebray bind API ishlamadi",
    };
  }
}

function getFriendlyBindInfoReason(details = {}) {
  const status = Number(details.status);
  const message = cleanEnv(
    details.data?.message ||
      details.data?.error ||
      details.data?.reason ||
      details.fallback ||
      details.error?.message
  );
  const lowered = message.toLowerCase();
  const contentType = cleanEnv(details.contentType).toLowerCase();
  const bodyText = cleanEnv(details.bodyText);

  if (
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|forbidden|auth|token|login|credential|api key/i.test(message)
  ) {
    return "bind_info_provider_auth_required";
  }

  if (status === 404 || /not found/i.test(message)) {
    return "bind_info_provider_not_found";
  }

  if ([522, 523, 524, 525, 526].includes(status)) {
    return "bind_info_provider_unavailable";
  }

  if (status === 429 || /rate limit|too many/i.test(lowered)) {
    return "bind_info_provider_rate_limited";
  }

  if (details.error?.name === "AbortError" || /abort|timeout|timed out/i.test(message)) {
    return "bind_info_provider_timeout";
  }

  if (
    contentType.includes("text/html") ||
    /^<!doctype html|^<html[\s>]/i.test(bodyText)
  ) {
    return "bind_info_provider_html_response";
  }

  return details.fallback || "bind_info_lookup_failed";
}

function buildBindInfoRequest(accountId, zoneId) {
  const method = MLBB_BIND_INFO_API_METHOD === "POST" ? "POST" : "GET";
  const url = new URL(MLBB_BIND_INFO_API_URL);
  const headers = {
    Accept: "application/json",
    "User-Agent": "MLBB-Server-Detector-Bot/1.0",
  };

  if (isZiteBindInfoProvider()) {
    return {
      method: "POST",
      url: url.toString(),
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role_id: Number(accountId),
        zone_id: Number(zoneId),
      }),
    };
  }

  if (method === "POST") {
    const payload = {
      player_id: accountId,
      server_id: zoneId,
    };

    if (MLBB_BIND_INFO_API_KEY) {
      payload[MLBB_BIND_INFO_API_KEY_FIELD] = MLBB_BIND_INFO_API_KEY;
    }

    return {
      method,
      url: url.toString(),
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    };
  }

  setMissingSearchParam(url, "id", accountId);
  setMissingSearchParam(url, "zone", zoneId);
  setMissingSearchParam(url, "server", zoneId);
  setMissingSearchParam(url, "player_id", accountId);
  setMissingSearchParam(url, "server_id", zoneId);

  if (MLBB_BIND_INFO_API_KEY) {
    setMissingSearchParam(url, MLBB_BIND_INFO_API_KEY_FIELD, MLBB_BIND_INFO_API_KEY);
  }

  return {
    method,
    url: url.toString(),
    headers,
    body: undefined,
  };
}

function buildBengkelBindInfoRequest(accountId, zoneId) {
  const method = MLBB_BIND_INFO_API_METHOD === "POST" ? "POST" : "GET";
  const url = new URL(MLBB_BIND_INFO_API_URL);
  const headers = {
    Accept: "application/json, text/plain",
    "User-Agent": "MLBB-Server-Detector-Bot/1.0",
  };
  const payload = {
    bot_username: MLBB_BIND_INFO_BENGKEL_BOT_USERNAME,
    message: formatBengkelBindInfoMessage(accountId, zoneId),
    account_id: accountId,
    zone_id: zoneId,
  };

  if (MLBB_BIND_INFO_API_KEY) {
    payload[MLBB_BIND_INFO_API_KEY_FIELD] = MLBB_BIND_INFO_API_KEY;
  }

  if (method === "POST") {
    return {
      method,
      url: url.toString(),
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    };
  }

  for (const [key, value] of Object.entries(payload)) {
    setMissingSearchParam(url, key, value);
  }

  return {
    method,
    url: url.toString(),
    headers,
    body: undefined,
  };
}

function formatBengkelBindInfoMessage(accountId, zoneId) {
  return MLBB_BIND_INFO_BENGKEL_MESSAGE_TEMPLATE
    .replace(/\{account_id\}/gi, accountId)
    .replace(/\{player_id\}/gi, accountId)
    .replace(/\{id\}/gi, accountId)
    .replace(/\{zone_id\}/gi, zoneId)
    .replace(/\{server_id\}/gi, zoneId)
    .replace(/\{zone\}/gi, zoneId)
    .replace(/\{server\}/gi, zoneId)
    .trim();
}

function setMissingSearchParam(url, key, value) {
  if (!url.searchParams.has(key)) {
    url.searchParams.set(key, value);
  }
}

function firstDefinedValue(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function firstObjectValue(...values) {
  return values.find((value) => value && typeof value === "object") || null;
}

function hasDirectBindKeys(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return false;
  }

  return Object.keys(source).some((key) =>
    [
      "moonton",
      "moontonemail",
      "email",
      "vk",
      "googleplay",
      "google",
      "gp",
      "tiktok",
      "facebook",
      "fb",
      "apple",
      "appleid",
      "gcid",
      "gamecenter",
      "telegram",
      "tg",
      "whatsapp",
      "wa",
    ].includes(String(key).toLowerCase().replace(/[\s_-]+/g, ""))
  );
}

function hasFlatDeviceLoginKeys(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return false;
  }

  return Object.keys(source).some((key) => {
    const normalized = String(key).toLowerCase().replace(/[\s_-]+/g, "");

    return (
      normalized.includes("devicelogin") &&
      (normalized.includes("android") ||
        normalized.includes("ios") ||
        normalized.includes("iphone"))
    );
  });
}

function normalizeBindInfoResponse(data) {
  const root = data?.data || data?.result || data?.account || data;

  if (!root || typeof root !== "object") {
    return {
      ok: false,
      reason: "Bind info API bo‘sh javob qaytardi",
    };
  }

  const playerInfoRoot = firstObjectValue(root.player_info, root.playerInfo, root.info);
  const bindingsSource = firstDefinedValue(
    playerInfoRoot?.bind_account,
    playerInfoRoot?.bindAccount,
    playerInfoRoot?.bindings,
    playerInfoRoot?.bind,
    playerInfoRoot?.accounts,
    root.bindings,
    root.bind,
    root.accounts,
    root.account_bindings,
    root.accountBindings,
    root.bind_account,
    root.bindAccount,
    root.bound_accounts,
    root.boundAccounts,
    root.social,
    root.socials,
    hasDirectBindKeys(root) ? root : undefined
  );

  if (bindingsSource === undefined) {
    return {
      ok: false,
      reason: "Bind info API ulanmalar ma’lumotini qaytarmadi",
    };
  }

  const bindingsRoot = normalizeNamedBindCollection(bindingsSource);
  const deviceRoot = normalizeNamedBindCollection(
    firstDefinedValue(
      playerInfoRoot?.device_login,
      playerInfoRoot?.deviceLogin,
      playerInfoRoot?.connected_device,
      playerInfoRoot?.connectedDevice,
      playerInfoRoot?.connected_devices,
      playerInfoRoot?.connectedDevices,
      root.device_login,
      root.deviceLogin,
      root.connected_device,
      root.connectedDevice,
      root.connected_devices,
      root.connectedDevices,
      root.device,
      root.devices,
      root.login,
      root.quick_login,
      root.quickLogin,
      hasFlatDeviceLoginKeys(root) ? root : undefined,
      hasFlatDeviceLoginKeys(playerInfoRoot) ? playerInfoRoot : undefined
    ) ||
      {}
  );

  return {
    ok: true,
    data: {
      bindings: {
        moonton: pickFirstValue(bindingsRoot, [
          "moonton",
          "Moonton",
          "moonton_email",
          "moontonEmail",
          "email",
        ]),
        vk: pickFirstValue(bindingsRoot, ["vk", "VK"]),
        googlePlay: pickFirstValue(bindingsRoot, [
          "google_play",
          "googlePlay",
          "Google Play",
          "google",
          "gp",
        ]),
        tiktok: pickFirstValue(bindingsRoot, ["tiktok", "tikTok", "TikTok"]),
        facebook: pickFirstValue(bindingsRoot, ["facebook", "fb", "Facebook"]),
        apple: pickFirstValue(bindingsRoot, ["apple", "Apple", "apple_id", "appleId"]),
        gcid: pickFirstValue(bindingsRoot, ["gcid", "GCID", "game_center", "gameCenter"]),
        telegram: pickFirstValue(bindingsRoot, ["telegram", "Telegram", "tg"]),
        whatsapp: pickFirstValue(bindingsRoot, ["whatsapp", "WhatsApp", "wa"]),
      },
      deviceLogin: {
        android: pickFirstValue(deviceRoot, [
          "android",
          "Android",
          "android_count",
          "androidCount",
          "android_device",
          "androidDevice",
          "android_devices",
          "androidDevices",
          "android_login",
          "androidLogin",
          "device login android",
          "deviceLoginAndroid",
          "login_android",
          "loginAndroid",
        ]),
        ios: pickFirstValue(deviceRoot, [
          "ios",
          "iOS",
          "IOS",
          "iphone",
          "iPhone",
          "ios_count",
          "iosCount",
          "iphone_count",
          "iphoneCount",
          "ios_device",
          "iosDevice",
          "ios_devices",
          "iosDevices",
          "ios_login",
          "iosLogin",
          "device login ios",
          "deviceLoginIos",
          "login_ios",
          "loginIos",
        ]),
      },
    },
  };
}

function normalizeBengkelBindInfoResponse(data, bodyText = "") {
  const structured = normalizeBindInfoResponse(data);

  if (structured.ok) {
    return structured;
  }

  const text = extractBengkelBindInfoText(data) || cleanEnv(bodyText);

  if (!text) {
    return {
      ok: false,
      reason: structured.reason || "Bengkel bridge bo‘sh javob qaytardi",
    };
  }

  return parseBengkelBindInfoText(text, structured.reason);
}

function extractBengkelBindInfoText(value, depth = 0) {
  if (depth > 4 || value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return cleanEnv(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractBengkelBindInfoText(item, depth + 1);

      if (text) {
        return text;
      }
    }

    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  const textKeys = [
    "text",
    "message",
    "reply",
    "response",
    "result_text",
    "resultText",
    "content",
    "output",
    "body",
  ];

  for (const key of textKeys) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }

    const text = extractBengkelBindInfoText(value[key], depth + 1);

    if (text) {
      return text;
    }
  }

  for (const item of Object.values(value)) {
    const text = extractBengkelBindInfoText(item, depth + 1);

    if (text) {
      return text;
    }
  }

  return "";
}

function parseBengkelBindInfoText(text, fallbackReason = "") {
  const normalizedText = normalizeBengkelMessageText(text);
  const bindings = {};
  const deviceLogin = {};

  for (const rawLine of normalizedText.split("\n")) {
    const line = cleanBengkelTextLine(rawLine);

    if (!line) {
      continue;
    }

    collectBengkelDeviceLogin(line, deviceLogin);

    const field = splitBengkelField(line);

    if (!field) {
      continue;
    }

    const target = mapBengkelBindLabel(field.label);

    if (!target) {
      continue;
    }

    if (target.type === "device") {
      deviceLogin[target.key] = normalizeBengkelDeviceCount(field.value);
      continue;
    }

    bindings[target.key] = normalizeBengkelBindTextValue(field.value);
  }

  if (!Object.keys(bindings).length && !Object.keys(deviceLogin).length) {
    return {
      ok: false,
      reason: fallbackReason || "Bengkel bot javobidan ulanmalar ma’lumoti o‘qilmadi",
    };
  }

  return normalizeBindInfoResponse({
    data: {
      bindings,
      connected_device: deviceLogin,
    },
  });
}

function normalizeBengkelMessageText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00A0/g, " ");
}

function cleanBengkelTextLine(value) {
  return String(value || "")
    .replace(/[_`~]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[^\w@+.-]+/, "")
    .trim();
}

function splitBengkelField(line) {
  const match = String(line || "").match(/^(.{1,80}?)(?:\s*[:：=]\s*|\s+-\s+)(.+)$/);

  if (!match) {
    return null;
  }

  return {
    label: match[1],
    value: match[2],
  };
}

function mapBengkelBindLabel(label) {
  const normalized = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  if (/\b(?:game\s*center|gcid)\b/.test(normalized)) {
    return { type: "binding", key: "gcid" };
  }

  if (/\b(?:google|gplay|googleplay|gmail)\b/.test(normalized)) {
    return { type: "binding", key: "googlePlay" };
  }

  if (/\b(?:moonton|email)\b/.test(normalized)) {
    return { type: "binding", key: "moonton" };
  }

  if (/\b(?:facebook|fb)\b/.test(normalized)) {
    return { type: "binding", key: "facebook" };
  }

  if (/\b(?:tiktok|tik\s*tok|tt)\b/.test(normalized)) {
    return { type: "binding", key: "tiktok" };
  }

  if (/\b(?:apple|appleid)\b/.test(normalized)) {
    return { type: "binding", key: "apple" };
  }

  if (/\b(?:telegram|tg)\b/.test(normalized)) {
    return { type: "binding", key: "telegram" };
  }

  if (/\b(?:whatsapp|wa)\b/.test(normalized)) {
    return { type: "binding", key: "whatsapp" };
  }

  if (/\b(?:vk|vkontakte)\b/.test(normalized)) {
    return { type: "binding", key: "vk" };
  }

  if (/\bandroid\b/.test(normalized)) {
    return { type: "device", key: "android" };
  }

  if (/\b(?:ios|iphone)\b/.test(normalized)) {
    return { type: "device", key: "ios" };
  }

  return null;
}

function normalizeBengkelBindTextValue(value) {
  const text = cleanBengkelTextLine(value)
    .replace(/^["':=\-–—]+|["']+$/g, "")
    .trim();
  const lowered = text.toLowerCase();

  if (!text) {
    return null;
  }

  if (
    /^(?:yes|true|linked|bound|connected|terhubung|ada|aktif)$/i.test(text)
  ) {
    return true;
  }

  if (
    /^(?:no|false|empty|none|null|-|kosong|tidak ada|belum bind|belum linked)$/i.test(
      text
    ) ||
    /(?:not linked|not bound|not bind|unlinked|unbound|disconnected|tidak terhubung)/i.test(
      lowered
    )
  ) {
    return "not linked";
  }

  return text;
}

function normalizeBengkelDeviceCount(value) {
  const text = cleanBengkelTextLine(value);
  const number = text.match(/\d+/)?.[0];

  if (number) {
    return number;
  }

  return normalizeBengkelBindTextValue(text);
}

function collectBengkelDeviceLogin(line, deviceLogin = {}) {
  const text = String(line || "");
  const android = text.match(/\bandroid\b[^\dA-Za-z]{0,20}(\d+|yes|true|linked|ada)/i);
  const ios = text.match(/\b(?:ios|iphone)\b[^\dA-Za-z]{0,20}(\d+|yes|true|linked|ada)/i);

  if (android) {
    deviceLogin.android = normalizeBengkelDeviceCount(android[1]);
  }

  if (ios) {
    deviceLogin.ios = normalizeBengkelDeviceCount(ios[1]);
  }

  return deviceLogin;
}

function normalizeNamedBindCollection(source = {}) {
  if (!Array.isArray(source)) {
    return source;
  }

  return source.reduce((result, item) => {
    if (typeof item === "string") {
      result[item] = true;
      return result;
    }

    if (!item || typeof item !== "object") {
      return result;
    }

    const name =
      item.key ||
      item.name ||
      item.type ||
      item.platform ||
      item.provider ||
      item.account ||
      item.title;

    if (name) {
      const key = normalizeBindCollectionKey(name);

      result[key] = chooseBindValue(
        result[key],
        getBindCollectionItemValue(item, name)
      );
      return result;
    }

    return {
      ...result,
      ...item,
    };
  }, {});
}

function normalizeBindCollectionKey(name) {
  const text = String(name || "").toLowerCase();

  if (text.includes("moonton")) return "moonton";
  if (text.includes("google") || text === "gg") return "googlePlay";
  if (text.includes("facebook") || text === "fb") return "facebook";
  if (text.includes("tiktok")) return "tiktok";
  if (text.includes("apple")) return "apple";
  if (text.includes("game center") || text.includes("gcid")) return "gcid";
  if (text.includes("telegram") || text === "tg") return "telegram";
  if (text.includes("whatsapp") || text === "wa") return "whatsapp";
  if (text.includes("android")) return "android";
  if (text.includes("ios") || text.includes("iphone")) return "ios";
  if (text === "vk" || text.includes("vkontakte")) return "vk";

  return name;
}

function getBindCollectionItemValue(item = {}, platformName = "") {
  const itemNameValue =
    item.name &&
    normalizeBindCollectionKey(item.name) !== normalizeBindCollectionKey(platformName)
      ? item.name
      : undefined;
  const candidates = [
    item.data,
    item.value,
    item.email,
    item.mail,
    item.username,
    item.userName,
    item.account_name,
    item.accountName,
    item.nickname,
    itemNameValue,
    item.id,
    item.uid,
    item.open_id,
    item.openId,
    item.count,
    item.total,
    item.status,
    item.bind_status,
    item.bindStatus,
    item.bound,
    item.linked,
    item.connected,
    item.is_bound,
    item.isBound,
    item.is_linked,
    item.isLinked,
    item.is_connected,
    item.isConnected,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }

    if (!isEmptyBindValue(normalizeBindValue(candidate))) {
      return candidate;
    }
  }

  const explicitEmpty = candidates.find((candidate) => candidate !== undefined);

  return explicitEmpty ?? true;
}

function chooseBindValue(currentValue, nextValue) {
  if (isEmptyBindValue(normalizeBindValue(currentValue))) {
    return nextValue;
  }

  return currentValue;
}

function normalizeLookupResponse(data) {
  if (!data) {
    return {
      ok: false,
      reason: "API bo‘sh javob qaytardi",
    };
  }

  const possibleNickname =
    data.nickname ||
    data.username ||
    data.name ||
    data.userName ||
    data.ign ||
    data?.data?.nickname ||
    data?.data?.username ||
    data?.data?.name ||
    data?.data?.ign ||
    data?.result?.nickname ||
    data?.result?.username ||
    data?.result?.name;

  const possibleRegion =
    data.region ||
    data.country ||
    data.server ||
    data?.data?.region ||
    data?.data?.country ||
    data?.data?.server ||
    data?.result?.region ||
    data?.result?.country ||
    data?.result?.server ||
    null;

  const successValue =
    data.success ??
    data.ok ??
    data.status ??
    data.valid ??
    data?.data?.success ??
    data?.data?.valid;

  const hasExplicitFailure =
    successValue === false ||
    successValue === "false" ||
    successValue === "error" ||
    successValue === "failed" ||
    successValue === "not_found";

  if (hasExplicitFailure) {
    return {
      ok: false,
      reason:
        data.message ||
        data.error ||
        data.msg ||
        data?.data?.message ||
        "Akkaunt topilmadi",
    };
  }

  if (!possibleNickname) {
    return {
      ok: false,
      reason: "Nickname topilmadi. ID yoki Server/Zone ID xato bo‘lishi mumkin",
    };
  }

  return {
    ok: true,
    nickname: String(possibleNickname).trim(),
    region: possibleRegion ? String(possibleRegion).trim() : null,
  };
}

function getFriendlyLookupReason(details = {}) {
  const status = Number(details.status);
  const rawReason = cleanEnv(details.reason || details.error?.message);
  const lowered = rawReason.toLowerCase();

  if (details.error?.name === "AbortError" || lowered.includes("aborted")) {
    return "Tashqi tekshiruv servisi sekin javob berdi. Iltimos, birozdan keyin qayta urinib ko‘ring.";
  }

  if (status >= 500) {
    return "Tashqi tekshiruv servisi vaqtincha javob bermayapti. ID va serverni tekshirib, birozdan keyin qayta urinib ko‘ring.";
  }

  if (status === 429) {
    return "Tashqi tekshiruv servisi juda ko‘p so‘rov oldi. Birozdan keyin qayta urinib ko‘ring.";
  }

  if (status >= 400) {
    return "ID yoki Server/Zone ID bo‘yicha profil topilmadi. Raqamlarni tekshirib qayta yuboring.";
  }

  if (
    lowered.includes("topilmadi") ||
    lowered.includes("not found") ||
    lowered.includes("nickname")
  ) {
    return "Bu ID va Server/Zone ID bo‘yicha profil topilmadi. Iltimos, raqamlarni tekshirib qayta yuboring.";
  }

  if (rawReason) {
    return "Profilni tekshirib bo‘lmadi. ID va Server/Zone ID ni tekshirib qayta urinib ko‘ring.";
  }

  return "Profil topilmadi yoki tashqi tekshiruv servisi vaqtincha javob bermadi.";
}

function detectServerType(zoneId) {
  const zoneNumber = Number(zoneId);

  if (!Number.isFinite(zoneNumber)) {
    return "Noma’lum";
  }

  const advancedRanges = parseAdvancedRanges();

  const isAdvancedServer = advancedRanges.some(([from, to]) => {
    return zoneNumber >= from && zoneNumber <= to;
  });

  return isAdvancedServer ? "Advanced Server" : "Original Server";
}

function parseAdvancedRanges() {
  const raw = process.env.ADVANCED_SERVER_RANGES || "57001-57999";

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((range) => {
      const [fromRaw, toRaw] = range.split("-");
      const from = Number(fromRaw.trim());
      const to = toRaw === undefined || !toRaw.trim() ? from : Number(toRaw.trim());

      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        return null;
      }

      return from <= to ? [from, to] : [to, from];
    })
    .filter(Boolean);
}

function parseMlbbInput(input) {
  const text = normalizeMlbbInputText(input);

  const withBrackets = text.match(/(\d{5,12})\s*[\(\[]\s*(\d{1,8})\s*[\)\]]/);

  if (withBrackets) {
    return validateParsedId(withBrackets[1], withBrackets[2]);
  }

  const numbers = text.match(/\d+/g) || [];

  if (numbers.length >= 2) {
    const accountId = numbers.find((num) => num.length >= 5 && num.length <= 12);
    const accountIndex = numbers.indexOf(accountId);

    const zoneId = numbers.find((num, index) => {
      return index > accountIndex && num.length >= 1 && num.length <= 8;
    });

    return validateParsedId(accountId, zoneId);
  }

  return {
    ok: false,
    reason: "Account ID va Server/Zone ID topilmadi",
  };
}

function normalizeMlbbInputText(input) {
  return String(input || "")
    .replace(/\u00A0/g, " ")
    .replace(/Account ID:/gi, "")
    .replace(/User ID:/gi, "")
    .replace(/Server ID:/gi, "")
    .replace(/Zone ID:/gi, "")
    .replace(/Zona:/gi, "")
    .replace(/[\[\](){}\["'«»“”‘’„“]|,|;|\||[*~#№$%^&*+_=]/g, " ")
    .replace(/[\\\\/:.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateParsedId(accountId, zoneId) {
  if (!accountId || !zoneId) {
    return {
      ok: false,
      reason: "Account ID yoki Server/Zone ID yetishmayapti",
    };
  }

  if (!/^\d{5,12}$/.test(accountId)) {
    return {
      ok: false,
      reason: "Account ID noto‘g‘ri",
    };
  }

  if (!/^\d{1,8}$/.test(zoneId)) {
    return {
      ok: false,
      reason: "Server/Zone ID noto‘g‘ri",
    };
  }

  return {
    ok: true,
    accountId,
    zoneId,
  };
}

async function broadcastMessage(payload) {
  const broadcastPayload =
    typeof payload === "string" ? createTextBroadcastPayload(payload) : payload;
  const chatIds = await getBroadcastChatIds();
  const counts = { total: chatIds.length, sent: 0, blocked: 0, inactive: 0, initiate: 0, errors: 0 };

  for (const chunk of chunkArray(chatIds, 20)) {
    const results = await Promise.allSettled(
      chunk.map(async (chatId) => {
        try {
          await sendBroadcastPayload(chatId, broadcastPayload);
          return "sent";
        } catch (error) {
          const category = categorizeBroadcastSendError(error);

          if (category === "error") {
            try {
              await sendBroadcastPayload(chatId, broadcastPayload);
              return "sent";
            } catch (retryError) {
              return categorizeBroadcastSendError(retryError);
            }
          }

          return category;
        }
      })
    );

    results.forEach((result, index) => {
      const category = result.status === "fulfilled" ? result.value : "error";

      if (category === "sent") {
        counts.sent += 1;
        return;
      }

      counts[counts[category] != null ? category : "errors"] += 1;

      if (result.status === "rejected") {
        console.error("[BROADCAST_ERROR]", result.reason);
        recordError("broadcast_failed", result.reason?.message || String(result.reason), {
          chatId: chunk[index],
        });
      }
    });
  }

  return counts;
}

async function getBroadcastChatIds() {
  const chatIds = new Set(Array.from(stats.broadcastChats || []));

  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return Array.from(chatIds);
  }

  try {
    await addSupabaseBroadcastRecipients(chatIds);
  } catch (error) {
    console.error("[SUPABASE_BROADCAST_USERS_ERROR]", error);
    recordError("supabase_broadcast_users_failed", error.message);
  }

  return Array.from(chatIds);
}

async function getBroadcastRecipientStats() {
  const sendable = new Set(Array.from(stats.broadcastChats || []));
  const groupOnly = new Set();

  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return { total: sendable.size, privateCount: sendable.size, groupOnlyCount: 0 };
  }

  try {
    const rows = await fetchAllSupabaseBroadcastRows();

    rows.forEach((row) => {
      const recipient = classifyBroadcastRecipient(row);

      if (recipient?.type === "private") {
        sendable.add(recipient.chatId);
      } else if (recipient) {
        groupOnly.add(recipient.chatId);
      }
    });
  } catch (error) {
    console.error("[SUPABASE_BROADCAST_STATS_ERROR]", error);
    recordError("supabase_broadcast_stats_failed", error.message);
  }

  return {
    total: sendable.size + groupOnly.size,
    privateCount: sendable.size,
    groupOnlyCount: groupOnly.size,
  };
}

async function addSupabaseBroadcastRecipients(chatIds) {
  const rows = await fetchAllSupabaseBroadcastRows();

  rows.forEach((row) => {
    const recipient = classifyBroadcastRecipient(row);

    if (recipient?.type === "private") {
      chatIds.add(recipient.chatId);
    }
  });
}

async function fetchAllSupabaseBroadcastRows() {
  const rows = [];

  for (let offset = 0; ; offset += BROADCAST_USERS_PAGE_SIZE) {
    const params = new URLSearchParams();

    params.set("select", "user_id,chat_id,chat_type,is_bot");
    params.set("order", "last_seen_at.desc.nullslast");
    params.set("limit", String(BROADCAST_USERS_PAGE_SIZE));
    params.set("offset", String(offset));

    const page = await supabaseRequest(`/bot_users?${params.toString()}`);

    if (!Array.isArray(page) || page.length === 0) {
      return rows;
    }

    rows.push(...page);

    if (page.length < BROADCAST_USERS_PAGE_SIZE) {
      return rows;
    }
  }
}

function classifyBroadcastRecipient(row = {}) {
  if (row.is_bot === true) {
    return null;
  }

  const userId = toPgBigint(row.user_id);

  if (userId && !userId.startsWith("-")) {
    return {
      chatId: userId,
      type: String(row.chat_type || "") === "private" ? "private" : "group",
    };
  }

  const chatId = toPgBigint(row.chat_id);

  if (chatId && !chatId.startsWith("-") && (!row.chat_type || row.chat_type === "private")) {
    return { chatId, type: "private" };
  }

  return null;
}

function getBroadcastRecipientId(row = {}) {
  if (row.is_bot === true) {
    return "";
  }

  const userId = toPgBigint(row.user_id);

  if (userId && !userId.startsWith("-")) {
    return userId;
  }

  const chatId = toPgBigint(row.chat_id);

  if (chatId && !chatId.startsWith("-") && (!row.chat_type || row.chat_type === "private")) {
    return chatId;
  }

  return "";
}

async function sendBroadcastPayload(chatId, payload) {
  if (payload?.kind === "copy") {
    return copyMessage(chatId, payload.fromChatId, payload.messageId);
  }

  return sendMessage(chatId, payload.text, null, {
    entities: payload.entities || [],
    plain: true,
  });
}

function categorizeBroadcastSendError(error) {
  const message = String(error?.message || error || "");
  const status = Number((message.match(/HTTP\s+(\d{3})/) || [])[1] || 0);

  if (status === 429 || status >= 500) {
    return "error";
  }

  const lower = message.toLowerCase();

  if (/bot was blocked|blocked by the user/.test(lower)) {
    return "blocked";
  }

  if (/can'?t initiate|cannot initiate|initiate conversation/.test(lower)) {
    return "initiate";
  }

  if (/deactivated/.test(lower)) {
    return "inactive";
  }

  if (/chat not found|channel not found|user not found|group not found|not found/.test(lower)) {
    return "inactive";
  }

  return "error";
}

async function sendFeedbackToAdmins(feedback) {
  const text = getAdminFeedbackText(feedback);
  let sent = 0;
  let failed = 0;

  // Feedback faqat asosiy guruhga yuboriladi
  if (MAIN_GROUP_ID) {
    try {
      await safeSendMessage(MAIN_GROUP_ID, text, null);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("[FEEDBACK_MAIN_GROUP_SEND_ERROR]", error.message);
      recordError("feedback_main_group_send_failed", error.message, {
        mainGroupId: MAIN_GROUP_ID,
        feedbackId: feedback.id,
      });
    }
  }

  return {
    total: MAIN_GROUP_ID ? 1 : 0,
    sent,
    failed,
  };
}

function createBroadcastPayload(message = {}) {
  const text = String(message.text || "");
  const command = text.match(/^\/message(?:@\w+)?(?=\s|$)/i);

  if (!command) {
    return null;
  }

  const afterCommand = text.slice(command[0].length);
  const separatorLength = afterCommand.match(/^\s*/)?.[0]?.length || 0;
  const contentOffset = command[0].length + separatorLength;
  const contentText = text.slice(contentOffset);

  if (contentText) {
    return createTextBroadcastPayload(
      contentText,
      adjustMessageEntities(message.entities || [], contentOffset, contentText.length)
    );
  }

  if (message.reply_to_message?.chat?.id && message.reply_to_message.message_id) {
    return {
      kind: "copy",
      fromChatId: message.reply_to_message.chat.id,
      messageId: message.reply_to_message.message_id,
      previewText: getReplyMessagePreview(message.reply_to_message),
    };
  }

  return null;
}

function createTextBroadcastPayload(text, entities = []) {
  return {
    kind: "text",
    text: String(text || ""),
    entities: Array.isArray(entities) ? entities : [],
  };
}

function adjustMessageEntities(entities = [], contentOffset = 0, contentLength = 0) {
  return entities
    .map((entity) => {
      const entityStart = Number(entity.offset);
      const entityEnd = entityStart + Number(entity.length);
      const contentEnd = contentOffset + contentLength;
      const start = Math.max(entityStart, contentOffset);
      const end = Math.min(entityEnd, contentEnd);

      if (!Number.isFinite(entityStart) || !Number.isFinite(entityEnd) || end <= start) {
        return null;
      }

      const adjusted = {
        ...entity,
        offset: start - contentOffset,
        length: end - start,
      };

      delete adjusted.type;

      return {
        type: entity.type,
        ...adjusted,
      };
    })
    .filter(Boolean);
}

function shiftMessageEntities(entities = [], offsetDelta = 0) {
  const safeDelta = Math.max(0, Number(offsetDelta) || 0);

  return (Array.isArray(entities) ? entities : [])
    .map((entity) => {
      const offset = Number(entity.offset);
      const length = Number(entity.length);

      if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) {
        return null;
      }

      return {
        ...entity,
        offset: offset + safeDelta,
        length,
      };
    })
    .filter(Boolean);
}

function createFeedbackAdminReplyPayload(message = {}, admin = {}) {
  const replyText = getFeedbackMessageText(message);

  if (!replyText) {
    if (hasCopyableMessageContent(message)) {
      return { kind: "copy" };
    }

    return null;
  }

  const adminUsername = admin.username ? `@${admin.username}` : (admin.first_name || "Admin");
  const prefix = `👮 Admin ${escapeHtml(adminUsername)} javob berdi:\n\n`;
  const sourceEntities = message.text ? message.entities : message.caption_entities;

  return {
    kind: "text",
    text: `${prefix}${replyText}`,
    entities: [
      {
        type: "bold",
        offset: 7,
        length: adminUsername.length + 14,
      },
      ...shiftMessageEntities(sourceEntities || [], prefix.length),
    ],
  };
}

function hasCopyableMessageContent(message = {}) {
  return Boolean(
    message.sticker ||
      message.photo ||
      message.video ||
      message.animation ||
      message.document ||
      message.voice ||
      message.audio ||
      message.video_note ||
      message.poll
  );
}

function getReplyMessagePreview(message = {}) {
  const text = message.text || message.caption;

  if (text) {
    return clipText(String(text), 900);
  }

  if (message.sticker) return "Sticker";
  if (message.photo) return "Rasm";
  if (message.video) return "Video";
  if (message.animation) return "GIF/animatsiya";
  if (message.document) return "Fayl";
  if (message.voice) return "Voice";
  if (message.audio) return "Audio";
  if (message.video_note) return "Video note";
  if (message.poll) return "So‘rovnoma";

  return "Reply qilingan xabar";
}

function getStartText(user) {
  const lang = getUserLang(user.id);
  const name = escapeHtml(user.first_name || (lang === "ru" ? "друг" : "do‘stim"));
  return t("start_welcome", lang, { name });
}

function getCheckPromptText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("check_prompt", lang);
}



function getResultText(result, lang) {
  lang = lang || DEFAULT_LANG;
  const lines = [
    t("result_title", lang),
    "",
    t("result_account_id", lang, { accountId: result.accountId }),
    t("result_server_zone", lang, { zoneId: result.zoneId }),
    t("result_server_type", lang, { serverType: result.serverType }),
    result.region ? t("result_region", lang, { region: escapeHtml(result.region) }) : t("result_region_missing", lang),
    t("result_nickname", lang, { nickname: escapeHtml(result.nickname) }),
    t("result_status", lang, { status: escapeHtml(result.status) }),
  ];
  return lines.join("\n");
}

function getFailedLookupText(parsed, lookup, lang) {
  lang = lang || DEFAULT_LANG;
  return [t("failed_lookup_title", lang), t("failed_lookup_body", lang)].join("\n");
}

function getInvalidMlbbInputText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("invalid_mlbb_input", lang);
}

function getHelpText(user = {}) {
  const lang = getUserLang(user.id);
  return [
    t("help_title", lang),
    "",
    t("help_intro", lang),
    "",
    t("help_section_check", lang),
    "",
    t("help_section_full_info", lang),
    "",
    t("help_section_reset_pw", lang),
    "",
    t("help_section_profile", lang),
    "",
    t("help_section_language", lang),
    "",
    t("help_section_feedback", lang),
    "",
    t("help_section_notes", lang),
    "",
    getCommandsText(user),
    "",
    t("help_contact", lang, { supportUsername: escapeHtml(SUPPORT_USERNAME) }),
  ].join("\n");
}

function getCommandsText(user = {}) {
  const lang = getUserLang(user.id);
  const commands = [
    t("commands_title", lang),
    "",
    t("cmd_start", lang),
    t("cmd_help", lang),
    t("cmd_commands", lang),
    t("cmd_check", lang),
    t("cmd_full_info", lang),
    t("cmd_reset_pw", lang),
    t("cmd_feedback", lang),
    t("cmd_language", lang),
  ];

  if (isAdmin(user.id)) {
    commands.push(
      "",
      t("admin_commands_title", lang),
      t("cmd_stats", lang),
      t("cmd_users", lang),
      t("cmd_errors", lang),
      t("cmd_emoji", lang),
      t("cmd_message", lang),
      t("cmd_limit_fullinfo", lang),
      t("cmd_limit_resetpw", lang)
    );
  }

  return commands.join("\n");
}

function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

function buildBotCommands(lang) {
  return [
    { command: "start", description: "Botni qayta faollashtirish♻️" },
    { command: "check", description: "Region nikname aniqlash🤓" },
    { command: "fullinfo", description: "Akkaunt to\u02BBliq malumotini chiqarish🤓" },
    { command: "resetpw", description: "Parolni tiklash🤓" },
    { command: "language", description: "Til almashtirish🤓" },
    { command: "feedback", description: "Fikr izoh yozish🌐" },
    { command: "help", description: "Foydalanish yo\u02BBriqnomasi🤓" },
  ];
}

async function registerBotCommands() {
  try {
    await telegram("setMyCommands", {
      commands: buildBotCommands(DEFAULT_LANG),
    });
    stats.commandsRegistered = true;
    return true;
  } catch (err) {
    console.error("[BOT] setMyCommands failed:", err.message);
    return false;
  }
}

function maybeRegisterBotCommands() {
  if (stats.commandsRegistered) {
    return;
  }
  void registerBotCommands().catch(() => {});
}

function getBindInfoPromptText() {
  return [
    "🔗 <b>Ulanmalar</b>",
    "",
    "MLBB <b>Account ID</b> va <b>Server/Zone ID</b> ni yuboring.",
    "",
    "<b>Namuna:</b>",
    "<code>1006613098 (13019)</code>",
  ].join("\n");
}

function getBindInfoLimitReachedText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("bind_info_limit_reached", lang);
}

function getInvalidBindInfoInputText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("invalid_bind_input", lang);
}

function getBindInfoFailedText(reason = "", lang) {
  lang = lang || DEFAULT_LANG;
  if (reason === "bengkel_bridge_not_configured") return t("bind_failed_bridge_not_configured", lang);
  if (/Bengkel bot javobidan ulanmalar/i.test(reason)) return t("bind_failed_bengkel_parse", lang);
  if (/ulanmalar ma‘lumotini qaytarmadi|ulanmalar ma'lumotini qaytarmadi/i.test(reason)) return t("bind_failed_no_data", lang);
  if (reason === "bind_info_provider_auth_required") return t("bind_failed_auth_required", lang);
  if (reason === "bind_info_provider_not_found" || reason === "bind_info_provider_html_response") return t("bind_failed_provider_down", lang);
  if (reason === "bind_info_provider_timeout") return t("bind_failed_provider_timeout", lang);
  if (reason === "bind_info_provider_unavailable" || reason === "bind_info_provider_rate_limited") return t("bind_failed_provider_unavailable", lang);
  return t("bind_failed_generic", lang);
}

function getBindInfoWaitText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("bind_info_wait", lang);
}

function getFullInfoPromptText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("full_info_prompt", lang);
}

function getFullInfoWaitText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("full_info_wait", lang);
}

function getResetPwPromptText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("reset_pw_prompt", lang);
}

function getResetPwWaitText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("reset_pw_wait", lang);
}

function getInvalidResetPwEmailText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("reset_pw_invalid_email", lang);
}

function getResetPwSuccessText(lang, params = {}) {
  lang = lang || DEFAULT_LANG;
  return t("reset_pw_success", lang, params);
}

function getResetPwLimitReachedText(lang, params = {}) {
  lang = lang || DEFAULT_LANG;
  return t("reset_pw_limit_reached", lang, params);
}

function getResetPwFailedText(reason = "", lang) {
  lang = lang || DEFAULT_LANG;
  if (/no_account/i.test(reason)) return t("reset_pw_failed_no_account", lang);
  if (/too_many|rate_limited/i.test(reason)) return t("reset_pw_failed_too_many", lang);
  if (/auth_required|not_configured/i.test(reason)) return t("reset_pw_failed_auth", lang);
  if (/quota_exceeded/i.test(reason)) return t("reset_pw_failed_quota", lang);
  if (/timeout/i.test(reason)) return t("reset_pw_failed_timeout", lang);
  if (/provider_down|unavailable/i.test(reason)) return t("reset_pw_failed_provider", lang);
  return t("reset_pw_failed_generic", lang);
}

function getFullInfoFailedText(reason = "", lang) {
  lang = lang || DEFAULT_LANG;
  // Sabablar yagona formatda: full_info_provider_* (underscore bilan).
  if (/403|quota|subscription expired|muddat/i.test(reason)) return t("full_info_failed_quota", lang);
  if (/404|not[_ ]?found|topilmadi/i.test(reason)) return t("full_info_failed_not_found", lang);
  if (/429|rate[_ ]?limit/i.test(reason)) return t("full_info_failed_rate_limited", lang);
  if (/401|auth|invalid|api[_ ]?key/i.test(reason)) return t("full_info_failed_auth", lang);
  if (/timeout|vaqt/i.test(reason)) return t("full_info_failed_timeout", lang);
  return t("full_info_failed_generic", lang);
}

function getFullInfoPostText(result = {}, pageUrl, lang, { remaining = null } = {}) {
  lang = lang || DEFAULT_LANG;
  const d = result.data || {};
  const lines = [
    `📋 <b>${t("full_info_post_title", lang)}</b>`,
    "",
    `👤 <b>${escapeHtml(d.nickname || result.accountId)}</b>`,
    `🆔 <code>${escapeHtml(result.accountId)}</code> ${result.zoneId ? `· 🌐 <code>${escapeHtml(result.zoneId)}</code>` : ""}`,
  ];

  if (d.level) lines.push(t("full_info_post_level", lang, { value: escapeHtml(d.level) }));
  if (d.rank) lines.push(t("full_info_post_rank", lang, { value: escapeHtml(d.rank) }));
  const readableSquad = buildReadableSquad(d.squad);
  if (readableSquad) lines.push(t("full_info_post_squad", lang, { value: escapeHtml(readableSquad) }));
  if (Array.isArray(d.location) && d.location.length) {
    lines.push(t("full_info_post_location", lang, { value: escapeHtml(d.location.join(", ")) }));
  }
  if (d.collection) {
    lines.push("");
    lines.push(
      t("full_info_post_collection", lang, {
        heroes: escapeHtml(d.collection.heroes || 0),
        skins: escapeHtml(d.collection.skins || 0),
      })
    );
  }
  if (d.combat && Number.isFinite(d.combat.win_rate)) {
    lines.push(
      t("full_info_post_combat", lang, {
        winRate: escapeHtml(d.combat.win_rate),
        total: escapeHtml(d.combat.total_matches || 0),
      })
    );
  }

  if (pageUrl) {
    lines.push("");
    lines.push(`👇 ${t("full_info_post_link_hint", lang)}`);
  }

  // Paket qoldig'i — faqat admin bo'lmagan va limiti aniq bo'lgan userlarga
  // ko'rinadi (adminlar va Supabase'siz holatda chiqmaydi).
  if (typeof remaining === "number") {
    lines.push("");
    lines.push(t("full_info_quota_remaining", lang, { remaining }));
  }

  return lines.filter((line) => line !== undefined && line !== null).join("\n");
}

function telegraphNode(tag, children, attrs) {
  const node = { tag };
  if (children !== undefined && children !== null) {
    node.children = typeof children === "string" ? [String(children)] : children;
  }
  if (attrs && Object.keys(attrs).length) {
    node.attrs = attrs;
  }
  return node;
}

function telegraphText(text) {
  return String(text ?? "");
}

function getBindInfoResultText(result = {}, limitData = null, lang) {
  lang = lang || DEFAULT_LANG;
  const bindings = result.bindings || {};
  const deviceLogin = result.deviceLogin || {};
  const hasDeviceLogin = MLBB_BIND_INFO_SHOW_DEVICES && hasDeviceLoginData(deviceLogin);
  const deviceLines = hasDeviceLogin ? getDeviceLoginResultLines(deviceLogin) : [];

  const lines = [
    t("bind_info_title", lang),
    "",
    t("bind_info_id", lang, { accountId: escapeHtml(result.accountId) }),
    t("bind_info_server", lang, { zoneId: escapeHtml(result.zoneId) }),
    "",
    t("bind_moonton", lang, { value: escapeHtml(bindings.moonton) }),
    t("bind_vk", lang, { value: escapeHtml(bindings.vk) }),
    t("bind_google_play", lang, { value: escapeHtml(bindings.googlePlay) }),
    t("bind_tiktok", lang, { value: escapeHtml(bindings.tiktok) }),
    t("bind_facebook", lang, { value: escapeHtml(bindings.facebook) }),
    t("bind_apple", lang, { value: escapeHtml(bindings.apple) }),
    t("bind_gcid", lang, { value: escapeHtml(bindings.gcid) }),
    t("bind_telegram", lang, { value: escapeHtml(bindings.telegram) }),
    t("bind_whatsapp", lang, { value: escapeHtml(bindings.whatsapp) }),
    ...deviceLines,
  ];

  if (limitData !== null) {
    const remaining = limitData.remaining;
    const total = limitData.total_limit || 10;
    lines.push("");
    lines.push(t("bind_limit_remaining", lang, { remaining, total }));
  }

  return lines.filter((line, index, arr) => line || arr[index + 1]).join("\n");
}

function getFeedbackPromptText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("feedback_prompt", lang);
}

function getFeedbackTextRequiredText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("feedback_text_required", lang);
}

function getFeedbackTooLongText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("feedback_too_long", lang, { maxLength: FEEDBACK_MAX_LENGTH });
}

function getFeedbackThanksText(result = {}, lang) {
  lang = lang || DEFAULT_LANG;
  const delivered = Number(result.sent || 0);
  return delivered
    ? t("feedback_thanks", lang)
    : t("feedback_thanks_failed", lang);
}

function getAdminFeedbackText(feedback) {
  const user = feedback.user || {};
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const username = user.username ? `@${user.username}` : "";
  const displayName = [fullName, username].filter(Boolean).join(" ") || "-";

  return [
    "💬 <b>Yangi fikr yoki izoh</b>",
    "",
    `User: ${escapeHtml(displayName)}`,
    "",
    "<b>Xabar:</b>",
    escapeHtml(feedback.text),
    "",
    "Shu xabarga reply qilib javob berishingiz mumkin.",
    `<tg-spoiler>Feedback ID: <code>${escapeHtml(feedback.id)}</code>\nUser ID: <code>${escapeHtml(feedback.userId)}</code>\nChat ID: <code>${escapeHtml(feedback.chatId)}</code></tg-spoiler>`,
  ].join("\n");
}

function getFeedbackReplySentText(target, lang) {
  lang = lang || DEFAULT_LANG;
  return [
    "✅ Javob userga yuborildi.",
    "",
    `User ID: <code>${escapeHtml(target.userId)}</code>`,
    target.feedbackId ? `Feedback ID: <code>${escapeHtml(target.feedbackId)}</code>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getFeedbackAdminReplyTextRequiredText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("admin_feedback_reply_required", lang);
}

function getFeedbackReplyFailedText(target, reason, lang) {
  lang = lang || DEFAULT_LANG;
  return [
    "❌ Javobni userga yuborib bo'lmadi.",
    "",
    `User ID: <code>${escapeHtml(target.userId)}</code>`,
    target.feedbackId ? `Feedback ID: <code>${escapeHtml(target.feedbackId)}</code>` : "",
    reason ? `Sabab: ${escapeHtml(clipText(reason, 220))}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function getStatsTextAsync(options = {}) {
  const dbStats = await getSupabaseStats(options);

  return getStatsText(dbStats);
}

function getStatsText(dbStats = null, lang) {
  lang = lang || DEFAULT_LANG;
  const todayLines = getStatsTodayUserLines(dbStats);
  const monthlyLines = getStatsMonthlyLines(dbStats, lang);
  const totalUsers = getDisplayTotalUsers(dbStats);
  const todayTotal = getDisplayTodayTotal(dbStats);

  return [
    t("stats_title", lang),
    "",
    t("stats_total_users", lang, { count: totalUsers }),
    t("stats_today_users", lang, { count: todayTotal }),
    t("stats_broadcast_chats", lang, { count: stats.broadcastChats.size }),
    t("stats_pending_broadcasts", lang, { count: stats.pendingBroadcasts.size }),
    t("stats_starts", lang, { count: stats.starts }),
    t("stats_total_checks", lang, { count: stats.checks }),
    t("stats_success", lang, { count: stats.successChecks }),
    t("stats_failed", lang, { count: stats.failedChecks }),
    t("stats_started_at", lang, { date: formatDate(stats.startedAt) }),
    stats.lastCheckAt ? t("stats_last_check", lang, { date: formatDate(stats.lastCheckAt) }) : "",
    "",
    t("stats_today_header", lang),
    ...todayLines,
    "",
    t("stats_monthly_header", lang),
    ...monthlyLines,
    "",
    t("stats_errors_moved", lang),
  ]
    .filter(Boolean)
    .join("\n");
}

function getDisplayTotalUsers(dbStats = null) {
  if (Number.isFinite(Number(dbStats?.totalUsers))) {
    return Number(dbStats.totalUsers);
  }

  return stats.users.size;
}

function getDisplayTodayTotal(dbStats = null) {
  if (Number.isFinite(Number(dbStats?.todayTotal))) {
    return Number(dbStats.todayTotal);
  }

  return getRuntimeTodayUsers().length;
}

function getStatsTodayUserLines(dbStats = null) {
  if (Array.isArray(dbStats?.todayUsers) && dbStats.todayUsers.length) {
    return dbStats.todayUsers.map((user, index) => {
      return formatUserLine(user, dbStats.todayPage || 0, USERS_PAGE_SIZE, index);
    });
  }

  if (dbStats?.configError) {
    return [`Supabase sozlamasi: ${escapeHtml(dbStats.configError)}`];
  }

  const memoryUsers = getRuntimeTodayUsers().slice(0, USERS_PAGE_SIZE);

  if (memoryUsers.length) {
    const suffix = dbStats?.error
      ? " — Supabase o‘qilmadi, lokal xotiradan"
      : "";

    return memoryUsers.map((user, index) => {
      return `${formatUserLine(user, 0, USERS_PAGE_SIZE, index)}${suffix}`;
    });
  }

  if (dbStats?.error) {
    return ["Supabase o‘qishda xatolik bor, bugungi lokal user topilmadi."];
  }

  return ["Bugun hali user qayd etilmagan."];
}

function formatUserLine(user, page = 0, pageSize = USERS_PAGE_SIZE, index = 0) {
  const userId = user.user_id || user.id || "-";
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const username = user.username ? `@${user.username}` : "";
  const name = [fullName, username].filter(Boolean).join(" ");
  const updates = Number(user.updates_count || 0);
  const lastSeen = user.last_seen_at ? formatDate(user.last_seen_at) : "-";

  return [
    `${page * pageSize + index + 1}. <code>${escapeHtml(userId)}</code>`,
    name ? `— ${escapeHtml(clipText(name, 45))}` : "",
    `— ${updates} update`,
    `— ${lastSeen}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function getUsersListText(pageData = {}, syncResult = null, lang) {
  lang = lang || DEFAULT_LANG;
  const users = Array.isArray(pageData.users) ? pageData.users : [];
  const total = Number(pageData.total || 0);
  const page = Number(pageData.page || 0);
  const pageSize = Number(pageData.pageSize || USERS_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const sourceText = pageData.source === "runtime" ? (lang === "ru" ? "локальная память" : "lokal xotira") : "Supabase";
  const lines = users.length
    ? users.map((user, index) => formatUserLine(user, page, pageSize, index))
    : [pageData.error ? t("users_read_error", lang) : t("users_not_found", lang)];
  const syncLine = syncResult?.attempted && !syncResult.skipped
    ? t("users_sync_line", lang, { saved: syncResult.saved, total: syncResult.total })
    : "";

  return [
    t("users_title", lang),
    "",
    t("users_total", lang, { total }),
    t("users_page", lang, { page: page + 1, totalPages }),
    t("users_source", lang, { source: escapeHtml(sourceText) }),
    syncLine,
    pageData.configError ? t("users_supabase_config_error", lang, { error: escapeHtml(pageData.configError) }) : "",
    pageData.error && !pageData.configError ? t("users_supabase_read_error", lang) : "",
    "",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}

function getStatsMonthlyLines(dbStats = null, lang) {
  lang = lang || DEFAULT_LANG;
  if (Array.isArray(dbStats?.monthly) && dbStats.monthly.length) {
    return dbStats.monthly.map((row) => {
      const month = formatMonth(row.month);
      const users = Number(row.active_users || 0);
      const updates = Number(row.updates || 0);
      return t("stats_monthly_line", lang, { month: escapeHtml(month), users, updates });
    });
  }
  if (dbStats?.configError) return [t("users_supabase_config_error", lang, { error: escapeHtml(dbStats.configError) })];
  if (dbStats?.error) return [t("stats_monthly_supabase_error", lang)];
  if (!isSupabaseConfigured()) return [t("stats_monthly_not_configured", lang, { count: stats.users.size })];
  return [t("stats_monthly_no_data", lang)];
}

function getErrorsText(lang) {
  lang = lang || DEFAULT_LANG;
  return [
    t("errors_title", lang),
    "",
    t("errors_types_header", lang),
    ...getErrorCountLines(),
    "",
    t("errors_recent_header", lang),
    ...getStatsErrorLines(),
  ].join("\n");
}

function getErrorCountLines() {
  const entries = Object.entries(stats.errorCounts || {});

  if (!entries.length) {
    return ["Xatolik qayd etilmagan."];
  }

  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${escapeHtml(type)}: <b>${count}</b>`);
}

function getStatsErrorLines() {
  const errors = (stats.errors || []).slice(-5).reverse();

  if (!errors.length) {
    return ["Xatolik qayd etilmagan."];
  }

  return errors.map((error) => {
    const meta = Object.entries(error.meta || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}=${clipText(String(value), 60)}`)
      .join(", ");

    return [
      `• ${formatDate(error.at)} — <b>${escapeHtml(error.type)}</b>`,
      escapeHtml(clipText(error.message || "Noma’lum xatolik", 160)),
      meta ? `(${escapeHtml(meta)})` : "",
    ]
      .filter(Boolean)
      .join(" ");
  });
}

function getCustomEmojiIdText(message = {}) {
  const targetMessage = message.reply_to_message || message;
  const customEmojis = getCustomEmojiEntities(targetMessage);

  if (!customEmojis.length) {
    return [
      "Premium/custom emoji topilmadi.",
      "",
      "ID olish uchun premium emoji bor xabarga reply qilib <code>/emoji</code> yozing.",
      "Yoki <code>/emoji</code> komandasi bilan birga premium emoji yuboring.",
    ].join("\n");
  }

  return [
    "🧩 <b>Custom emoji ID lar</b>",
    "",
    ...customEmojis.flatMap((emoji, index) => [
      `${index + 1}. ${escapeHtml(emoji.alt || "emoji")} — <code>${escapeHtml(
        emoji.custom_emoji_id
      )}</code>`,
      `<code>${escapeHtml(
        `<tg-emoji emoji-id="${emoji.custom_emoji_id}">${emoji.alt || "🙂"}</tg-emoji>`
      )}</code>`,
    ]),
  ].join("\n");
}

function getCustomEmojiEntities(message = {}) {
  const seen = new Set();
  const entities = [
    ...extractCustomEmojiEntities(message.text, message.entities),
    ...extractCustomEmojiEntities(message.caption, message.caption_entities),
  ];

  return entities.filter((emoji) => {
    const key = `${emoji.custom_emoji_id}:${emoji.alt}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractCustomEmojiEntities(text, entities = []) {
  const sourceText = String(text || "");

  return (Array.isArray(entities) ? entities : [])
    .filter((entity) => entity?.type === "custom_emoji" && entity.custom_emoji_id)
    .map((entity) => {
      const offset = Number(entity.offset);
      const length = Number(entity.length);
      const alt =
        Number.isFinite(offset) && Number.isFinite(length) && length > 0
          ? sourceText.slice(offset, offset + length)
          : "";

      return {
        alt,
        custom_emoji_id: String(entity.custom_emoji_id),
      };
    });
}

function getUnknownText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("unknown_text", lang);
}

function getAdminOnlyText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("admin_only", lang);
}

function getErrorText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("error_unexpected", lang);
}

function getBroadcastUsageText(lang) {
  lang = lang || DEFAULT_LANG;
  return [
    t("broadcast_usage_title", lang),
    "",
    t("broadcast_usage_format", lang),
    "",
    t("broadcast_usage_hint", lang),
  ].join("\n");
}

function getBroadcastTooLongText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("broadcast_too_long", lang);
}

function getBroadcastExpiredText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("broadcast_expired", lang);
}

function getBroadcastConfirmText(payload, recipientStats = { privateCount: stats.broadcastChats.size }, lang) {
  lang = lang || DEFAULT_LANG;

  if (typeof recipientStats === "number") {
    recipientStats = { privateCount: recipientStats };
  }

  const preview = typeof payload === "string" ? payload : payload?.previewText || payload?.text || "";
  const entities = (typeof payload === "object" && payload?.kind === "text") ? (payload.entities || []) : [];
  const header = [
    t("broadcast_confirm_title", lang),
    t("broadcast_confirm_body", lang),
    t("broadcast_confirm_audience", lang, {
      total: Number(recipientStats.total) || 0,
      private: Number(recipientStats.privateCount) || 0,
      groupOnly: Number(recipientStats.groupOnlyCount) || 0,
    }),
    "",
    t("broadcast_confirm_message", lang),
  ].join("\n");
  const formattedPreview = entities.length
    ? entitiesToHtml(preview, entities)
    : escapeHtml(clipText(preview, 900));
  return header + "\n" + formattedPreview;
}

function entitiesToHtml(text, entities = []) {
  const safeText = clipText(text, 900);
  if (!entities.length) return escapeHtml(safeText);

  const sorted = [...entities]
    .filter((e) => e && typeof e.offset === "number" && typeof e.length === "number" && e.length > 0)
    .sort((a, b) => a.offset - b.offset || b.length - a.length);

  const tags = [];
  for (const entity of sorted) {
    const end = entity.offset + entity.length;
    if (entity.offset >= safeText.length) continue;
    const actualEnd = Math.min(end, safeText.length);
    const openTag = getEntityOpenTag(entity);
    const closeTag = getEntityCloseTag(entity);
    if (openTag) {
      tags.push({ pos: entity.offset, tag: openTag, type: "open" });
      tags.push({ pos: actualEnd, tag: closeTag, type: "close" });
    }
  }

  tags.sort((a, b) => a.pos - b.pos || (a.type === "close" ? -1 : 1));

  let result = "";
  let cursor = 0;
  for (const t of tags) {
    if (t.pos > cursor && t.pos <= safeText.length) {
      result += escapeHtml(safeText.slice(cursor, t.pos));
    }
    if (t.pos < safeText.length) result += t.tag;
    cursor = Math.max(cursor, t.pos);
  }
  if (cursor < safeText.length) result += escapeHtml(safeText.slice(cursor));
  return result;
}

function getEntityOpenTag(entity) {
  switch (entity.type) {
    case "bold": return "<b>";
    case "italic": return "<i>";
    case "underline": return "<u>";
    case "strikethrough": return "<s>";
    case "spoiler": return "<tg-spoiler>";
    case "code": return "<code>";
    case "pre": return entity.language ? `<pre><code class="language-${escapeHtml(entity.language)}">` : "<pre>";
    case "blockquote": return "<blockquote>";
    case "expandable_blockquote": return "<blockquote expandable>";
    case "text_link": return `<a href="${escapeHtml(entity.url || "")}">`;
    case "custom_emoji": return entity.custom_emoji_id ? `<tg-emoji emoji-id="${escapeHtml(entity.custom_emoji_id)}">` : "";
    default: return "";
  }
}

function getEntityCloseTag(entity) {
  switch (entity.type) {
    case "bold": return "</b>";
    case "italic": return "</i>";
    case "underline": return "</u>";
    case "strikethrough": return "</s>";
    case "spoiler": return "</tg-spoiler>";
    case "code": return "</code>";
    case "pre": return "</code></pre>";
    case "blockquote": return "</blockquote>";
    case "expandable_blockquote": return "</blockquote>";
    case "text_link": return "</a>";
    case "custom_emoji": return entity.custom_emoji_id ? "</tg-emoji>" : "";
    default: return "";
  }
}

function getBroadcastQueuedText(queued, lang) {
  lang = lang || DEFAULT_LANG;
  return [
    t("broadcast_queued_title", lang),
    "",
    t("broadcast_queued_recipients", lang, { count: queued }),
    t("broadcast_queued_body", lang),
  ].join("\n");
}

async function sendBroadcastReport(chatId, result) {
  return sendMessage(chatId, getBroadcastResultText(result), mainKeyboard());
}

function getBroadcastQueuedErrorText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("broadcast_queued_error", lang);
}

function getBroadcastResultText(result = {}, lang) {
  lang = lang || DEFAULT_LANG;

  const total = Number(result.total) || 0;
  const sent = Number(result.sent) || 0;
  const blocked = Number(result.blocked) || 0;
  const inactive = Number(result.inactive) || 0;
  const initiate = Number(result.initiate) || 0;
  const errors = Number(result.errors) || 0;

  const lines = [
    t("broadcast_result_title", lang),
    "",
    t("broadcast_result_total", lang, { total }),
    t("broadcast_result_sent", lang, { sent }),
  ];

  if (blocked > 0) {
    lines.push(t("broadcast_result_blocked", lang, { blocked }));
  }

  if (inactive > 0) {
    lines.push(t("broadcast_result_inactive", lang, { count: inactive }));
  }

  if (initiate > 0) {
    lines.push(t("broadcast_result_initiate", lang, { count: initiate }));
  }

  if (errors > 0) {
    lines.push(t("broadcast_result_other_errors", lang, { count: errors }));
  }

  return lines.join("\n");
}

function mainKeyboard(user = {}) {
  const lang = getUserLang(user.id);
  const keyboard = [
    [{ text: t("btn_check", lang) }],
    [{ text: t("btn_full_info", lang) }, { text: t("btn_reset_pw", lang) }],
    [{ text: t("btn_shop", lang) }, { text: t("btn_language", lang) }],
  ];

  if (isAdmin(user.id)) {
    keyboard.splice(
      2,
      0,
      [{ text: t("btn_stats", lang) }, { text: t("btn_users", lang) }],
      [{ text: BUTTON_ADMIN_PANEL, web_app: { url: MINIAPP_URL } }]
    );
  }

  // "Mening profilim" — har bir user uchun, eng pastda, 2 ta tugma joyini egallaydi
  keyboard.push([{ text: t("btn_my_profile", lang) }]);

  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
  };
}

function checkKeyboard(user = {}) {
  return mainKeyboard(user);
}

function resultKeyboard(user = {}) {
  return mainKeyboard(user);
}

function helpKeyboard(user = {}) {
  return mainKeyboard(user);
}

function broadcastConfirmKeyboard(broadcastId, confirmToken, lang) {
  return {
    inline_keyboard: [
      [
        {
          text: t("btn_confirm_yes", lang || DEFAULT_LANG),
          callback_data: `broadcast_confirm:${broadcastId}:${confirmToken}`,
        },
        {
          text: t("btn_confirm_no", lang || DEFAULT_LANG),
          callback_data: `broadcast_cancel:${broadcastId}:${confirmToken}`,
        },
      ],
    ],
  };
}

function dailyUsersPaginationKeyboard(pageData = {}) {
  return paginationKeyboard("stats_today_page", {
    page: pageData.todayPage || 0,
    pageSize: pageData.todayPageSize || USERS_PAGE_SIZE,
    total: pageData.todayTotal || 0,
    lang: pageData.lang,
  });
}

function usersPaginationKeyboard(pageData = {}) {
  return paginationKeyboard("users_page", {
    page: pageData.page || 0,
    pageSize: pageData.pageSize || USERS_PAGE_SIZE,
    total: pageData.total || 0,
    lang: pageData.lang,
  });
}

function errorsRefreshKeyboard(lang) {
  return {
    inline_keyboard: [
      [
        {
          text: t("btn_refresh", lang || DEFAULT_LANG),
          callback_data: "errors",
        },
      ],
    ],
  };
}

function feedbackForceReply(lang) {
  return {
    force_reply: true,
    selective: true,
    input_field_placeholder: t("placeholder_feedback", lang || DEFAULT_LANG),
  };
}

function bindInfoForceReply(lang) {
  return {
    force_reply: true,
    selective: true,
    input_field_placeholder: t("placeholder_bind_info", lang || DEFAULT_LANG),
  };
}

function fullInfoForceReply(lang) {
  return {
    force_reply: true,
    selective: true,
    input_field_placeholder: t("placeholder_full_info", lang || DEFAULT_LANG),
  };
}

function resetPwForceReply(lang) {
  return {
    force_reply: true,
    selective: true,
    input_field_placeholder: t("placeholder_reset_pw", lang || DEFAULT_LANG),
  };
}

function paginationKeyboard(prefix, { page = 0, pageSize = USERS_PAGE_SIZE, total = 0, lang } = {}) {
  const safePage = Math.max(0, Number(page) || 0);
  const safePageSize = Math.max(1, Number(pageSize) || USERS_PAGE_SIZE);
  const safeTotal = Math.max(0, Number(total) || 0);
  const buttons = [];

  if (safePage > 0) {
    buttons.push({
      text: t("btn_pagination_prev", lang || DEFAULT_LANG),
      callback_data: `${prefix}:${safePage - 1}`,
    });
  }

  if ((safePage + 1) * safePageSize < safeTotal) {
    buttons.push({
      text: t("btn_pagination_next", lang || DEFAULT_LANG),
      callback_data: `${prefix}:${safePage + 1}`,
    });
  }

  return buttons.length ? { inline_keyboard: [buttons] } : null;
}

async function sendOrEditAdminMessage(chatId, messageId, text, replyMarkup) {
  if (!messageId) {
    return sendMessage(chatId, text, replyMarkup);
  }

  try {
    return await editMessageText(
      chatId,
      messageId,
      text,
      isInlineKeyboard(replyMarkup) ? replyMarkup : null
    );
  } catch (error) {
    if (/message is not modified/i.test(error.message || "")) {
      return null;
    }

    console.error("[EDIT_MESSAGE_ERROR]", error);
    recordError("telegram_edit_failed", error.message, { chatId, messageId });

    return sendMessage(chatId, text, replyMarkup);
  }
}

async function sendMessage(chatId, text, replyMarkup, options = {}) {
  const originalText = String(text ?? "");
  const outgoingText = shouldEnrichPremiumEmoji(options)
    ? enrichPremiumEmojis(originalText)
    : originalText;
  const safeText = sanitizeTelegramText(outgoingText);
  const payload = {
    chat_id: chatId,
    text: safeText || " ",
    disable_web_page_preview: !options.enableLinkPreview,
  };

  if (options.enableLinkPreview && options.linkPreviewUrl) {
    payload.link_preview_options = {
      url: options.linkPreviewUrl,
      show_above_text: true,
    };
  }

  if (
    Array.isArray(options.entities) &&
    options.entities.length &&
    safeText === outgoingText
  ) {
    payload.entities = options.entities;
  } else if (!options.plain) {
    payload.parse_mode = "HTML";
  }

  const isGroupOrChannel = (() => {
    if (!chatId) return false;
    const str = String(chatId).trim();
    if (str.startsWith("-") || str.startsWith("@")) return true;
    const num = Number(str);
    return !isNaN(num) && num < 0;
  })();

  if (replyMarkup && replyMarkup.inline_keyboard) {
    payload.reply_markup = replyMarkup;
  } else if (isGroupOrChannel) {
    payload.reply_markup = { remove_keyboard: true };
  } else if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return telegram("sendMessage", payload);
}

async function editMessageText(chatId, messageId, text, replyMarkup) {
  const outgoingText = enrichPremiumEmojis(text);
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: sanitizeTelegramText(outgoingText) || " ",
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return telegram("editMessageText", payload);
}

function shouldEnrichPremiumEmoji(options = {}) {
  return !options.plain && options.premiumEmoji !== false;
}

function bindProviderEmoji(provider, fallbackEmoji) {
  const premiumEmoji = PREMIUM_BIND_PROVIDER_EMOJIS[provider];

  if (!premiumEmoji?.id) {
    return fallbackEmoji;
  }

  return telegramEmoji(premiumEmoji.emoji || fallbackEmoji, premiumEmoji.id);
}

function telegramEmoji(emoji, emojiId) {
  return `<tg-emoji emoji-id="${emojiId}">${emoji}</tg-emoji>`;
}

function enrichPremiumEmojis(text) {
  const sourceText = String(text ?? "");

  if (!sourceText) {
    return sourceText;
  }

  const protectedParts = [];
  const protectedText = sourceText.replace(
    /<(?:tg-emoji|code|pre)\b[^>]*>.*?<\/(?:tg-emoji|code|pre)>/gis,
    (match) => {
      const token = `__PREMIUM_EMOJI_PROTECTED_${protectedParts.length}__`;
      protectedParts.push(match);
      return token;
    }
  );

  const enrichedText = Object.entries(PREMIUM_EMOJIS).reduce(
    (value, [emoji, emojiId]) => {
      if (!emojiId) {
        return value;
      }
      return value.split(emoji).join(telegramEmoji(emoji, emojiId));
    },
    protectedText
  );

  return protectedParts.reduce(
    (value, part, index) => value.replace(`__PREMIUM_EMOJI_PROTECTED_${index}__`, part),
    enrichedText
  );
}

async function copyMessage(chatId, fromChatId, messageId) {
  return telegram("copyMessage", {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  });
}

async function deleteMessage(chatId, messageId) {
  return telegram("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

async function sendChatAction(chatId, action) {
  return telegram("sendChatAction", {
    chat_id: chatId,
    action,
  });
}

async function safeSendMessage(chatId, text, replyMarkup) {
  try {
    return await sendMessage(chatId, text, replyMarkup);
  } catch (error) {
    console.error("[SEND_MESSAGE_ERROR]", error);
    return null;
  }
}

async function safeSendChatAction(chatId, action) {
  try {
    return await sendChatAction(chatId, action);
  } catch (error) {
    console.error("[CHAT_ACTION_ERROR]", error);
    return null;
  }
}

async function safeDeleteMessage(chatId, messageId) {
  if (!messageId) {
    return null;
  }

  try {
    return await deleteMessage(chatId, messageId);
  } catch (error) {
    console.error("[DELETE_MESSAGE_ERROR]", error);
    return null;
  }
}

async function safeDeleteBindWaitMessage(fallbackChatId, waitMessage) {
  const normalized = normalizeBindWaitMessage(waitMessage);

  return safeDeleteMessage(normalized?.chatId || fallbackChatId, normalized?.messageId);
}

async function answerCallbackQuery(callbackQueryId) {
  return telegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
  });
}

async function telegram(method, payload) {
  const response = await fetchWithTimeout(`${TG_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    timeoutMs: TELEGRAM_TIMEOUT_MS,
  });

  const bodyText = await response.text();
  const data = safeJsonParse(bodyText);

  if (!response.ok || !data?.ok) {
    throw new Error(
      `Telegram API error: HTTP ${response.status} ${bodyText || response.statusText}`
    );
  }

  return data;
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isCommand(text, command) {
  return new RegExp(`^\\/${command}(?:@\\w+)?(?:\\s|$)`, "i").test(text);
}

function isBindInfoCommand(text) {
  return (
    isCommand(text, "info") ||
    isCommand(text, "bind") ||
    isCommand(text, "ulanish") ||
    isCommand(text, "ulamalar") ||
    isCommand(text, "ulanmalar")
  );
}

function stripBindInfoCommand(text) {
  return String(text || "")
    .replace(/^\/(?:info|bind|ulanish|ulamalar|ulanmalar)(?:@\w+)?/i, "")
    .trim();
}

function isFullInfoCommand(text) {
  return (
    isCommand(text, "full_info") ||
    isCommand(text, "fullinfo") ||
    isCommand(text, "toliq") ||
    isCommand(text, "malumot")
  );
}

function stripFullInfoCommand(text) {
  return String(text || "")
    .replace(/^\/(?:full_info|fullinfo|toliq|malumot)(?:@\w+)?/i, "")
    .trim();
}

function isResetPwCommand(text) {
  return (
    isCommand(text, "resetpw") ||
    isCommand(text, "reset_pw") ||
    isCommand(text, "reset") ||
    isCommand(text, "parol") ||
    isCommand(text, "parolni_tiklash")
  );
}

function stripResetPwCommand(text) {
  return String(text || "")
    .replace(/^\/(?:resetpw|reset_pw|reset|parol|parolni_tiklash)(?:@\w+)?/i, "")
    .trim();
}

function isValidEmailFormat(value) {
  const text = String(value || "").trim();

  if (!text || text.length > 254 || /\s/.test(text)) {
    return false;
  }

  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(text);
}

function stripCommand(text, command) {
  return String(text || "")
    .replace(new RegExp(`^\\/${command}(?:@\\w+)?`, "i"), "")
    .trim();
}

function isGroupChat(chat = {}) {
  return chat.type === "group" || chat.type === "supergroup";
}

function getGroupAddressing(message = {}) {
  const text = String(message.text || "").trim();

  if (!text) {
    return {
      addressed: false,
      input: "",
    };
  }

  const commandAddressing = getGroupCommandAddressing(text);

  if (commandAddressing.addressed) {
    return commandAddressing;
  }

  const mention = findAddressedBotMention(text, message.entities || []);

  if (!mention) {
    return {
      addressed: false,
      input: "",
    };
  }

  return {
    addressed: true,
    input: removeTextRange(text, mention.offset, mention.length).trim(),
  };
}

function getGroupCommandAddressing(text) {
  const match = String(text || "").match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/);

  if (!match) {
    return {
      addressed: false,
      input: "",
    };
  }

  const [, command, username] = match;

  const normalizedCommand = command.toLowerCase();

  if (
    ![
      "check",
      "start",
      "info",
      "bind",
      "ulanish",
      "ulamalar",
      "ulanmalar",
    ].includes(normalizedCommand)
  ) {
    return {
      addressed: false,
      input: "",
    };
  }

  if (
    [
      "check",
      "info",
      "bind",
      "ulanish",
      "ulamalar",
      "ulanmalar",
    ].includes(normalizedCommand) &&
    !username
  ) {
    return {
      addressed: true,
      input: text.slice(match[0].length).trim(),
      commandText: text,
    };
  }

  if (!isAddressedBotUsername(username, 0)) {
    return {
      addressed: false,
      input: "",
    };
  }

  return {
    addressed: true,
    input: text.slice(match[0].length).trim(),
    commandText: text,
  };
}

function findAddressedBotMention(text, entities = []) {
  for (const entity of entities) {
    if (entity?.type !== "mention") {
      continue;
    }

    const mention = text.slice(entity.offset, entity.offset + entity.length);

    if (isAddressedBotUsername(mention, entity.offset)) {
      return {
        offset: entity.offset,
        length: entity.length,
      };
    }
  }

  const fallback = text.match(/@\w{5,32}/);

  if (fallback && isAddressedBotUsername(fallback[0], fallback.index || 0)) {
    return {
      offset: fallback.index || 0,
      length: fallback[0].length,
    };
  }

  return null;
}

function isAddressedBotUsername(value, offset = 0) {
  const username = sanitizeOptionalTelegramUsername(value);

  if (!username) {
    return false;
  }

  if (!TELEGRAM_BOT_USERNAME) {
    return false;
  }

  return username.toLowerCase() === TELEGRAM_BOT_USERNAME.toLowerCase();
}

function removeTextRange(text, offset, length) {
  return `${text.slice(0, offset)} ${text.slice(offset + length)}`
    .replace(/\s+/g, " ")
    .trim();
}

function isKeyboardButton(text, ...buttons) {
  return buttons.includes(String(text || "").trim());
}

function isTranslatedKeyboardButton(text, translationKey) {
  const normalized = String(text || "").trim();
  for (const lang of SUPPORTED_LANGS) {
    if (t(translationKey, lang) === normalized) return true;
  }
  return false;
}

function normalizeBindWaitMessage(value = {}) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const chatId = toTelegramChatId(value.chatId || value.chat_id);
  const messageId = toTelegramMessageId(value.messageId || value.message_id);

  if (!chatId || !messageId) {
    return null;
  }

  return {
    chatId,
    messageId,
  };
}

function toTelegramChatId(value) {
  const text = String(value ?? "").trim();

  return /^-?\d{1,20}$/.test(text) ? text : null;
}

function toTelegramMessageId(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return Math.trunc(number);
}

function isFeedbackAdminReply(message = {}) {
  if (!isAdmin(message.from?.id)) {
    return false;
  }

  return Boolean(parseFeedbackAdminReplyTarget(message.reply_to_message));
}

function parseFeedbackAdminReplyTarget(replyToMessage = {}) {
  const text = String(replyToMessage?.text || replyToMessage?.caption || "");

  if (!text || !/Feedback ID:/i.test(text) || !/User ID:/i.test(text)) {
    return null;
  }

  const feedbackMatch = text.match(/Feedback ID:\s*(?:<code>)?([A-Za-z0-9_-]+)(?:<\/code>)?/i);
  const userMatch = text.match(/User ID:\s*(?:<code>)?(-?\d{1,20})(?:<\/code>)?/i);
  const chatMatch = text.match(/Chat ID:\s*(?:<code>)?(-?\d{1,20})(?:<\/code>)?/i);

  if (!userMatch) {
    return null;
  }

  return {
    feedbackId: feedbackMatch?.[1] || "",
    userId: userMatch[1],
    chatId: chatMatch?.[1] || userMatch[1],
  };
}

function isFeedbackSubmissionMessage(message = {}, user = {}) {
  const text = getFeedbackMessageText(message);

  if (!text || isCommandLike(text) || isTranslatedKeyboardButton(text, "btn_feedback")) {
    return false;
  }

  return Boolean(getPendingFeedback(user.id) || isFeedbackPromptReply(message));
}

function rememberUserMode(userId, mode) {
  if (!userId) {
    return;
  }

  stats.userModes.set(String(userId), mode);
  void activeUserModeStore?.set?.(userId, mode);
}

function getUserMode(userId) {
  return stats.userModes.get(String(userId || "")) || "";
}

// Rejim isolate RAM'ida yo'q bo'lsa (yangi Worker isolate'i), Durable Object'dan
// qayta o'qiymiz — aks holda "Akkaunt qo'shish"dan keyingi xabar tushib qoladi.
async function resolveUserMode(userId) {
  const cached = getUserMode(userId);

  if (cached) {
    return cached;
  }

  if (!userId || !activeUserModeStore?.get) {
    return "";
  }

  try {
    const mode = await activeUserModeStore.get(userId);

    if (mode) {
      stats.userModes.set(String(userId), mode);
      return mode;
    }
  } catch (error) {
    console.error("[USER_MODE_RESOLVE_ERROR]", error);
  }

  return "";
}

function clearUserMode(userId) {
  stats.userModes.delete(String(userId || ""));
  void activeUserModeStore?.clear?.(userId);
}

function isFeedbackPromptReply(message = {}) {
  const replyText = String(message.reply_to_message?.text || "");

  return /Fikr va izohlar/i.test(replyText);
}

// Rejim RAM'da yo'q bo'lsa ham, bot yuborgan "Akkaunt qo'shish" xabariga
// reply qilingan xabar aniqlandiriladi — stateless ishlaydi.
function isProfileAddPromptReply(message = {}) {
  const replyText = String(message.reply_to_message?.text || "");

  return /User ID/i.test(replyText) && /Zone\s*\/?\s*Server ID/i.test(replyText);
}

function isBindInfoPromptReply(message = {}) {
  const replyText = String(message.reply_to_message?.text || "");

  return /Ulanmalar/i.test(replyText) && /Account ID/i.test(replyText);
}

function isFullInfoPromptReply(message = {}) {
  const replyText = String(message.reply_to_message?.text || "");

  return /To'liq ma'lumot/i.test(replyText) && /Account ID/i.test(replyText);
}

function isResetPwPromptReply(message = {}) {
  const replyText = String(message.reply_to_message?.text || "");

  return (
    /Moonton email/i.test(replyText) ||
    /Moonton почт/i.test(replyText)
  );
}

function getFeedbackMessageText(message = {}) {
  return String(message.text || message.caption || "").trim();
}

function isCommandLike(text) {
  return /^\//.test(String(text || "").trim());
}

function rememberPendingFeedback(userId, chatId, promptMessageId = null) {
  if (!userId) {
    return;
  }

  stats.pendingFeedbacks.set(String(userId), {
    chatId: String(chatId),
    promptMessageId,
    createdAt: Date.now(),
  });
}

function getPendingFeedback(userId) {
  cleanupPendingFeedbacks();

  return stats.pendingFeedbacks.get(String(userId || "")) || null;
}

function clearPendingFeedback(userId) {
  return stats.pendingFeedbacks.delete(String(userId || ""));
}

function cleanupPendingFeedbacks() {
  const now = Date.now();

  for (const [userId, pending] of stats.pendingFeedbacks.entries()) {
    if (now - Number(pending.createdAt || 0) > FEEDBACK_PENDING_TTL_MS) {
      stats.pendingFeedbacks.delete(userId);
    }
  }
}

function isInlineKeyboard(replyMarkup) {
  return Array.isArray(replyMarkup?.inline_keyboard);
}

function parsePageFromCallback(data, prefix) {
  const value = String(data || "").slice(`${prefix}:`.length);
  const page = Number.parseInt(value, 10);

  return Number.isFinite(page) && page > 0 ? page : 0;
}

function parseRequestBody(body) {
  if (!body) return {};

  if (typeof body === "string") {
    return safeJsonParse(body) || {};
  }

  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return safeJsonParse(Buffer.from(body).toString("utf8")) || {};
  }

  if (typeof body !== "object") {
    return {};
  }

  return body;
}

function safeJsonParse(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pickFirstValue(source = {}, keys = []) {
  if (!source || typeof source !== "object") {
    return null;
  }

  for (const key of keys) {
    if (Object.hasOwn(source, key)) {
      return normalizeBindValue(source[key]);
    }
  }

  const loweredKeys = Object.keys(source).reduce((map, key) => {
    map.set(key.toLowerCase().replace(/[\s_-]+/g, ""), key);
    return map;
  }, new Map());

  for (const key of keys) {
    const normalizedKey = String(key).toLowerCase().replace(/[\s_-]+/g, "");
    const actualKey = loweredKeys.get(normalizedKey);

    if (actualKey) {
      return normalizeBindValue(source[actualKey]);
    }
  }

  return null;
}

function normalizeBindValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const item = value.find((entry) => !isEmptyBindValue(entry));

    return normalizeBindValue(item);
  }

  if (typeof value === "object") {
    return normalizeBindValue(
      value.email ??
        value.mail ??
        value.account_name ??
        value.accountName ??
        value.username ??
        value.userName ??
        value.nickname ??
        value.name ??
        value.id ??
        value.uid ??
        value.open_id ??
        value.openId ??
        value.count ??
        value.total ??
        value.value ??
        value.data ??
        value.bound ??
        value.linked ??
        value.connected ??
        value.status ??
        value.bind_status ??
        value.bindStatus ??
        value.is_bound ??
        value.isBound ??
        value.is_linked ??
        value.isLinked ??
        value.is_connected ??
        value.isConnected ??
        null
    );
  }

  return String(value).trim();
}

function isEmptyBindValue(value) {
  if (value === undefined || value === null || value === false || value === 0) {
    return true;
  }

  const text = String(value).trim().toLowerCase();

  return (
    !text ||
    [
      "0",
      "empty",
      "empty.",
      "null",
      "none",
      "false",
      "-",
      "no",
      "not linked",
      "not_linked",
      "not bound",
      "not_bound",
      "not bind",
      "unlinked",
      "unbound",
      "disconnected",
      "tidak ada",
      "tidak terhubung",
      "belum bind",
      "belum linked",
      "kosong",
      "yo‘q",
      "yo'q",
    ].includes(text)
  );
}

function formatBindValue(value) {
  if (isEmptyBindValue(value)) {
    return "empty.";
  }

  if (value === true) {
    return "linked.";
  }

  const text = sanitizeTelegramText(String(value)).trim();

  if (!text) {
    return "empty.";
  }

  if (["1", "true", "yes", "linked", "bound", "connected"].includes(text.toLowerCase())) {
    return "linked.";
  }

  return text;
}

function formatDeviceLoginCount(value) {
  if (isEmptyBindValue(value)) {
    return "0";
  }

  if (value === true) {
    return "1";
  }

  const number = Number(value);

  if (Number.isFinite(number) && number >= 0) {
    return String(Math.trunc(number));
  }

  return String(value);
}

function getDeviceLoginResultLines(deviceLogin = {}) {
  const total = formatDeviceLoginTotal(deviceLogin);

  return [
    "",
    "📱 <b>Device Login</b>",
    `🤖 <b>Android:</b> ${escapeHtml(formatDeviceLoginCount(deviceLogin.android))}`,
    `🍎 <b>iOS:</b> ${escapeHtml(formatDeviceLoginCount(deviceLogin.ios))}`,
    total ? `📊 <b>Jami:</b> ${escapeHtml(total)}` : "",
  ];
}

function formatDeviceLoginTotal(deviceLogin = {}) {
  const counts = [deviceLogin.android, deviceLogin.ios].map(getDeviceLoginCountNumber);

  if (counts.some((count) => count === null)) {
    return "";
  }

  return String(counts.reduce((total, count) => total + count, 0));
}

function getDeviceLoginCountNumber(value) {
  if (isEmptyBindValue(value)) {
    return 0;
  }

  if (value === true) {
    return 1;
  }

  const number = Number(value);

  if (Number.isFinite(number) && number >= 0) {
    return Math.trunc(number);
  }

  return null;
}

function hasDeviceLoginData(deviceLogin = {}) {
  return [deviceLogin.android, deviceLogin.ios].some((value) => {
    if (value === undefined || value === null) {
      return false;
    }

    return String(value).trim() !== "";
  });
}

function escapeHtml(value) {
  return sanitizeTelegramText(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMonth(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value || "-").slice(0, 7);
  }

  return date.toISOString().slice(0, 7);
}

function cleanEnv(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isFalseyEnv(value) {
  return /^(?:0|false|no|off)$/i.test(cleanEnv(value));
}

function normalizeHttpMethod(value) {
  const method = cleanEnv(value).toUpperCase();

  return method === "POST" ? "POST" : "GET";
}

function normalizeSecretEnv(value) {
  let text = cleanEnv(value);

  const assignment = text.match(/^[A-Z0-9_]+\s*=\s*(.+)$/i);

  if (assignment) {
    text = assignment[1].trim();
  }

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("`") && text.endsWith("`"))
  ) {
    text = text.slice(1, -1).trim();
  }

  text = text.replace(/^Bearer\s+/i, "").trim();

  return text.replace(/\s+/g, "");
}

function resolveSupabaseConfig(env = {}, supabaseUrl = "") {
  if (!supabaseUrl) {
    return {
      serviceKey: "",
      keyType: "",
      error: "SUPABASE_URL topilmadi",
    };
  }

  const projectRef = extractSupabaseProjectRef(supabaseUrl);
  const candidates = getSupabaseKeyCandidates(env);
  const invalidReasons = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const serviceKey = normalizeSecretEnv(candidate.value);

    if (!serviceKey || seen.has(serviceKey)) {
      continue;
    }

    seen.add(serviceKey);

    const validation = validateSupabaseServiceKey(serviceKey, projectRef);

    if (validation.ok) {
      return {
        serviceKey,
        keyType: validation.keyType,
        source: candidate.name,
        projectRef,
        error: "",
      };
    }

    invalidReasons.push(`${candidate.name}: ${validation.reason}`);
  }

  return {
    serviceKey: "",
    keyType: "",
    projectRef,
    error: invalidReasons.length
      ? `Supabase service key yaroqsiz (${invalidReasons.join("; ")})`
      : "SUPABASE_SERVICE_KEY yoki SUPABASE_SERVICE_ROLE_KEY topilmadi",
  };
}

function getSupabaseKeyCandidates(env = {}) {
  return [
    { name: "SUPABASE_SERVICE_ROLE_KEY", value: env.SUPABASE_SERVICE_ROLE_KEY },
    { name: "SUPABASE_SERVICE_KEY", value: env.SUPABASE_SERVICE_KEY },
    { name: "SUPABASE_SECRET_KEY", value: env.SUPABASE_SECRET_KEY },
    { name: "SUPABASE_SERVICE_ROLE", value: env.SUPABASE_SERVICE_ROLE },
    { name: "SUPABASE_SERVICE_ROLE_SECRET", value: env.SUPABASE_SERVICE_ROLE_SECRET },
    { name: "SUPABASE_SERVICE_RELE_KEY", value: env.SUPABASE_SERVICE_RELE_KEY },
  ];
}

function validateSupabaseServiceKey(serviceKey, projectRef = "") {
  if (!serviceKey) {
    return {
      ok: false,
      reason: "bo‘sh qiymat",
    };
  }

  if (serviceKey.startsWith("sb_secret_")) {
    return {
      ok: true,
      keyType: "secret",
    };
  }

  if (serviceKey.startsWith("sb_publishable_")) {
    return {
      ok: false,
      reason: "publishable key server statistikasi uchun yetarli emas",
    };
  }

  const payload = decodeJwtPayload(serviceKey);

  if (!payload) {
    return {
      ok: false,
      reason: "service_role JWT yoki sb_secret formatida emas",
    };
  }

  if (payload.role !== "service_role") {
    return {
      ok: false,
      reason: `role=${payload.role || "-"}, service_role kerak`,
    };
  }

  if (projectRef && payload.ref && payload.ref !== projectRef) {
    return {
      ok: false,
      reason: `ref=${payload.ref} URL ref=${projectRef} bilan mos emas`,
    };
  }

  if (payload.exp && Number(payload.exp) <= Math.floor(Date.now() / 1000)) {
    return {
      ok: false,
      reason: "muddati tugagan",
    };
  }

  return {
    ok: true,
    keyType: "legacy_service_role",
  };
}

function decodeJwtPayload(token) {
  const [, payload] = String(token || "").split(".");

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function extractSupabaseProjectRef(supabaseUrl = "") {
  try {
    const hostname = new URL(supabaseUrl).hostname;
    const match = hostname.match(/^(?:db\.)?([a-z0-9]+)\.supabase\.co$/i);

    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function parseBoundedNumber(value, fallback, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function parseIdList(value) {
  return cleanEnv(value)
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^-?\d+$/.test(id));
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId || ""));
}

function trackUser(user = {}, chat = {}, updateMeta = {}) {
  rememberRuntimeUser(user, chat, updateMeta);

  queueSupabaseUserTrack(user, chat, updateMeta).catch((error) => {
    console.error("[SUPABASE_TRACK_BACKGROUND_ERROR]", error);
    recordError("supabase_track_background_failed", error.message, {
      userId: user.id,
      updateType: updateMeta.updateType,
    });
  });
}

function trackFeatureUse(user, chat, action, updateMeta = {}) {
  if (!action) {
    return;
  }

  recordRuntimeAction(user, action);
  trackUser(user, chat, {
    ...updateMeta,
    action,
  });
}

function recordRuntimeAction(user, action) {
  const userId = user?.id ? String(user.id) : "";

  if (!userId || !action) {
    return;
  }

  stats.featureCounts[action] = (stats.featureCounts[action] || 0) + 1;
  stats.userActionCounts.set(
    userId,
    Number(stats.userActionCounts.get(userId) || 0) + 1
  );
}

function rememberRuntimeUser(user = {}, chat = {}, updateMeta = {}) {
  const userId = user.id ? String(user.id) : "";
  const now = new Date().toISOString();

  if (userId) {
    const previous = stats.userProfiles.get(userId) || {};

    stats.users.add(userId);
    stats.userProfiles.set(userId, {
      ...previous,
      user_id: userId,
      chat_id: chat?.id ?? previous.chat_id ?? user.id,
      chat_type: chat?.type || previous.chat_type || "private",
      username: cleanTextValue(user.username, 64) ?? previous.username ?? null,
      first_name: cleanTextValue(user.first_name, 128) ?? previous.first_name ?? null,
      last_name: cleanTextValue(user.last_name, 128) ?? previous.last_name ?? null,
      language_code: cleanTextValue(user.language_code, 16) ?? previous.language_code ?? null,
      is_bot: typeof user.is_bot === "boolean" ? user.is_bot : previous.is_bot ?? null,
      first_seen_at: previous.first_seen_at || now,
      last_seen_at: now,
      updates_count: Number(previous.updates_count || 0) + (updateMeta.action ? 1 : 0),
      last_update_type: updateMeta.updateType || previous.last_update_type || null,
    });
  }

  if (chat?.id && (!chat.type || chat.type === "private")) {
    stats.broadcastChats.add(String(chat.id));

    if (!userId) {
      rememberKnownPrivateChat(chat.id);
    }
  }
}

function rememberKnownPrivateChat(chatId) {
  const userId = String(chatId || "");

  if (!/^-?\d+$/.test(userId) || stats.userProfiles.has(userId)) {
    return;
  }

  const now = new Date().toISOString();

  stats.users.add(userId);
  stats.userProfiles.set(userId, {
    user_id: userId,
    chat_id: userId,
    chat_type: "private",
    first_seen_at: now,
    last_seen_at: now,
    updates_count: 0,
    last_update_type: "known_private_chat",
  });
}

async function queueSupabaseUserTrack(user = {}, chat = {}, updateMeta = {}) {
  if (getSupabaseConfigError() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }

  const payload = buildSupabaseTrackPayload(user, chat, updateMeta);

  if (!payload) {
    return;
  }

  try {
    await supabaseRpc("track_bot_user", payload, {
      prefer: "return=minimal",
    });
  } catch (error) {
    console.error("[SUPABASE_TRACK_ERROR]", error);
    recordError("supabase_track_failed", error.message, {
      userId: payload.p_user_id,
      updateType: payload.p_update_type,
    });
  }
}

function buildSupabaseTrackPayload(user = {}, chat = {}, updateMeta = {}) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const userId = toPgBigint(user.id);

  if (!userId) {
    return null;
  }

  return {
    p_user_id: userId,
    p_chat_id: toPgBigint(chat?.id),
    p_chat_type: cleanTextValue(chat?.type, 32),
    p_username: cleanTextValue(user.username, 64),
    p_first_name: cleanTextValue(user.first_name, 128),
    p_last_name: cleanTextValue(user.last_name, 128),
    p_language_code: cleanTextValue(user.language_code, 16),
    p_is_bot: typeof user.is_bot === "boolean" ? user.is_bot : null,
    p_update_id: toPgBigint(updateMeta.updateId),
    p_update_type: cleanTextValue(updateMeta.updateType, 32),
    p_action: cleanTextValue(updateMeta.action, 32),
  };
}

function cleanTextValue(value, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = sanitizeTelegramText(value).trim();

  if (!text) {
    return null;
  }

  return clipText(text, maxLength);
}

function toPgBigint(value) {
  const text = String(value ?? "").trim();

  return /^-?\d{1,19}$/.test(text) ? text : null;
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY && !SUPABASE_CONFIG.error);
}

function getSupabaseConfigError() {
  if (!SUPABASE_URL) {
    return "SUPABASE_URL topilmadi";
  }

  if (SUPABASE_CONFIG.error) {
    return SUPABASE_CONFIG.error;
  }

  return "";
}

function isSupabaseAuthTemporarilyDisabled() {
  return Date.now() < Number(stats.supabaseAuthDisabledUntil || 0);
}

function rememberSupabaseAuthFailure(message) {
  const safeMessage = cleanEnv(message) || "Supabase API key yaroqsiz";

  stats.supabaseLastAuthError =
    "Supabase API key yaroqsiz yoki JWT secret rotate qilingan. Cloudflare/Vercel envdagi SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY ni yangilang.";
  stats.supabaseAuthDisabledUntil = Date.now() + 5 * 60 * 1000;
  recordError("supabase_auth_failed", safeMessage);
}

async function getSupabaseStats(options = {}) {
  const todayPage = Math.max(0, Number(options.todayPage) || 0);
  const configError = getSupabaseConfigError();

  if (configError) {
    return {
      error: true,
      configError,
      todayUsers: getRuntimeTodayUsers().slice(0, USERS_PAGE_SIZE),
      todayTotal: getRuntimeTodayUsers().length,
      todayPage,
      todayPageSize: USERS_PAGE_SIZE,
      totalUsers: stats.users.size,
      monthly: [],
    };
  }

  if (isSupabaseAuthTemporarilyDisabled()) {
    return {
      error: true,
      configError: stats.supabaseLastAuthError,
      todayUsers: getRuntimeTodayUsers().slice(0, USERS_PAGE_SIZE),
      todayTotal: getRuntimeTodayUsers().length,
      todayPage,
      todayPageSize: USERS_PAGE_SIZE,
      totalUsers: stats.users.size,
      monthly: [],
    };
  }

  try {
    const [today, total, monthly] = await Promise.all([
      getSupabaseUsersPage(todayPage, {
        todayOnly: true,
      }),
      getSupabaseUsersCount(),
      supabaseRequest(
        "/bot_monthly_active_users?select=month,active_users,updates&order=month.desc&limit=6"
      ),
    ]);

    return {
      todayUsers: today.users,
      todayTotal: today.total,
      todayPage,
      todayPageSize: USERS_PAGE_SIZE,
      totalUsers: total,
      monthly: Array.isArray(monthly) ? monthly : [],
    };
  } catch (error) {
    console.error("[SUPABASE_STATS_ERROR]", error);
    recordError("supabase_stats_failed", error.message);

    return {
      error: true,
      todayUsers: getRuntimeTodayUsers().slice(0, USERS_PAGE_SIZE),
      todayTotal: getRuntimeTodayUsers().length,
      todayPage,
      todayPageSize: USERS_PAGE_SIZE,
      totalUsers: stats.users.size,
      monthly: [],
    };
  }
}

async function getUsersPageData(page = 0) {
  const safePage = Math.max(0, Number(page) || 0);
  const configError = getSupabaseConfigError();

  if (configError || isSupabaseAuthTemporarilyDisabled()) {
    return {
      ...getRuntimeUsersPage(safePage),
      error: Boolean(configError || stats.supabaseLastAuthError),
      configError: configError || stats.supabaseLastAuthError,
    };
  }

  try {
    return await getSupabaseUsersPage(safePage);
  } catch (error) {
    console.error("[SUPABASE_USERS_ERROR]", error);
    recordError("supabase_users_failed", error.message);

    return {
      ...getRuntimeUsersPage(safePage),
      error: true,
    };
  }
}

async function getSupabaseUsersPage(page = 0, options = {}) {
  const safePage = Math.max(0, Number(page) || 0);
  const params = new URLSearchParams();
  const offset = safePage * USERS_PAGE_SIZE;

  params.set(
    "select",
    "user_id,chat_id,chat_type,username,first_name,last_name,updates_count,first_seen_at,last_seen_at"
  );
  params.set("order", "last_seen_at.desc.nullslast");
  params.set("limit", String(USERS_PAGE_SIZE));
  params.set("offset", String(offset));

  if (options.todayOnly) {
    const bounds = getTashkentDayBounds();

    params.set("last_seen_at", `gte.${bounds.startIso}`);
    params.append("last_seen_at", `lt.${bounds.endIso}`);
  }

  const result = await supabaseRequest(`/bot_users?${params.toString()}`, {
    prefer: "count=exact",
    returnMeta: true,
  });

  return {
    users: Array.isArray(result.data) ? result.data : [],
    total: Number.isFinite(result.count) ? result.count : 0,
    page: safePage,
    pageSize: USERS_PAGE_SIZE,
    source: "supabase",
  };
}

async function getSupabaseUsersCount() {
  const result = await supabaseRequest("/bot_users?select=user_id&limit=1", {
    prefer: "count=exact",
    returnMeta: true,
  });

  return Number.isFinite(result.count) ? result.count : 0;
}

async function notifyMainGroupIfNewUser(user) {
  if (!MAIN_GROUP_ID) return;

  const isKnown = await isKnownUserInSupabase(user.id);
  if (isKnown) return;

  const userLink = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${escapeHtml(user.first_name || "Foydalanuvchi")}</a>`;
  const notificationText = `#yangi_foydalanuvchi\n\n🆕 <b>Yangi foydalanuvchi botga start bosib botimiz foydalanuvchisiga aylandi</b>\n\n👤 ${userLink}`;
  await safeSendMessage(MAIN_GROUP_ID, notificationText, null);
}

async function isKnownUserInSupabase(userId) {
  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return false;
  }

  try {
    const data = await supabaseRequest(
      `/bot_users?user_id=eq.${toPgBigint(userId)}&select=user_id&limit=1`
    );
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    // Xatolik bo'lsa — xavfsiz tomon: foydalanuvchini "yangi" deb hisoblaymiz
    console.error("[SUPABASE_USER_CHECK_ERROR]", error.message);
    return false;
  }
}

function getRuntimeUsersPage(page = 0) {
  const safePage = Math.max(0, Number(page) || 0);
  const users = getRuntimeUsers();
  const offset = safePage * USERS_PAGE_SIZE;

  return {
    users: users.slice(offset, offset + USERS_PAGE_SIZE),
    total: users.length,
    page: safePage,
    pageSize: USERS_PAGE_SIZE,
    source: "runtime",
  };
}

function getRuntimeUsers() {
  return Array.from(stats.userProfiles.values())
    .sort((a, b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0))
    .map(normalizeRuntimeUser);
}

function getRuntimeTodayUsers() {
  const bounds = getTashkentDayBounds();

  return getRuntimeUsers().filter((user) => {
    const lastSeenAt = new Date(user.last_seen_at).getTime();

    return lastSeenAt >= bounds.startMs && lastSeenAt < bounds.endMs;
  });
}

function normalizeRuntimeUser(user = {}) {
  return {
    ...user,
    user_id: String(user.user_id || user.id || ""),
    chat_id: user.chat_id ? String(user.chat_id) : null,
    updates_count: Number(user.updates_count || 0),
  };
}

function getTashkentDayBounds(now = new Date()) {
  const tashkentOffsetMs = 5 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + tashkentOffsetMs);
  const startMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    tashkentOffsetMs;
  const endMs = startMs + 24 * 60 * 60 * 1000;

  return {
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

function getTashkentDateString(now = new Date()) {
  const tashkentOffsetMs = 5 * 60 * 60 * 1000;

  return new Date(now.getTime() + tashkentOffsetMs).toISOString().slice(0, 10);
}

async function sendDailyUsageReport() {
  const chatId = MAIN_GROUP_ID;

  if (!chatId) {
    return { ok: false, reason: "main_group_not_configured" };
  }

  let report = null;

  if (isSupabaseConfigured() && !isSupabaseAuthTemporarilyDisabled()) {
    try {
      report = await supabaseRpc("get_daily_usage_report", {
        p_date: getTashkentDateString(),
      });
    } catch (error) {
      console.error("[DAILY_USAGE_REPORT_ERROR]", error);
      recordError("daily_usage_report_failed", error.message);
    }
  }

  if (!report || typeof report !== "object") {
    report = buildRuntimeDailyReport();
  }

  await safeSendMessage(chatId, getDailyReportText(report), null);

  return { ok: true };
}

function buildRuntimeDailyReport() {
  const actions = Object.entries(stats.featureCounts || {})
    .map(([action, count]) => ({ action, count }))
    .sort((left, right) => Number(right.count || 0) - Number(left.count || 0));
  const topUsers = Array.from(stats.userActionCounts.entries())
    .map(([userId, count]) => {
      const profile = stats.userProfiles.get(String(userId)) || {};

      return {
        user_id: userId,
        username: profile.username || null,
        first_name: profile.first_name || null,
        last_name: profile.last_name || null,
        count,
      };
    })
    .sort((left, right) => Number(right.count || 0) - Number(left.count || 0))
    .slice(0, 3);

  return {
    date: getTashkentDateString(),
    actions,
    top_users: topUsers,
    source: "runtime",
  };
}

function getDailyReportText(report = {}, lang) {
  lang = lang || DEFAULT_LANG;
  const actions = Array.isArray(report.actions) ? report.actions : [];
  const topUsers = Array.isArray(report.top_users) ? report.top_users : [];
  const date = cleanEnv(report.date);

  const lines = [
    t("daily_report_title", lang),
    "",
    date ? t("daily_report_date", lang, { date: escapeHtml(date) }) : "",
    "",
    t("daily_report_functions", lang),
    ...(actions.length
      ? actions.map((entry) => {
          const label = getDailyReportActionLabel(entry.action, lang);
          return `${label}: <b>${Number(entry.count || 0)}</b> ta`;
        })
      : [t("daily_report_no_functions", lang)]),
    "",
    t("daily_report_top3", lang),
    ...(topUsers.length
      ? topUsers.map((user, index) => {
          const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
          const label = user.username ? `@${user.username}` : name || String(user.user_id || "");
          return `${index + 1}. ${escapeHtml(label)} — <b>${Number(user.count || 0)}</b> ta`;
        })
      : [t("daily_report_no_users", lang)]),
    report.source === "runtime" ? t("daily_report_runtime_warning", lang) : "",
  ].filter(Boolean);

  return lines.join("\n");
}

async function syncKnownUsersToSupabase() {
  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return {
      attempted: false,
      skipped: true,
      total: 0,
      saved: 0,
    };
  }

  if (Date.now() - Number(stats.lastKnownUsersSyncAt || 0) < KNOWN_USERS_SYNC_INTERVAL_MS) {
    return {
      attempted: true,
      skipped: true,
      total: 0,
      saved: 0,
    };
  }

  const rows = getKnownUserRowsForSupabase();

  if (!rows.length) {
    return {
      attempted: true,
      skipped: false,
      total: 0,
      saved: 0,
    };
  }

  let saved = 0;

  try {
    for (const chunk of chunkArray(rows, 100)) {
      await supabaseRequest("/bot_users?on_conflict=user_id", {
        method: "POST",
        body: chunk,
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
      saved += chunk.length;
    }

    stats.lastKnownUsersSyncAt = Date.now();

    return {
      attempted: true,
      skipped: false,
      total: rows.length,
      saved,
    };
  } catch (error) {
    console.error("[SUPABASE_KNOWN_USERS_SYNC_ERROR]", error);
    recordError("supabase_known_users_sync_failed", error.message);

    return {
      attempted: true,
      skipped: false,
      total: rows.length,
      saved,
      error: true,
    };
  }
}

function getKnownUserRowsForSupabase() {
  const knownIds = new Set([
    ...Array.from(stats.broadcastChats || []),
    ...Array.from(stats.users || []),
    ...Array.from(stats.userProfiles.keys()),
  ]);
  const now = new Date().toISOString();

  return Array.from(knownIds)
    .map((userId) => {
      const id = toPgBigint(userId);

      if (!id || id.startsWith("-")) {
        return null;
      }

      const profile = stats.userProfiles.get(String(userId)) || {};

      return {
        user_id: id,
        chat_id: toPgBigint(profile.chat_id) || id,
        chat_type: cleanTextValue(profile.chat_type, 32) || "private",
        username: cleanTextValue(profile.username, 64),
        first_name: cleanTextValue(profile.first_name, 128),
        last_name: cleanTextValue(profile.last_name, 128),
        language_code: cleanTextValue(profile.language_code, 16),
        is_bot: typeof profile.is_bot === "boolean" ? profile.is_bot : null,
        first_seen_at: profile.first_seen_at || now,
        last_seen_at: profile.last_seen_at || now,
        updates_count: Number(profile.updates_count || 0),
        last_update_type: profile.last_update_type || "known_private_chat",
        updated_at: now,
      };
    })
    .filter(Boolean);
}

async function getMandatoryChannel() {
  if (Date.now() - botSettings.lastFetchedAt < 60000) {
    return botSettings.mandatoryChannel;
  }
  if (!isSupabaseConfigured()) {
    return null;
  }
  try {
    const data = await supabaseRequest(`/bot_settings?key=eq.mandatory_channel&select=value`);
    if (data && data.length > 0) {
      botSettings.mandatoryChannel = data[0].value;
    } else {
      botSettings.mandatoryChannel = null;
    }
    botSettings.lastFetchedAt = Date.now();
  } catch (err) {
    console.error("[FETCH_SETTINGS_ERROR]", err);
  }
  return botSettings.mandatoryChannel;
}

async function setMandatoryChannel(value) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured.");
  }
  try {
    if (value) {
      await supabaseRequest(`/bot_settings?on_conflict=key`, {
        method: "POST",
        prefer: "resolution=merge-duplicates",
        body: { key: "mandatory_channel", value },
      });
    } else {
      await supabaseRequest(`/bot_settings?key=eq.mandatory_channel`, {
        method: "DELETE",
      });
    }
    botSettings.mandatoryChannel = value;
    botSettings.lastFetchedAt = Date.now();
  } catch (err) {
    console.error("[SET_SETTINGS_ERROR]", err);
    throw err;
  }
}

// Limitlar tarixi (018 migratsiyasi) — shaxsiy kabinet "qaysi limit qaysi
// akkauntga ketgani"ni shundan ko'rsatadi. Xato asosiy ishni to'xtatmaydi.
async function recordQuotaEvent(event) {
  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }

  try {
    await quotaLog.logQuotaEvent((path, options) => supabaseRequest(path, options), event);
  } catch (error) {
    console.error("[QUOTA_EVENT_LOG_ERROR]", error.message);
  }
}

async function supabaseRpc(functionName, args, options = {}) {
  return supabaseRequest(`/rpc/${encodeURIComponent(functionName)}`, {
    method: "POST",
    body: args,
    ...options,
  });
}

function getAccountOwnerNotifyActionLabel(action, lang) {
  if (action === FEATURE_ACTIONS.FULL_INFO) {
    return t("account_owner_notify_action_full_info", lang);
  }
  if (action === FEATURE_ACTIONS.BIND_INFO) {
    return t("account_owner_notify_action_bind_info", lang);
  }
  return t("account_owner_notify_action_check", lang);
}

// Tekshiruv natijasi userga yuborilgach fonga ishlaydi (ctx.waitUntil orqali).
// Bitta query akkaunt egasini topadi va tekshiruvni log qiladi; ega ru'yxatdan
// o'tgan bo'lsa va tekshiruvchi egasining o'zi bo'lmasa — egasiga xabar boradi.
async function runAccountOwnerNotify(ctx, user, accountId, zoneId, action) {
  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }

  const task = (async () => {
    try {
      const record = await supabaseRpc("record_account_check", {
        p_account_id: String(accountId),
        p_zone_id: String(zoneId),
        p_checker_user_id: toPgBigint(user.id),
        p_checker_username: cleanTextValue(user.username, 64),
        p_checker_first_name: cleanTextValue(user.first_name, 128),
        p_action: action,
      });

      if (!record || record.notify !== true || !record.owner_user_id) {
        return;
      }

      const ownerUserId = String(record.owner_user_id);
      const lang = await loadUserLangFromSupabase(ownerUserId);
      const checkerMention = user.username
        ? `@${escapeHtml(user.username)}`
        : `<a href="tg://user?id=${user.id}">${escapeHtml(user.first_name || "Foydalanuvchi")}</a>`;

      const text = t("account_owner_notify", lang, {
        checker: checkerMention,
        accountId: String(accountId),
        zoneId: String(zoneId),
        action: getAccountOwnerNotifyActionLabel(action, lang),
      });

      const inlineKeyboard = {
        inline_keyboard: [[{ text: t("btn_open_profile", lang), url: `tg://user?id=${user.id}` }]],
      };

      await safeSendMessage(ownerUserId, text, inlineKeyboard);
    } catch (error) {
      console.error("[ACCOUNT_OWNER_NOTIFY_ERROR]", error);
      recordError("account_owner_notify_failed", error.message, {
        accountId,
        zoneId,
      });
    }
  })();

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(task);
  } else {
    void task;
  }
}

async function supabaseRequest(path, options = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error(getSupabaseConfigError() || "Supabase env sozlanmagan");
  }

  const { method = "GET", body, prefer, returnMeta = false } = options;
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Accept: "application/json",
  };

  if (SUPABASE_KEY_TYPE !== "secret") {
    headers.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (prefer) {
    headers.Prefer = prefer;
  }

  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive: method === "POST",
    timeoutMs: SUPABASE_TIMEOUT_MS,
  });

  const bodyText = await response.text();

  if (!response.ok) {
    const message = `Supabase REST ${method} ${path.split("?")[0]} HTTP ${response.status}: ${clipText(bodyText, 180)}`;

    if (response.status === 401) {
      rememberSupabaseAuthFailure(message);
    }

    throw new Error(message);
  }

  const data = bodyText ? safeJsonParse(bodyText) ?? bodyText : null;

  if (returnMeta) {
    return {
      data,
      count: parseContentRangeTotal(response.headers.get("content-range")),
    };
  }

  return data;
}

function parseContentRangeTotal(contentRange) {
  const match = String(contentRange || "").match(/\/(\d+|\*)$/);

  if (!match || match[1] === "*") {
    return null;
  }

  const total = Number(match[1]);

  return Number.isFinite(total) ? total : null;
}

function recordError(type, message, meta = {}) {
  const safeType = cleanEnv(type) || "unknown_error";
  const safeMessage = cleanEnv(message) || "Noma’lum xatolik";

  stats.errorCounts[safeType] = (stats.errorCounts[safeType] || 0) + 1;
  stats.errors.push({
    at: new Date().toISOString(),
    type: safeType,
    message: safeMessage,
    meta,
  });

  if (stats.errors.length > 20) {
    stats.errors.splice(0, stats.errors.length - 20);
  }
}

function getChatIdFromUpdate(update) {
  if (!update || typeof update !== "object") {
    return null;
  }

  return (
    update.message?.chat?.id ||
    update.edited_message?.chat?.id ||
    update.channel_post?.chat?.id ||
    update.edited_channel_post?.chat?.id ||
    update.callback_query?.message?.chat?.id ||
    null
  );
}

function getFirstHeader(headers, name) {
  if (!headers || typeof headers !== "object") {
    return "";
  }

  return getFirstValue(headers[name] ?? headers[name.toLowerCase()]);
}

function getFirstValue(value) {
  if (Array.isArray(value)) {
    return cleanEnv(value[0]);
  }

  return cleanEnv(value);
}

function isValidWebhookSecret(secretHeader, secretQuery) {
  return [secretHeader, secretQuery].some((value) => {
    return safeCompare(value, TELEGRAM_WEBHOOK_SECRET);
  });
}

function safeCompare(a, b) {
  const left = Buffer.from(cleanEnv(a));
  const right = Buffer.from(cleanEnv(b));

  if (!left.length || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function normalizeTelegramError(message) {
  const text = cleanEnv(message);
  const telegramBody = text.match(/\{.*\}$/)?.[0];
  const parsed = telegramBody ? safeJsonParse(telegramBody) : null;

  if (parsed?.description) {
    return parsed.description;
  }

  return text;
}

function sanitizeTelegramUsername(value) {
  const username = cleanEnv(value).replace(/^@+/, "");

  if (/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return username;
  }

  return "Oblto_org";
}

function sanitizeOptionalTelegramUsername(value) {
  const username = cleanEnv(value).replace(/^@+/, "");

  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : "";
}

function isZiteBindInfoProvider() {
  return (
    MLBB_BIND_INFO_PROVIDER === "zite" ||
    /^https?:\/\/(?:www\.)?zite\.lol\b/i.test(MLBB_BIND_INFO_API_URL)
  );
}

function isBengkelBindInfoProvider() {
  return ["bengkel", "bengkelmlbb", "bengkelmlbb_bot"].includes(
    MLBB_BIND_INFO_PROVIDER
  );
}

function isTelegramBotApiUrl(value) {
  return /^https?:\/\/api\.telegram\.org\/bot/i.test(cleanEnv(value));
}

function createBroadcastId() {
  return crypto.randomBytes(8).toString("hex");
}

function createFeedbackId() {
  return `fb_${crypto.randomBytes(6).toString("hex")}`;
}

function createBroadcastToken() {
  return crypto.randomBytes(8).toString("hex");
}

function hashBroadcastToken(token) {
  return crypto.createHash("sha256").update(cleanEnv(token)).digest("hex");
}

function parseBroadcastCallback(data, action) {
  const prefix = `${action}:`;

  if (!String(data || "").startsWith(prefix)) {
    return {
      broadcastId: "",
      token: "",
    };
  }

  const [broadcastId = "", token = ""] = String(data).slice(prefix.length).split(":");

  return {
    broadcastId,
    token,
  };
}

const PENDING_BROADCAST_STORAGE_PREFIX = "broadcast_pending:";

function pendingBroadcastStorageKey(broadcastId) {
  return `${PENDING_BROADCAST_STORAGE_PREFIX}${broadcastId}`;
}

async function persistPendingBroadcast(broadcastId, pending) {
  stats.pendingBroadcasts.set(broadcastId, pending);

  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }

  try {
    await supabaseRequest(`/bot_settings?on_conflict=key`, {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: {
        key: pendingBroadcastStorageKey(broadcastId),
        value: pending,
      },
    });
  } catch (error) {
    console.error("[PERSIST_PENDING_BROADCAST_ERROR]", error.message);
  }
}

async function loadPendingBroadcast(broadcastId) {
  const fromMemory = stats.pendingBroadcasts.get(broadcastId);

  if (fromMemory) {
    return fromMemory;
  }

  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return null;
  }

  try {
    const data = await supabaseRequest(
      `/bot_settings?key=eq.${encodeURIComponent(pendingBroadcastStorageKey(broadcastId))}&select=value`
    );

    if (Array.isArray(data) && data[0]?.value) {
      const pending = data[0].value;

      if (Date.now() - Number(pending.createdAt || 0) > BROADCAST_TTL_MS) {
        await deletePendingBroadcast(broadcastId);
        return null;
      }

      stats.pendingBroadcasts.set(broadcastId, pending);
      return pending;
    }
  } catch (error) {
    console.error("[LOAD_PENDING_BROADCAST_ERROR]", error.message);
  }

  return null;
}

async function deletePendingBroadcast(broadcastId) {
  stats.pendingBroadcasts.delete(broadcastId);

  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }

  try {
    await supabaseRequest(
      `/bot_settings?key=eq.${encodeURIComponent(pendingBroadcastStorageKey(broadcastId))}`,
      { method: "DELETE" }
    );
  } catch (error) {
    console.error("[DELETE_PENDING_BROADCAST_ERROR]", error.message);
  }
}

async function cleanupPendingBroadcasts() {
  const now = Date.now();

  for (const [broadcastId, pending] of stats.pendingBroadcasts.entries()) {
    if (now - pending.createdAt > BROADCAST_TTL_MS) {
      stats.pendingBroadcasts.delete(broadcastId);
    }
  }

  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }

  try {
    const data = await supabaseRequest(
      `/bot_settings?key=like.${PENDING_BROADCAST_STORAGE_PREFIX}*&select=key,value`
    );

    if (Array.isArray(data)) {
      const stale = [];

      for (const row of data) {
        const createdAt = Number(row.value?.createdAt || 0);
        if (row.key && createdAt && now - createdAt > BROADCAST_TTL_MS) {
          stale.push(row.key);
        }
      }

      await Promise.allSettled(
        stale.map((key) =>
          supabaseRequest(`/bot_settings?key=eq.${encodeURIComponent(key)}`, {
            method: "DELETE",
          })
        )
      );
    }
  } catch (error) {
    console.error("[CLEANUP_PENDING_BROADCAST_ERROR]", error.message);
  }
}

function chunkArray(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function clipText(text, maxLength) {
  const safeText = sanitizeTelegramText(text);
  const safeMaxLength = Math.max(0, Number(maxLength) || 0);
  const chars = Array.from(safeText);

  if (!safeMaxLength || chars.length <= safeMaxLength) {
    return safeText;
  }

  if (safeMaxLength <= 3) {
    return chars.slice(0, safeMaxLength).join("");
  }

  return `${chars.slice(0, safeMaxLength - 3).join("")}...`;
}

function sanitizeTelegramText(value) {
  const text = String(value ?? "");
  let result = "";

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        result += text[index] + text[index + 1];
        index += 1;
      }

      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }

    result += text[index];
  }

  return result;
}

module.exports.sendDailyUsageReport = sendDailyUsageReport;
module.exports.sendBroadcastPayload = sendBroadcastPayload;
module.exports.categorizeBroadcastSendError = categorizeBroadcastSendError;
module.exports.sendBroadcastReport = sendBroadcastReport;
module.exports.getBroadcastChatIds = getBroadcastChatIds;
module.exports.enrichPremiumEmojis = enrichPremiumEmojis;
module.exports.__private = {
  buildMlCodeMode,
  buildMyProfileKeyboard,
  getMlAccountSummaryText,
  parseMlCodeMode,
  buildBengkelBindInfoRequest,
  buildBindInfoRequest,
  broadcastMessage,
  buildFullInfoTelegraphContent,
  buildReadableSquad,
  buildRuntimeDailyReport,
  buildSupabaseTrackPayload,
  detectServerType,
  getDailyReportText,
  getTashkentDateString,
  recordRuntimeAction,
  sendDailyUsageReport,
  trackFeatureUse,
  enrichPremiumEmojis,
  getBroadcastChatIds,
  getBroadcastRecipientId,
  getBroadcastRecipientStats,
  getCommandsText,
  getCustomEmojiIdText,
  getAdminFeedbackText,
  getErrorsText,
  getFailedLookupText,
  getBindInfoWaitText,
  getBindInfoResultText,
  getResultText,
  getStatsText,
  getStatsTextAsync,
  getUsersListText,
  isSupabaseConfigured,
  getFullInfoPostText,
  getFullInfoPageTitle,
  getFullInfoPromptText,
  getFullInfoWaitText,
  getFullInfoFailedText,
  getFullInfoLimitReachedText,
  getInvalidFullInfoInputText,
  isFullInfoCommand,
  isFullInfoPromptReply,
  lookupMlbbFullInfo,
  handleLimitFullInfoCommand,
  lookupResetPassword,
  getFriendlyResetPwReason,
  handleResetPwRequest,
  handleLimitResetPwCommand,
  getResetPwPromptText,
  getResetPwWaitText,
  getInvalidResetPwEmailText,
  getResetPwSuccessText,
  getResetPwLimitReachedText,
  getResetPwFailedText,
  resetPwForceReply,
  isResetPwCommand,
  stripResetPwCommand,
  isResetPwPromptReply,
  isValidEmailFormat,
  handleInlineQuery,
  answerInlineQuery,
  buildInlineMessageResult,
  buildInlineHintResult,
  checkUserMembership,
  getCachedUserAccess,
  cacheUserAccess,
  prewarmUserAccess,
  enforceMandatoryMembership,
  persistPendingBroadcast,
  loadPendingBroadcast,
  deletePendingBroadcast,
  createTelegraphPage,
  getTelegraphAccessToken,
  mainKeyboard,
  normalizeSecretEnv,
  parseContentRangeTotal,
  isValidWebhookSecret,
  isAdmin,
  isKeyboardButton,
  lookupMlbbBindInfo,
  normalizeBengkelBindInfoResponse,
  normalizeLookupResponse,
  normalizeBindInfoResponse,
  parseBengkelBindInfoText,
  parseIdList,
  parseAdvancedRanges,
  parseMlbbInput,
  normalizeMlbbInputText,
  parseRequestBody,
  resolveSupabaseConfig,
  sanitizeTelegramText,
  sanitizeTelegramUsername,
  trackUser,
  validateSupabaseServiceKey,
  handleMyProfileRequest,
  handleProfileAddAccount,
  handleProfileViewersRequest,
  handleShopMessage,
  handleShopCallback,
  buildShopFirstmailListView,
  buildShopFirstmailDetail,
  shopKeyboard,
  getAccountOwnerNotifyActionLabel,
  ACCOUNT_MAX_COUNT,
  t,
  getUserLang,
  setUserLang,
  inferTranslationsLang,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  translations,
};