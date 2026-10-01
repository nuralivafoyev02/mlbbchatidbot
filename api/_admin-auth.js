// ---------------------------------------------------------------------------
// Admin panel login — faqat env orqali.
//
//   ADMIN_PANEL_USERNAME — login
//   ADMIN_PANEL_PASSWORD — parol
//
// Kodda standart login/parol YO'Q: env sozlanmagan bo'lsa panelga kirib
// bo'lmaydi (fail-closed). Sessiya imzosi kaliti env paroldan ham olinadi —
// parol almashtirilsa, eski sessiyalar avtomatik bekor bo'ladi.
//
// Fayl nomi `_` bilan boshlanadi — Vercel uni endpoint deb hisoblamaydi.
// ---------------------------------------------------------------------------

const crypto = require("node:crypto");

function getAdminCredentials(env = process.env) {
  const username = String(env.ADMIN_PANEL_USERNAME || "").trim();
  const password = String(env.ADMIN_PANEL_PASSWORD || "");

  return {
    username,
    password,
    configured: Boolean(username && password),
  };
}

function isAdminLoginConfigured(env = process.env) {
  return getAdminCredentials(env).configured;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

// Uzunlikdan qat'i nazar doimiy vaqtli taqqoslash (hash orqali).
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function verifyAdminLogin(username, password, env = process.env) {
  const creds = getAdminCredentials(env);

  if (!creds.configured) {
    return false;
  }

  const userOk = safeEqual(String(username || "").trim(), creds.username);
  const passOk = safeEqual(String(password || ""), creds.password);

  return userOk && passOk;
}

function getAdminSessionSubject(env = process.env) {
  return getAdminCredentials(env).username;
}

function getAdminSessionKey(env = process.env) {
  const creds = getAdminCredentials(env);
  const secret = String(env.ADMIN_PANEL_SECRET || env.TELEGRAM_WEBHOOK_SECRET || "").trim();

  return crypto
    .createHash("sha256")
    .update(`${secret}\n${creds.username}\n${creds.password}`)
    .digest();
}

module.exports = {
  getAdminCredentials,
  getAdminSessionKey,
  getAdminSessionSubject,
  isAdminLoginConfigured,
  verifyAdminLogin,
};
