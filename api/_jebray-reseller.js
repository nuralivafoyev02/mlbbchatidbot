const DEFAULT_BASE_URL = "https://api.jebray.com";
const DEVICE_LOGOUT_PATH = "/reseller/v1/logout";
const DEVICE_LOGOUT_TYPES = new Set(["send-code", "verify-code1", "verify-code2", "cancel"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{4,8}$/;
const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{8,128}$/;

class JebrayResellerError extends Error {
  constructor(reason, status = null, remaining = null, detail = null) {
    super(reason);
    this.name = "JebrayResellerError";
    this.reason = reason;
    this.status = status;
    this.remaining = remaining;
    this.detail = detail;
  }
}

function validateDeviceLogoutInput(input) {
  const type = String(input?.type || "");
  const email = String(input?.email || "").trim();

  if (!DEVICE_LOGOUT_TYPES.has(type)) {
    throw new JebrayResellerError("invalid_input");
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new JebrayResellerError("invalid_email");
  }

  if (type === "send-code") {
    if (!PASSWORD_RE.test(String(input?.password || ""))) {
      throw new JebrayResellerError("invalid_password");
    }
  } else if (type === "verify-code1" || type === "verify-code2") {
    if (!CODE_RE.test(String(input?.code || "").trim())) {
      throw new JebrayResellerError("invalid_code");
    }
  }

  return { type, email };
}

function classifyProviderError(status, payload, type) {
  const error = String(payload?.error || payload?.message || "").toLowerCase();
  // Kalit noto'g'ri / muddati tugagan / oylik to'lov qilinmagan — foydalanuvchi
  // aybi emas, administrator darhol bilishi kerak.
  if (status === 401 || status === 403 || /api key|unauthori[sz]ed|forbidden|subscription|expired/.test(error)) {
    return "provider_auth";
  }
  if (/wrong verification code/.test(error)) {
    return "wrong_code";
  }
  if (/password/.test(error)) {
    return "invalid_password";
  }
  if (/max verification attempts/.test(error)) {
    return "attempts_exceeded";
  }
  if (status === 402 || /insufficient balance|insufficient funds/.test(error)) {
    return "insufficient_balance";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (type === "verify-code2" && status >= 500) {
    return "result_unknown";
  }
  return status >= 500 ? "service_unavailable" : "request_failed";
}

async function requestDeviceLogout(input, options = {}) {
  const { type, email } = validateDeviceLogoutInput(input);
  const apiKey = String(
    options.apiKey ?? process.env.JEBRAY_RESELLER_API_KEY ?? ""
  ).trim();
  if (!apiKey) {
    throw new JebrayResellerError("not_configured");
  }

  const baseUrl = String(options.baseUrl || process.env.JEBRAY_RESELLER_API_URL || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  let url;
  try {
    url = new URL(`${baseUrl}${DEVICE_LOGOUT_PATH}`);
  } catch {
    throw new JebrayResellerError("not_configured");
  }
  if (url.protocol !== "https:") {
    throw new JebrayResellerError("not_configured");
  }

  const body = { type, email };
  if (type === "send-code") body.password = String(input.password);
  if (type === "verify-code1" || type === "verify-code2") body.code = String(input.code).trim();

  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 12000, 1000), 12000);
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let responseText;
  try {
    response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch (error) {
    const reason = error?.name === "AbortError"
      ? (type === "verify-code2" ? "result_unknown" : "timeout")
      : (type === "verify-code2" ? "result_unknown" : "network");
    throw new JebrayResellerError(reason);
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new JebrayResellerError(type === "verify-code2" ? "result_unknown" : "service_unavailable", response.status);
  }

  if (!response.ok || payload?.success !== true) {
    const remaining = Number.isInteger(payload?.remaining) && payload.remaining >= 0
      ? payload.remaining
      : null;
    throw new JebrayResellerError(
      classifyProviderError(response.status, payload, type),
      response.status,
      remaining,
      String(payload?.error || payload?.message || "").slice(0, 120)
    );
  }

  return {
    ok: true,
    type,
    cost: type === "verify-code2" && Number.isFinite(Number(payload.cost)) ? Number(payload.cost) : null,
  };
}

// ---------------------------------------------------------------------------
// Email almashtirish — POST /reseller/v1/changeemail (5 bosqich, hujjat:
// https://api.jebray.com/reseller/docs):
//   start(email)               → joriy emailga login kodi, session_id
//   login(session_id, code)    → login kodi + o'yin serveri, joriy emailga 1-kod
//   verify_code_old(…, code)   → 1-kod tasdiqlanadi
//   set_new_email(…, email_new)→ yangi emailga 2-kod
//   confirm(…, code)           → 2-kod; FAQAT shu yerda provayder pul yechadi
//   cancel(session_id)         → bepul
// ---------------------------------------------------------------------------
const CHANGE_EMAIL_PATH = "/reseller/v1/changeemail";
const CHANGE_EMAIL_STEPS = new Set(["start", "login", "verify_code_old", "set_new_email", "confirm", "cancel"]);
const SESSION_RE = /^[A-Za-z0-9._~:+\/=-]{6,200}$/;

function validateChangeEmailInput(input) {
  const step = String(input?.step || "");
  if (!CHANGE_EMAIL_STEPS.has(step)) throw new JebrayResellerError("invalid_input");

  if (step === "start") {
    const email = String(input?.email || "").trim();
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new JebrayResellerError("invalid_email");
    return { step, email };
  }

  const sessionId = String(input?.sessionId || "").trim();
  if (!SESSION_RE.test(sessionId)) throw new JebrayResellerError("session_expired");
  const out = { step, sessionId };
  if (step === "login" || step === "verify_code_old" || step === "confirm") {
    const code = String(input?.code || "").trim();
    if (!CODE_RE.test(code)) throw new JebrayResellerError("invalid_code");
    out.code = code;
  }
  if (step === "set_new_email") {
    const emailNew = String(input?.emailNew || "").trim();
    if (emailNew.length > 254 || !EMAIL_RE.test(emailNew)) throw new JebrayResellerError("invalid_new_email");
    out.emailNew = emailNew;
  }
  return out;
}

function classifyChangeEmailError(status, payload, step) {
  const error = String(payload?.error || payload?.message || "").toLowerCase();
  if (status === 401 || status === 403 || /api key|unauthori[sz]ed|forbidden|subscription|plan reseller/.test(error)) {
    return "provider_auth";
  }
  if (status === 402 || /insufficient balance|insufficient funds|saldo/.test(error)) return "insufficient_balance";
  if (/session not found|expired|session/.test(error)) return "session_expired";
  if (/kontak gm|banned/.test(error)) return "account_banned";
  if (/invalid code|wrong code|incorrect code|code/.test(error)) return "wrong_code";
  if (/same email|already (used|registered|bound)|email.*(exist|taken|used)/.test(error)) return "email_taken";
  if (/invalid email|email/.test(error)) return step === "set_new_email" ? "invalid_new_email" : "invalid_email";
  if (status === 429) return "rate_limited";
  if (status === 503) return "maintenance";
  if (step === "confirm" && status >= 500) return "result_unknown";
  return status >= 500 ? "service_unavailable" : "request_failed";
}

async function requestChangeEmail(input, options = {}) {
  const parsed = validateChangeEmailInput(input);
  const { step } = parsed;
  const apiKey = String(options.apiKey ?? process.env.JEBRAY_RESELLER_API_KEY ?? "").trim();
  if (!apiKey) throw new JebrayResellerError("not_configured");

  const baseUrl = String(options.baseUrl || process.env.JEBRAY_RESELLER_API_URL || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  let url;
  try {
    url = new URL(`${baseUrl}${CHANGE_EMAIL_PATH}`);
  } catch {
    throw new JebrayResellerError("not_configured");
  }
  if (url.protocol !== "https:") throw new JebrayResellerError("not_configured");

  const body = { step };
  if (step === "start") body.email = parsed.email;
  else body.session_id = parsed.sessionId;
  if (parsed.code) body.code = parsed.code;
  if (parsed.emailNew) body.email_new = parsed.emailNew;

  // login bosqichi o'yin serveriga ulanadi — sekinroq bo'lishi mumkin.
  const defaultTimeout = step === "login" || step === "confirm" ? 25000 : 15000;
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || defaultTimeout, 1000), 25000);
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let responseText;
  try {
    response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch (error) {
    if (step === "confirm") throw new JebrayResellerError("result_unknown");
    throw new JebrayResellerError(error?.name === "AbortError" ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new JebrayResellerError(step === "confirm" ? "result_unknown" : "service_unavailable", response.status);
  }

  if (!response.ok || payload?.success !== true) {
    const remaining = Number.isInteger(payload?.remaining) && payload.remaining >= 0 ? payload.remaining : null;
    throw new JebrayResellerError(
      classifyChangeEmailError(response.status, payload, step),
      response.status,
      remaining,
      String(payload?.error || payload?.message || "").slice(0, 160)
    );
  }

  const result = { ok: true, step };
  if (step === "start") {
    const sessionId = String(payload.session_id || "").trim();
    if (!SESSION_RE.test(sessionId)) throw new JebrayResellerError("service_unavailable", response.status);
    result.sessionId = sessionId;
  }
  if (step === "set_new_email") result.emailNew = parsed.emailNew;
  if (step === "confirm") {
    result.oldEmail = String(payload.old_email || "") || null;
    result.newEmail = String(payload.new_email || "") || null;
    result.cost = Number.isFinite(Number(payload.cost)) ? Number(payload.cost) : null;
  }
  return result;
}

module.exports = {
  CHANGE_EMAIL_STEPS,
  DEVICE_LOGOUT_TYPES,
  JebrayResellerError,
  requestChangeEmail,
  requestDeviceLogout,
  validateChangeEmailInput,
  validateDeviceLogoutInput,
};
