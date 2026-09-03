const crypto = require("node:crypto");

const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL).replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = resolveServiceKey(process.env);
const ADMIN_PANEL_SECRET = cleanEnv(
  process.env.ADMIN_PANEL_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET
);
const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const SUPABASE_TIMEOUT_MS = parseBoundedNumber(
  process.env.SUPABASE_TIMEOUT_MS,
  2500,
  300,
  8000
);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 kun
const COOKIE_NAME = "mlbb_admin_session";

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET" && !isAdminAction(req)) {
      const session = readSession(req);
      const authed = session ? await isAuthed(session) : false;

      if (authed) {
        return serveDashboard(req, res, session);
      }

      return serveLogin(req, res, "");
    }

    if (req.method === "POST") {
      const body = parseBody(req.body);
      const action = String(body.action || req.query?.action || "");

      if (action === "login") {
        return handleLogin(req, res, body);
      }
      if (action === "logout") {
        return handleLogout(req, res);
      }
      if (action === "change_password") {
        return handleChangePassword(req, res, body);
      }
      if (action === "create_token") {
        return handleCreateToken(req, res, body);
      }
      if (action === "revoke_token") {
        return handleRevokeToken(req, res, body);
      }

      return serveLogin(req, res, "Noma'lum amal.");
    }

    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (error) {
    console.error("[ADMIN_PANEL_ERROR]", error);
    return serveLogin(req, res, "Kutilmagan xatolik yuz berdi. Keyinroq urinib ko'ring.");
  }
};

// ------------------------------------------------------------------
// Auth / session
// ------------------------------------------------------------------
function readSession(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const value = cookies[COOKIE_NAME];
  if (!value) {
    return null;
  }
  const [payloadB64, signature] = value.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }
  const payload = safeJsonParse(base64Decode(payloadB64));
  if (!payload || typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return null;
  }
  const expected = sign(payloadB64);
  if (!timingSafeEqualStr(expected, signature)) {
    return null;
  }
  return payload;
}

function sign(value) {
  return crypto
    .createHmac("sha256", ADMIN_PANEL_SECRET)
    .update(String(value))
    .digest("base64url");
}

function createSession(res) {
  const payloadB64 = base64Encode(
    JSON.stringify({
      sub: DEFAULT_ADMIN_USER,
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL_MS,
    })
  );
  const value = `${payloadB64}.${sign(payloadB64)}`;

  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${value}; HttpOnly; Path=/; SameSite=Lax`);

  return value;
}

function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );
}

async function isAuthed(session) {
  if (!session || session.sub !== DEFAULT_ADMIN_USER) {
    return false;
  }
  return true;
}

// ------------------------------------------------------------------
// Login / logout / password
// ------------------------------------------------------------------
async function handleLogin(req, res, body) {
  const username = cleanEnv(body.username);
  const password = cleanEnv(body.password);

  if (username !== DEFAULT_ADMIN_USER) {
    return serveLogin(req, res, "Foydalanuvchi nomi yoki parol noto'g'ri.");
  }

  const valid = await checkPassword(password);
  if (!valid) {
    return serveLogin(req, res, "Foydalanuvchi nomi yoki parol noto'g'ri.");
  }

  createSession(res);
  return redirect(res, "/api/admin");
}

function handleLogout(req, res) {
  clearSession(res);
  return redirect(res, "/api/admin");
}

async function handleChangePassword(req, res, body) {
  const session = readSession(req);
  if (!(await isAuthed(session))) {
    return serveLogin(req, res, "Avval tizimga kiring.");
  }

  const current = cleanEnv(body.current_password);
  const next = cleanEnv(body.new_password);

  if (!current || !next) {
    return serveDashboard(req, res, session, "Joriy va yangi parol kiritilishi shart.");
  }

  if (next.length < 6) {
    return serveDashboard(req, res, session, "Yangi parol kamida 6 belgidan iborat bo'lsin.");
  }

  if (!(await checkPassword(current))) {
    return serveDashboard(req, res, session, "Joriy parol noto'g'ri.");
  }

  await setPassword(next);
  return serveDashboard(req, res, session, "✅ Parol muvaffaqiyatli o'zgartirildi.");
}

// ------------------------------------------------------------------
// Token management
// ------------------------------------------------------------------
async function handleCreateToken(req, res, body) {
  const session = readSession(req);
  if (!(await isAuthed(session))) {
    return serveLogin(req, res, "Avval tizimga kiring.");
  }

  const title = cleanEnv(body.title);
  const days = parseInt(body.days, 10);

  if (!Number.isFinite(days) || days <= 0 || days > 3650) {
    return serveDashboard(
      req,
      res,
      session,
      "Amal qilish muddati 1 dan 3650 kungacha bo'lishi kerak."
    );
  }

  const rawToken = `mlbb_${crypto.randomBytes(20).toString("hex")}`;
  const tokenHash = hashToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 14) + "...";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return serveDashboard(req, res, session, "Supabase ulanishi sozlanmagan.");
  }

  try {
    await supabaseRequest("/api_tokens", {
      method: "POST",
      body: {
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        title,
        created_by: DEFAULT_ADMIN_USER,
        expires_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
        is_revoked: false,
        usage_count: 0,
      },
      prefer: "return=minimal",
    });

    return serveDashboard(
      req,
      res,
      session,
      "",
      `✅ Token yaratildi.\n\n<b>Token:</b> <code>${rawToken}</code>\n\nBu token shu sahifada faqat bir marta ko'rsatiladi. Uni xavfsiz saqlang.`
    );
  } catch (error) {
    console.error("[ADMIN_CREATE_TOKEN_ERROR]", error);
    return serveDashboard(req, res, session, "Tokenni yaratishda xatolik yuz berdi.");
  }
}

