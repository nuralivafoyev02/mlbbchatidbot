const crypto = require("node:crypto");
// --- i18n: Load from locale JSON files ---
const SUPPORTED_LANGS = ["uz", "ru"];
const DEFAULT_LANG = "uz";

const translations = {
  uz: require("./locales/uz.json"),
  ru: require("./locales/ru.json"),
};

function t(key, lang, params = {}) {
  const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
  let text = translations[safeLang]?.[key] || translations[DEFAULT_LANG]?.[key] || key;

  for (const [param, value] of Object.entries(params)) {
    text = text.replace(new RegExp(`\{${param}\}`, "g"), String(value ?? ""));
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
    return DEFAULT_LANG;
  }
  try {
    const data = await supabaseRequest(
      `/bot_users?user_id=eq.${toPgBigint(userId)}&select=preferred_language&limit=1`
    );
    if (Array.isArray(data) && data[0]?.preferred_language) {
      return SUPPORTED_LANGS.includes(data[0].preferred_language) ? data[0].preferred_language : DEFAULT_LANG;
    }
  } catch (error) {
    console.error("[LOAD_LANG_ERROR]", error.message);
  }
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
  FEEDBACK: "feedback",
});
const DAILY_REPORT_ACTION_KEYS = Object.freeze({
  start: "label_start",
  server_check: "label_server_check",
  bind_info: "label_bind_info",
  full_info: "label_full_info",
  feedback: "label_feedback",
});
function getDailyReportActionLabel(action, lang) {
  const key = DAILY_REPORT_ACTION_KEYS[action];
  return key ? t(key, lang || DEFAULT_LANG) : escapeHtml(String(action || ""));
}
const EMOJIS = require("./emojis.json");

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
const FULL_INFO_API_URL = cleanEnv(process.env.FULL_INFO_API) || "https://api.jebray.com";
const FULL_INFO_API_KEY = cleanEnv(process.env.FULL_INFO_API_KEY);
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
stats.users ||= new Set();
stats.broadcastChats ||= new Set();
stats.pendingBroadcasts ||= new Map();
stats.membershipCache ||= new Map();
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

