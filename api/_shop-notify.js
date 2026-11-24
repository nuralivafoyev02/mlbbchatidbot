// ---------------------------------------------------------------------------
// Shaxsiy kabinetdan kelgan xarid so'rovini do'kon egasiga yuborish.
//
// Bot ichidagi Firstmail xaridi bilan bir xil qoida (api/bot.js →
// notifyShopBuyRequest): so'rov do'kon egasiga boradi — SHOP_NOTIFY_CHAT_ID,
// aks holda @Ksava_org (api/_contact.js) bo'yicha bot_users dan topilgan chat. Egasiga
// yetib bormasa — zaxira sifatida ADMIN_IDS ga.
// ---------------------------------------------------------------------------

const { ADMIN_CONTACT_USERNAME } = require("./_contact.js");
const { enrichPremiumEmojis } = require("./_premium-emoji.js");
const DEFAULT_ADMIN_IDS = "7396686285,5081175125";
// bot.js dagi MAIN_GROUP_ID bilan bir xil: env yo'q bo'lsa — shu guruh, bo'sh bo'lsa — o'chiq.
const DEFAULT_MAIN_GROUP_ID = "-1004434649076";

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

  const mainGroupId = env.MAIN_GROUP_ID === undefined || env.MAIN_GROUP_ID === null
    ? DEFAULT_MAIN_GROUP_ID
    : cleanEnv(env.MAIN_GROUP_ID);

  return {
    notifyChatId: /^-?\d{1,20}$/.test(cleanEnv(env.SHOP_NOTIFY_CHAT_ID)) ? cleanEnv(env.SHOP_NOTIFY_CHAT_ID) : null,
    mainGroupId: /^-?\d{1,20}$/.test(mainGroupId) ? mainGroupId : null,
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

// Asosiy guruhga (MAIN_GROUP_ID) — kim nimani sotib olgani (bot ichidagi va
// kabinetdagi xarid uchun bir xil). Parol hech qachon yozilmaydi.
function buildMainGroupSaleText(user, { kind, item, price }) {
  const mention = user.username
    ? `@${escapeHtml(user.username)}`
    : `<a href="tg://user?id=${escapeHtml(user.id)}">${escapeHtml(user.first_name || "Foydalanuvchi")}</a>`;
  const what = kind === "firstmail"
    ? `<b>${escapeHtml(item.email)}</b> ni sotib oldi`
    : `<b>${escapeHtml(LIMIT_KIND_LABELS[item.kind] || item.kind)}</b> limitidan <b>${escapeHtml(item.amount)} ta</b> sotib oldi`;

  return [
    kind === "firstmail" ? "#sotuv #firstmail" : "#sotuv #limit",
    `${mention} ${what} — ${escapeHtml(formatSom(price))}.`,
  ].join("\n");
}

// Asosiy guruhga — kim balansini qancha summaga to'ldirgani. Balans
// qoldig'i yozilmaydi (faqat foydalanuvchining o'ziga boradi).
function buildMainGroupTopupText(user, amount) {
  const mention = user.username
    ? `@${escapeHtml(user.username)}`
    : `<a href="tg://user?id=${escapeHtml(user.id)}">${escapeHtml(user.first_name || "Foydalanuvchi")}</a>`;
  return [
    "#balans #toldirish",
    `💰 ${mention} balansini <b>${escapeHtml(formatSom(amount))}</b>ga to'ldirdi.`,
  ].join("\n");
}

// "ab***@gmail.com" — guruh va tarix uchun (to'liq email faqat egasiga).
function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

// Asosiy guruhga — kim "Qurilmalardan chiqish" xizmatidan foydalangani. Email yozilmaydi.
function buildMainGroupDeviceLogoutText(user, price) {
  const mention = user.username
    ? `@${escapeHtml(user.username)}`
    : `<a href="tg://user?id=${escapeHtml(user.id)}">${escapeHtml(user.first_name || "Foydalanuvchi")}</a>`;
  return [
    "#sotuv #device_logout",
    `🔐 ${mention} akkauntini barcha qurilmalardan chiqardi — <b>${escapeHtml(formatSom(price))}</b>.`,
  ].join("\n");
}

const DEVICE_LOGOUT_DONE_TEXT = {
  uz: (d) => [
    "✅ <b>Barcha qurilmalardan chiqildi</b>",
    "",
    `📧 Akkaunt: <code>${d.email}</code>`,
    `💳 Balansdan yechildi: <b>${d.price}</b>`,
    `💰 Qoldiq: <b>${d.balance}</b>`,
    "",
    "Endi akkauntga faqat siz kira olasiz. Xavfsizlik uchun Moonton parolingizni ham almashtirib qo'ying.",
  ],
  ru: (d) => [
    "✅ <b>Выполнен выход со всех устройств</b>",
    "",
    `📧 Аккаунт: <code>${d.email}</code>`,
    `💳 Списано с баланса: <b>${d.price}</b>`,
    `💰 Остаток: <b>${d.balance}</b>`,
    "",
    "Теперь войти в аккаунт можете только вы. Для безопасности смените и пароль Moonton.",
  ],
  en: (d) => [
    "✅ <b>Logged out of all devices</b>",
    "",
    `📧 Account: <code>${d.email}</code>`,
    `💳 Charged from balance: <b>${d.price}</b>`,
    `💰 Balance left: <b>${d.balance}</b>`,
    "",
    "Only you can sign in to the account now. For safety, change your Moonton password as well.",
  ],
};

function buildDeviceLogoutDoneText(lang, { email, price, balance }) {
  const unit = lang === "ru" ? "сум" : lang === "en" ? "UZS" : "so'm";
  const fmt = (v) => `${String(Math.max(0, Math.round(Number(v) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${unit}`;
  return (DEVICE_LOGOUT_DONE_TEXT[lang] || DEVICE_LOGOUT_DONE_TEXT.uz)({
    email: escapeHtml(email),
    price: fmt(price),
    balance: fmt(balance),
  }).join("\n");
}

// Admin panel → Balans: admin qo'lda pul qo'shganda (bonus, kompensatsiya…).
function buildMainGroupAdminCreditText(user, amount) {
  const mention = user.username
    ? `@${escapeHtml(user.username)}`
    : `<a href="tg://user?id=${escapeHtml(user.id)}">${escapeHtml(user.first_name || "Foydalanuvchi")}</a>`;
  return [
    "#balans #admin",
    `💰 ${mention} balansiga admin tomonidan <b>${escapeHtml(formatSom(amount))}</b> qo'shildi.`,
  ].join("\n");
}

// Asosiy guruhga — kim "Email almashtirish" xizmatidan foydalangani. Email yozilmaydi.
function buildMainGroupChangeEmailText(user, price) {
  const mention = user.username
    ? `@${escapeHtml(user.username)}`
    : `<a href="tg://user?id=${escapeHtml(user.id)}">${escapeHtml(user.first_name || "Foydalanuvchi")}</a>`;
  return [
    "#sotuv #change_email",
    `✉️ ${mention} akkaunt emailini almashtirdi — <b>${escapeHtml(formatSom(price))}</b>.`,
  ].join("\n");
}

const CHANGE_EMAIL_DONE_TEXT = {
  uz: (d) => [
    "✅ <b>Akkaunt emaili almashtirildi</b>",
    "",
    `📤 Eski email: <code>${d.oldEmail}</code>`,
    `📥 Yangi email: <code>${d.newEmail}</code>`,
    `💳 Balansdan yechildi: <b>${d.price}</b>`,
    `💰 Qoldiq: <b>${d.balance}</b>`,
    "",
    "Endi akkauntga yangi email orqali kiriladi. Yangi emailga kirish ma'lumotlarini hech kimga bermang.",
  ],
  ru: (d) => [
    "✅ <b>Email аккаунта изменён</b>",
    "",
    `📤 Старый email: <code>${d.oldEmail}</code>`,
    `📥 Новый email: <code>${d.newEmail}</code>`,
    `💳 Списано с баланса: <b>${d.price}</b>`,
    `💰 Остаток: <b>${d.balance}</b>`,
    "",
    "Теперь вход в аккаунт — через новый email. Никому не передавайте доступ к нему.",
  ],
  en: (d) => [
    "✅ <b>Account email changed</b>",
    "",
    `📤 Old email: <code>${d.oldEmail}</code>`,
    `📥 New email: <code>${d.newEmail}</code>`,
    `💳 Charged from balance: <b>${d.price}</b>`,
    `💰 Balance left: <b>${d.balance}</b>`,
    "",
    "Sign in with the new email from now on. Never share access to it.",
  ],
};

function buildChangeEmailDoneText(lang, { oldEmail, newEmail, price, balance }) {
  const unit = lang === "ru" ? "сум" : lang === "en" ? "UZS" : "so'm";
  const fmt = (v) => `${String(Math.max(0, Math.round(Number(v) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${unit}`;
  return (CHANGE_EMAIL_DONE_TEXT[lang] || CHANGE_EMAIL_DONE_TEXT.uz)({
    oldEmail: escapeHtml(oldEmail || "—"),
    newEmail: escapeHtml(newEmail || "—"),
    price: fmt(price),
    balance: fmt(balance),
  }).join("\n");
}

function buildTopupCreditedText(amount, balance) {
  return [
    "✅ <b>Balans to'ldirildi</b>",
    "",
    `➕ Tushgan summa: <b>${escapeHtml(formatSom(amount))}</b>`,
    `💳 Joriy balans: <b>${escapeHtml(formatSom(balance))}</b>`,
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

  // Asosiy guruhga — "👤 Profilni ochish" tugmasi bilan; tg://user tugmasini
  // xaridorning maxfiylik sozlamasi rad etsa — tugmasiz.
  async function notifyMainGroup(text, buyerId) {
    if (!botToken || !config.mainGroupId) {
      return false;
    }

    const button = { inline_keyboard: [[{ text: "👤 Profilni ochish", url: `tg://user?id=${buyerId}` }]] };
    const body = enrichPremiumEmojis(text);

    try {
      if (await telegramSend(config.mainGroupId, body, button)) return true;
      return await telegramSend(config.mainGroupId, body, null);
    } catch (error) {
      console.error("[SHOP_MAIN_GROUP_NOTIFY]", error?.message);
      return false;
    }
  }

  return {
    supportUsername: config.supportUsername,
    notify,
    notifyMainGroup,
  };
}

module.exports = {
  LIMIT_KIND_LABELS,
  buildFirstmailBuyText,
  buildLimitBuyText,
  buildMainGroupSaleText,
  buildChangeEmailDoneText,
  buildDeviceLogoutDoneText,
  buildMainGroupChangeEmailText,
  buildMainGroupDeviceLogoutText,
  buildMainGroupAdminCreditText,
  buildMainGroupTopupText,
  buildTopupCreditedText,
  maskEmail,
  buildWalletSaleText,
  createShopNotifier,
  resolveShopNotifyConfig,
};
