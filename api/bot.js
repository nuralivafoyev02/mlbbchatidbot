const crypto = require("node:crypto");

const TELEGRAM_BOT_TOKEN = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_WEBHOOK_SECRET = cleanEnv(process.env.TELEGRAM_WEBHOOK_SECRET);
const SUPPORT_USERNAME = sanitizeTelegramUsername(
  process.env.SUPPORT_USERNAME || "Oblto_org"
);

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
    startedAt: new Date().toISOString(),
    lastCheckAt: null,
  };
}

const stats = global.__MLBB_BOT_STATS__;

module.exports = async function handler(req, res) {
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

    const update = parseRequestBody(req.body);
    await processUpdate(update);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[BOT_ERROR]", error);

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

  if (user.id) stats.users.add(user.id);
  if (!text) return;

  if (isCommand(text, "start")) {
    stats.starts += 1;
    await sendMessage(chatId, getStartText(user), mainKeyboard());
    return;
  }

  if (isCommand(text, "help")) {
    await sendMessage(chatId, getHelpText(), helpKeyboard());
    return;
  }

  if (isCommand(text, "stat") || isCommand(text, "stats")) {
    await sendMessage(chatId, getStatsText(), mainKeyboard());
    return;
  }

  if (isCommand(text, "check")) {
    const input = text.replace(/^\/check(@\w+)?/i, "").trim();

    if (!input) {
      await sendMessage(chatId, getCheckPromptText(), checkKeyboard());
      return;
    }

    await detectAndReply(chatId, input);
    return;
  }

  const parsed = parseMlbbInput(text);

  if (parsed.ok) {
    await detectAndReply(chatId, text);
    return;
  }

  await sendMessage(chatId, getUnknownText(), mainKeyboard());
}

async function handleCallbackQuery(callbackQuery) {
  if (!callbackQuery?.id) {
    return;
  }

  const data = String(callbackQuery.data || "");
  const chatId = callbackQuery.message?.chat?.id;
  const user = callbackQuery.from || {};

  if (user.id) stats.users.add(user.id);

  await answerCallbackQuery(callbackQuery.id);

  if (!chatId) {
    return;
  }

  if (data === "detect_server" || data === "check_again") {
    await sendMessage(chatId, getCheckPromptText(), checkKeyboard());
    return;
  }

  if (data === "stats") {
    await sendMessage(chatId, getStatsText(), mainKeyboard());
    return;
  }

  if (data === "menu") {
    await sendMessage(chatId, getStartText(user), mainKeyboard());
    return;
  }
}