async function handleRevokeToken(req, res, body) {
  const session = readSession(req);
  if (!(await isAuthed(session))) {
    return serveLogin(req, res, "Avval tizimga kiring.");
  }

  const id = parseInt(body.id, 10);
  if (!Number.isFinite(id)) {
    return serveDashboard(req, res, session, "Token ID topilmadi.");
  }

  try {
    await supabaseRequest(`/api_tokens?id=eq.${id}`, {
      method: "PATCH",
      body: { is_revoked: true },
    });

    return serveDashboard(req, res, session, `✅ Token #${id} bekor qilindi.`);
  } catch (error) {
    console.error("[ADMIN_REVOKE_TOKEN_ERROR]", error);
    return serveDashboard(req, res, session, "Tokenni bekor qilishda xatolik yuz berdi.");
  }
}

// ------------------------------------------------------------------
// Password storage
// ------------------------------------------------------------------
async function checkPassword(password) {
  try {
    const rows = await supabaseRequest(
      `/admin_settings?key=eq.admin_password&select=value&limit=1`
    );

    if (Array.isArray(rows) && rows.length > 0 && rows[0]?.value) {
      const { salt, hash } = rows[0].value;
      const candidate = crypto
        .createHash("sha256")
        .update(String(salt) + ":" + String(password))
        .digest("hex");
      return timingSafeEqualStr(candidate, hash);
    }

    // Default fallback
    return timingSafeEqualStr(password, DEFAULT_ADMIN_PASSWORD);
  } catch (error) {
    console.error("[CHECK_PASSWORD_ERROR]", error);
    return timingSafeEqualStr(password, DEFAULT_ADMIN_PASSWORD);
  }
}

async function setPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHash("sha256")
    .update(salt + ":" + String(password))
    .digest("hex");

  await supabaseRequest("/admin_settings?on_conflict=key", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: { key: "admin_password", value: { salt, hash } },
  });
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

