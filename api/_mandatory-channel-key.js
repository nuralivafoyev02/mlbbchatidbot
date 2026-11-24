// ---------------------------------------------------------------------------
// Majburiy kanal har bir bot uchun alohida saqlanadi (beta va prod bitta
// Supabase'ni ishlatadi). Kalit bot token'idagi bot ID bo'yicha:
//   bot_settings.key = "mandatory_channel:<bot_id>"
// Worker (api/bot.js) ham, admin panel (api/miniapp.js) ham o'z muhitining
// TELEGRAM_BOT_TOKEN'idan kalitni oladi — shuning uchun ular hech qachon
// boshqa-boshqa kalitga qaramaydi. Token yo'q/noto'g'ri bo'lsa — eski umumiy kalit.
// ---------------------------------------------------------------------------
const LEGACY_MANDATORY_CHANNEL_KEY = "mandatory_channel";

function mandatoryChannelKey(botToken) {
  const botId = String(botToken || "").trim().split(":")[0];
  return /^\d{3,20}$/.test(botId) ? `${LEGACY_MANDATORY_CHANNEL_KEY}:${botId}` : LEGACY_MANDATORY_CHANNEL_KEY;
}

module.exports = { LEGACY_MANDATORY_CHANNEL_KEY, mandatoryChannelKey };
