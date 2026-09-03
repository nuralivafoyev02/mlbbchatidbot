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
    return serveLogin(req, res, "Kutilmagan xatolik yuz berdi: " + safeErrorMessage(error));
  }
};

function safeErrorMessage(error) {
  try {
    if (error instanceof Error) {
      return String(error.message || "").slice(0, 220);
    }
    return String(error).slice(0, 220);
  } catch {
    return "texnik xatolik";
  }
}

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

  try {
    await setPassword(next);
  } catch (error) {
    console.error("[SET_PASSWORD_ERROR]", error);
    return serveDashboard(req, res, session, "Parolni saqlashda xatolik yuz berdi. Likinroq urinib ko'ring.");
  }
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
  let listError = "";
  try {
    tokens = await supabaseRequest(rowData);
    if (!Array.isArray(tokens)) {
      tokens = [];
    }
  } catch (error) {
    console.error("[ADMIN_LIST_TOKENS_ERROR]", error);
    listError = String(error.message || error);
  }

  const warnings = [];
  if (!SUPABASE_URL) {
    warnings.push("`SUPABASE_URL` env o'rnatilmagan (Vercel → Settings → Environment Variables).");
  } else if (!SUPABASE_SERVICE_KEY) {
    warnings.push("`SUPABASE_SERVICE_ROLE_KEY` env o'rnatilmagan (Vercel → Settings → Environment Variables).");
  } else if (listError) {
    if (/SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/.test(listError)) {
      warnings.push(listError);
    } else if (/relation.*(api_tokens|admin_settings).*does not exist|42P01/.test(listError)) {
      warnings.push("`api_tokens` jadvali topilmadi. Supabase SQL Editor'da `supabase/011_api_tokens.sql` migratsiyasini ishga tushiring.");
    } else {
      warnings.push("Tokenlar ro'yxatini yuklashda xatolik: " + listError);
    }
  }

  const html = renderDashboard({
    message,
    notice,
    tokens,
    warnings,
  });

  return res
    .status(200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Cache-Control", "no-store")
    .send(html);
}

