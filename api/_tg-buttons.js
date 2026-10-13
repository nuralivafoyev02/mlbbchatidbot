// ---------------------------------------------------------------------------
// Tugmalar bezagi (Bot API 9.4) — andoza: fearpin-node (src/menu.js → btn()).
//
// Tugma matni premium ikonkasi bor emoji bilan boshlansa — tugmaga
// icon_custom_emoji_id qo'yiladi va emoji matndan olinadi (aks holda ikonka va
// emoji ikki marta ko'rinadi). Ikonkalar: api/emojis.json → buttonIcons, keyin
// premium. Rang — style: "success" (yashil), "primary" (ko'k), "danger"
// (qizil). Tugma qurilayotganda style qo'yilmagan bo'lsa: ✅/💰 — yashil,
// ❌ — qizil.
//
// Reply klaviatura tugmasi bosilganda botga emojisiz matn keladi —
// buttonLabelVariants ikkala ko'rinishni ham beradi.
// Telegram bezakni rad etsa (bot egasida Premium yo'q va h.k.), bot.js
// telegram() xabarni plainReplyMarkup bilan qayta yuboradi.
// ---------------------------------------------------------------------------

const EMOJIS = require("./emojis.json");

const BUTTON_STYLES = Object.freeze(["success", "primary", "danger"]);
const EMOJI_STYLES = Object.freeze({ "✅": "success", "💰": "success", "❌": "danger" });

function pickIds(map) {
  return Object.fromEntries(
    Object.entries(map || {}).filter(([emoji, id]) => emoji && /^\d{5,25}$/.test(String(id || "")))
  );
}

const BUTTON_ICONS = Object.freeze({ ...pickIds(EMOJIS.premium), ...pickIds(EMOJIS.buttonIcons) });
// "⭕️" kabi variantlar "⭕" dan oldin tekshirilsin.
const ICON_EMOJIS = Object.freeze(Object.keys(BUTTON_ICONS).sort((a, b) => b.length - a.length));

// "🔎 Server aniqlash" → { emoji: "🔎", iconId, text: "Server aniqlash" }; ikonka
// bo'lmasa yoki emojidan keyin matn qolmasa — null.
function splitButtonIcon(text) {
  const value = String(text ?? "");

  for (const emoji of ICON_EMOJIS) {
    if (value.startsWith(emoji)) {
      const rest = value.slice(emoji.length).replace(/^️/, "").trim();
      return rest ? { emoji, iconId: BUTTON_ICONS[emoji], text: rest } : null;
    }
  }

  return null;
}

function decorateButton(button) {
  if (!button || typeof button !== "object" || typeof button.text !== "string") {
    return button;
  }

  const out = { ...button };
  const split = out.icon_custom_emoji_id ? null : splitButtonIcon(out.text);

  if (split) {
    out.text = split.text;
    out.icon_custom_emoji_id = split.iconId;
  }

  if (!out.style && split && EMOJI_STYLES[split.emoji]) {
    out.style = EMOJI_STYLES[split.emoji];
  }

  if (out.style && !BUTTON_STYLES.includes(out.style)) {
    delete out.style;
  }

  return out;
}

function mapButtons(markup, fn) {
  if (!markup || typeof markup !== "object") {
    return markup;
  }

  const mapRows = (rows) => rows.map((row) => (Array.isArray(row) ? row.map(fn) : row));

  if (Array.isArray(markup.inline_keyboard)) {
    return { ...markup, inline_keyboard: mapRows(markup.inline_keyboard) };
  }

  if (Array.isArray(markup.keyboard)) {
    return { ...markup, keyboard: mapRows(markup.keyboard) };
  }

  return markup;
}

function decorateReplyMarkup(markup) {
  return mapButtons(markup, decorateButton);
}

// Bezaksiz ko'rinish — Telegram bezakni rad etgandagi zaxira.
function plainReplyMarkup(markup) {
  return mapButtons(markup, (button) => {
    if (!button || typeof button !== "object") return button;
    const { style, icon_custom_emoji_id: iconId, ...rest } = button;
    return rest;
  });
}

function hasButtons(markup) {
  return Boolean(markup && (Array.isArray(markup.inline_keyboard) || Array.isArray(markup.keyboard)));
}

// Faqat bezak sabab bo'lishi mumkin bo'lgan 400 xatolarida qayta yuboriladi.
function isButtonDecorationError(message) {
  const text = String(message || "");
  return /HTTP 400/.test(text) && /icon|emoji|style|button/i.test(text);
}

// Boshidagi emoji(lar)ni olib tashlaydi: "🔎 Server aniqlash" → "Server aniqlash"
// (ikonka xaritasiga bog'liq emas — bayroq, ZWJ, rang modifikatorlari ham).
function stripLeadingEmoji(label) {
  return String(label ?? "")
    .replace(/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}])+\s*/u, "")
    .trim();
}

// Reply tugma yorlig'i: o'zi, ikonkali va emojisiz ko'rinishlari.
function buttonLabelVariants(label) {
  const split = splitButtonIcon(label);
  return [...new Set([String(label), split ? split.text : "", stripLeadingEmoji(label)].filter(Boolean))];
}

module.exports = {
  BUTTON_ICONS,
  BUTTON_STYLES,
  buttonLabelVariants,
  decorateButton,
  decorateReplyMarkup,
  hasButtons,
  isButtonDecorationError,
  plainReplyMarkup,
  splitButtonIcon,
  stripLeadingEmoji,
};
