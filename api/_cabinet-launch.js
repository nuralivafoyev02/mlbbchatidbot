// ---------------------------------------------------------------------------
// Shaxsiy kabinetni reply klaviatura tugmasidan ochish.
//
// Telegram reply klaviaturadagi web_app tugmasidan ochilgan Mini App'ga
// initData BERMAYDI (core.telegram.org/bots/webapps — WebAppInitData). Shu
// sabab bot klaviaturani yuborayotganda (bot.js → telegram()) kabinet
// tugmasining URL'iga o'sha chat egasi uchun imzolangan kalit qo'shadi
// (?lt=<userId>.<exp>.<hmac>). Kalit faqat chat_id > 0 (shaxsiy chat, chat_id
// = user_id) bo'lganda beriladi — boshqa birovning kaliti tushib qolmaydi.
// Kabinet initData bo'lmasa shu kalit bilan so'rov yuboradi (api/account.js).
// Imzo kaliti TELEGRAM_BOT_TOKEN dan olinadi — yangi env kerak emas.
// ---------------------------------------------------------------------------

const crypto = require("node:crypto");

const CABINET_LAUNCH_PARAM = "lt";
// Klaviatura har bir bot xabari bilan yangilanadi; uzoq jim turgan userda
// eskirgan bo'lsa, kabinet "botga /start yuboring" deydi.
const CABINET_LAUNCH_TTL_SEC = 30 * 24 * 60 * 60;

function launchKey(botToken) {
  return crypto.createHmac("sha256", "CabinetLaunch").update(String(botToken || "")).digest();
}

function sign(payload, botToken) {
  return crypto.createHmac("sha256", launchKey(botToken)).update(payload).digest("hex");
}

function createCabinetLaunchToken(userId, botToken, { now = Date.now(), ttlSec = CABINET_LAUNCH_TTL_SEC } = {}) {
  const id = String(userId ?? "");

  if (!/^\d{1,19}$/.test(id) || !botToken) {
    return null;
  }

  const payload = `${id}.${Math.floor(now / 1000) + ttlSec}`;
  return `${payload}.${sign(payload, botToken)}`;
}

function verifyCabinetLaunchToken(token, botToken, { now = Date.now() } = {}) {
  const match = /^(\d{1,19})\.(\d{1,12})\.([a-f0-9]{64})$/.exec(String(token || ""));

  if (!match || !botToken) {
    return { ok: false, error: "bad_token" };
  }

  const expected = Buffer.from(sign(`${match[1]}.${match[2]}`, botToken), "hex");
  const received = Buffer.from(match[3], "hex");

  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, error: "bad_token" };
  }

  if (Number(match[2]) < now / 1000) {
    return { ok: false, error: "expired" };
  }

  return { ok: true, userId: match[1], exp: Number(match[2]) };
}

// Reply klaviaturadagi kabinet tugmalariga (web_app.url === cabinetUrl) chat
// egasining kalitini qo'shadi. Inline tugmalarga tegilmaydi — ular initData oladi.
function withCabinetLaunchTokens(markup, chatId, { botToken, cabinetUrl, now } = {}) {
  if (!markup || !Array.isArray(markup.keyboard) || !cabinetUrl) {
    return markup;
  }

  const isCabinet = (button) => Boolean(button && button.web_app && button.web_app.url === cabinetUrl);

  if (!markup.keyboard.some((row) => Array.isArray(row) && row.some(isCabinet))) {
    return markup;
  }

  const token = /^\d{1,19}$/.test(String(chatId ?? "")) ? createCabinetLaunchToken(chatId, botToken, { now }) : null;

  if (!token) {
    return markup;
  }

  const separator = cabinetUrl.includes("?") ? "&" : "?";
  const url = `${cabinetUrl}${separator}${CABINET_LAUNCH_PARAM}=${encodeURIComponent(token)}`;

  return {
    ...markup,
    keyboard: markup.keyboard.map((row) =>
      Array.isArray(row) ? row.map((button) => (isCabinet(button) ? { ...button, web_app: { ...button.web_app, url } } : button)) : row
    ),
  };
}

module.exports = {
  CABINET_LAUNCH_PARAM,
  CABINET_LAUNCH_TTL_SEC,
  createCabinetLaunchToken,
  verifyCabinetLaunchToken,
  withCabinetLaunchTokens,
};
