// ---------------------------------------------------------------------------
// ELDER PAY (https://pay.elder.uz) — balansni karta orqali to'ldirish.
//
// API v1 (hujjat: https://pay.elder.uz/):
//   POST /api { method: "create", shop_id, shop_key, amount, user_id? }
//        → { status: "success", order, pay_url?, data: { amount, over } }
//   POST /api { method: "check", order }
//        → { status: "success", order, data: { amount, status: pending|paid|cancel, date, over } }
//   POST /api { method: "cancel", order, shop_id, shop_key }
//   Xatolik: { status: "error", message } — 400 / 403 (kassa faol emas) /
//            409 (shu summada faol to'lov bor yoki holat mos emas) / 500.
//
// To'lov so'rovi ElderPay'da 5 daqiqa amal qiladi. Webhook yo'q — holat
// `check` bilan (3–5 s oralig'ida) tekshiriladi.
//
// Env (faqat serverda — shop_key maxfiy, brauzerga chiqmaydi):
//   ELDERPAY_SHOP_ID, ELDERPAY_SHOP_KEY
//   ELDERPAY_API_URL     — default https://pay.elder.uz
//   ELDERPAY_TIMEOUT_MS  — default 10000
// ---------------------------------------------------------------------------

const PROVIDER = "elderpay";
const DEFAULT_API_URL = "https://pay.elder.uz";
const ORDER_TTL_MINUTES = 5;
const ORDER_STATUSES = Object.freeze(["pending", "paid", "cancel"]);

function cleanEnv(value) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function resolveElderPayConfig(env = process.env) {
  const timeout = Number(env.ELDERPAY_TIMEOUT_MS);
  return {
    apiUrl: (cleanEnv(env.ELDERPAY_API_URL) || DEFAULT_API_URL).replace(/\/+$/, ""),
    shopId: cleanEnv(env.ELDERPAY_SHOP_ID),
    shopKey: cleanEnv(env.ELDERPAY_SHOP_KEY),
    timeoutMs: timeout > 0 ? timeout : 10000,
  };
}

class ElderPayError extends Error {
  constructor(message, reason, httpStatus = 0) {
    super(message);
    this.name = "ElderPayError";
    // not_configured | invalid | auth | conflict | unavailable | timeout
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

function reasonForStatus(status) {
  if (status === 400) return "invalid";
  if (status === 403) return "auth";
  if (status === 409) return "conflict";
  return "unavailable";
}

function parseAmount(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  return /^\d{1,12}$/.test(text) ? Number(text) : null;
}

function createElderPayClient({ config = resolveElderPayConfig(), fetchFn = fetch } = {}) {
  const enabled = Boolean(config.shopId && config.shopKey);

  async function call(body) {
    if (!enabled) {
      throw new ElderPayError("elderpay_not_configured", "not_configured");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchFn(`${config.apiUrl}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      const timeout = cause?.name === "AbortError";
      throw new ElderPayError(`elderpay_${body.method}_failed: ${timeout ? "timeout" : cause?.message || cause}`, timeout ? "timeout" : "unavailable");
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    // shop_key xabarlarga/loglarga tushmaydi — faqat ElderPay'ning o'z matni.
    if (!response.ok || !payload || payload.status !== "success") {
      const message = String(payload?.message || text || "").slice(0, 200);
      const status = response.ok ? 0 : response.status;
      throw new ElderPayError(`elderpay_${body.method}_${status || "error"}: ${message}`, response.ok ? "unavailable" : reasonForStatus(status), status);
    }

    return payload;
  }

  // Yangi to'lov. 409 — shu summada faol to'lov bor (chaqiruvchi boshqa summa tanlaydi).
  async function createOrder({ amount, userId } = {}) {
    const payload = await call({
      method: "create",
      shop_id: config.shopId,
      shop_key: config.shopKey,
      amount: Number(amount),
      ...(userId ? { user_id: `tg_${userId}` } : {}),
    });

    const order = String(payload.order || "").trim();
    if (!order) {
      throw new ElderPayError("elderpay_create_no_order", "unavailable");
    }

    return {
      order,
      amount: parseAmount(payload.data?.amount) ?? Number(amount),
      payUrl: /^https:\/\//.test(String(payload.pay_url || "")) ? String(payload.pay_url) : null,
    };
  }

  // → { order, status: pending|paid|cancel, amount, date }
  async function checkOrder(order) {
    const payload = await call({ method: "check", order: String(order) });
    const status = String(payload.data?.status || "").toLowerCase();
    return {
      order: String(payload.order || order),
      status: ORDER_STATUSES.includes(status) ? status : "pending",
      amount: parseAmount(payload.data?.amount),
      date: payload.data?.date || null,
    };
  }

  async function cancelOrder(order) {
    await call({ method: "cancel", order: String(order), shop_id: config.shopId, shop_key: config.shopKey });
    return true;
  }

  return { provider: PROVIDER, enabled, createOrder, checkOrder, cancelOrder };
}

module.exports = {
  ElderPayError,
  ORDER_TTL_MINUTES,
  PROVIDER,
  createElderPayClient,
  resolveElderPayConfig,
};