module.exports = async function handler(req, res, env = {}) {
  let update = null;

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
    await processUpdate(update, { env });

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

const MEMBERSHIP_CACHE_TTL_MS = 5 * 60 * 1000;
const MEMBERSHIP_CACHE_NEGATIVE_TTL_MS = 60 * 1000;

function getCachedMembership(userId) {
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

  return entry.member;
}

function cacheMembership(userId, member) {
  const key = String(userId || "");

  if (!key) {
    return;
  }

  stats.membershipCache.set(key, {
    member: !!member,
    at: Date.now(),
  });
}async function enforceMandatoryMembership(chatId, user) {
  if (isAdmin(user.id)) return true;

  const cached = getCachedMembership(user.id);
  if (cached !== null) return cached;

  const mandatoryChannel = await getMandatoryChannel();
  if (!mandatoryChannel) return true;

  let isMember = false;
  try {
    isMember = await checkUserMembership(mandatoryChannel.id, user.id);
  } catch (error) {
    // Telegram API muammosi — user aybdor emas, keshlamasdan o'tkazib yuboramiz.
    // Keyingi xabarda yana tekshiriladi.
    return true;
  }

  cacheMembership(user.id, isMember);
  if (isMember) return true;

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

  trackUser(user, message.chat, {
    ...updateMeta,
  });

  // Load user's preferred language from cache or Supabase
  if (user.id) {
    let lang = getUserLang(user.id);
    if (!stats.languageCache.has(String(user.id))) {
      lang = await loadUserLangFromSupabase(user.id);
      setUserLang(user.id, lang);
    }
  }

  if (!isGroupChat(message.chat)) {
    const isAllowed = await enforceMandatoryMembership(chatId, user);
    if (!isAllowed) return;
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
      });
      return;
    }

    if (!addressing.input) {
      await sendMessage(chatId, getCheckPromptText(), null);
      return;
    }

    await detectAndReply(chatId, addressing.input, user, {
      replyMarkup: null,
    });
    return;
  }

  if (isFeedbackSubmissionMessage(message, user)) {
    await handleFeedbackSubmission(chatId, user, message);
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

  if (isCommand(text, "limit")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
      return;
    }

    const args = text.split(/\s+/);
    if (args.length !== 3) {
      await sendMessage(chatId, "<b>Noto'g'ri format!</b>\n\nTo'g'ri foydalanish: /limit [tgid] [miqdor]", mainKeyboard(user));
      return;
    }

    const targetTgId = parseInt(args[1], 10);
    const newLimit = parseInt(args[2], 10);

    if (isNaN(targetTgId) || isNaN(newLimit) || newLimit < 0) {
      await sendMessage(chatId, "<b>Xato!</b> ID va limit faqat musbat sonlardan iborat bo'lishi kerak.", mainKeyboard(user));
      return;
    }

    try {
      const res = await supabaseRpc("set_custom_bind_limit", {
        p_target_user_id: toPgBigint(targetTgId),
        p_new_limit: newLimit
      });

      if (res && res.ok) {
        await sendMessage(chatId, `Muvaffaqiyatli! Foydalanuvchi (${targetTgId}) limiti <b>${newLimit}</b> ga o'zgartirildi ✅`, mainKeyboard(user));
        await safeSendMessage(targetTgId, `Tabriklaymiz! Sizning ulanmalarni tekshirish limitingiz <b>${newLimit}</b> ta ga o'zgartirildi ✅`, null);
      } else {
        await sendMessage(chatId, "Bazada xatolik yuz berdi.", mainKeyboard(user));
      }
    } catch (error) {
      console.error("[SET_CUSTOM_LIMIT_ERROR]", error);
      await sendMessage(chatId, "Serverda xatolik yuz berdi.", mainKeyboard(user));
    }
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

    await detectAndReply(chatId, input, user);
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
    rememberUserMode(user.id, null);
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
    });
    return;
  }

  if (getUserMode(user.id) === "bind_info") {
    await handleBindInfoRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
    });
    return;
  }

  if (isFullInfoPromptReply(message)) {
    rememberUserMode(user.id, "full_info");
    await handleFullInfoRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
    });
    return;
  }

  if (getUserMode(user.id) === "full_info") {
    await handleFullInfoRequest(chatId, text, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
    });
    return;
  }

  if (getUserMode(user.id) === "server_check") {
    await detectAndReply(chatId, text, user);
    return;
  }

  const parsed = parseMlbbInput(text);

  if (parsed.ok) {
    await detectAndReply(chatId, text, user);
    return;
  }

  await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
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
        cacheMembership(user.id, true);
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

  if (callbackQuery.message && !isGroupChat(callbackQuery.message.chat)) {
    const isAllowed = await enforceMandatoryMembership(chatId, user);
    if (!isAllowed) {
      await answerCallbackQuery(callbackQuery.id);
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
      await setMandatoryChannel({ id: chat.id, title: chat.title, invite_link: inviteLink, username: chat.username });
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

  cleanupPendingBroadcasts();

  const broadcastId = createBroadcastId();
  const confirmToken = createBroadcastToken();
  const recipientCount = await getBroadcastRecipientCount();

  stats.pendingBroadcasts.set(broadcastId, {
    adminId: String(user.id),
    chatId: String(chatId),
    payload: broadcastPayload,
    tokenHash: hashBroadcastToken(confirmToken),
    createdAt: Date.now(),
    status: "pending",
    recipientCount,
  });

  await sendMessage(
    chatId,
    getBroadcastConfirmText(broadcastPayload, recipientCount, getUserLang(user.id)),
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

  if ((isZiteBindInfoProvider() || isBengkelBindInfoProvider()) && !options.skipWait) {
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

  if (MAIN_GROUP_ID && String(chatId) !== MAIN_GROUP_ID) {
    const userMention = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name || "Foydalanuvchi"}</a>`;
    const notificationText = `#foydalanish\n${userMention} <b>${parsed.accountId} (${parsed.zoneId})</b> ni ulanmalarini tekshirdi.`;
    const inlineKeyboard = {
      inline_keyboard: [[{ text: "👤 Profilni ochish", url: `tg://user?id=${user.id}` }]]
    };
    await safeSendMessage(MAIN_GROUP_ID, notificationText, inlineKeyboard);
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
    const page = await createTelegraphPage(getFullInfoPageTitle(fullInfo.data), content);
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
  }

  const lang = getUserLang(user.id);
  const resultText = getFullInfoPostText(
    { accountId: parsed.accountId, zoneId: parsed.zoneId, data: fullInfo.data },
    pageUrl,
    lang,
    { remaining: remainingAfter }
  );
  const resultKeyboardMarkup = {
    inline_keyboard: [
      [{ text: t("btn_view_result", lang), url: pageUrl }],
    ],
  };

  await sendFullInfoResult(chatId, resultText, resultKeyboardMarkup);
  await safeDeleteBindWaitMessage(chatId, waitMessage);

  // Main group'ga faqat MUVAFFAQIYATLI tekshiruv haqida xabar boradi;
  // xatolik bo'lsa limit ham kamaymaydi, group'ga ham yozilmaydi.
  if (MAIN_GROUP_ID && String(chatId) !== MAIN_GROUP_ID) {
    const userMention = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name || "Foydalanuvchi"}</a>`;
    const notificationText = `#foydalanish\n${userMention} <b>${parsed.accountId} (${parsed.zoneId})</b> akkauntining to'liq ma'lumotlarini oldi.`;
    const inlineKeyboard = {
      inline_keyboard: [[{ text: "👤 Profilni ochish", url: `tg://user?id=${user.id}` }]]
    };
    await safeSendMessage(MAIN_GROUP_ID, notificationText, inlineKeyboard);
  }
}

async function handleLimitFullInfoCommand(chatId, user, input) {
  const args = String(input || "").trim().split(/\s+/).filter(Boolean);
  const targetUserId = (args[0] || "").replace(/^@/, "");
  const amount = Number.parseInt(args[1], 10);

  if (!/^\d{1,20}$/.test(targetUserId) || !Number.isInteger(amount) || amount <= 0) {
    await sendMessage(
      chatId,
      [
        "❌ Format xato.",
        "",
        "To'g'ri ko'rinish:",
        "<code>/limit_fullinfo [tgid] [limit]</code>",
        "",
        "Namuna: <code>/limit_fullinfo 123456789 10</code>",
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
    const result = await supabaseRpc("add_full_info_quota", {
      p_user_id: toPgBigint(targetUserId),
      p_amount: amount,
    });

    if (!result || result.ok !== true) {
      throw new Error(result?.error || "add_full_info_quota javobi noto'g'ri");
    }

    const lines = [
      `✅ <b>Limit qo'shildi.</b>`,
      "",
      `👤 User ID: <code>${escapeHtml(targetUserId)}</code>`,
      `➕ Qo'shildi: <b>+${amount}</b> ta`,
    ];

    if (typeof result.remaining === "number") {
      lines.push(`📦 Jami qoldiq: <b>${result.remaining}</b> ta`);
    }

    await sendMessage(chatId, lines.join("\n"), mainKeyboard(user));

    // Limit olgan userga ham tabrik xabari boradi (bot bilan chat ochgan bo'lsa).
    const targetChatId = Number(targetUserId);
    if (Number.isFinite(targetChatId) && targetChatId !== Number(user.id)) {
      const targetLang = await loadUserLangFromSupabase(targetUserId).catch(() => DEFAULT_LANG);
      const grantedText = t("full_info_quota_granted_user", targetLang, {
        count: amount,
        remaining: typeof result.remaining === "number" ? result.remaining : amount,
      });

      try {
        await sendMessage(targetChatId, grantedText, null);
      } catch (notifyError) {
        // User botni bloklagan yoki bot bilan chat ochmagan — bu xato emas,
        // limit baribir berilgan. Xatoni log'ga yozamiz.
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

function getInvalidFullInfoInputText(lang) {
  lang = lang || DEFAULT_LANG;
  return t("full_info_invalid_input", lang);
}

function getFullInfoPageTitle(data = {}) {
  const nickname = escapeHtml(data.nickname || "MLBB Player");
  const date = getTashkentDateString();
  return `To'liq ma'lumot | ${nickname} (${date})`;
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
        ["Oxirgi qahramonlar", Array.isArray(data.last_use_hero) && data.last_use_hero.length ? data.last_use_hero.join(", ") : null],
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
  const firstLine = `${resultEmoji} ${battle.hero || "Qahramon"} — ${battle.mode || "Rejim noma'lum"} (${resultLabel})`;
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
  const pending = stats.pendingBroadcasts.get(broadcastId);

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
  stats.pendingBroadcasts.delete(broadcastId);
  await sendMessage(chatId, "📣 <b>Xabar yuborish boshlandi.</b>", mainKeyboard(user));

  const broadcastQueue = options.env?.BROADCAST_QUEUE;

  if (broadcastQueue && typeof broadcastQueue.send === "function") {
    try {
      await broadcastQueue.send({
        payload: pending.payload,
        adminChatId: String(chatId),
      });
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

async function handleBroadcastCancel(chatId, user, data) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, getUnknownText(getUserLang(user.id)), mainKeyboard(user));
    return;
  }

  const { broadcastId, token } = parseBroadcastCallback(data, "broadcast_cancel");
  const pending = stats.pendingBroadcasts.get(broadcastId);

  if (pending?.adminId === String(user.id) && pending.tokenHash === hashBroadcastToken(token)) {
    stats.pendingBroadcasts.delete(broadcastId);
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


  if (MAIN_GROUP_ID && String(chatId) !== MAIN_GROUP_ID) {
    const userMention = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name || "Foydalanuvchi"}</a>`;
    const notificationText = `#foydalanish\n${userMention} <b>${parsed.accountId} (${parsed.zoneId})</b> ni check qildi.`;
    const inlineKeyboard = {
      inline_keyboard: [[{ text: "👤 Profilni ochish", url: `tg://user?id=${user.id}` }]]
    };
    await safeSendMessage(MAIN_GROUP_ID, notificationText, inlineKeyboard);
  }
}

async function lookupMlbbAccount(accountId, zoneId) {
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
      timeoutMs: MLBB_LOOKUP_TIMEOUT_MS,
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

async function lookupMlbbBindInfo(accountId, zoneId) {
  if (isBengkelBindInfoProvider()) {
    return lookupBengkelMlbbBindInfo(accountId, zoneId);
  }

  if (!MLBB_BIND_INFO_API_URL) {
    return {
      ok: false,
      reason: "bind_info_api_not_configured",
      technicalReason: "MLBB_BIND_INFO_API_URL env sozlanmagan",
    };
  }

  try {
    const request = buildBindInfoRequest(accountId, zoneId);

    const response = await fetchWithTimeout(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeoutMs: MLBB_BIND_INFO_TIMEOUT_MS,
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

async function lookupBengkelMlbbBindInfo(accountId, zoneId) {
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
      timeoutMs: MLBB_BIND_INFO_TIMEOUT_MS,
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
      root.quickLogin
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
  let sent = 0;
  let failed = 0;

  for (const chunk of chunkArray(chatIds, 20)) {
    const results = await Promise.allSettled(
      chunk.map((chatId) => sendBroadcastPayload(chatId, broadcastPayload))
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        sent += 1;
      } else {
        failed += 1;
        console.error("[BROADCAST_ERROR]", result.reason);
        recordError("broadcast_failed", result.reason?.message || String(result.reason), {
          chatId: chunk[index],
        });
      }
    });
  }

  return {
    total: chatIds.length,
    sent,
    failed,
  };
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

async function getBroadcastRecipientCount() {
  return (await getBroadcastChatIds()).length;
}

async function addSupabaseBroadcastRecipients(chatIds) {
  for (let offset = 0; ; offset += BROADCAST_USERS_PAGE_SIZE) {
    const params = new URLSearchParams();

    params.set("select", "user_id,chat_id,chat_type,is_bot");
    params.set("order", "last_seen_at.desc.nullslast");
    params.set("limit", String(BROADCAST_USERS_PAGE_SIZE));
    params.set("offset", String(offset));

    const rows = await supabaseRequest(`/bot_users?${params.toString()}`);

    if (!Array.isArray(rows) || rows.length === 0) {
      return;
    }

    rows.forEach((row) => {
      const chatId = getBroadcastRecipientId(row);

      if (chatId) {
        chatIds.add(chatId);
      }
    });

    if (rows.length < BROADCAST_USERS_PAGE_SIZE) {
      return;
    }
  }
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
    t("help_section_server", lang),
    "",
    t("help_section_keyboard", lang),
    "",
    t("help_section_limitations", lang),
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
    t("cmd_info", lang),
    t("cmd_full_info", lang),
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
      t("cmd_limit_fullinfo", lang)
    );
  }

  return commands.join("\n");
}

function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

function buildBotCommands(lang) {
  const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
  return [
    { command: "start", description: stripHtmlTags(t("cmd_start", safeLang).replace(/^.*—\s*/, "")) },
    { command: "help", description: stripHtmlTags(t("cmd_help", safeLang).replace(/^.*—\s*/, "")) },
    { command: "commands", description: stripHtmlTags(t("cmd_commands", safeLang).replace(/^.*—\s*/, "")) },
    { command: "check", description: stripHtmlTags(t("cmd_check", safeLang).replace(/^.*—\s*/, "")) },
    { command: "info", description: stripHtmlTags(t("cmd_info", safeLang).replace(/^.*—\s*/, "")) },
    { command: "fullinfo", description: stripHtmlTags(t("cmd_full_info", safeLang).replace(/^.*—\s*/, "")) },
    { command: "feedback", description: stripHtmlTags(t("cmd_feedback", safeLang).replace(/^.*—\s*/, "")) },
    { command: "language", description: stripHtmlTags(t("cmd_language", safeLang).replace(/^.*—\s*/, "")) },
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

  if (d.level) lines.push(`📊 <b>Level:</b> ${escapeHtml(d.level)}`);
  if (d.rank) lines.push(`🏆 <b>Rank:</b> ${escapeHtml(d.rank)}`);
  const readableSquad = buildReadableSquad(d.squad);
  if (readableSquad) lines.push(`🛡 <b>Squad:</b> ${escapeHtml(readableSquad)}`);
  if (Array.isArray(d.location) && d.location.length) {
    lines.push(`📍 <b>Manzil:</b> ${escapeHtml(d.location.join(", "))}`);
  }
  if (d.collection) {
    lines.push("");
    lines.push(`🎨 <b>Kolleksiya:</b> ${escapeHtml(d.collection.heroes || 0)} qahramon · ${escapeHtml(d.collection.skins || 0)} skin`);
  }
  if (d.combat && Number.isFinite(d.combat.win_rate)) {
    lines.push(`⚔️ <b>Win rate:</b> ${escapeHtml(d.combat.win_rate)}% · <b>Jami:</b> ${escapeHtml(d.combat.total_matches || 0)} o'yin`);
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
    `<tg-emoji emoji-id="5271527792641595125">😎</tg-emoji> <b>TikTok:</b> ${escapeHtml(bindings.tiktok)}`,
    `<tg-emoji emoji-id="5269427536453984598">😎</tg-emoji> <b>Facebook:</b> ${escapeHtml(bindings.facebook)}`,
    `<tg-emoji emoji-id="5821379843861778259">⚪️</tg-emoji> <b>Apple:</b> ${escapeHtml(bindings.apple)}`,
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

function getBroadcastConfirmText(payload, recipientCount = stats.broadcastChats.size, lang) {
  lang = lang || DEFAULT_LANG;
  const preview = typeof payload === "string" ? payload : payload?.previewText || payload?.text || "";
  const entities = (typeof payload === "object" && payload?.kind === "text") ? (payload.entities || []) : [];
  const header = [
    t("broadcast_confirm_title", lang),
    t("broadcast_confirm_body", lang, { count: recipientCount }),
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

function getBroadcastResultText(result, lang) {
  lang = lang || DEFAULT_LANG;
  return [
    t("broadcast_result_title", lang),
    "",
    t("broadcast_result_total", lang, { total: result.total }),
    t("broadcast_result_sent", lang, { sent: result.sent }),
    t("broadcast_result_failed", lang, { failed: result.failed }),
  ].join("\n");
}

function mainKeyboard(user = {}) {
  const lang = getUserLang(user.id);
  const keyboard = [
    [{ text: t("btn_check", lang) }, { text: t("btn_bind_info", lang) }],
    [{ text: t("btn_full_info", lang) }, { text: t("btn_language", lang) }],
  ];

  if (isAdmin(user.id)) {
    keyboard.splice(
      2,
      0,
      [{ text: t("btn_stats", lang) }, { text: t("btn_users", lang) }],
      [{ text: t("btn_mandatory_setup", lang) }]
    );
  }

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
}

function getUserMode(userId) {
  return stats.userModes.get(String(userId || "")) || "";
}

function isFeedbackPromptReply(message = {}) {
  const replyText = String(message.reply_to_message?.text || "");

  return /Fikr va izohlar/i.test(replyText);
}

function isBindInfoPromptReply(message = {}) {
  const replyText = String(message.reply_to_message?.text || "");

  return /Ulanmalar/i.test(replyText) && /Account ID/i.test(replyText);
}

function isFullInfoPromptReply(message = {}) {
  const replyText = String(message.reply_to_message?.text || "");

  return /To'liq ma'lumot/i.test(replyText) && /Account ID/i.test(replyText);
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

function maskSensitiveValue(value) {
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

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) {
    return maskEmailValue(text);
  }

  return maskTokenValue(text);
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

function maskEmailValue(value) {
  const [localPart, ...domainParts] = String(value).split("@");
  const domain = domainParts.join("@");

  if (!domain) {
    return maskTokenValue(value);
  }

  return `${maskTokenValue(localPart)}@${domain}`;
}

function maskTokenValue(value) {
  const chars = Array.from(String(value));

  if (chars.length <= 2) {
    return "*".repeat(Math.max(1, chars.length));
  }

  if (chars.length <= 4) {
    return `${chars[0]}${"*".repeat(chars.length - 2)}${chars.at(-1)}`;
  }

  return `${chars.slice(0, 2).join("")}${"*".repeat(chars.length - 4)}${chars.slice(-2).join("")}`;
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

  return maskSensitiveValue(value);
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

async function supabaseRpc(functionName, args, options = {}) {
  return supabaseRequest(`/rpc/${encodeURIComponent(functionName)}`, {
    method: "POST",
    body: args,
    ...options,
  });
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

function cleanupPendingBroadcasts() {
  const now = Date.now();

  for (const [broadcastId, pending] of stats.pendingBroadcasts.entries()) {
    if (now - pending.createdAt > BROADCAST_TTL_MS) {
      stats.pendingBroadcasts.delete(broadcastId);
    }
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
module.exports.sendBroadcastReport = sendBroadcastReport;
module.exports.getBroadcastChatIds = getBroadcastChatIds;

module.exports.__private = {
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
  checkUserMembership,
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
  t,
  getUserLang,
  setUserLang,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  translations,
};
