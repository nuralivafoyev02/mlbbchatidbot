const DEFAULT_BASE_URL = "https://api.jebray.com";
const DEVICE_LOGOUT_PATH = "/reseller/v1/logout";
const DEVICE_LOGOUT_TYPES = new Set(["send-code", "verify-code1", "verify-code2", "cancel"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{4,8}$/;
const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{8,128}$/;

class JebrayResellerError extends Error {
  constructor(reason, status = null, remaining = null) {
    super(reason);
    this.name = "JebrayResellerError";
    this.reason = reason;
    this.status = status;
    this.remaining = remaining;
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
    options.apiKey ?? process.env.JEBRAY_RESELLER_API_KEY ?? process.env.FULL_INFO_API_KEY ?? ""
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
      remaining
    );
  }

  return {
    ok: true,
    type,
    cost: type === "verify-code2" && Number.isFinite(Number(payload.cost)) ? Number(payload.cost) : null,
  };
}

module.exports = {
  DEVICE_LOGOUT_TYPES,
  JebrayResellerError,
  requestDeviceLogout,
  validateDeviceLogoutInput,
};