function renderDashboard({ message, notice, tokens, warnings = [] }) {
  const warningHtml = warnings
    .map((w) => `<div class="warn">⚠️ ${escapeHtml(w)}</div>`)
    .join("");
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
  button.ghost{background:#6c757d}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{border:1px solid #e1e4e8;padding:8px;text-align:left;white-space:nowrap}
  th{background:#f6f8fa}
  code{background:#f0f0f0;padding:2px 4px;border-radius:3px}
  .alert{background:#fcf8e3;border:1px solid #faebcc;color:#8a6d3b;padding:10px;border-radius:4px;margin-bottom:15px}
  .notice{background:#dff0d8;border:1px solid #d6e9c6;color:#3c763d;padding:12px;border-radius:4px;margin-bottom:15px;word-break:break-all}
  .warn{background:#eaf4fb;border:1px solid #bcd8f0;color:#2c5f8a;padding:12px;border-radius:4px;margin-bottom:15px;font-size:14px}
  .topbar{display:flex;justify-content:space-between;align-items:center}
  /* Modal */
  .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:50}
  .modal.open{display:flex}
  .modal-card{background:#fff;border-radius:10px;padding:26px;width:100%;max-width:380px;box-shadow:0 10px 40px rgba(0,0,0,.3)}
  .modal-card h2{margin-top:0;color:#1f3a5f;font-size:18px}
  .modal-card .row{display:flex;gap:10px;margin-top:14px}
  .modal-card .row button{flex:1;padding:11px;border:0;border-radius:6px;cursor:pointer;font-size:15px}
  .btn-primary{background:#337ab7;color:#fff}
  .btn-ghost{background:#e4e4e4;color:#333}
  @media(max-width:640px){body{padding:10px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="topbar">
      <h1>📊 MLBB Bot — Admin Panel</h1>
      <a href="/api/admin?action=logout"><button class="ghost">Chiqish</button></a>
    </div>
  </div>

  ${message ? `<div class="alert">${message}</div>` : ""}
  ${notice ? `<div class="notice">${notice}</div>` : ""}
  ${warningHtml}

  <div class="card">
    <h2>🔑 Yangi token yaratish</h2>
    <form method="POST" action="/api/admin?action=create_token">
      <input type="hidden" name="action" value="create_token">
      <label>Sarlavha (title)</label>
      <input type="text" name="title" placeholder="Masalan: Hamkor sayti / Alisa" required>
      <label>Amal qilish muddati (kun)</label>
      <input type="number" name="days" min="1" max="3650" placeholder="Masalan: 30" required>
      <button type="submit">Yaratish</button>
      <button type="button" class="ghost" style="margin-left:8px" onclick="openModal('pwModal')">🔒 Parolni o'zgartirish</button>
    </form>
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

<div class="modal" id="pwModal" onclick="if(event.target===this)closeModal('pwModal')">
  <div class="modal-card">
    <h2>Parolni o'zgartirish</h2>
    <form method="POST" action="/api/admin?action=change_password">
      <input type="hidden" name="action" value="change_password">
      <label>Joriy parol</label>
      <input type="password" name="current_password" required autocomplete="current-password">
      <label>Yangi parol (kamida 6 belgi)</label>
      <input type="password" name="new_password" required autocomplete="new-password">
      <div class="row">
        <button type="button" class="btn-ghost" onclick="closeModal('pwModal')">Bekor qilish</button>
        <button type="submit" class="btn-primary">Saqlash</button>
      </div>
    </form>
  </div>
</div>

<script>
  function openModal(id){document.getElementById(id).classList.add('open')}
  function closeModal(id){document.getElementById(id).classList.remove('open')}
</script>
</body>
</html>`;
}

// ------------------------------------------------------------------
// Login rendering
// ------------------------------------------------------------------
function serveLogin(req, res, error = "") {
  const errorHtml = error
    ? `<div class="alert alert-error">${escapeHtml(error)}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MLBB Admin — Login</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:linear-gradient(135deg,#1f3a5f,#2c5f8a);display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#333}
  .card{background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:36px;width:100%;max-width:380px;text-align:center}
  h1{margin-top:0;font-size:22px;color:#1f3a5f}
  .sub{color:#888;margin-bottom:20px;font-size:14px}
  .lock{font-size:40px}
  .btn{background:#337ab7;color:#fff;border:0;padding:12px 22px;border-radius:6px;cursor:pointer;font-size:15px;width:100%}
  .btn:hover{background:#286090}
  .alert-error{background:#f2dede;border:1px solid #ebccd1;color:#a94442;padding:10px;border-radius:6px;margin-bottom:16px;font-size:14px;text-align:left}
  /* Modal */
  .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:50}
  .modal.open{display:flex}
  .modal-card{background:#fff;border-radius:12px;padding:28px;width:100%;max-width:360px;box-shadow:0 10px 40px rgba(0,0,0,.3)}
  .modal-card h2{margin-top:0;color:#1f3a5f;font-size:18px}
  .modal input[type=text],.modal input[type=password]{width:100%;padding:11px;border:1px solid #ccd;border-radius:6px;box-sizing:border-box;margin-bottom:12px;font-size:15px}
  .modal .row{display:flex;gap:10px;margin-top:14px}
  .modal .row button{flex:1;padding:11px;border:0;border-radius:6px;cursor:pointer;font-size:15px}
  .btn-primary{background:#337ab7;color:#fff}
  .btn-ghost{background:#e4e4e4;color:#333}
</style>
</head>
<body>
  <div class="card">
    <div class="lock">🔒</div>
    <h1>MLBB Admin Panel</h1>
    <div class="sub">Davom etish uchun tizimga kiring</div>
    ${errorHtml}
    <button class="btn" type="button" onclick="openModal()">🔐 Kirish</button>
  </div>

  <div class="modal" id="loginModal" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <h2>Tizimga kirish</h2>
      <form method="POST" action="/api/admin?action=login">
        <input type="hidden" name="action" value="login">
        <input type="text" name="username" placeholder="Foydalanuvchi nomi" required autocapitalize="off" autocomplete="username">
        <input type="password" name="password" placeholder="Parol" required autocomplete="current-password">
        <div class="row">
          <button type="button" class="btn-ghost" onclick="closeModal()">Bekor qilish</button>
          <button type="submit" class="btn-primary">Kirish</button>
        </div>
      </form>
    </div>
  </div>

<script>
  function openModal(){document.getElementById('loginModal').classList.add('open')}
  function closeModal(){document.getElementById('loginModal').classList.remove('open')}
</script>
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
  const raw = String(body);
  // JSON
  if (raw.charAt(0) === "{" || raw.charAt(0) === "[") {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  // application/x-www-form-urlencoded
  const out = {};
  for (const part of raw.split("&")) {
    if (!part) {
      continue;
    }
    const eq = part.indexOf("=");
    if (eq === -1) {
      out[safeDecode(part)] = "";
      continue;
    }
    const key = safeDecode(part.slice(0, eq));
    const value = safeDecode(part.slice(eq + 1));
    if (key) {
      out[key] = value;
    }
  }
  return out;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
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
  if (!SUPABASE_URL || /^https?:\/\/.+/.test(SUPABASE_URL) === false) {
    throw new Error("SUPABASE_URL env o'rnatilmagan");
  }
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY env o'rnatilmagan");
  }

  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
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
    throw new Error(`Supabase HTTP ${response.status}` + (text ? `: ${String(text).slice(0, 240)}` : ""));
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
