// ---------------------------------------------------------------------------
// Ommaviy API kalitlari: muddat tugashiga 7 kun qolganda ogohlantirish.
//
// Worker cron'i (*/10) ichida soatiga bir marta, Toshkent vaqti 09:00–21:00
// oralig'ida ishlaydi. Muddati 7 kun ichida tugaydigan, bekor qilinmagan
// kalitlar uchun:
//   * egasiga (api_tokens.owner_user_id, admin panelda bir marta kiritiladi),
//   * adminlarga (ADMIN_IDS) — egasi bo'lmasa ham
// bitta xabar yuboriladi. Har bir muddat uchun faqat BIR MARTA:
// api_tokens.expiry_reminded_for = o'sha expires_at (supabase/029). Kalit
// uzaytirilsa expires_at o'zgaradi va keyingi muddat uchun yana ogohlantiriladi.
// "Belgilash" shartli PATCH bilan — ikki tick bir vaqtda ishlasa ham bitta xabar.
//
// Beta va prod bitta bazani ishlatadi — ikki marta yubormaslik uchun faqat
// API_TOKEN_REMINDERS=true bo'lgan Worker (prod) yuboradi.
// ---------------------------------------------------------------------------

export const REMINDER_WINDOW_DAYS = 7;
const DAY_MS = 86400000;
const TZ_OFFSET_MS = 5 * 3600 * 1000; // Asia/Tashkent
const CONTACT = "@vafoyev_n";

function clean(value) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatTashkentDate(iso) {
  const d = new Date(Date.parse(iso) + TZ_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function daysLeft(iso, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / DAY_MS));
}

// Soatiga bir marta (har soatning birinchi 10 daqiqalik tick'i) va kunduzi.
export function isReminderTick(now = Date.now()) {
  const local = new Date(now + TZ_OFFSET_MS);
  const hour = local.getUTCHours();
  return local.getUTCMinutes() < 10 && hour >= 9 && hour < 21;
}

export function buildOwnerReminderText(token, now = Date.now()) {
  const left = daysLeft(token.expires_at, now);
  return [
    "⏳ <b>Kalitingiz muddati tugashiga oz qoldi!</b>",
    "",
    `🔑 Kalit: <b>${escapeHtml(token.title || "API")}</b>`,
    `📅 Tugash sanasi: <b>${formatTashkentDate(token.expires_at)}</b> (${left} kun qoldi)`,
    "",
    `Muddatni uzaytirish uchun: ${CONTACT}`,
  ].join("\n");
}

export function buildAdminReminderText(token, ownerResult, now = Date.now()) {
  const left = daysLeft(token.expires_at, now);
  const owner = token.owner_user_id
    ? `<a href="tg://user?id=${escapeHtml(token.owner_user_id)}">${escapeHtml(token.owner_user_id)}</a>` +
      (ownerResult === "sent" ? " — xabar yuborildi" : " — xabar yetib bormadi")
    : "kiritilmagan (admin panel → Ommaviy API → kalit → Telegram ID)";
  return [
    "#api_kalit #muddat",
    "⏳ <b>API kaliti muddati tugashiga oz qoldi</b>",
    "",
    `🔑 ${escapeHtml(token.title || "API")} · <code>${escapeHtml(token.token_prefix || "")}</code>`,
    `📅 Tugaydi: <b>${formatTashkentDate(token.expires_at)}</b> (${left} kun qoldi)`,
    `👤 Egasi: ${owner}`,
  ].join("\n");
}

async function sendTelegram(fetchImpl, token, chatId, text) {
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = await response.json().catch(() => null);
    if (!data?.ok) console.error("[API_TOKEN_REMINDER_SEND]", chatId, data?.description || response.status);
    return Boolean(data?.ok);
  } catch (error) {
    console.error("[API_TOKEN_REMINDER_SEND]", chatId, error?.message || error);
    return false;
  }
}

export async function runApiTokenReminders({ env = {}, fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  if (clean(env.API_TOKEN_REMINDERS) !== "true") return { ok: true, skipped: "disabled" };
  if (!force && !isReminderTick(now)) return { ok: true, skipped: "not_now" };

  const botToken = clean(env.TELEGRAM_BOT_TOKEN);
  const base = clean(env.SUPABASE_URL).replace(/\/+$/, "");
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEY);
  if (!botToken || !base || !key) return { ok: false, error: "not_configured" };

  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const nowIso = new Date(now).toISOString();
  const untilIso = new Date(now + REMINDER_WINDOW_DAYS * DAY_MS).toISOString();
  const params = new URLSearchParams({
    select: "id,title,token_prefix,expires_at,owner_user_id,expiry_reminded_for",
    is_revoked: "eq.false",
    and: `(expires_at.gt.${nowIso},expires_at.lte.${untilIso})`,
    order: "expires_at.asc",
    limit: "50",
  });

  let tokens;
  try {
    const response = await fetchImpl(`${base}/rest/v1/api_tokens?${params.toString()}`, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 160)}`);
    tokens = await response.json();
  } catch (error) {
    // 029 qo'llanmagan bo'lsa (expiry_reminded_for yo'q) — jim o'tamiz.
    console.error("[API_TOKEN_REMINDER_LIST]", error?.message || error);
    return { ok: false, error: "list_failed" };
  }

  const due = (Array.isArray(tokens) ? tokens : []).filter(
    (t) => !t.expiry_reminded_for || Date.parse(t.expiry_reminded_for) !== Date.parse(t.expires_at)
  );
  const adminIds = clean(env.ADMIN_IDS).split(/[\s,]+/).filter((id) => /^\d{3,20}$/.test(id));
  const sent = [];

  for (const token of due) {
    // Avval "band qilamiz": faqat hali belgilanmagan bo'lsa yangilanadi.
    const claim = new URLSearchParams({
      id: `eq.${token.id}`,
      or: `(expiry_reminded_for.is.null,expiry_reminded_for.neq.${token.expires_at})`,
    });
    let claimed = false;
    try {
      const response = await fetchImpl(`${base}/rest/v1/api_tokens?${claim.toString()}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ expiry_reminded_for: token.expires_at }),
      });
      const rows = response.ok ? await response.json().catch(() => []) : [];
      claimed = Array.isArray(rows) && rows.length > 0;
    } catch (error) {
      console.error("[API_TOKEN_REMINDER_CLAIM]", token.id, error?.message || error);
    }
    if (!claimed) continue;

    let ownerResult = null;
    if (token.owner_user_id) {
      ownerResult = (await sendTelegram(fetchImpl, botToken, token.owner_user_id, buildOwnerReminderText(token, now))) ? "sent" : "failed";
    }
    const adminText = buildAdminReminderText(token, ownerResult, now);
    for (const adminId of adminIds) {
      await sendTelegram(fetchImpl, botToken, adminId, adminText);
    }
    sent.push({ id: token.id, owner: ownerResult });
  }

  return { ok: true, checked: due.length, sent };
}
