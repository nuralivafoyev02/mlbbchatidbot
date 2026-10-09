// ---------------------------------------------------------------------------
// Shaxsiy kabinetdan kelgan xarid so'rovini do'kon egasiga yuborish.
//
// Bot ichidagi Firstmail xaridi bilan bir xil qoida (api/bot.js →
// notifyShopBuyRequest): so'rov do'kon egasiga boradi — SHOP_NOTIFY_CHAT_ID,
// aks holda @Ksava_org (api/_contact.js) bo'yicha bot_users dan topilgan chat. Egasiga
// yetib bormasa — zaxira sifatida ADMIN_IDS ga.
// ---------------------------------------------------------------------------

const { ADMIN_CONTACT_USERNAME } = require("./_contact.js");
const DEFAULT_ADMIN_IDS = "5081175125,8500085987,7396686285";

function cleanEnv(value) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSom(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} so'm` : "—";
}

function resolveShopNotifyConfig(env = process.env) {
  // Aloqa manzili env'dan emas — api/_contact.js.
  const support = ADMIN_CONTACT_USERNAME;

  return {
    notifyChatId: /^-?\d{1,20}$/.test(cleanEnv(env.SHOP_NOTIFY_CHAT_ID)) ? cleanEnv(env.SHOP_NOTIFY_CHAT_ID) : null,
    supportUsername: /^[A-Za-z0-9_]{3,32}$/.test(support) ? support : null,
    adminIds: cleanEnv(env.ADMIN_IDS || DEFAULT_ADMIN_IDS)
      .split(/[\s,]+/)
      .filter((id) => /^-?\d{1,20}$/.test(id)),
  };
}

const LIMIT_KIND_LABELS = {
  full_info: "📋 To'liq ma'lumot",
  reset_pw: "🔐 Parolni tiklash",
};

function buyerLine(user) {
  const buyer = user.username
    ? `@${escapeHtml(user.username)}`
    : `<a href="tg://user?id=${escapeHtml(user.id)}">${escapeHtml(user.first_name || "Foydalanuvchi")}</a>`;
  return `👤 Xaridor: ${buyer} (<code>${escapeHtml(user.id)}</code>)`;
}

function buildLimitBuyText(user, item) {
  return [
    "#dokon_sorov #limit",
    "",
    "🛒 <b>Yangi xarid so'rovi — Limit</b> (shaxsiy kabinet)",
    "",
    buyerLine(user),
    `📦 Paket: <b>${escapeHtml(LIMIT_KIND_LABELS[item.kind] || item.kind)}</b> × <b>${escapeHtml(item.amount)}</b>${item.title ? ` — ${escapeHtml(item.title)}` : ""}`,
    `💰 Narx: <b>${escapeHtml(formatSom(item.price))}</b>`,
    `🆔 Paket ID: <code>${escapeHtml(item.id)}</code>`,
    "",
    "To'lovdan keyin limitni admin panel yoki bot buyrug'i orqali qo'shing.",
  ].join("\n");
}

function buildFirstmailBuyText(user, item, priceText) {
  return [
    "#dokon_sorov",
    "",
    "🛒 <b>Yangi xarid so'rovi — Firstmail</b> (shaxsiy kabinet)",
    "",
    buyerLine(user),
    `✉️ Pochta: <code>${escapeHtml(item.email)}</code>`,
    `💰 Narx: <b>${escapeHtml(priceText)}</b>`,
    `🆔 Mahsulot ID: <code>${escapeHtml(item.id)}</code>`,
    "",
    "Sotilgach admin paneldagi <b>Do'kon → Firstmail</b> bo'limida «Sotildi» tugmasini bosing.",
  ].join("\n");
}

// Balansdan to'langan (avtomatik bajarilgan) sotuv — egasiga ma'lumot uchun.
function buildWalletSaleText(user, { kind, item, orderId, price }) {
  const what = kind === "firstmail"
    ? `✉️ Pochta: <code>${escapeHtml(item.email)}</code>`
    : `📦 Paket: <b>${escapeHtml(LIMIT_KIND_LABELS[item.kind] || item.kind)}</b> × <b>${escapeHtml(item.amount)}</b>`;

  return [
    kind === "firstmail" ? "#sotuv #firstmail" : "#sotuv #limit",
    "",
    "✅ <b>Balansdan xarid — avtomatik bajarildi</b>",
    "",
    buyerLine(user),
    what,
    `💰 Summa: <b>${escapeHtml(formatSom(price))}</b>`,
    `🧾 Buyurtma: <code>#${escapeHtml(orderId)}</code>`,
    "",
    "Xatolik bo'lsa admin paneldagi <b>Balans</b> bo'limidan pulni qaytarish mumkin.",
  ].join("\n");
}

function buildTopupCreditedText(amount, balance) {
  return [
    "✅ <b>Balans to'ldirildi</b>",
    "",
    `➕ Tushgan summa: <b>${escapeHtml(formatSom(amount))}</b>`,
    `💰 Joriy balans: <b>${escapeHtml(formatSom(balance))}</b>`,
  ].join("\n");
}

// deps: { botToken, requestFn (Supabase REST), fetchFn? }
function createShopNotifier({ botToken, requestFn, fetchFn = fetch, env = process.env } = {}) {
  const config = resolveShopNotifyConfig(env);

  async function telegramSend(chatId, text, replyMarkup) {
    const response = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    const data = await response.json().catch(() => null);
    return Boolean(data && data.ok);
  }

  async function sendTo(chatId, text, buyerId) {
    // tg://user tugmasi xaridorning maxfiylik sozlamasi sabab rad etilishi mumkin.
    const button = { inline_keyboard: [[{ text: "💬 Xaridorga yozish", url: `tg://user?id=${buyerId}` }]] };

    try {
      if (await telegramSend(chatId, text, button)) return true;
      return await telegramSend(chatId, text, null);
    } catch (error) {
      console.error("[SHOP_NOTIFY_SEND]", chatId, error?.message);
      return false;
    }
  }

  async function resolveOwnerChatId() {
    if (config.notifyChatId) {
      return config.notifyChatId;
    }

    if (!config.supportUsername || typeof requestFn !== "function") {
      return null;
    }

    try {
      const rows = await requestFn(
        `/bot_users?username=ilike.${encodeURIComponent(config.supportUsername)}&select=user_id,chat_id,username&limit=5`
      );
      const match = (Array.isArray(rows) ? rows : []).find(
        (row) => String(row.username || "").toLowerCase() === config.supportUsername.toLowerCase()
      );
      const chatId = match ? String(match.chat_id || match.user_id || "") : "";
      return /^-?\d{1,20}$/.test(chatId) ? chatId : null;
    } catch (error) {
      console.error("[SHOP_NOTIFY_LOOKUP]", error?.message);
      return null;
    }
  }

  async function notify(text, buyerId) {
    if (!botToken) {
      return false;
    }

    const owner = await resolveOwnerChatId();

    if (owner && (await sendTo(owner, text, buyerId))) {
      return true;
    }

    let delivered = false;
    for (const adminId of config.adminIds) {
      if (await sendTo(adminId, text, buyerId)) delivered = true;
    }
    return delivered;
  }

  return {
    supportUsername: config.supportUsername,
    notify,
  };
}

module.exports = {
  LIMIT_KIND_LABELS,
  buildFirstmailBuyText,
  buildLimitBuyText,
  buildTopupCreditedText,
  buildWalletSaleText,
  createShopNotifier,
  resolveShopNotifyConfig,
};
