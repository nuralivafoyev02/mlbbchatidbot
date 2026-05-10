const crypto = require("node:crypto");

const TELEGRAM_BOT_TOKEN = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_WEBHOOK_SECRET = cleanEnv(process.env.TELEGRAM_WEBHOOK_SECRET);
const SUPPORT_USERNAME = sanitizeTelegramUsername(
  process.env.SUPPORT_USERNAME || "Oblto_org"
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
    startedAt: new Date().toISOString(),
    lastCheckAt: null,
  };
}

const stats = global.__MLBB_BOT_STATS__;
stats.users ||= new Set();
stats.broadcastChats ||= new Set();
stats.pendingBroadcasts ||= new Map();
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

  const message =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post;

  if (message) {
    await handleMessage(message);
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }
}

async function handleMessage(message) {
  if (!message?.chat?.id) {
    return;
  }

  const chatId = message.chat.id;
  const text = String(message.text || "").trim();
  const user = message.from || {};

  trackUser(user, message.chat);

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
      await sendMessage(chatId, getAdminOnlyText(), mainKeyboard(user));
      return;
    }

    await sendMessage(chatId, getStatsText(), mainKeyboard(user));
    return;
  }

  if (isCommand(text, "message")) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getAdminOnlyText(), mainKeyboard(user));
      return;
    }

    await handleMessageCommand(chatId, user, text);
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
      await sendMessage(chatId, getAdminOnlyText(), mainKeyboard(user));
      return;
    }

    await sendMessage(chatId, getStatsText(), mainKeyboard(user));
    return;
  }

  if (isKeyboardButton(text, BUTTON_BROADCAST)) {
    if (!isAdmin(user.id)) {
      await sendMessage(chatId, getAdminOnlyText(), mainKeyboard(user));
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

async function handleCallbackQuery(callbackQuery) {
  if (!callbackQuery?.id) {
    return;
  }

  const data = String(callbackQuery.data || "");
  const chatId = callbackQuery.message?.chat?.id;
  const user = callbackQuery.from || {};

  trackUser(user, callbackQuery.message?.chat);

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
      await sendMessage(chatId, getAdminOnlyText(), mainKeyboard(user));
      return;
    }

    await sendMessage(chatId, getStatsText(), mainKeyboard(user));
    return;
  }

  if (data === "menu") {
    await sendMessage(chatId, getStartText(user), mainKeyboard(user));
    return;
  }
}

async function handleMessageCommand(chatId, user, text) {
  const messageText = text.replace(/^\/message(@\w+)?/i, "").trim();

  if (!messageText) {
    await sendMessage(chatId, getBroadcastUsageText(), mainKeyboard(user));
    return;
  }

  if (messageText.length > 3500) {
    await sendMessage(chatId, getBroadcastTooLongText(), mainKeyboard(user));
    return;
  }

  cleanupPendingBroadcasts();

  const broadcastId = createBroadcastId();
  stats.pendingBroadcasts.set(broadcastId, {
    adminId: String(user.id),
    text: messageText,
    createdAt: Date.now(),
  });

  await sendMessage(
    chatId,
    getBroadcastConfirmText(messageText),
    broadcastConfirmKeyboard(broadcastId)
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
    await sendMessage(chatId, getAdminOnlyText(), mainKeyboard(user));
    return;
  }

  const broadcastId = data.replace("broadcast_confirm:", "");
  const pending = stats.pendingBroadcasts.get(broadcastId);

  if (!pending || pending.adminId !== String(user.id)) {
    await sendMessage(chatId, getBroadcastExpiredText(), mainKeyboard(user));
    return;
  }

  stats.pendingBroadcasts.delete(broadcastId);
  await sendMessage(chatId, "📣 <b>Xabar yuborish boshlandi.</b>", mainKeyboard(user));

  const result = await broadcastMessage(pending.text);

  await sendMessage(
    chatId,
    getBroadcastResultText(result),
    mainKeyboard(user)
  );
}

async function handleBroadcastCancel(chatId, user, data) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, getAdminOnlyText(), mainKeyboard(user));
    return;
  }

  const broadcastId = data.replace("broadcast_cancel:", "");
  stats.pendingBroadcasts.delete(broadcastId);

  await sendMessage(chatId, "Bekor qilindi.", mainKeyboard(user));
}

