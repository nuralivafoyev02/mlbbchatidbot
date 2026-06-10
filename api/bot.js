const crypto = require("node:crypto");

const TELEGRAM_BOT_TOKEN = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_WEBHOOK_SECRET = cleanEnv(process.env.TELEGRAM_WEBHOOK_SECRET);
const SUPPORT_USERNAME = sanitizeTelegramUsername(
  process.env.SUPPORT_USERNAME || "Oblto_org"
);
const TELEGRAM_BOT_USERNAME = sanitizeOptionalTelegramUsername(
  process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME
);
const ADMIN_IDS = parseIdList(process.env.ADMIN_IDS || "5081175125,8500085987");
const BROADCAST_USER_IDS = parseIdList(process.env.BROADCAST_USER_IDS);
const BROADCAST_TTL_MS = 15 * 60 * 1000;
const BUTTON_CHECK = "🔎 Server aniqlash";
const BUTTON_TG_PROFILE = "👤 TG profil topish";
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
const USERS_PAGE_SIZE = 10;
const BROADCAST_USERS_PAGE_SIZE = 1000;
const KNOWN_USERS_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const FEEDBACK_PENDING_TTL_MS = 30 * 60 * 1000;
const FEEDBACK_MAX_LENGTH = 3000;
const PREMIUM_EMOJIS = Object.freeze({
  "🏪": "5208573502046610594",
  "✅": "5316561083085895267",
  "🚨": "5204082134486117389",
  "👉": "5202091395669588099",
  "🔍": "5188217332748527444",
  "🔎": "5188217332748527444",
  "👤": "5373012449597335010",
  "📌": "5316650525779835016",
  "⭕️": "5319090522470495400",
  "💦": "5316589275251226951",
  "🔗": "5375129357373165375",
  "👋": "5319007286004299794",
  "📱": "5926788567622749870",
  "🖥": "5926754173524643275",
  "🌐": "5927048877000626277",
});
const PREMIUM_BIND_PROVIDER_EMOJIS = Object.freeze({
  facebook: {
    emoji: "📘",
    id: "5929545717583449337",
  },
});

const MLBB_LOOKUP_API_URL =
  process.env.MLBB_LOOKUP_API_URL || "https://api.isan.eu.org/nickname/ml";
const MLBB_BIND_INFO_PROVIDER = cleanEnv(process.env.MLBB_BIND_INFO_PROVIDER).toLowerCase();
const MLBB_BIND_INFO_SHOW_DEVICES = isTruthyEnv(process.env.MLBB_BIND_INFO_SHOW_DEVICES);
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
    userModes: new Map(),
    userProfiles: new Map(),
    phoneProfiles: new Map(),
    errors: [],
    errorCounts: {},
    startedAt: new Date().toISOString(),
    lastCheckAt: null,
    lastKnownUsersSyncAt: 0,
    supabaseAuthDisabledUntil: 0,
    supabaseLastAuthError: null,
  };
}

const stats = global.__MLBB_BOT_STATS__;
stats.users ||= new Set();
stats.broadcastChats ||= new Set();
stats.pendingBroadcasts ||= new Map();
if (!(stats.pendingFeedbacks instanceof Map)) {
  stats.pendingFeedbacks = new Map(Object.entries(stats.pendingFeedbacks || {}));
}
if (!(stats.userModes instanceof Map)) {
  stats.userModes = new Map(Object.entries(stats.userModes || {}));
}
if (!(stats.userProfiles instanceof Map)) {
  stats.userProfiles = new Map(Object.entries(stats.userProfiles || {}));
}
if (!(stats.phoneProfiles instanceof Map)) {
  stats.phoneProfiles = new Map(Object.entries(stats.phoneProfiles || {}));
}
stats.errors ||= [];
stats.errorCounts ||= {};
stats.lastKnownUsersSyncAt ||= 0;
stats.supabaseAuthDisabledUntil ||= 0;
stats.supabaseLastAuthError ||= null;
BROADCAST_USER_IDS.forEach((chatId) => stats.broadcastChats.add(chatId));
BROADCAST_USER_IDS.forEach((chatId) => rememberKnownPrivateChat(chatId));

module.exports = async function handler(req, res) {
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
    await processUpdate(update);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[BOT_ERROR]", error);
    recordError("bot_error", error.message, {
      chatId: getChatIdFromUpdate(update),
      updateId: update?.update_id,
    });

    const chatId = getChatIdFromUpdate(update);

    if (chatId) {
      await safeSendMessage(chatId, getErrorText(), mainKeyboard());
    }

    return res.status(200).json({
      ok: false,
      error: error.message,
    });
  }
};

