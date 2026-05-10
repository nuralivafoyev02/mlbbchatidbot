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
const BUTTON_STATS = "📊 Statistika";
const BUTTON_BROADCAST = "📣 Xabar yuborish";
const BUTTON_COMMANDS = "📋 Buyruqlar";
const BUTTON_HELP = "ℹ️ Yordam";
const BUTTON_MENU = "🏠 Menyu";
const BUTTON_CHECK_AGAIN = "🔍 Yana tekshirish";

const MLBB_LOOKUP_API_URL =
  process.env.MLBB_LOOKUP_API_URL || "https://api.isan.eu.org/nickname/ml";
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
const SUPABASE_USER_LIST_LIMIT = parseBoundedNumber(
  process.env.SUPABASE_USER_LIST_LIMIT,
  10,
  1,
  25
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
    errors: [],
    errorCounts: {},
    startedAt: new Date().toISOString(),
    lastCheckAt: null,
    supabaseAuthDisabledUntil: 0,
    supabaseLastAuthError: null,
  };
}

const stats = global.__MLBB_BOT_STATS__;
stats.users ||= new Set();
stats.broadcastChats ||= new Set();
stats.pendingBroadcasts ||= new Map();
stats.errors ||= [];
stats.errorCounts ||= {};
stats.supabaseAuthDisabledUntil ||= 0;
stats.supabaseLastAuthError ||= null;
BROADCAST_USER_IDS.forEach((chatId) => stats.broadcastChats.add(chatId));

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

  trackUser(user, message.chat, {
    ...updateMeta,
  });

  if (isGroupChat(message.chat)) {
    const addressing = getGroupAddressing(message);

    if (!addressing.addressed) {
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

    await sendMessage(chatId, await getStatsTextAsync(), mainKeyboard(user));
    return;
  }

  if (isCommand(text, "message")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getUnknownText(), mainKeyboard(user));
      return;
    }

    await handleMessageCommand(chatId, user, message);
    return;
  }

  if (isCommand(text, "tg") || isCommand(text, "user") || isCommand(text, "profile")) {
    await handleTelegramProfileCommand(chatId, user, text);
    return;
  }

  if (isCommand(text, "check")) {
    const input = text.replace(/^\/check(@\w+)?/i, "").trim();

    if (!input) {
      await sendMessage(chatId, getCheckPromptText(), checkKeyboard(user));
      return;
    }

    await detectAndReply(chatId, input, user);
    return;
  }

  if (isKeyboardButton(text, BUTTON_CHECK, BUTTON_CHECK_AGAIN)) {
    await sendMessage(chatId, getCheckPromptText(), mainKeyboard(user));
    return;
  }

  if (isKeyboardButton(text, BUTTON_TG_PROFILE)) {
    await sendMessage(chatId, getTelegramProfilePromptText(), mainKeyboard(user));
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

    await sendMessage(chatId, await getStatsTextAsync(), mainKeyboard(user));
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

  const parsed = parseMlbbInput(text);

  if (parsed.ok) {
    await detectAndReply(chatId, text, user);
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

    await sendMessage(chatId, await getStatsTextAsync(), mainKeyboard(user));
    return;
  }

  if (data === "menu") {
    await sendMessage(chatId, getStartText(user), mainKeyboard(user));
    return;
  }
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
    getBroadcastConfirmText(broadcastPayload),
    broadcastConfirmKeyboard(broadcastId, confirmToken)
  );
}

