// ---------------------------------------------------------------------------
// Premium (custom) emoji — api/emojis.json `premium` xaritasi bo'yicha oddiy
// emojini <tg-emoji emoji-id="…"> ga almashtiradi (HTML parse_mode).
// bot.js va miniapp.js dagi enrichPremiumEmojis bilan bir xil qoida; bu
// modul Vercel'dagi kabinet (api/account.js) xabarlari uchun.
// <tg-emoji>, <code>, <pre> ichiga tegilmaydi; ID bo'sh bo'lsa emoji o'zgarmaydi.
// ---------------------------------------------------------------------------

const EMOJIS = require("./emojis.json");

const PREMIUM_EMOJIS = Object.freeze({ ...(EMOJIS.premium || {}) });

function enrichPremiumEmojis(text) {
  const sourceText = String(text ?? "");
  if (!sourceText) return sourceText;

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
    (value, [emoji, emojiId]) => (emojiId ? value.split(emoji).join(`<tg-emoji emoji-id="${emojiId}">${emoji}</tg-emoji>`) : value),
    protectedText
  );

  return protectedParts.reduce(
    (value, part, index) => value.replace(`__PREMIUM_EMOJI_PROTECTED_${index}__`, part),
    enrichedText
  );
}

module.exports = { enrichPremiumEmojis };
