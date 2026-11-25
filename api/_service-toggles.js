// ---------------------------------------------------------------------------
// Pullik Jebray xizmatlarini (device logout, email almashtirish) admin panel
// (Do'kon) orqali vaqtincha o'chirib/yoqish.
//
// Beta va prod bitta Supabase'ni ishlatadi, shuning uchun holat har bir bot
// uchun alohida saqlanadi (majburiy kanal kabi):
//   bot_settings.key = "service_toggles:<bot_id>"
//   value = { device_logout: true|false, change_email: true|false }
// Bot (api/bot.js), kabinet/xizmat sahifalari (api/account.js) va admin panel
// (api/miniapp.js) kalitni o'z muhitining TELEGRAM_BOT_TOKEN'idan oladi.
//
// Yozuv yo'q yoki qiymat aniq `false` emas — xizmat yoqilgan hisoblanadi.
// Env flag (JEBRAY_*_ENABLED) va JEBRAY_RESELLER_API_KEY bu yerda tekshirilmaydi —
// ular muhit darajasidagi shart bo'lib qoladi, bu esa uning ustidagi o'chirgich.
// ---------------------------------------------------------------------------
const SERVICE_TOGGLES_PREFIX = "service_toggles";
const TOGGLE_SERVICES = Object.freeze(["device_logout", "change_email"]);

function serviceTogglesKey(botToken) {
  const botId = String(botToken || "").trim().split(":")[0];
  return /^\d{3,20}$/.test(botId) ? `${SERVICE_TOGGLES_PREFIX}:${botId}` : SERVICE_TOGGLES_PREFIX;
}

function normalizeServiceToggles(value) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  for (const name of TOGGLE_SERVICES) out[name] = source[name] !== false;
  return out;
}

// request(path, { method, body, prefer }) — Supabase REST yordamchisi.
// Xatoda xizmatlar yoqilgan deb olinadi: Supabase ishlamasa balans ham
// ishlamaydi va pul yechilmagan holda xizmat baribir bajarilmaydi.
async function loadServiceToggles(request, key) {
  try {
    const rows = await request(`/bot_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
    return normalizeServiceToggles(Array.isArray(rows) && rows[0] ? rows[0].value : null);
  } catch (error) {
    console.error("[SERVICE_TOGGLES_LOAD]", error?.message || error);
    return normalizeServiceToggles(null);
  }
}

async function saveServiceToggle(request, key, service, enabled) {
  if (!TOGGLE_SERVICES.includes(service)) throw new Error("unknown_service");
  const rows = await request(`/bot_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
  const current = normalizeServiceToggles(Array.isArray(rows) && rows[0] ? rows[0].value : null);
  const next = { ...current, [service]: Boolean(enabled) };
  await request(`/bot_settings?on_conflict=key`, {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: { key, value: next },
  });
  return next;
}

module.exports = {
  SERVICE_TOGGLES_PREFIX,
  TOGGLE_SERVICES,
  serviceTogglesKey,
  normalizeServiceToggles,
  loadServiceToggles,
  saveServiceToggle,
};