async function handleTelegramProfileCommand(chatId, user, text) {
  const tgId = extractTelegramId(text);

  if (!tgId) {
    await sendMessage(chatId, getTelegramProfilePromptText(), mainKeyboard(user));
    return;
  }

  if (!isValidTelegramId(tgId)) {
    await sendMessage(chatId, getInvalidTelegramIdText(), mainKeyboard(user));
    return;
  }

  await safeSendChatAction(chatId, "typing");

  const profile = await lookupTelegramProfile(tgId);

  if (!profile.ok) {
    await sendMessage(
      chatId,
      getTelegramProfileFailedText(tgId, profile.reason),
      mainKeyboard(user)
    );
    return;
  }

  await sendMessage(
    chatId,
    getTelegramProfileText(profile.data),
    mainKeyboard(user)
  );
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
      [
        "❌ <b>ID formati noto‘g‘ri</b>",
        "",
        "Aniq tekshirish uchun MLBB <b>Account ID</b> va <b>Server/Zone ID</b> kerak.",
        "",
        "<b>To‘g‘ri formatlar:</b>",
        "✅ <code>1289050 (10050)</code>",
        "✅ <code>1289050 10050</code>",
        "✅ <code>/check 1289050 10050</code>",
      ].join("\n"),
      Object.hasOwn(options, "replyMarkup") ? options.replyMarkup : checkKeyboard(user)
    );

    return;
  }

  await safeSendChatAction(chatId, "typing");

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
      timeoutMs: 10000,
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
  const chatIds = Array.from(stats.broadcastChats);
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

