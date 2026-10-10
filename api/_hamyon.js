// ---------------------------------------------------------------------------
// Hamyon API (https://hamyon-api.uz) — Telegram botlar uchun avtomatik to'lov.
//
// REST API (so'rovlar application/x-www-form-urlencoded):
//   POST /payment/create   shop_id, shop_key, amount, order_id?
//        → { payment_id, order_id, amount, card, expires_in, expire_at } — 200
//        → { error } — 400 (shu summada ochiq to'lov mavjud) / 403 / 500
//   GET  /payment/status?payment_id=
//        → { payment_id, status: pending|paid|cancel, amount, ... }
//   POST /payment/cancel   payment_id, shop_key
//
// Callback'lar (do'kon sozlamalarida @HamyonAPIBot → prepare_url/complete_url):
//   POST complete_url  payment_id, order_id, shop_id, amount,
//                      status=paid|cancel, paid_at?, reason?, sign
//   sign = md5(shop_id + payment_id + amount + shop_key)
//   2xx bo'lmasa Hamyon qayta yuboradi (0, 3, 10, 30, 60 s) — idempotent.
//
// To'lov 5 daqiqa amal qiladi (muddati o'tsa — cancel). Asosiy tasdiq —
// complete_url callback; kabinetdagi `status` so'rovi zaxira. shop_key faqat
// serverda; brauzerga chiqmaydi.
//
// Env (faqat serverda):
//   HAMYON_SHOP_ID, HAMYON_SHOP_KEY
//   HAMYON_API_URL     — default https://hamyon-api.uz
//   HAMYON_TIMEOUT_MS  — default 10000
// ---------------------------------------------------------------------------

const crypto = require("node:crypto");

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

// 50000 | "50000" | "50000.00" → 50000; kasr yoki noto'g'ri qiymat — null.
function parseAmount(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isInteger(amount) ? amount : null;
}

function md5(text) {
  return crypto.createHash("md5").update(String(text), "utf8").digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cleanCard(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{16}$/.test(digits) ? digits : "";
}

function createHamyonClient({ config = resolveHamyonConfig(), fetchFn = fetch } = {}) {
  const enabled = Boolean(config.shopId && config.shopKey);

  // body berilmasa — GET (path ichida query), aks holda POST /path + form.
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
        headers: body === undefined
          ? { Accept: "application/json" }
          : { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body === undefined ? undefined : new URLSearchParams(body).toString(),
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
      amount: String(Number(amount)),
      ...(orderId ? { order_id: String(orderId) } : {}),
    });

    const paymentId = String(payload?.payment_id || "").trim();
    if (!paymentId) {
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
    // Hujjatda faqat payment_id; shop_id/shop_key ortiqcha bo'lsa ham zarar qilmaydi.
    const params = new URLSearchParams({
      payment_id: String(order),
      shop_id: String(config.shopId),
      shop_key: String(config.shopKey),
    });
    const payload = (await call(`/payment/status?${params.toString()}`)) || {};
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

  // complete_url / prepare_url callback'ini tekshiradi va normallashtiradi.
  // → { ok: true, order, orderId, status, amount, paidAt, reason } | { ok: false, error }
  function parseCallback(fields = {}) {
    if (!enabled) return { ok: false, error: "not_configured" };

    const order = String(fields.payment_id ?? "").trim();
    const shopId = String(fields.shop_id ?? "").trim();
    const amountRaw = String(fields.amount ?? "").trim();
    const sign = String(fields.sign ?? "").trim().toLowerCase();
    if (!order || !amountRaw || !sign) return { ok: false, error: "invalid" };
    if (shopId && shopId !== String(config.shopId)) return { ok: false, error: "shop_mismatch" };

    const expected = md5(`${config.shopId}${order}${amountRaw}${config.shopKey}`);
    if (!safeEqual(expected, sign)) return { ok: false, error: "bad_sign" };

    const status = String(fields.status ?? "").trim().toLowerCase();
    const paidAtSec = Number(fields.paid_at);
    return {
      ok: true,
      order,
      orderId: String(fields.order_id ?? "").trim() || null,
      status: ["prepare", "paid", "cancel"].includes(status) ? status : "unknown",
      amount: parseAmount(amountRaw),
      paidAt: paidAtSec > 0 ? new Date(paidAtSec * 1000).toISOString() : null,
      reason: String(fields.reason ?? "").slice(0, 60) || null,
    };
  }

  return { provider: PROVIDER, enabled, createOrder, checkOrder, cancelOrder, parseCallback };
}

module.exports = {
  HamyonError,
  ORDER_TTL_MINUTES,
  PROVIDER,
  createHamyonClient,
  resolveHamyonConfig,
};