async function processUpdate(update) {
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
    await handleCallbackQuery(update.callback_query, {
      updateId: update.update_id,
      updateType: "callback_query",
    });
    return;
  }
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

  if (isGroupChat(message.chat)) {
    const addressing = getGroupAddressing(message);
    const addressedText = addressing.commandText || addressing.input;

    if (!addressing.addressed) {
      return;
    }

    if (isTelegramProfileCommand(addressedText)) {
      await handleTelegramProfileCommand(chatId, user, addressedText, {
        replyMarkup: null,
      });
      return;
    }

    if (isBindInfoCommand(addressedText) || isBindInfoCommand(addressing.input)) {
      const bindInput = stripBindInfoCommand(addressedText);

      if (!bindInput) {
        await sendMessage(chatId, getBindInfoPromptText(), null);
        return;
      }

      await handleBindInfoRequest(chatId, bindInput, user, {
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

  if (message.contact) {
    await handleTelegramProfileContact(chatId, user, message);
    return;
  }

  if (isFeedbackAdminReply(message)) {
    await handleFeedbackAdminReply(chatId, user, message);
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
    await sendMessage(chatId, getStartText(user), mainKeyboard(user));
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

  if (isCommand(text, "stat") || isCommand(text, "stats")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleStatsRequest(chatId, user, 0);
    return;
  }

  if (isCommand(text, "users") || isCommand(text, "foydalanuvchilar")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleUsersListRequest(chatId, user, 0);
    return;
  }

  if (isCommand(text, "errors") || isCommand(text, "xatoliklar")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleErrorsRequest(chatId, user);
    return;
  }

  if (isCommand(text, "emoji")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
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
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleMessageCommand(chatId, user, message);
    return;
  }

  if (isTelegramProfileCommand(text)) {
    await handleTelegramProfileCommand(chatId, user, text);
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

  if (isBindInfoCommand(text)) {
    const input = stripBindInfoCommand(text);
    rememberUserMode(user.id, "bind_info");

    if (!input) {
      await sendMessage(chatId, getBindInfoPromptText(), mainKeyboard(user));
      return;
    }

    await handleBindInfoRequest(chatId, input, user, {
      skipWait: skipBindWait,
      waitMessage: bindWaitMessage,
    });
    return;
  }

  if (isKeyboardButton(text, BUTTON_CHECK, BUTTON_CHECK_AGAIN)) {
    rememberUserMode(user.id, "server_check");
    await sendMessage(chatId, getCheckPromptText(), mainKeyboard(user));
    return;
  }

  if (isKeyboardButton(text, BUTTON_TG_PROFILE)) {
    rememberUserMode(user.id, "tg_profile");
    await sendMessage(chatId, getTelegramProfilePromptText(), telegramProfileKeyboard(user));
    return;
  }

  if (isKeyboardButton(text, BUTTON_BIND_INFO)) {
    rememberUserMode(user.id, "bind_info");
    await sendMessage(chatId, getBindInfoPromptText(), bindInfoForceReply());
    return;
  }

  if (isKeyboardButton(text, BUTTON_FEEDBACK)) {
    await handleFeedbackPrompt(chatId, user);
    return;
  }

  if (isKeyboardButton(text, BUTTON_HELP)) {
    await sendMessage(chatId, getHelpText(user), mainKeyboard(user));
    return;
  }

  if (isKeyboardButton(text, BUTTON_COMMANDS)) {
    await sendMessage(chatId, getCommandsText(user), mainKeyboard(user));
    return;
  }

  if (isKeyboardButton(text, BUTTON_MENU)) {
    await sendMessage(chatId, getStartText(user), mainKeyboard(user));
    return;
  }

  if (isKeyboardButton(text, BUTTON_STATS)) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleStatsRequest(chatId, user, 0);
    return;
  }

  if (isKeyboardButton(text, BUTTON_USERS)) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleUsersListRequest(chatId, user, 0);
    return;
  }

  if (isKeyboardButton(text, BUTTON_ERRORS)) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleErrorsRequest(chatId, user);
    return;
  }

  if (isKeyboardButton(text, BUTTON_BROADCAST)) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await sendMessage(chatId, getBroadcastUsageText(), mainKeyboard(user));
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

  if (getUserMode(user.id) === "tg_profile") {
    await handleTelegramProfileCommand(chatId, user, text);
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

  if (isBareTelegramIdInput(text)) {
    await handleTelegramProfileCommand(chatId, user, text);
    return;
  }

  await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
}

async function handleCallbackQuery(callbackQuery, updateMeta = {}) {
  if (!callbackQuery?.id) {
    return;
  }

  const data = String(callbackQuery.data || "");
  const chatId = callbackQuery.message?.chat?.id;
  const user = callbackQuery.from || {};

  trackUser(user, callbackQuery.message?.chat, {
    ...updateMeta,
  });

  await answerCallbackQuery(callbackQuery.id);

  if (!chatId) {
    return;
  }

  if (data.startsWith("broadcast_confirm:")) {
    await handleBroadcastConfirm(chatId, user, data);
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
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleStatsRequest(chatId, user, 0, callbackQuery.message?.message_id);
    return;
  }

  if (data.startsWith("stats_today_page:")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
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
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
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
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleErrorsRequest(chatId, user, callbackQuery.message?.message_id);
    return;
  }

  if (data === "menu") {
    await sendMessage(chatId, getStartText(user), mainKeyboard(user));
    return;
  }
}

async function handleStatsRequest(chatId, user, todayPage = 0, messageId = null) {
  const dbStats = await getSupabaseStats({ todayPage });
  const text = getStatsText(dbStats);
  const replyMarkup = dailyUsersPaginationKeyboard(dbStats);

  await sendOrEditAdminMessage(chatId, messageId, text, replyMarkup || mainKeyboard(user));
}

async function handleUsersListRequest(chatId, user, page = 0, messageId = null) {
  const syncResult = await syncKnownUsersToSupabase();
  const pageData = await getUsersPageData(page);
  const text = getUsersListText(pageData, syncResult);
  const replyMarkup = usersPaginationKeyboard(pageData) || mainKeyboard(user);

  await sendOrEditAdminMessage(chatId, messageId, text, replyMarkup);
}

async function handleErrorsRequest(chatId, user, messageId = null) {
  await sendOrEditAdminMessage(
    chatId,
    messageId,
    getErrorsText(),
    errorsRefreshKeyboard() || mainKeyboard(user)
  );
}

async function handleEmojiIdRequest(chatId, user, message = {}) {
  await sendMessage(chatId, getCustomEmojiIdText(message), mainKeyboard(user), {
    premiumEmoji: false,
  });
}

async function handleFeedbackPrompt(chatId, user) {
  cleanupPendingFeedbacks();

  const response = await sendMessage(chatId, getFeedbackPromptText(), feedbackForceReply());
  const promptMessageId = response?.result?.message_id || null;

  rememberPendingFeedback(user.id, chatId, promptMessageId);
}

async function handleFeedbackSubmission(chatId, user, message) {
  const feedbackText = getFeedbackMessageText(message);

  if (!feedbackText) {
    await sendMessage(chatId, getFeedbackTextRequiredText(), mainKeyboard(user));
    return;
  }

  if (feedbackText.length > FEEDBACK_MAX_LENGTH) {
    await sendMessage(chatId, getFeedbackTooLongText(), mainKeyboard(user));
    return;
  }

  clearPendingFeedback(user.id);

  const feedback = {
    id: createFeedbackId(),
    userId: String(user.id || chatId),
    chatId: String(chatId),
    user,
    text: feedbackText,
    createdAt: new Date().toISOString(),
  };
  const result = await sendFeedbackToAdmins(feedback);

  await sendMessage(chatId, getFeedbackThanksText(result), mainKeyboard(user));
}

async function handleFeedbackAdminReply(chatId, admin, message) {
  const target = parseFeedbackAdminReplyTarget(message.reply_to_message);
  const replyPayload = createFeedbackAdminReplyPayload(message);

  if (!target) {
    return;
  }

  if (!replyPayload) {
    await sendMessage(chatId, getFeedbackAdminReplyTextRequiredText(), mainKeyboard(admin));
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
    await sendMessage(chatId, getBroadcastTooLongText(), mainKeyboard(user));
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
  });

  await sendMessage(
    chatId,
    getBroadcastConfirmText(broadcastPayload, recipientCount),
    broadcastConfirmKeyboard(broadcastId, confirmToken)
  );
}

async function handleTelegramProfileCommand(chatId, user, text, options = {}) {
  const phoneNumber = extractTelegramPhoneNumber(text);
  const tgId = extractTelegramId(text);
  const replyMarkup = Object.hasOwn(options, "replyMarkup")
    ? options.replyMarkup
    : mainKeyboard(user);

  if (phoneNumber) {
    await handleTelegramPhoneProfileLookup(chatId, user, phoneNumber, {
      replyMarkup,
    });
    return;
  }

  if (!tgId) {
    await sendMessage(chatId, getTelegramProfilePromptText(), replyMarkup);
    return;
  }

  if (!isValidTelegramId(tgId)) {
    await sendMessage(chatId, getInvalidTelegramIdText(), replyMarkup);
    return;
  }

  await handleTelegramProfileById(chatId, tgId, replyMarkup);
}

async function handleTelegramProfileContact(chatId, user, message = {}, options = {}) {
  const replyMarkup = Object.hasOwn(options, "replyMarkup")
    ? options.replyMarkup
    : mainKeyboard(user);
  const contact = normalizeTelegramContact(message.contact);

  if (!contact.phoneNumber) {
    await sendMessage(chatId, getTelegramContactWithoutPhoneText(), replyMarkup);
    return;
  }

  if (!contact.userId) {
    await sendMessage(
      chatId,
      getTelegramProfileText(createTelegramPhoneLinkProfile(contact.phoneNumber, contact)),
      replyMarkup
    );
    return;
  }

  rememberPhoneProfile(contact.phoneNumber, createTelegramProfileFromContact(contact));
  void queueSupabasePhoneProfileTrack(contact);
  await handleTelegramProfileById(chatId, contact.userId, replyMarkup, {
    phoneNumber: contact.phoneNumber,
    fallbackProfile: createTelegramProfileFromContact(contact),
  });
}

async function handleTelegramPhoneProfileLookup(chatId, user, phoneNumber, options = {}) {
  const replyMarkup = Object.hasOwn(options, "replyMarkup")
    ? options.replyMarkup
    : mainKeyboard(user);

  void safeSendChatAction(chatId, "typing");

  const phoneProfile = await lookupTelegramProfileByPhone(phoneNumber);

  if (!phoneProfile.ok) {
    await sendMessage(
      chatId,
      getTelegramProfileText(createTelegramPhoneLinkProfile(phoneNumber)),
      replyMarkup
    );
    return;
  }

  await sendMessage(
    chatId,
    getTelegramProfileText({
      ...phoneProfile.data,
      phone_number: phoneNumber,
    }),
    replyMarkup
  );
}

async function handleTelegramProfileById(
  chatId,
  tgId,
  replyMarkup,
  { phoneNumber = "", fallbackProfile = null } = {}
) {
  void safeSendChatAction(chatId, "typing");

  const profile = await lookupTelegramProfile(tgId);

  if (!profile.ok) {
    if (fallbackProfile?.id) {
      await sendMessage(
        chatId,
        getTelegramProfileText({
          ...fallbackProfile,
          phone_number: phoneNumber,
        }),
        replyMarkup
      );
      return;
    }

    await sendMessage(
      chatId,
      getTelegramProfileFailedText(tgId, profile.reason),
      replyMarkup
    );
    return;
  }

  if (phoneNumber) {
    rememberPhoneProfile(phoneNumber, profile.data);
    void queueSupabasePhoneProfileTrack({
      phoneNumber,
      userId: profile.data?.id,
      first_name: profile.data?.first_name,
      last_name: profile.data?.last_name,
      username: profile.data?.username,
    });
  }

  await sendMessage(
    chatId,
    getTelegramProfileText({
      ...profile.data,
      phone_number: phoneNumber,
    }),
    replyMarkup
  );
}

async function handleBindInfoRequest(chatId, input, user = {}, options = {}) {
  const parsed = parseMlbbInput(input);
  const replyMarkup =
    Object.hasOwn(options, "replyMarkup") ? options.replyMarkup : resultKeyboard(user);
  let waitMessage = options.waitMessage || null;

  if (!parsed.ok) {
    await sendMessage(chatId, getInvalidBindInfoInputText(), replyMarkup);
    return;
  }

  void safeSendChatAction(chatId, "typing");

  if ((isZiteBindInfoProvider() || isBengkelBindInfoProvider()) && !options.skipWait) {
    const waitResponse = await safeSendMessage(chatId, getBindInfoWaitText(), replyMarkup);
    waitMessage = normalizeBindWaitMessage({
      chatId,
      messageId: waitResponse?.result?.message_id,
    });
  }

  const bindInfo = await lookupMlbbBindInfo(parsed.accountId, parsed.zoneId);

  if (!bindInfo.ok) {
    recordError("mlbb_bind_info_failed", bindInfo.technicalReason || bindInfo.reason, {
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
      status: bindInfo.status,
    });

    await sendMessage(chatId, getBindInfoFailedText(bindInfo.reason), replyMarkup);
    await safeDeleteBindWaitMessage(chatId, waitMessage);
    return;
  }

  await sendMessage(
    chatId,
    getBindInfoResultText({
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
      ...bindInfo.data,
    }),
    replyMarkup
  );
  await safeDeleteBindWaitMessage(chatId, waitMessage);
}

async function handleBroadcastConfirm(chatId, user, data) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
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

  const result = await broadcastMessage(pending.payload);

  await sendMessage(
    chatId,
    getBroadcastResultText(result),
    mainKeyboard(user)
  );
}

async function handleBroadcastCancel(chatId, user, data) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
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
      getInvalidMlbbInputText(),
      Object.hasOwn(options, "replyMarkup") ? options.replyMarkup : checkKeyboard(user)
    );

    return;
  }

  void safeSendChatAction(chatId, "typing");

  const lookup = await lookupMlbbAccount(parsed.accountId, parsed.zoneId);

  stats.checks += 1;
  stats.lastCheckAt = new Date().toISOString();

  if (!lookup.ok) {
    stats.failedChecks += 1;
    recordError("mlbb_lookup_failed", lookup.technicalReason || lookup.reason, {
      accountId: parsed.accountId,
      zoneId: parsed.zoneId,
      status: lookup.status,
    });

    await sendMessage(
      chatId,
      getFailedLookupText(parsed, lookup),
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

  await sendMessage(chatId, getResultText(result), replyMarkup);
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
        android: pickFirstValue(deviceRoot, ["android", "Android", "android_count"]),
        ios: pickFirstValue(deviceRoot, ["ios", "iOS", "IOS", "iphone", "ios_count"]),
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
    .replace(/[*_`~]/g, "")
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

async function lookupTelegramProfile(tgId) {
  try {
    const data = await telegram("getChat", {
      chat_id: tgId,
    });

    return {
      ok: true,
      data: data.result,
    };
  } catch (error) {
    return {
      ok: false,
      reason: normalizeTelegramError(error.message),
    };
  }
}

async function lookupTelegramProfileByPhone(phoneNumber) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  if (!normalizedPhone) {
    return {
      ok: false,
      reason: "phone_invalid",
    };
  }

  const runtimeProfile = getPhoneProfile(normalizedPhone);

  if (runtimeProfile?.id) {
    const profile = await lookupTelegramProfile(runtimeProfile.id);

    if (profile.ok) {
      rememberPhoneProfile(normalizedPhone, profile.data);
      void queueSupabasePhoneProfileTrack({
        phoneNumber: normalizedPhone,
        userId: profile.data?.id,
        first_name: profile.data?.first_name,
        last_name: profile.data?.last_name,
        username: profile.data?.username,
      });
      return profile;
    }

    return {
      ok: true,
      data: runtimeProfile,
    };
  }

  const supabaseProfile = await lookupSupabaseUserByPhone(normalizedPhone);

  if (supabaseProfile?.id) {
    const profile = await lookupTelegramProfile(supabaseProfile.id);

    if (profile.ok) {
      rememberPhoneProfile(normalizedPhone, profile.data);
      void queueSupabasePhoneProfileTrack({
        phoneNumber: normalizedPhone,
        userId: profile.data?.id,
        first_name: profile.data?.first_name,
        last_name: profile.data?.last_name,
        username: profile.data?.username,
      });
      return profile;
    }

    return {
      ok: true,
      data: supabaseProfile,
    };
  }

  return {
    ok: false,
    reason: "phone_not_found",
  };
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
  const raw = process.env.ADVANCED_SERVER_RANGES || "30000-39999,90000-99999";

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
  const text = String(input || "")
    .replace(/\u00A0/g, " ")
    .replace(/Account ID:/gi, "")
    .replace(/User ID:/gi, "")
    .replace(/Server ID:/gi, "")
    .replace(/Zone ID:/gi, "")
    .replace(/Zona:/gi, "")
    .trim();

  const withBrackets = text.match(/(\d{5,12})\s*[\(\[]\s*(\d{2,8})\s*[\)\]]/);

  if (withBrackets) {
    return validateParsedId(withBrackets[1], withBrackets[2]);
  }

  const numbers = text.match(/\d+/g) || [];

  if (numbers.length >= 2) {
    const accountId = numbers.find((num) => num.length >= 5 && num.length <= 12);
    const accountIndex = numbers.indexOf(accountId);

    const zoneId = numbers.find((num, index) => {
      return index > accountIndex && num.length >= 2 && num.length <= 8;
    });

    return validateParsedId(accountId, zoneId);
  }

  return {
    ok: false,
    reason: "Account ID va Server/Zone ID topilmadi",
  };
}

function extractTelegramId(text) {
  const commandless = String(text || "")
    .replace(/^\/(?:tg|user|profile)(@\w+)?/i, "")
    .replace(/\u00A0/g, " ")
    .trim();
  const match = commandless.match(/-?\d{5,20}/);

  return match ? match[0] : "";
}

function extractTelegramPhoneNumber(text) {
  const commandless = stripTelegramProfileCommand(text);

  return normalizePhoneNumber(commandless);
}

function stripTelegramProfileCommand(text) {
  return String(text || "")
    .replace(/^\/(?:tg|user|profile)(@\w+)?/i, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

function normalizePhoneNumber(value) {
  const rawText = String(value || "").replace(/\u00A0/g, " ").trim();

  if (!rawText) {
    return "";
  }

  const text = rawText.replace(/^(?:phone|telefon|tel)\s*[:=]\s*/i, "");
  const hasExplicitPhoneSignal =
    /^\+/.test(text) ||
    /^00\d/.test(text) ||
    /^(?:phone|telefon|tel)\s*[:=]/i.test(rawText) ||
    /^tel:/i.test(text) ||
    /[\s().-]/.test(text);
  let digits = text.replace(/^tel:/i, "").replace(/[^\d]/g, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (!/^\d{7,15}$/.test(digits)) {
    return "";
  }

  if (!hasExplicitPhoneSignal && !digits.startsWith("998")) {
    return "";
  }

  return digits;
}

function formatPhoneNumber(value) {
  const phoneNumber = normalizePhoneNumber(value);

  return phoneNumber ? `+${phoneNumber}` : "";
}

function maskPhoneNumber(value) {
  const phoneNumber = normalizePhoneNumber(value);

  if (!phoneNumber) {
    return "";
  }

  if (phoneNumber.length <= 6) {
    return `+${"*".repeat(phoneNumber.length)}`;
  }

  const left = phoneNumber.slice(0, Math.min(5, phoneNumber.length - 2));
  const right = phoneNumber.slice(-2);
  const hiddenLength = Math.max(2, phoneNumber.length - left.length - right.length);

  return `+${left}${"*".repeat(hiddenLength)}${right}`;
}

function getTelegramPhoneProfileLink(value) {
  const phoneNumber = normalizePhoneNumber(value);

  return phoneNumber ? `tg://resolve?phone=${phoneNumber}` : "";
}

function isValidTelegramId(tgId) {
  return /^-?\d{5,20}$/.test(String(tgId || ""));
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

  if (!/^\d{2,8}$/.test(zoneId)) {
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
  const adminIds = ADMIN_IDS.map(String);
  const text = getAdminFeedbackText(feedback);
  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    adminIds.map((adminId) => sendMessage(adminId, text, null))
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sent += 1;
      return;
    }

    failed += 1;
    console.error("[FEEDBACK_ADMIN_SEND_ERROR]", result.reason);
    recordError("feedback_admin_send_failed", result.reason?.message || String(result.reason), {
      adminId: adminIds[index],
      feedbackId: feedback.id,
    });
  });

  return {
    total: adminIds.length,
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

function createFeedbackAdminReplyPayload(message = {}) {
  const replyText = getFeedbackMessageText(message);

  if (!replyText) {
    if (hasCopyableMessageContent(message)) {
      return { kind: "copy" };
    }

    return null;
  }

  const prefix = "👮 Admin javobi:\n\n";
  const sourceEntities = message.text ? message.entities : message.caption_entities;

  return {
    kind: "text",
    text: `${prefix}${replyText}`,
    entities: [
      {
        type: "bold",
        offset: 3,
        length: "Admin javobi".length,
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
  const name = escapeHtml(user.first_name || "do‘stim");

  return [
    `Salom, <b>${name}</b>! 👋`,
    "",
    "MLBB Account ID va Server/Zone ID yuboring, men serverini aniqlab beraman.",
    "TG ID yoki oldin yuborilgan kontakt telefoni orqali Telegram profil ma’lumotlarini ham tekshirishingiz mumkin.",
    "",
    "Ko‘p ishlatiladigan funksiyalar pastdagi klaviaturada.",
  ].join("\n");
}

function getCheckPromptText() {
  return [
    "🔎 <b>Server aniqlash</b>",
    "",
    "Iltimos, MLBB <b>Account ID</b> va <b>Server/Zone ID</b> ni yuboring.",
    "",
    "<b>Namuna:</b>",
    "1289050 (10050)",
    "/check 1289050 (10050)",
    "",
    "📌 Faqat Account ID yuborilsa, serverni aniq topib bo‘lmaydi.",
  ].join("\n");
}

function getResultText(result) {
  return [
    "🔍 <b>Server Aniqlash Natijasi</b>",
    "",
    `🆔 <b>Account ID:</b> <code>${escapeHtml(result.accountId)}</code>`,
    `🌐 <b>Server / Zone ID:</b> <code>${escapeHtml(result.zoneId)}</code>`,
    `🖥 <b>Server turi:</b> <b>${escapeHtml(result.serverType)}</b>`,
    result.region ? `📍 <b>Region:</b> ${escapeHtml(result.region)}` : "📍 <b>Region:</b> API qaytarmadi",
    `👤 <b>Nickname:</b> ${escapeHtml(result.nickname)}`,
    `✅ <b>Holat:</b> ${escapeHtml(result.status)}`,
  ].join("\n");
}

function getFailedLookupText(parsed) {
  return [
    "❌ <b>Profil topilmadi.</b>",
    "Foydalanuvchi yoki server topilmadi.",
  ].join("\n");
}

function getInvalidMlbbInputText() {
  return "Server topilmadi. Account ID va Server/Zone ID ni tekshirib qayta yuboring.";
}

function getHelpText(user = {}) {
  return [
    "ℹ️ <b>Yordam</b>",
    "",
    "<b>1. MLBB server aniqlash</b>",
    "Account ID va Server/Zone ID ni yuboring. Bot profilni MLBB official serveri orqali aniqlaydi.",
    "",
    "<b>Formatlar:</b>",
    "<code>1289050 (10050)</code>",
    "<code>1289050 10050</code>",
    "<code>/check 1289050 10050</code>",
    "",
    "<b>2. Telegram profil topish</b>",
    "TG ID orqali bot ko‘ra oladigan profil ma’lumotlarini chiqaradi. Telefon yuborilsa, saqlangan profil topiladi yoki Telegram clientda ochish linki beriladi.",
    "<code>/tg 5081175125</code>",
    "<code>/tg +998901234567</code>",
    "<code>/user 5081175125</code>",
    "<code>/profile 5081175125</code>",
    "",
    "<b>3. Klaviatura</b>",
    "Pastdagi tugmalar orqali asosiy funksiyalarni command yozmasdan ishlatishingiz mumkin.",
    "",
    "<b>4. Cheklovlar</b>",
    "Faqat Account ID yuborilsa, MLBB serverini aniq topib bo‘lmaydi. TG profil lookup esa Telegram botga ko‘rinadigan public ma’lumotlargina qaytaradi; telefon linkining ochilishi Telegram client va user privacy sozlamalariga bog‘liq.",
    "",
    getCommandsText(user),
    "",
    `Aloqa: @${escapeHtml(SUPPORT_USERNAME)}`,
  ].join("\n");
}

function getCommandsText(user = {}) {
  const commands = [
    "📋 <b>Buyruqlar</b>",
    "",
    "<code>/start</code> — botni ishga tushirish va klaviaturani chiqarish",
    "<code>/help</code> — batafsil yordam",
    "<code>/commands</code> — barcha buyruqlar ro‘yxati",
    "<code>/check 1289050 10050</code> — MLBB server/profil tekshirish",
    "<code>/info 1006613098 13019</code> yoki <code>/bind</code> — akkaunt ulanmalarini tekshirish",
    "<code>/tg 5081175125</code> — Telegram ID orqali profil topish",
    "<code>/tg +998901234567</code> — botga oldin yuborilgan kontakt telefoni orqali profil topish",
    "<code>/user 5081175125</code> — /tg bilan bir xil",
    "<code>/profile 5081175125</code> — /tg bilan bir xil",
    "<code>/feedback</code> yoki <code>/fikr</code> — taklif yoki shikoyat yuborish",
  ];

  if (isAdmin(user.id)) {
    commands.push(
      "",
      "<b>Admin buyruqlari:</b>",
      "<code>/stats</code> yoki <code>/stat</code> — bot statistikasi",
      "<code>/users</code> — barcha saqlangan foydalanuvchilar ro‘yxati",
      "<code>/errors</code> — bot xatoliklari",
      "<code>/emoji</code> — premium/custom emoji ID larini chiqarish",
      "<code>/message Matn</code> — barcha userlarga tasdiq bilan xabar yuborish"
    );
  }

  return commands.join("\n");
}

function getTelegramProfilePromptText() {
  return [
    "👤 <b>TG profil topish</b>",
    "",
    "Telegram ID yoki oldin botga yuborilgan kontakt telefonini yuboring:",
    "<code>/tg 5081175125</code>",
    "<code>/tg +998901234567</code>",
    "",
    "Telefon saqlangan bo‘lsa profil ma’lumoti chiqadi, aks holda Telegram clientda ochish linki beriladi.",
    "Eslatma: telefon linkining ochilishi Telegram client va user privacy sozlamalariga bog‘liq.",
  ].join("\n");
}

function getInvalidTelegramIdText() {
  return "Foydalanuvchi topilmadi. TG ID ni tekshirib qayta yuboring.";
}

function getTelegramContactWithoutPhoneText() {
  return "Kontakt ichida telefon raqam topilmadi. Iltimos, telefon raqami bor kontakt yuboring.";
}

function getTelegramPhoneProfileUnavailableText(phoneNumber) {
  return [
    "Bu kontaktda Telegram user_id ko‘rinmadi.",
    `Telefon: <code>${escapeHtml(formatPhoneNumber(phoneNumber))}</code>`,
    "",
    "Telegram botlar user_id bo‘lmagan kontaktni profilga aylantira olmaydi.",
  ].join("\n");
}

function getTelegramPhoneProfileNotFoundText(phoneNumber) {
  return [
    "Bu telefon bo‘yicha saqlangan Telegram profil topilmadi.",
    `Telefon: <code>${escapeHtml(formatPhoneNumber(phoneNumber))}</code>`,
    "",
    "Raqamdan topish uchun avval shu kontaktni botga yuboring. Kontakt ichida Telegram user_id bo‘lsa, keyingi safar raqam orqali ham ishlaydi.",
  ].join("\n");
}

function createTelegramPhoneLinkProfile(phoneNumber, contact = {}) {
  return {
    id: "",
    type: "private",
    first_name: contact.first_name || "",
    last_name: contact.last_name || "",
    phone_number: phoneNumber,
  };
}

function getTelegramProfileText(profile) {
  const id = String(profile.id || "");
  const name = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const username = profile.username ? `@${profile.username}` : "Yo‘q";
  const title = profile.title ? escapeHtml(profile.title) : null;
  const bio = profile.bio || profile.description;
  const phoneLink = profile.phone_number
    ? getTelegramPhoneProfileLink(profile.phone_number)
    : "";

  return [
    "👤 <b>Telegram profil</b>",
    "",
    id ? `🆔 <b>ID:</b> <code>${escapeHtml(id)}</code>` : "",
    name ? `👤 <b>Ism:</b> ${escapeHtml(name)}` : "",
    title ? `🏷 <b>Nomi:</b> ${title}` : "",
    profile.phone_number
      ? `📱 <b>Telefon:</b> <code>${escapeHtml(maskPhoneNumber(profile.phone_number))}</code>`
      : "",
    `🔗 <b>Username:</b> ${escapeHtml(username)}`,
    profile.type ? `📌 <b>Turi:</b> ${escapeHtml(profile.type)}` : "",
    profile.username
      ? `🌐 <b>Link:</b> https://t.me/${escapeHtml(profile.username)}`
      : id
        ? `🌐 <b>Link:</b> <a href="tg://user?id=${escapeHtml(id)}">profilni ochish</a>`
        : phoneLink
          ? `🌐 <b>Link:</b> <a href="${escapeHtml(phoneLink)}">profilni ochish</a>`
          : "",
    bio ? `📝 <b>Bio:</b> ${escapeHtml(clipText(String(bio), 500))}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getTelegramProfileFailedText(tgId) {
  return "Foydalanuvchi topilmadi.";
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

function getInvalidBindInfoInputText() {
  return "Ulanmalar topilmadi. Account ID va Server/Zone ID ni tekshirib qayta yuboring.";
}

function getBindInfoFailedText(reason = "") {
  if (reason === "bengkel_bridge_not_configured") {
    return [
      "Bengkel bot orqali ulanmalarni tekshirish uchun bridge endpoint sozlanmagan.",
      "Adminlarga xatolik yozib qo‘yildi, sozlama yangilangandan keyin qayta urinib ko‘ring.",
    ].join("\n");
  }

  if (/Bengkel bot javobidan ulanmalar/i.test(reason)) {
    return [
      "Bengkel bot javobidan ulanmalar ma’lumotini o‘qib bo‘lmadi.",
      "Iltimos, ID va Server/Zone ID ni tekshirib qayta yuboring.",
    ].join("\n");
  }

  if (/ulanmalar ma’lumotini qaytarmadi|ulanmalar ma'lumotini qaytarmadi/i.test(reason)) {
    return [
      "Ulanmalar ma’lumotini olish imkoni bo‘lmadi.",
      "Provider bu akkaunt uchun linked-account ma’lumotini qaytarmadi.",
    ].join("\n");
  }

  if (reason === "bind_info_provider_auth_required") {
    return [
      "Ulanmalar provideriga ulanish uchun avtorizatsiya kerak.",
      "Adminlarga xatolik yozib qo‘yildi, sozlama yangilangandan keyin qayta urinib ko‘ring.",
    ].join("\n");
  }

  if (
    reason === "bind_info_provider_not_found" ||
    reason === "bind_info_provider_html_response"
  ) {
    return [
      "Ulanmalar provider manzili ishlamayapti yoki o‘zgargan.",
      "Adminlarga xatolik yozib qo‘yildi, birozdan keyin qayta urinib ko‘ring.",
    ].join("\n");
  }

  if (reason === "bind_info_provider_timeout") {
    return [
      "Ulanmalar provideri sekin javob berdi.",
      "Iltimos, birozdan keyin qayta urinib ko‘ring.",
    ].join("\n");
  }

  if (
    reason === "bind_info_provider_unavailable" ||
    reason === "bind_info_provider_rate_limited"
  ) {
    return [
      "Ulanmalar provideri vaqtincha javob bermayapti.",
      "Iltimos, birozdan keyin qayta urinib ko‘ring.",
    ].join("\n");
  }

  return [
    "Ma’lumot olish uchun bazadan javob olib bo‘lmadi.",
    "Iltimos, birozdan keyin qayta urinib ko‘ring.",
  ].join("\n");
}

function getBindInfoWaitText() {
  return [
    "⏳ <b>Ulanmalar tekshirilmoqda...</b>",
    "",
    "Iltimos, kutib turing. Bu biroz vaqt olishi mumkin.",
  ].join("\n");
}

function getBindInfoResultText(result = {}) {
  const bindings = result.bindings || {};
  const deviceLogin = result.deviceLogin || {};
  const hasDeviceLogin = MLBB_BIND_INFO_SHOW_DEVICES && hasDeviceLoginData(deviceLogin);

  return [
    "🔗 <b>Ulanmalar</b>",
    "",
    `🆔 <b>ID:</b> <code>${escapeHtml(result.accountId)}</code>`,
    `🌐 <b>Server:</b> <code>${escapeHtml(result.zoneId)}</code>`,
    `📧 <b>Moonton:</b> ${escapeHtml(maskSensitiveValue(bindings.moonton))}`,
    `🔵 <b>VK:</b> ${escapeHtml(maskSensitiveValue(bindings.vk))}`,
    `🎮 <b>Google Play:</b> ${escapeHtml(maskSensitiveValue(bindings.googlePlay))}`,
    `🎵 <b>TikTok:</b> ${escapeHtml(maskSensitiveValue(bindings.tiktok))}`,
    `${bindProviderEmoji("facebook", "📘")} <b>Facebook:</b> ${escapeHtml(
      maskSensitiveValue(bindings.facebook)
    )}`,
    `🍎 <b>Apple:</b> ${escapeHtml(maskSensitiveValue(bindings.apple))}`,
    `🕹 <b>GCID:</b> ${escapeHtml(maskSensitiveValue(bindings.gcid))}`,
    `✈️ <b>Telegram:</b> ${escapeHtml(maskSensitiveValue(bindings.telegram))}`,
    `🟢 <b>WhatsApp:</b> ${escapeHtml(maskSensitiveValue(bindings.whatsapp))}`,
    "",
    hasDeviceLogin
      ? `📱 <b>Device Login</b> 🤖 Android: <b>${escapeHtml(formatDeviceLoginCount(deviceLogin.android))}</b> | 🍎 iOS: <b>${escapeHtml(formatDeviceLoginCount(deviceLogin.ios))}</b>`
      : "",
  ]
    .filter((line, index, lines) => line || lines[index + 1])
    .join("\n");
}

function getFeedbackPromptText() {
  return [
    "💬 <b>Fikr va izohlar</b>",
    "",
    "Botga kerakli funksiya, taklif yoki shikoyatingizni yozib yuboring.",
    "Xabaringiz adminlarga yetkaziladi. Admin javob bersa, javobi bot orqali sizga keladi.",
    "",
    "Bekor qilish uchun /cancel buyrug'ini bosing.",
  ].join("\n");
}

function getFeedbackTextRequiredText() {
  return [
    "Fikr yoki izoh matn ko‘rinishida bo‘lishi kerak.",
    "Iltimos, taklif yoki shikoyatingizni yozib yuboring.",
  ].join("\n");
}

function getFeedbackTooLongText() {
  return `Fikr juda uzun. Iltimos, ${FEEDBACK_MAX_LENGTH} belgidan qisqaroq yozing.`;
}

function getFeedbackThanksText(result = {}) {
  const delivered = Number(result.sent || 0);

  return [
    "✅ <b>Fikringiz yuborildi.</b>",
    "",
    delivered
      ? "Adminlar ko‘rib chiqadi. Javob berilsa, bot orqali sizga yuboriladi."
      : "Hozir adminlarga yetkazishda xatolik bo‘ldi. Iltimos, birozdan keyin qayta urinib ko‘ring.",
  ].join("\n");
}

function getAdminFeedbackText(feedback) {
  const user = feedback.user || {};
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const username = user.username ? `@${user.username}` : "";
  const displayName = [fullName, username].filter(Boolean).join(" ") || "-";

  return [
    "💬 <b>Yangi fikr yoki izoh</b>",
    "",
    `Feedback ID: <code>${escapeHtml(feedback.id)}</code>`,
    `User ID: <code>${escapeHtml(feedback.userId)}</code>`,
    `Chat ID: <code>${escapeHtml(feedback.chatId)}</code>`,
    `User: ${escapeHtml(displayName)}`,
    `Vaqt: ${formatDate(feedback.createdAt)}`,
    "",
    "<b>Xabar:</b>",
    escapeHtml(feedback.text),
    "",
    "Shu xabarga reply qilib javob berishingiz mumkin.",
  ].join("\n");
}

function getFeedbackReplySentText(target) {
  return [
    "✅ Javob userga yuborildi.",
    "",
    `User ID: <code>${escapeHtml(target.userId)}</code>`,
    target.feedbackId ? `Feedback ID: <code>${escapeHtml(target.feedbackId)}</code>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getFeedbackAdminReplyTextRequiredText() {
  return "Userga yuboriladigan javob matn ko‘rinishida bo‘lishi kerak.";
}

function getFeedbackReplyFailedText(target, reason) {
  return [
    "❌ Javobni userga yuborib bo‘lmadi.",
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

function getStatsText(dbStats = null) {
  const todayLines = getStatsTodayUserLines(dbStats);
  const monthlyLines = getStatsMonthlyLines(dbStats);
  const totalUsers = getDisplayTotalUsers(dbStats);
  const todayTotal = getDisplayTodayTotal(dbStats);

  return [
    "📊 <b>Bot statistikasi</b>",
    "",
    `👥 <b>Jami foydalanuvchilar:</b> ${totalUsers}`,
    `🟢 <b>Bugun foydalanganlar:</b> ${todayTotal}`,
    `📣 <b>Broadcast chatlar:</b> ${stats.broadcastChats.size}`,
    `⏳ <b>Kutilayotgan broadcast:</b> ${stats.pendingBroadcasts.size}`,
    `🚀 <b>/start:</b> ${stats.starts}`,
    `🔎 <b>Jami tekshiruv:</b> ${stats.checks}`,
    `✅ <b>Muvaffaqiyatli:</b> ${stats.successChecks}`,
    `❌ <b>MLBB tekshiruv xatolari:</b> ${stats.failedChecks}`,
    `🕒 <b>Ishga tushgan:</b> ${formatDate(stats.startedAt)}`,
    stats.lastCheckAt ? `✅ <b>Oxirgi tekshiruv:</b> ${formatDate(stats.lastCheckAt)}` : "",
    "",
    "<b>Bugun botdan foydalanganlar:</b>",
    ...todayLines,
    "",
    "<b>Oylik aktiv userlar:</b>",
    ...monthlyLines,
    "",
    "Xatoliklar alohida admin tugmasiga ko‘chirildi: <b>⚠️ Xatoliklar</b>.",
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

function getUsersListText(pageData = {}, syncResult = null) {
  const users = Array.isArray(pageData.users) ? pageData.users : [];
  const total = Number(pageData.total || 0);
  const page = Number(pageData.page || 0);
  const pageSize = Number(pageData.pageSize || USERS_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const sourceText = pageData.source === "runtime" ? "lokal xotira" : "Supabase";
  const lines = users.length
    ? users.map((user, index) => formatUserLine(user, page, pageSize, index))
    : [pageData.error ? "Foydalanuvchilarni o‘qib bo‘lmadi." : "User topilmadi."];
  const syncLine =
    syncResult?.attempted && !syncResult.skipped
      ? `🔄 <b>Known user sync:</b> ${syncResult.saved}/${syncResult.total} yuborildi`
      : "";

  return [
    "👥 <b>Bot foydalanuvchilari</b>",
    "",
    `Jami: <b>${total}</b>`,
    `Sahifa: <b>${page + 1}/${totalPages}</b>`,
    `Manba: <b>${escapeHtml(sourceText)}</b>`,
    syncLine,
    pageData.configError ? `Supabase sozlamasi: ${escapeHtml(pageData.configError)}` : "",
    pageData.error && !pageData.configError ? "Supabase o‘qishda xatolik bor." : "",
    "",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}

function getStatsMonthlyLines(dbStats = null) {
  if (Array.isArray(dbStats?.monthly) && dbStats.monthly.length) {
    return dbStats.monthly.map((row) => {
      const month = formatMonth(row.month);
      const users = Number(row.active_users || 0);
      const updates = Number(row.updates || 0);

      return `${escapeHtml(month)}: <b>${users}</b> user, ${updates} update`;
    });
  }

  if (dbStats?.configError) {
    return [`Supabase sozlamasi: ${escapeHtml(dbStats.configError)}`];
  }

  if (dbStats?.error) {
    return ["Supabase o‘qishda xatolik bor, oylik statistika vaqtincha olinmadi."];
  }

  if (!isSupabaseConfigured()) {
    return [`Supabase ulanmagan. Joriy runtime: <b>${stats.users.size}</b> user.`];
  }

  return ["Hali oylik aktivlik qayd etilmagan."];
}

function getErrorsText() {
  return [
    "⚠️ <b>Bot xatoliklari</b>",
    "",
    "<b>Xatolik turlari:</b>",
    ...getErrorCountLines(),
    "",
    "<b>Oxirgi xatoliklar:</b>",
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

function getUnknownText() {
  return [
    "Men siz yuborgan xabarni tushunmadim 🙂",
    "",
    "Serverni aniqlash uchun quyidagi formatda yuboring:",
    "1289050 (10050)",
    "Yoki pastdagi tugmalardan foydalaning.",
  ].join("\n");
}

function getAdminOnlyText() {
  return "Bu bo‘lim faqat adminlar uchun!";
}

function getErrorText() {
  return [
    "Kutilmagan xatolik bo‘ldi, lekin men ishlayapman.",
    "",
    "Iltimos, ID’ni yana shu formatda yuboring:",
    "1289050 (10050)",
  ].join("\n");
}

function getBroadcastUsageText() {
  return [
    "📣 <b>Umumiy xabar yuborish</b>",
    "",
    "Format:",
    "<code>/message Sizning xabaringiz</code>",
    "",
    "Formatlangan text, premium emoji va linklar saqlanadi.",
    "Sticker/media yuborish uchun o‘sha xabarga reply qilib <code>/message</code> yozing.",
    "",
    "Keyingi qadamda tasdiqlash tugmasi chiqadi.",
  ].join("\n");
}

function getBroadcastTooLongText() {
  return "Xabar juda uzun. Iltimos, 3500 belgidan qisqaroq matn yuboring.";
}

function getBroadcastExpiredText() {
  return "Bu tasdiqlash eskirgan yoki topilmadi. /message orqali qaytadan boshlang.";
}

function getBroadcastConfirmText(payload, recipientCount = stats.broadcastChats.size) {
  const preview =
    typeof payload === "string"
      ? payload
      : payload?.previewText || payload?.text || "Reply qilingan xabar";

  return [
    "📣 <b>Hamma foydalanuvchilarga yuborilsinmi?</b>",
    "Hali hech kimga yuborilmadi. Yuborish faqat pastdagi tasdiq tugmasidan keyin boshlanadi.",
    "",
    `Qabul qiluvchilar: <b>${recipientCount}</b>`,
    "",
    "<b>Xabar:</b>",
    escapeHtml(clipText(preview, 900)),
  ].join("\n");
}

function getBroadcastResultText(result) {
  return [
    "📣 <b>Yuborish yakunlandi</b>",
    "",
    `Jami: <b>${result.total}</b>`,
    `Yuborildi: <b>${result.sent}</b>`,
    `Xato: <b>${result.failed}</b>`,
  ].join("\n");
}

function mainKeyboard(user = {}) {
  const keyboard = [
    [{ text: BUTTON_BIND_INFO }],
    [{ text: BUTTON_CHECK }, { text: BUTTON_TG_PROFILE }],
    [{ text: BUTTON_FEEDBACK }],
    [{ text: BUTTON_COMMANDS }, { text: BUTTON_HELP }],
  ];

  if (isAdmin(user.id)) {
    keyboard.splice(
      1,
      0,
      [{ text: BUTTON_STATS }, { text: BUTTON_USERS }],
      [{ text: BUTTON_ERRORS }, { text: BUTTON_BROADCAST }]
    );
  }

  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
  };
}

function telegramProfileKeyboard(user = {}) {
  const keyboard = [
    [{ text: "📱 Kontakt yuborish", request_contact: true }],
    ...mainKeyboard(user).keyboard,
  ];

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

function broadcastConfirmKeyboard(broadcastId, confirmToken) {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Tasdiqlash",
          callback_data: `broadcast_confirm:${broadcastId}:${confirmToken}`,
        },
        {
          text: "❌ Bekor qilish",
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
  });
}

function usersPaginationKeyboard(pageData = {}) {
  return paginationKeyboard("users_page", {
    page: pageData.page || 0,
    pageSize: pageData.pageSize || USERS_PAGE_SIZE,
    total: pageData.total || 0,
  });
}

function errorsRefreshKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔄 Yangilash",
          callback_data: "errors",
        },
      ],
    ],
  };
}

function feedbackForceReply() {
  return {
    force_reply: true,
    selective: true,
    input_field_placeholder: "Fikringizni yozing...",
  };
}

function bindInfoForceReply() {
  return {
    force_reply: true,
    selective: true,
    input_field_placeholder: "1006613098 (13019)",
  };
}

function paginationKeyboard(prefix, { page = 0, pageSize = USERS_PAGE_SIZE, total = 0 } = {}) {
  const safePage = Math.max(0, Number(page) || 0);
  const safePageSize = Math.max(1, Number(pageSize) || USERS_PAGE_SIZE);
  const safeTotal = Math.max(0, Number(total) || 0);
  const buttons = [];

  if (safePage > 0) {
    buttons.push({
      text: "⬅️ Oldingi 10",
      callback_data: `${prefix}:${safePage - 1}`,
    });
  }

  if ((safePage + 1) * safePageSize < safeTotal) {
    buttons.push({
      text: "Keyingi 10 ➡️",
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
    disable_web_page_preview: true,
  };

  if (
    Array.isArray(options.entities) &&
    options.entities.length &&
    safeText === outgoingText
  ) {
    payload.entities = options.entities;
  } else if (!options.plain) {
    payload.parse_mode = "HTML";
  }

  if (replyMarkup) {
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
    (value, [emoji, emojiId]) =>
      value.split(emoji).join(telegramEmoji(emoji, emojiId)),
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

function isTelegramProfileCommand(text) {
  return (
    isCommand(text, "tg") ||
    isCommand(text, "user") ||
    isCommand(text, "profile")
  );
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

function stripCommand(text, command) {
  return String(text || "")
    .replace(new RegExp(`^\\/${command}(?:@\\w+)?`, "i"), "")
    .trim();
}

function isBareTelegramIdInput(text) {
  return /^-?\d{5,20}$/.test(String(text || "").trim());
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
      "tg",
      "user",
      "profile",
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
      "tg",
      "user",
      "profile",
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

  if (!text || isCommandLike(text) || isKeyboardButton(text, BUTTON_FEEDBACK)) {
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

function isTruthyEnv(value) {
  return /^(?:1|true|yes|on)$/i.test(cleanEnv(value));
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
      updates_count: Number(previous.updates_count || 0) + (updateMeta.updateType ? 1 : 0),
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

function normalizeTelegramContact(contact = {}) {
  const phoneNumber = normalizePhoneNumber(contact.phone_number);
  const userId = toTelegramChatId(contact.user_id);

  return {
    phoneNumber,
    userId,
    first_name: cleanTextValue(contact.first_name, 128),
    last_name: cleanTextValue(contact.last_name, 128),
  };
}

function createTelegramProfileFromContact(contact = {}) {
  return {
    id: contact.userId || "",
    type: contact.userId ? "private" : "",
    first_name: contact.first_name || "",
    last_name: contact.last_name || "",
    phone_number: contact.phoneNumber || "",
  };
}

function rememberPhoneProfile(phoneNumber, profile = {}) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const userId = toTelegramChatId(profile.id || profile.user_id || profile.userId);

  if (!normalizedPhone || !userId) {
    return;
  }

  const previous = stats.phoneProfiles.get(normalizedPhone) || {};
  const now = new Date().toISOString();

  stats.phoneProfiles.set(normalizedPhone, {
    ...previous,
    phone_number: normalizedPhone,
    id: userId,
    user_id: userId,
    type: profile.type || previous.type || "private",
    username: cleanTextValue(profile.username, 64) ?? previous.username ?? null,
    first_name: cleanTextValue(profile.first_name, 128) ?? previous.first_name ?? null,
    last_name: cleanTextValue(profile.last_name, 128) ?? previous.last_name ?? null,
    last_seen_at: now,
  });
}

function getPhoneProfile(phoneNumber) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  if (!normalizedPhone) {
    return null;
  }

  const profile = stats.phoneProfiles.get(normalizedPhone);

  if (!profile?.id) {
    return null;
  }

  return {
    ...profile,
    phone_number: normalizedPhone,
  };
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

async function queueSupabasePhoneProfileTrack(contact = {}) {
  if (getSupabaseConfigError() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }

  const userId = toPgBigint(contact.userId);
  const phoneNumber = normalizePhoneNumber(contact.phoneNumber);

  if (!userId || !phoneNumber || userId.startsWith("-")) {
    return;
  }

  try {
    await supabaseRpc(
      "track_bot_user",
      {
        p_user_id: userId,
        p_chat_id: userId,
        p_chat_type: "private",
        p_username: cleanTextValue(contact.username, 64),
        p_first_name: cleanTextValue(contact.first_name, 128),
        p_last_name: cleanTextValue(contact.last_name, 128),
        p_language_code: null,
        p_is_bot: null,
        p_update_id: null,
        p_update_type: null,
        p_message_text: null,
        p_phone_number: phoneNumber,
      },
      {
        prefer: "return=minimal",
      }
    );
  } catch (error) {
    console.error("[SUPABASE_PHONE_TRACK_ERROR]", error);
    recordError("supabase_phone_track_failed", error.message, {
      userId,
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

async function lookupSupabaseUserByPhone(phoneNumber) {
  if (!isSupabaseConfigured() || isSupabaseAuthTemporarilyDisabled()) {
    return null;
  }

  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  if (!normalizedPhone) {
    return null;
  }

  try {
    const rows = await supabaseRpc("find_bot_user_by_phone", {
      p_phone_number: normalizedPhone,
    });
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row?.user_id) {
      return null;
    }

    return createTelegramProfileFromSupabaseUser(row);
  } catch (error) {
    console.error("[SUPABASE_PHONE_LOOKUP_ERROR]", error);
    recordError("supabase_phone_lookup_failed", error.message);
    return null;
  }
}

function createTelegramProfileFromSupabaseUser(row = {}) {
  const id = toTelegramChatId(row.user_id);

  if (!id) {
    return null;
  }

  return {
    id,
    user_id: id,
    type: row.chat_type || "private",
    username: row.username || "",
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    phone_number: row.phone_number || "",
  };
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

module.exports.__private = {
  buildBengkelBindInfoRequest,
  buildBindInfoRequest,
  broadcastMessage,
  buildSupabaseTrackPayload,
  detectServerType,
  extractTelegramId,
  extractTelegramPhoneNumber,
  enrichPremiumEmojis,
  formatPhoneNumber,
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
  getTelegramProfileText,
  getUsersListText,
  isSupabaseConfigured,
  mainKeyboard,
  normalizeSecretEnv,
  parseContentRangeTotal,
  isValidWebhookSecret,
  isAdmin,
  isKeyboardButton,
  isValidTelegramId,
  lookupMlbbBindInfo,
  lookupTelegramProfileByPhone,
  maskPhoneNumber,
  normalizeBengkelBindInfoResponse,
  normalizePhoneNumber,
  normalizeLookupResponse,
  normalizeBindInfoResponse,
  parseBengkelBindInfoText,
  parseIdList,
  parseAdvancedRanges,
  parseMlbbInput,
  parseRequestBody,
  resolveSupabaseConfig,
  sanitizeTelegramText,
  sanitizeTelegramUsername,
  trackUser,
  validateSupabaseServiceKey,
};
