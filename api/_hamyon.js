// ---------------------------------------------------------------------------
// Hamyon API (https://hamyon-api.uz) — Telegram botlar uchun avtomatik to'lov.
//
// REST API:
//   POST /payment/create   { shop_id, shop_key, amount, order_id? }
//        → { payment_id, card, amount, ... } — 200
//        → { error } — 400 (shu summada ochiq to'lov mavjud) / 403 / 500
//   GET  /payment/status?payment_id=&shop_id=&shop_key=
//        → { payment_id, status: pending|paid|cancel, amount, ... }
//   POST /payment/cancel   { shop_id, shop_key, payment_id }
//        → { ok, payment_id, status }
//
// To'lov 5 daqiqa amal qiladi (muddati o'tsa — cancel). Webhook (prepare_url /
// complete_url) o'rniga biz status'ni so'rab turamiz — `call` orqali. shop_key
// faqat serverda; brauzerga chiqmaydi.
//
// Env (faqat serverda):
//   HAMYON_SHOP_ID, HAMYON_SHOP_KEY
//   HAMYON_API_URL     — default https://hamyon-api.uz
//   HAMYON_TIMEOUT_MS  — default 10000
// ---------------------------------------------------------------------------

const PROVIDER = "hamyon";
const DEFAULT_API_URL = "https://hamyon-api.uz";
const ORDER_TTL_MINUTES = 5;
const ORDER_STATUSES = Object.freeze(["pending", "paid", "cancel"]);
const CONFLICT_HINT = /ochiq to'lov|band|allaqachon|mavjud|o'zgartiring/i;

function cleanEnv(value) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function resolveHamyonConfig(env = process.env) {
  const timeout = Number(env.HAMYON_TIMEOUT_MS);
  return {
    apiUrl: (cleanEnv(env.HAMYON_API_URL) || DEFAULT_API_URL).replace(/\/+$/, ""),
    shopId: cleanEnv(env.HAMYON_SHOP_ID),
    shopKey: cleanEnv(env.HAMYON_SHOP_KEY),
    timeoutMs: timeout > 0 ? timeout : 10000,
  };
}

class HamyonError extends Error {
  constructor(message, reason, httpStatus = 0) {
    super(message);
    this.name = "HamyonError";
    // not_configured | invalid | auth | conflict | unavailable | timeout
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

function reasonForStatus(status, payload) {
  const message = String(payload?.error || payload?.message || "");
  if (status === 400 && CONFLICT_HINT.test(message)) return "conflict";
  if (status === 400) return "invalid";
  if (status === 403) return "auth";
  return "unavailable";
}

function parseAmount(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  return /^\d{1,12}$/.test(text) ? Number(text) : null;
}

function cleanCard(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{16}$/.test(digits) ? digits : "";
}

function createHamyonClient({ config = resolveHamyonConfig(), fetchFn = fetch } = {}) {
  const enabled = Boolean(config.shopId && config.shopKey);

  // body berilmasa — GET (path ichida query), aks holda POST /path + JSON.
  async function call(path, body) {
    if (!enabled) {
      throw new HamyonError("hamyon_not_configured", "not_configured");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchFn(`${config.apiUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      const timeout = cause?.name === "AbortError";
      throw new HamyonError(
        `hamyon_${body === undefined ? "status" : "pay"}_failed: ${timeout ? "timeout" : cause?.message || cause}`,
        timeout ? "timeout" : "unavailable"
      );
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

    // shop_key xabarlarga/loglarga tushmaydi — faqat Hamyon'ning o'z matni.
    if (!response.ok || (payload && payload.error && !payload.payment_id)) {
      const message = String(payload?.error || payload?.message || text || "").slice(0, 200);
      const status = response.ok ? 0 : response.status;
      throw new HamyonError(
        `hamyon_${body === undefined ? "status" : "pay"}_${status || "error"}: ${message}`,
        response.ok ? "unavailable" : reasonForStatus(status, payload),
        status
      );
    }

    return payload;
  }

  // Yangi to'lov. 400 + "ochiq to'lov mavjud" — conflict (chaqiruvchi
  // boshqa summa tanlaydi). Javobda qaysi kartaga o'tkazish ko'rsatiladi.
  async function createOrder({ amount, orderId } = {}) {
    const payload = await call("/payment/create", {
      shop_id: config.shopId,
      shop_key: config.shopKey,
      amount: Number(amount),
      ...(orderId ? { order_id: String(orderId) } : {}),
    });

    const paymentId = String(payload.payment_id || "").trim();
    if (!paymentId || !parseAmount(payload.amount)) {
      throw new HamyonError("hamyon_create_invalid_response", "unavailable");
    }

    return {
      order: paymentId,
      amount: parseAmount(payload.amount) ?? Number(amount),
      card: cleanCard(payload.card) || null,
      payUrl: null,
    };
  }

  // → { order, status: pending|paid|cancel, amount, date }
  async function checkOrder(order) {
    const params = new URLSearchParams({
      payment_id: String(order),
      shop_id: String(config.shopId),
      shop_key: String(config.shopKey),
    });
    const payload = await call(`/payment/status?${params.toString()}`);
    const status = String(payload.status || "").toLowerCase();
    return {
      order: String(payload.payment_id || order),
      status: ORDER_STATUSES.includes(status) ? status : "pending",
      amount: parseAmount(payload.amount),
      date: payload.created_at || payload.updated_at || null,
    };
  }

  async function cancelOrder(order) {
    await call("/payment/cancel", {
      shop_id: config.shopId,
      shop_key: config.shopKey,
      payment_id: String(order),
    });
    return true;
  }

  return { provider: PROVIDER, enabled, createOrder, checkOrder, cancelOrder };
}

module.exports = {
  HamyonError,
  ORDER_TTL_MINUTES,
  PROVIDER,
  createHamyonClient,
  resolveHamyonConfig,
};