// ------------------------------------------------------------------
// Dashboard rendering
// ------------------------------------------------------------------
async function serveDashboard(req, res, session, message = "", notice = "") {
  const rowData = "/api_tokens?select=id,token_prefix,title,created_at,expires_at,usage_count,is_revoked,last_used_at&order=created_at.desc&limit=200";

  let tokens = [];
  try {
    tokens = await supabaseRequest(rowData);
    if (!Array.isArray(tokens)) {
      tokens = [];
    }
  } catch (error) {
    console.error("[ADMIN_LIST_TOKENS_ERROR]", error);
  }

  const html = renderDashboard({
    message,
    notice,
    tokens,
  });

  return res
    .status(200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Cache-Control", "no-store")
    .send(html);
}

function renderDashboard({ message, notice, tokens }) {
  const tokenRows = tokens
    .map((t) => {
      const status = t.is_revoked
        ? '<span style="color:#d9534f;font-weight:bold">Bekor qilingan</span>'
        : new Date(t.expires_at).getTime() < Date.now()
        ? '<span style="color:#f0ad4e;font-weight:bold">Muddati tugagan</span>'
        : '<span style="color:#5cb85c;font-weight:bold">Faol</span>';
      const expires = formatDate(t.expires_at);
      const created = formatDate(t.created_at);
      const lastUsed = t.last_used_at ? formatDate(t.last_used_at) : "—";
      return `
      <tr>
        <td>${escapeHtml(t.token_prefix || "—")}</td>
        <td>${escapeHtml(t.title || "—")}</td>
        <td>${created}</td>
        <td>${expires}</td>
        <td>${Number(t.usage_count || 0)}</td>
        <td>${lastUsed}</td>
        <td>${status}</td>
        <td>${t.is_revoked ? "—" : `
          <form method="POST" action="/api/admin?action=revoke_token" style="display:inline">
            <input type="hidden" name="action" value="revoke_token">
            <input type="hidden" name="id" value="${t.id}">
            <button type="submit" onclick="return confirm('Bu tokenni bekor qilasizmi?')" style="background:#d9534f;color:#fff;border:0;padding:5px 10px;border-radius:4px;cursor:pointer">Bekor qilish</button>
          </form>
        `}</td>
      </tr>`;
    })
    .join("");

  const messageHtml = message ? `<div style="background:#fcf8e3;border:1px solid #faebcc;color:#8a6d3b;padding:10px;border-radius:4px;margin-bottom:15px">${message}</div>` : "";
  const noticeHtml = notice ? `<div style="background:#dff0d8;border:1px solid #d6e9c6;color:#3c763d;padding:12px;border-radius:4px;margin-bottom:15px;word-break:break-all">${notice}</div>` : "";

  return `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MLBB Bot — Admin</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6f8;margin:0;padding:20px;color:#333}
  .wrap{max-width:1000px;margin:0 auto}
  .card{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);padding:20px;margin-bottom:20px}
  h1,h2{margin-top:0}
  input[type=text],input[type=password],input[type=number]{width:100%;padding:9px;border:1px solid #ccd;border-radius:4px;box-sizing:border-box;margin-bottom:10px}
  button{background:#337ab7;color:#fff;border:0;padding:9px 14px;border-radius:4px;cursor:pointer}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{border:1px solid #e1e4e8;padding:8px;text-align:left;white-space:nowrap}
  th{background:#f6f8fa}
  .logout{float:right;background:#777}
  code{background:#f0f0f0;padding:2px 4px;border-radius:3px}
  .grid{display:flex;gap:20px}
  .grid > div{flex:1}
  @media(max-width:640px){.grid{flex-direction:column}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>📊 MLBB Bot — Admin Panel</h1>
    <a href="/api/admin?action=logout" class="logout"><button class="logout">Chiqish</button></a>
  </div>

  ${messageHtml}
  ${noticeHtml}

  <div class="grid">
    <div class="card">
      <h2>🔑 Yangi token yaratish</h2>
      <form method="POST" action="/api/admin?action=create_token">
        <input type="hidden" name="action" value="create_token">
        <label>Sarlavha (title)</label>
        <input type="text" name="title" placeholder="Masalan: Hamkor sayti / Alisa" required>
        <label>Amal qilish muddati (kun)</label>
        <input type="number" name="days" min="1" max="3650" placeholder="Masalan: 30" required>
        <button type="submit">Yaratish</button>
      </form>
    </div>

    <div class="card">
      <h2>🔒 Parolni o'zgartirish</h2>
      <form method="POST" action="/api/admin?action=change_password">
        <input type="hidden" name="action" value="change_password">
        <label>Joriy parol</label>
        <input type="password" name="current_password" required>
        <label>Yangi parol</label>
        <input type="password" name="new_password" required>
        <button type="submit">Saqlash</button>
      </form>
    </div>
  </div>

  <div class="card">
    <h2>📋 Tokenlar (${tokens.length})</h2>
    <div style="overflow-x:auto">
    <table>
      <thead>
        <tr>
          <th>Token (avvali)</th>
          <th>Sarlavha</th>
          <th>Yaratilgan</th>
          <th>Muddati</th>
          <th>Ishlatish</th>
          <th>Oxirgi ishlatish</th>
          <th>Holat</th>
          <th>Amal</th>
        </tr>
      </thead>
      <tbody>
        ${tokenRows || '<tr><td colspan="8">Hozircha tokenlar yo\'q.</td></tr>'}
      </tbody>
    </table>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ------------------------------------------------------------------
// Login rendering
// ------------------------------------------------------------------
function serveLogin(req, res, error = "") {
  const errorHtml = error
    ? `<div style="background:#f2dede;border:1px solid #ebccd1;color:#a94442;padding:10px;border-radius:4px;margin-bottom:15px">${escapeHtml(error)}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MLBB Admin — Login</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6f8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.15);padding:30px;width:100%;max-width:360px}
  h1{text-align:center;margin-top:0;font-size:20px}
  input{width:100%;padding:10px;border:1px solid #ccd;border-radius:4px;box-sizing:border-box;margin-bottom:12px}
  button{width:100%;background:#337ab7;color:#fff;border:0;padding:11px;border-radius:4px;cursor:pointer;font-size:15px}
</style>
</head>
<body>
  <div class="card">
    <h1>🔐 MLBB Admin Panel</h1>
    ${errorHtml}
    <form method="POST" action="/api/admin?action=login">
      <input type="hidden" name="action" value="login">
      <input type="text" name="username" placeholder="Foydalanuvchi nomi" required>
      <input type="password" name="password" placeholder="Parol" required>
      <button type="submit">Kirish</button>
    </form>
  </div>
</body>
</html>`;

  return res
    .status(200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Cache-Control", "no-store")
    .send(html);
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function isAdminAction(req) {
  return (req.query && typeof req.query?.action === "string");
}

function redirect(res, location) {
  return res
    .status(302)
    .setHeader("Location", location)
    .send("");
}

function parseBody(body) {
  if (!body) {
    return {};
  }
  if (typeof body === "object") {
    return body;
  }
  try {
    return JSON.parse(String(body));
  } catch {
    return {};
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) {
    return out;
  }
  for (const part of String(cookieHeader).split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) {
      try {
        out[k] = decodeURIComponent(v.join("="));
      } catch {
        out[k] = v.join("=");
      }
    }
  }
  return out;
}

function base64Encode(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function base64Decode(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function timingSafeEqualStr(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function formatDate(iso) {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function supabaseRequest(path, options = {}) {
  const { method = "GET", body, prefer } = options;
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (prefer) {
    headers.Prefer = prefer;
  }

  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}: ${text}`);
  }

  return json;
}

function resolveServiceKey(env) {
  const candidates = [
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_SERVICE_KEY,
    env.SUPABASE_SECRET_KEY,
    env.SUPABASE_SERVICE_ROLE,
    env.SUPABASE_SERVICE_ROLE_SECRET,
    env.SUPABASE_SERVICE_RELE_KEY,
  ];

  for (const key of candidates) {
    if (key && String(key).trim()) {
      return String(key).trim();
    }
  }

  return "";
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || SUPABASE_TIMEOUT_MS);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function cleanEnv(value) {
  return String(value ?? "").trim();
}

function parseBoundedNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}