async function sendBroadcastPayload(chatId, payload) {
  if (payload?.kind === "copy") {
    return copyMessage(chatId, payload.fromChatId, payload.messageId);
  }

  return sendMessage(chatId, payload.text, null, {
    entities: payload.entities || [],
    plain: true,
  });
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
    "TG ID yuborib Telegram profil ma’lumotlarini ham tekshirishingiz mumkin.",
    "",
    "<b>Namuna:</b>",
    "<code>1289050 (10050)</code>",
    "<code>123456789 5009</code>",
    "<code>/tg 5081175125</code>",
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
    "<code>1289050 (10050)</code>",
    "<code>1289050 10050</code>",
    "<code>/check 1289050 10050</code>",
    "",
    "⚠️ Faqat Account ID yuborilsa, serverni aniq topib bo‘lmaydi.",
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

function getFailedLookupText(parsed, lookup) {
  return [
    "❌ <b>Profil topilmadi</b>",
    "",
    `🆔 <b>Account ID:</b> <code>${escapeHtml(parsed.accountId)}</code>`,
    `🌐 <b>Server / Zone ID:</b> <code>${escapeHtml(parsed.zoneId)}</code>`,
    "",
    "Raqamlar to‘g‘ri kiritilganini tekshirib ko‘ring:",
    "1. Account ID to‘liq yozilgan bo‘lishi kerak",
    "2. Server/Zone ID qavs ichidagi raqam bo‘lishi kerak",
    "3. Tashqi tekshiruv servisi vaqtincha sekinlashgan bo‘lishi mumkin",
    "",
    `📌 <b>Holat:</b> ${escapeHtml(lookup.reason || getFriendlyLookupReason())}`,
    "",
    "Namuna: <code>1289050 (10050)</code>",
  ].join("\n");
}

function getHelpText(user = {}) {
  return [
    "ℹ️ <b>Yordam</b>",
    "",
    "<b>1. MLBB server aniqlash</b>",
    "Account ID va Server/Zone ID ni yuboring. Bot profilni tashqi lookup API orqali tekshiradi va server turini chiqaradi.",
    "",
    "<b>Formatlar:</b>",
    "<code>1289050 (10050)</code>",
    "<code>1289050 10050</code>",
    "<code>/check 1289050 10050</code>",
    "",
    "<b>2. Telegram profil topish</b>",
    "TG ID orqali bot ko‘ra oladigan profil ma’lumotlarini chiqaradi.",
    "<code>/tg 5081175125</code>",
    "<code>/user 5081175125</code>",
    "<code>/profile 5081175125</code>",
    "",
    "<b>3. Klaviatura</b>",
    "Pastdagi tugmalar orqali asosiy funksiyalarni command yozmasdan ishlatishingiz mumkin.",
    "",
    "<b>4. Cheklovlar</b>",
    "Faqat Account ID yuborilsa, MLBB serverini aniq topib bo‘lmaydi. TG profil lookup esa Telegram botga ko‘rinadigan public ma’lumotlargina qaytaradi.",
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
    "<code>/tg 5081175125</code> — Telegram ID orqali profil topish",
    "<code>/user 5081175125</code> — /tg bilan bir xil",
    "<code>/profile 5081175125</code> — /tg bilan bir xil",
  ];

  if (isAdmin(user.id)) {
    commands.push(
      "",
      "<b>Admin buyruqlari:</b>",
      "<code>/stats</code> yoki <code>/stat</code> — bot statistikasi",
      "<code>/message Matn</code> — barcha userlarga tasdiq bilan xabar yuborish"
    );
  }

  return commands.join("\n");
}

function getTelegramProfilePromptText() {
  return [
    "👤 <b>TG profil topish</b>",
    "",
    "Telegram ID yuboring:",
    "<code>/tg 5081175125</code>",
    "",
    "Eslatma: Telegram botlar faqat bot ko‘ra oladigan profil/public chat ma’lumotlarini oladi.",
  ].join("\n");
}

function getInvalidTelegramIdText() {
  return [
    "TG ID formati noto‘g‘ri.",
    "",
    "To‘g‘ri format:",
    "<code>/tg 5081175125</code>",
  ].join("\n");
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

  return [
    "👤 <b>Telegram profil</b>",
    "",
    `🆔 <b>ID:</b> <code>${escapeHtml(id)}</code>`,
    name ? `👤 <b>Ism:</b> ${escapeHtml(name)}` : "",
    title ? `🏷 <b>Nomi:</b> ${title}` : "",
    `🔗 <b>Username:</b> ${escapeHtml(username)}`,
    profile.type ? `📌 <b>Turi:</b> ${escapeHtml(profile.type)}` : "",
    profile.username
      ? `🌐 <b>Link:</b> https://t.me/${escapeHtml(profile.username)}`
      : id
        ? `🌐 <b>Link:</b> <a href="tg://user?id=${escapeHtml(id)}">profilni ochish</a>`
        : "",
    bio ? `📝 <b>Bio:</b> ${escapeHtml(clipText(String(bio), 500))}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getTelegramProfileFailedText(tgId, reason) {
  return [
    "👤 <b>Profil topilmadi</b>",
    "",
    `🆔 <b>TG ID:</b> <code>${escapeHtml(tgId)}</code>`,
    "",
    "Sabab: bot bu profilni ko‘ra olmayapti yoki ID noto‘g‘ri.",
    reason ? `Telegram javobi: ${escapeHtml(reason)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function getStatsTextAsync() {
  const dbStats = await getSupabaseStats();

  return getStatsText(dbStats);
}

function getStatsText(dbStats = null) {
  const errorLines = getStatsErrorLines();
  const userLines = getStatsUserLines(dbStats);
  const monthlyLines = getStatsMonthlyLines(dbStats);

  return [
    "📊 <b>Bot statistikasi</b>",
    "",
    `👥 <b>Foydalanuvchilar:</b> ${stats.users.size}`,
    `📣 <b>Broadcast chatlar:</b> ${stats.broadcastChats.size}`,
    `⏳ <b>Kutilayotgan broadcast:</b> ${stats.pendingBroadcasts.size}`,
    `🚀 <b>/start:</b> ${stats.starts}`,
    `🔎 <b>Jami tekshiruv:</b> ${stats.checks}`,
    `✅ <b>Muvaffaqiyatli:</b> ${stats.successChecks}`,
    `❌ <b>Xatolik:</b> ${stats.failedChecks}`,
    `🕒 <b>Ishga tushgan:</b> ${formatDate(stats.startedAt)}`,
    stats.lastCheckAt ? `✅ <b>Oxirgi tekshiruv:</b> ${formatDate(stats.lastCheckAt)}` : "",
    "",
    "<b>Joriy userlar:</b>",
    ...userLines,
    "",
    "<b>Oylik aktiv userlar:</b>",
    ...monthlyLines,
    "",
    "<b>Xatolik turlari:</b>",
    ...getErrorCountLines(),
    "",
    "<b>Oxirgi xatoliklar:</b>",
    ...errorLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function getStatsUserLines(dbStats = null) {
  if (Array.isArray(dbStats?.users) && dbStats.users.length) {
    return dbStats.users.map(formatSupabaseUserLine);
  }

  if (dbStats?.configError) {
    return [`Supabase sozlamasi: ${escapeHtml(dbStats.configError)}`];
  }

  const memoryUsers = Array.from(stats.users || []).slice(-SUPABASE_USER_LIST_LIMIT).reverse();

  if (memoryUsers.length) {
    const suffix = dbStats?.error
      ? " — Supabase o‘qilmadi, lokal xotiradan"
      : "";

    return memoryUsers.map((userId, index) => {
      return `${index + 1}. <code>${escapeHtml(userId)}</code>${suffix}`;
    });
  }

  if (dbStats?.error) {
    return ["Supabase o‘qishda xatolik bor, lokal xotirada user topilmadi."];
  }

  return ["Hali user qayd etilmagan."];
}

function formatSupabaseUserLine(user, index) {
  const userId = user.user_id || user.id || "-";
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const username = user.username ? `@${user.username}` : "";
  const name = [fullName, username].filter(Boolean).join(" ");
  const updates = Number(user.updates_count || 0);
  const lastSeen = user.last_seen_at ? formatDate(user.last_seen_at) : "-";

  return [
    `${index + 1}. <code>${escapeHtml(userId)}</code>`,
    name ? `— ${escapeHtml(clipText(name, 45))}` : "",
    `— ${updates} update`,
    `— ${lastSeen}`,
  ]
    .filter(Boolean)
    .join(" ");
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

function getUnknownText() {
  return [
    "Men siz yuborgan xabarni tushunmadim 🙂",
    "",
    "Serverni aniqlash uchun quyidagi formatda yuboring:",
    "",
    "<code>1289050 (10050)</code>",
    "",
    "Yoki pastdagi tugmalardan foydalaning.",
  ].join("\n");
}

function getAdminOnlyText() {
  return "Bu bo‘lim faqat adminlar uchun.";
}

function getErrorText() {
  return [
    "Kutilmagan xatolik bo‘ldi, lekin men ishlayapman.",
    "",
    "Iltimos, ID’ni yana shu formatda yuboring:",
    "<code>1289050 (10050)</code>",
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

function getBroadcastConfirmText(payload) {
  const preview =
    typeof payload === "string"
      ? payload
      : payload?.previewText || payload?.text || "Reply qilingan xabar";

  return [
    "📣 <b>Hamma foydalanuvchilarga yuborilsinmi?</b>",
    "Hali hech kimga yuborilmadi. Yuborish faqat pastdagi tasdiq tugmasidan keyin boshlanadi.",
    "",
    `Qabul qiluvchilar: <b>${stats.broadcastChats.size}</b>`,
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
    [{ text: BUTTON_CHECK }, { text: BUTTON_TG_PROFILE }],
    [{ text: BUTTON_COMMANDS }, { text: BUTTON_HELP }],
  ];

  if (isAdmin(user.id)) {
    keyboard.splice(1, 0, [
      { text: BUTTON_STATS },
      { text: BUTTON_BROADCAST },
    ]);
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

async function sendMessage(chatId, text, replyMarkup, options = {}) {
  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };

  if (Array.isArray(options.entities) && options.entities.length) {
    payload.entities = options.entities;
  } else if (!options.plain) {
    payload.parse_mode = "HTML";
  }

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return telegram("sendMessage", payload);
}

async function copyMessage(chatId, fromChatId, messageId) {
  return telegram("copyMessage", {
    chat_id: chatId,
    from_chat_id: fromChatId,
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
    timeoutMs: 10000,
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

  if (!["check", "start"].includes(normalizedCommand)) {
    return {
      addressed: false,
      input: "",
    };
  }

  if (normalizedCommand === "check" && !username) {
    return {
      addressed: true,
      input: text.slice(match[0].length).trim(),
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
    return offset === 0;
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

function escapeHtml(value) {
  return String(value || "")
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
  if (user.id) {
    stats.users.add(String(user.id));
  }

  if (chat?.id && (!chat.type || chat.type === "private")) {
    stats.broadcastChats.add(String(chat.id));
  }

  queueSupabaseUserTrack(user, chat, updateMeta);
}

function queueSupabaseUserTrack(user = {}, chat = {}, updateMeta = {}) {
  if (getSupabaseConfigError() || isSupabaseAuthTemporarilyDisabled()) {
    return;
  }

  const payload = buildSupabaseTrackPayload(user, chat, updateMeta);

  if (!payload) {
    return;
  }

  void supabaseRpc("track_bot_user", payload, {
    prefer: "return=minimal",
  }).catch((error) => {
    console.error("[SUPABASE_TRACK_ERROR]", error);
    recordError("supabase_track_failed", error.message, {
      userId: payload.p_user_id,
      updateType: payload.p_update_type,
    });
  });
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

  const text = String(value).trim();

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
    "Supabase API key yaroqsiz yoki JWT secret rotate qilingan. Vercel envdagi SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY ni yangilang.";
  stats.supabaseAuthDisabledUntil = Date.now() + 5 * 60 * 1000;
  recordError("supabase_auth_failed", safeMessage);
}

async function getSupabaseStats() {
  const configError = getSupabaseConfigError();

  if (configError) {
    return {
      error: true,
      configError,
      users: [],
      monthly: [],
    };
  }

  if (isSupabaseAuthTemporarilyDisabled()) {
    return {
      error: true,
      configError: stats.supabaseLastAuthError,
      users: [],
      monthly: [],
    };
  }

  try {
    const [users, monthly] = await Promise.all([
      supabaseRequest(
        `/bot_users?select=user_id,username,first_name,last_name,updates_count,last_seen_at&order=last_seen_at.desc&limit=${SUPABASE_USER_LIST_LIMIT}`
      ),
      supabaseRequest(
        "/bot_monthly_active_users?select=month,active_users,updates&order=month.desc&limit=6"
      ),
    ]);

    return {
      users: Array.isArray(users) ? users : [],
      monthly: Array.isArray(monthly) ? monthly : [],
    };
  } catch (error) {
    console.error("[SUPABASE_STATS_ERROR]", error);
    recordError("supabase_stats_failed", error.message);

    return {
      error: true,
      users: [],
      monthly: [],
    };
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

  const { method = "GET", body, prefer } = options;
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

  if (!bodyText) {
    return null;
  }

  return safeJsonParse(bodyText) ?? bodyText;
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

function createBroadcastId() {
  return crypto.randomBytes(8).toString("hex");
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
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

module.exports.__private = {
  broadcastMessage,
  buildSupabaseTrackPayload,
  detectServerType,
  extractTelegramId,
  getCommandsText,
  getFailedLookupText,
  getResultText,
  getStatsText,
  getStatsTextAsync,
  getTelegramProfileText,
  isSupabaseConfigured,
  mainKeyboard,
  normalizeSecretEnv,
  isValidWebhookSecret,
  isAdmin,
  isKeyboardButton,
  isValidTelegramId,
  normalizeLookupResponse,
  parseIdList,
  parseAdvancedRanges,
  parseMlbbInput,
  parseRequestBody,
  resolveSupabaseConfig,
  sanitizeTelegramUsername,
  trackUser,
  validateSupabaseServiceKey,
};