async function detectAndReply(chatId, input) {
  const startedAt = Date.now();
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
        "✅ <code>123456789 (5009)</code>",
        "✅ <code>123456789 5009</code>",
        "✅ <code>/check 123456789 5009</code>",
      ].join("\n"),
      checkKeyboard()
    );

    return;
  }

  await sendChatAction(chatId, "typing");

  const lookup = await lookupMlbbAccount(parsed.accountId, parsed.zoneId);
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.01).toFixed(2);

  stats.checks += 1;
  stats.lastCheckAt = new Date().toISOString();

  if (!lookup.ok) {
    stats.failedChecks += 1;

    await sendMessage(
      chatId,
      getFailedLookupText(parsed, lookup, elapsedSeconds),
      resultKeyboard()
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

  await sendMessage(chatId, getResultText(result, elapsedSeconds), resultKeyboard());
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

function getStartText(user) {
  const name = escapeHtml(user.first_name || "do‘stim");

  return [
    `Salom, <b>${name}</b>! 👋`,
    "",
    "Men MLBB akkauntingiz serverini va profil mavjudligini tekshiraman.",
    "",
    "<b>Bot funksiyalari:</b>",
    "🔎 <b>Server aniqlash</b> — Account ID va Server/Zone ID orqali profilni tekshiradi",
    "👤 <b>Nickname topish</b> — agar API topa olsa, akkaunt nomini chiqaradi",
    "📊 <b>Statistika</b> — bot ishlash statistikasi",
    "ℹ️ <b>Yordam</b> — admin profiliga o‘tish",
    "",
    "<b>Namuna:</b>",
    "<code>123456789 (5009)</code>",
    "<code>/check 123456789 5009</code>",
  ].join("\n");
}

function getCheckPromptText() {
  return [
    "🔎 <b>Server aniqlash</b>",
    "",
    "Iltimos, MLBB <b>Account ID</b> va <b>Server/Zone ID</b> ni yuboring.",
    "",
    "<b>Namuna:</b>",
    "<code>123456789 (5009)</code>",
    "<code>123456789 5009</code>",
    "<code>/check 123456789 5009</code>",
    "",
    "⚠️ Faqat Account ID yuborilsa, serverni aniq topib bo‘lmaydi.",
  ].join("\n");
}

function getResultText(result, elapsedSeconds) {
  return [
    "🔍 <b>Server Aniqlash Natijasi</b>",
    "",
    `🆔 <b>Account ID:</b> <code>${escapeHtml(result.accountId)}</code>`,
    `🌐 <b>Server / Zone ID:</b> <code>${escapeHtml(result.zoneId)}</code>`,
    `🖥 <b>Server turi:</b> <b>${escapeHtml(result.serverType)}</b>`,
    result.region ? `📍 <b>Region:</b> ${escapeHtml(result.region)}` : "📍 <b>Region:</b> API qaytarmadi",
    `👤 <b>Nickname:</b> ${escapeHtml(result.nickname)}`,
    `✅ <b>Holat:</b> ${escapeHtml(result.status)}`,
    `⏱ <b>Vaqt:</b> ${elapsedSeconds} soniya`,
  ].join("\n");
}

function getFailedLookupText(parsed, lookup, elapsedSeconds) {
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
    `⏱ <b>Vaqt:</b> ${elapsedSeconds} soniya`,
  ].join("\n");
}

function getHelpText() {
  return [
    "ℹ️ <b>Yordam</b>",
    "",
    "MLBB profilida ID odatda shunday ko‘rinadi:",
    "<code>123456789 (5009)</code>",
    "",
    "Bu yerda:",
    "🆔 <b>123456789</b> — Account ID",
    "🌐 <b>5009</b> — Server/Zone ID",
    "",
    `Admin bilan bog‘lanish: @${escapeHtml(SUPPORT_USERNAME)}`,
  ].join("\n");
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
    "<code>123456789 (5009)</code>",
    "",
    "Yoki pastdagi tugmalardan foydalaning.",
  ].join("\n");
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔎 Server aniqlash",
          callback_data: "detect_server",
        },
      ],
      [
        {
          text: "📊 Statistika",
          callback_data: "stats",
        },
        {
          text: "ℹ️ Yordam",
          url: `https://t.me/${SUPPORT_USERNAME}`,
        },
      ],
    ],
  };
}

function checkKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔎 Server aniqlash",
          callback_data: "detect_server",
        },
      ],
      [
        {
          text: "🏠 Menyu",
          callback_data: "menu",
        },
        {
          text: "ℹ️ Yordam",
          url: `https://t.me/${SUPPORT_USERNAME}`,
        },
      ],
    ],
  };
}

function resultKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔍 Yana tekshirish",
          callback_data: "check_again",
        },
      ],
      [
        {
          text: "📊 Statistika",
          callback_data: "stats",
        },
        {
          text: "ℹ️ Yordam",
          url: `https://t.me/${SUPPORT_USERNAME}`,
        },
      ],
    ],
  };
}

function helpKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔎 Server aniqlash",
          callback_data: "detect_server",
        },
      ],
      [
        {
          text: `📩 @${SUPPORT_USERNAME}`,
          url: `https://t.me/${SUPPORT_USERNAME}`,
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

function sanitizeTelegramUsername(value) {
  const username = cleanEnv(value).replace(/^@+/, "");

  if (/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return username;
  }

  return "Oblto_org";
}

module.exports.__private = {
  detectServerType,
  isValidWebhookSecret,
  normalizeLookupResponse,
  parseAdvancedRanges,
  parseMlbbInput,
  parseRequestBody,
  sanitizeTelegramUsername,
};