async function detectAndReply(chatId, input, user = {}) {
  const parsed = parseMlbbInput(input);

  if (!parsed.ok) {
    stats.failedChecks += 1;

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
      checkKeyboard(user)
    );

    return;
  }

  await safeSendChatAction(chatId, "typing");

  const lookup = await lookupMlbbAccount(parsed.accountId, parsed.zoneId);

  stats.checks += 1;
  stats.lastCheckAt = new Date().toISOString();

  if (!lookup.ok) {
    stats.failedChecks += 1;

    await sendMessage(
      chatId,
      getFailedLookupText(parsed, lookup),
      resultKeyboard(user)
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

  await sendMessage(chatId, getResultText(result), resultKeyboard(user));
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
        reason: `Lookup API HTTP ${response.status}`,
        data,
      };
    }

    const normalized = normalizeLookupResponse(data);

    if (!normalized.ok) {
      return {
        ok: false,
        provider: "external_api",
        reason: normalized.reason || "Akkaunt topilmadi yoki server ID noto‘g‘ri",
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
      reason: error.message || "Lookup API ishlamadi",
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

async function broadcastMessage(text) {
  const chatIds = Array.from(stats.broadcastChats);
  let sent = 0;
  let failed = 0;

  for (const chunk of chunkArray(chatIds, 20)) {
    const results = await Promise.allSettled(
      chunk.map((chatId) => sendMessage(chatId, escapeHtml(text)))
    );

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        sent += 1;
      } else {
        failed += 1;
        console.error("[BROADCAST_ERROR]", result.reason);
      }
    });
  }

  return {
    total: chatIds.length,
    sent,
    failed,
  };
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
    "❌ <b>Akkaunt tekshirilmadi</b>",
    "",
    `🆔 <b>Account ID:</b> <code>${escapeHtml(parsed.accountId)}</code>`,
    `🌐 <b>Server / Zone ID:</b> <code>${escapeHtml(parsed.zoneId)}</code>`,
    "",
    "Bu quyidagilardan biri bo‘lishi mumkin:",
    "1. Account ID xato kiritilgan",
    "2. Server/Zone ID xato kiritilgan",
    "3. Tashqi MLBB lookup API vaqtincha ishlamayapti",
    "",
    `📌 <b>Sabab:</b> ${escapeHtml(lookup.reason || "Noma’lum xatolik")}`,
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
    `Admin bilan bog‘lanish: @${escapeHtml(SUPPORT_USERNAME)}`,
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

function getStatsText() {
  return [
    "📊 <b>Bot statistikasi</b>",
    "",
    `👥 <b>Foydalanuvchilar:</b> ${stats.users.size}`,
    `🚀 <b>/start:</b> ${stats.starts}`,
    `🔎 <b>Jami tekshiruv:</b> ${stats.checks}`,
    `✅ <b>Muvaffaqiyatli:</b> ${stats.successChecks}`,
    `❌ <b>Xatolik:</b> ${stats.failedChecks}`,
    `🕒 <b>Ishga tushgan:</b> ${formatDate(stats.startedAt)}`,
    stats.lastCheckAt ? `✅ <b>Oxirgi tekshiruv:</b> ${formatDate(stats.lastCheckAt)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
    "Keyingi qadamda tasdiqlash tugmasi chiqadi.",
  ].join("\n");
}

function getBroadcastTooLongText() {
  return "Xabar juda uzun. Iltimos, 3500 belgidan qisqaroq matn yuboring.";
}

function getBroadcastExpiredText() {
  return "Bu tasdiqlash eskirgan yoki topilmadi. /message orqali qaytadan boshlang.";
}

function getBroadcastConfirmText(text) {
  return [
    "📣 <b>Hamma foydalanuvchilarga yuborilsinmi?</b>",
    "",
    `Qabul qiluvchilar: <b>${stats.broadcastChats.size}</b>`,
    "",
    "<b>Xabar:</b>",
    escapeHtml(clipText(text, 900)),
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
    input_field_placeholder: "1289050 (10050) yoki /tg 5081175125",
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

function broadcastConfirmKeyboard(broadcastId) {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Tasdiqlash",
          callback_data: `broadcast_confirm:${broadcastId}`,
        },
        {
          text: "❌ Bekor qilish",
          callback_data: `broadcast_cancel:${broadcastId}`,
        },
      ],
    ],
  };
}

async function sendMessage(chatId, text, replyMarkup) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
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

function cleanEnv(value) {
  return typeof value === "string" ? value.trim() : "";
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

function trackUser(user = {}, chat = {}) {
  if (user.id) {
    stats.users.add(String(user.id));
  }

  if (chat?.id && (!chat.type || chat.type === "private")) {
    stats.broadcastChats.add(String(chat.id));
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

function createBroadcastId() {
  return crypto.randomBytes(8).toString("hex");
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
  detectServerType,
  extractTelegramId,
  getCommandsText,
  getResultText,
  getTelegramProfileText,
  isValidWebhookSecret,
  isAdmin,
  isKeyboardButton,
  isValidTelegramId,
  normalizeLookupResponse,
  parseIdList,
  parseAdvancedRanges,
  parseMlbbInput,
  parseRequestBody,
  sanitizeTelegramUsername,
  trackUser,
};
