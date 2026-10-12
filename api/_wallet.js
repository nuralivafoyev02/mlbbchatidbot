// ---------------------------------------------------------------------------
// Balans (hamyon) — supabase/020_wallet.sql ustidagi server qatlami.
//
// Pul bilan bog'liq har bir amal Postgres funksiyasida (bitta tranzaksiya):
// bu yerda faqat chaqiruv, natijani normallashtirish va to'ldirishni
// to'lov provayderi orqali ochish/tekshirish bor.
//
// Provayder (bot_settings `wallet_provider`, admin panel → Feat): hamyon
// (default, api/_hamyon.js) | elderpay (api/_elderpay.js) | manual (admin
// qo'lda tasdiqlaydi). shop_id/shop_key panelda saqlanadi; bo'lmasa env
// (HAMYON_SHOP_ID/KEY, ELDERPAY_SHOP_ID/KEY). Har bir so'rov o'zi ochilgan
// provayder bilan tekshiriladi — provayder almashtirilsa ham ochiq to'lovlar
// yo'qolmaydi. Hodisalar jurnali: api/_pay-events.js (024 migratsiyasi).
//
// Karta rekvizitlari: bot_settings `wallet_config` (admin panel) → env
// (WALLET_CARD_NUMBER / WALLET_CARD_HOLDER / WALLET_CARD_BANK).
// ---------------------------------------------------------------------------

const hamyon = require("./_hamyon.js");
const elderpay = require("./_elderpay.js");
const { createPayEvents } = require("./_pay-events.js");

const WALLET_CONFIG_KEY = "wallet_config";
const WALLET_PROVIDER_KEY = "wallet_provider";
const PROVIDER_MODES = Object.freeze(["hamyon", "elderpay", "manual"]);
const PROVIDER_NAMES = Object.freeze({ hamyon: "Hamyon", elderpay: "ElderPay", manual: "Qo'lda" });
const TZ_OFFSET_MS = 5 * 3600 * 1000; // Asia/Tashkent (UTC+5, yozgi vaqt yo'q)
const TOPUP_DEFAULTS = Object.freeze({
  min: 5000,
  max: 5000000,
  // Provayder (ElderPay/Hamyon) buyurtmasi 5 daqiqa amal qiladi; provayder
  // ulanmagan bo'lsa (admin qo'lda tasdiqlaydi) so'rov 30 daqiqa turadi.
  ttlMinutes: elderpay.ORDER_TTL_MINUTES,
  manualTtlMinutes: 30,
  graceMinutes: 60,
  // Avto rejimda bekor qilingan/muddati o'tgan summa shuncha vaqt
  // boshqaga berilmaydi (provayder buyurtmasi 5 daqiqa yashaydi).
  exactGraceMinutes: 10,
  // To'lanmagan buyurtmalar shuncha vaqt orqaga qayta tekshiriladi.
  syncWindowMinutes: 180,
  presets: [10000, 20000, 50000, 100000],
});
const WALLET_HISTORY_LIMIT = 50;

function cleanEnv(value) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanCardNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{16}$/.test(digits) ? digits : "";
}

// "8600123412341234" → "8600 1234 1234 1234"
function formatCardNumber(value) {
  const digits = cleanCardNumber(value);
  return digits ? digits.replace(/(\d{4})(?=\d)/g, "$1 ") : "";
}

function parsePositiveInt(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  return /^\d{1,12}$/.test(text) && Number(text) > 0 ? Number(text) : NaN;
}

function normalizeWalletConfig(stored = {}, env = process.env) {
  const value = stored && typeof stored === "object" ? stored : {};
  const min = parsePositiveInt(value.min);
  const max = parsePositiveInt(value.max);
  const presets = Array.isArray(value.presets)
    ? value.presets.map(parsePositiveInt).filter((n) => Number.isFinite(n)).slice(0, 6)
    : [];

  const config = {
    cardNumber: cleanCardNumber(value.cardNumber) || cleanCardNumber(env.WALLET_CARD_NUMBER),
    cardHolder: cleanText(value.cardHolder || env.WALLET_CARD_HOLDER, 60),
    cardBank: cleanText(value.cardBank || env.WALLET_CARD_BANK, 40),
    min: Number.isFinite(min) ? min : TOPUP_DEFAULTS.min,
    max: Number.isFinite(max) ? max : TOPUP_DEFAULTS.max,
    presets: presets.length ? presets : TOPUP_DEFAULTS.presets.slice(),
    // Admin to'ldirishni vaqtincha o'chirib qo'yishi mumkin.
    enabled: value.enabled !== false,
  };

  if (config.max < config.min) config.max = config.min;
  return config;
}

function normalizeWalletConfigInput(input = {}) {
  const cardNumber = cleanCardNumber(input.cardNumber);
  if (String(input.cardNumber || "").trim() && !cardNumber) {
    return { ok: false, error: "card_invalid" };
  }

  const min = parsePositiveInt(input.min);
  const max = parsePositiveInt(input.max);
  if (input.min !== undefined && input.min !== "" && Number.isNaN(min)) return { ok: false, error: "min_invalid" };
  if (input.max !== undefined && input.max !== "" && Number.isNaN(max)) return { ok: false, error: "max_invalid" };
  if (Number.isFinite(min) && Number.isFinite(max) && max < min) return { ok: false, error: "max_invalid" };

  const presets = String(Array.isArray(input.presets) ? input.presets.join(",") : input.presets ?? "")
    .split(/[,;\n]+/)
    .map(parsePositiveInt)
    .filter((n) => Number.isFinite(n))
    .slice(0, 6);

  return {
    ok: true,
    value: {
      cardNumber,
      cardHolder: cleanText(input.cardHolder, 60),
      cardBank: cleanText(input.cardBank, 40),
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
      presets,
      enabled: !(input.enabled === false || input.enabled === "false" || input.enabled === 0 || input.enabled === "0"),
    },
  };
}

// ---------------------------------------------------------------------------
// Provayder sozlamalari (bot_settings `wallet_provider`)
// ---------------------------------------------------------------------------
function cleanShopId(value) {
  const text = cleanEnv(value);
  return /^[A-Za-z0-9_-]{1,40}$/.test(text) ? text : "";
}

function cleanShopKey(value) {
  const text = cleanEnv(value);
  return /^[\x21-\x7e]{4,128}$/.test(text) ? text : "";
}

function resolveKeys(stored, envId, envKey) {
  const shopId = cleanShopId(stored?.shopId);
  const shopKey = cleanShopKey(stored?.shopKey);
  if (shopId && shopKey) return { shopId, shopKey, source: "panel" };
  const fromEnvId = cleanShopId(envId);
  const fromEnvKey = cleanShopKey(envKey);
  if (fromEnvId && fromEnvKey) return { shopId: fromEnvId, shopKey: fromEnvKey, source: "env" };
  return { shopId: shopId || fromEnvId, shopKey: "", source: null };
}

function normalizeProviderSettings(stored = {}, env = process.env) {
  const value = stored && typeof stored === "object" ? stored : {};
  return {
    mode: PROVIDER_MODES.includes(value.mode) ? value.mode : "hamyon",
    hamyon: resolveKeys(value.hamyon, env.HAMYON_SHOP_ID, env.HAMYON_SHOP_KEY),
    elderpay: resolveKeys(value.elderpay, env.ELDERPAY_SHOP_ID, env.ELDERPAY_SHOP_KEY),
    updatedAt: value.updatedAt || null,
  };
}

// Panel kiritgan qiymatlar. shop_key bo'sh qoldirilsa — eskisi saqlanadi;
// `clear` — panelda saqlangan kalitlar o'chiriladi (env qoladi).
function normalizeProviderInput(input = {}, stored = {}) {
  const mode = String(input.mode || "").trim();
  if (!PROVIDER_MODES.includes(mode)) return { ok: false, error: "provider_invalid" };

  const value = { mode, updatedAt: new Date().toISOString() };
  for (const name of ["hamyon", "elderpay"]) {
    const part = input[name] && typeof input[name] === "object" ? input[name] : {};
    const previous = stored && typeof stored[name] === "object" ? stored[name] : {};
    if (part.clear === true || part.clear === "true") {
      value[name] = {};
      continue;
    }
    const idRaw = String(part.shopId ?? "").trim();
    const keyRaw = String(part.shopKey ?? "").trim();
    const shopId = idRaw ? cleanShopId(idRaw) : cleanShopId(previous.shopId);
    if (idRaw && !shopId) return { ok: false, error: "shop_id_invalid", provider: name };
    const shopKey = keyRaw ? cleanShopKey(keyRaw) : cleanShopKey(previous.shopKey);
    if (keyRaw && !shopKey) return { ok: false, error: "shop_key_invalid", provider: name };
    if (shopKey && !shopId) return { ok: false, error: "shop_id_invalid", provider: name };
    value[name] = shopId || shopKey ? { shopId, shopKey } : {};
  }
  return { ok: true, value };
}

function keyHint(key) {
  return key ? `••••${key.slice(-4)}` : "";
}

// Admin panel uchun — shop_key o'zi hech qachon chiqmaydi.
function publicProviderSettings(settings) {
  const part = (keys) => ({ shopId: keys.shopId || "", keySet: Boolean(keys.shopKey), keyHint: keyHint(keys.shopKey), source: keys.source });
  return { mode: settings.mode, hamyon: part(settings.hamyon), elderpay: part(settings.elderpay), updatedAt: settings.updatedAt };
}

function disabledClient(provider = "manual") {
  const fail = async () => {
    throw new hamyon.HamyonError(`${provider}_not_configured`, "not_configured");
  };
  return {
    provider,
    enabled: false,
    createOrder: fail,
    checkOrder: fail,
    cancelOrder: fail,
    parseCallback: () => ({ ok: false, error: "not_configured" }),
  };
}

function buildClient(provider, settings, env, fetchFn) {
  if (provider === "hamyon") {
    const config = hamyon.resolveHamyonConfig({ ...env, HAMYON_SHOP_ID: settings.hamyon.shopId, HAMYON_SHOP_KEY: settings.hamyon.shopKey });
    return hamyon.createHamyonClient({ config, fetchFn });
  }
  if (provider === "elderpay") {
    const config = elderpay.resolveElderPayConfig({ ...env, ELDERPAY_SHOP_ID: settings.elderpay.shopId, ELDERPAY_SHOP_KEY: settings.elderpay.shopKey });
    return elderpay.createElderPayClient({ config, fetchFn });
  }
  return disabledClient(provider || "manual");
}

// Faqat env bo'yicha (panel sozlamasisiz) — testlar va skriptlar uchun.
function createPayClient(env = process.env, fetchFn = fetch, stored = {}) {
  const settings = normalizeProviderSettings(stored, env);
  return buildClient(settings.mode, settings, env, fetchFn);
}

// Asia/Tashkent bo'yicha kun boshi (ms).
function dayStart(ms) {
  return Math.floor((ms + TZ_OFFSET_MS) / 86400000) * 86400000 - TZ_OFFSET_MS;
}

function toPublicTopup(row) {
  if (!row || !row.id) return null;
  const expiresMs = Date.parse(row.expires_at || "");
  const status = row.status === "pending" && Number.isFinite(expiresMs) && expiresMs < Date.now() ? "expired" : row.status;
  return {
    id: String(row.id),
    amount: Number(row.amount) || 0,
    pay_amount: Number(row.pay_amount) || 0,
    paid_amount: row.paid_amount === null || row.paid_amount === undefined ? null : Number(row.paid_amount),
    status,
    pay_url: row.pay_url || null,
    card: row.card || null,
    created_at: row.created_at || null,
    expires_at: row.expires_at || null,
    paid_at: row.paid_at || null,
  };
}

function toPublicTransaction(row) {
  return {
    id: String(row.id),
    delta: Number(row.delta) || 0,
    balance_after: Number(row.balance_after) || 0,
    kind: row.kind,
    order_id: row.order_id ? String(row.order_id) : null,
    note: row.note || "",
    created_at: row.created_at || null,
  };
}

// requestFn — Supabase REST so'rovchisi: (path, { method, body, prefer }) => data
// payClient — testlar uchun: barcha provayderlar o'rniga shu mijoz.
function createWallet(requestFn, { env = process.env, fetchFn = fetch, payClient, events } = {}) {
  if (typeof requestFn !== "function") {
    throw new Error("createWallet: requestFn is required");
  }

  const rpc = (name, args) => requestFn(`/rpc/${name}`, { method: "POST", body: args });
  const log = events || createPayEvents(requestFn);
  const clients = new Map();
  let loaded = null;

  async function readSetting(key) {
    try {
      const rows = await requestFn(`/bot_settings?key=eq.${key}&select=value&limit=1`);
      return Array.isArray(rows) && rows[0] ? rows[0].value : null;
    } catch (error) {
      console.error("[WALLET_CONFIG]", key, error?.message);
      return null;
    }
  }

  // Bitta so'rov davomida sozlamalar bir marta o'qiladi.
  function load() {
    if (!loaded) {
      loaded = Promise.all([readSetting(WALLET_CONFIG_KEY), readSetting(WALLET_PROVIDER_KEY)]).then(([walletStored, providerStored]) => ({
        config: normalizeWalletConfig(walletStored, env),
        settings: normalizeProviderSettings(providerStored, env),
        providerStored: providerStored && typeof providerStored === "object" ? providerStored : {},
      }));
    }
    return loaded;
  }

  function reset() {
    loaded = null;
    clients.clear();
  }

  async function clientFor(provider) {
    if (payClient) return provider === payClient.provider || !provider ? payClient : disabledClient(provider);
    if (!provider || !["hamyon", "elderpay"].includes(provider)) return disabledClient(provider || "manual");
    if (!clients.has(provider)) {
      const { settings } = await load();
      clients.set(provider, buildClient(provider, settings, env, fetchFn));
    }
    return clients.get(provider);
  }

  // Yangi to'lovlar shu mijoz orqali ochiladi.
  async function activeClient() {
    if (payClient) return payClient;
    const { settings } = await load();
    return settings.mode === "manual" ? disabledClient("manual") : clientFor(settings.mode);
  }

  async function getPayClient() {
    return activeClient();
  }

  async function getConfig() {
    const [{ config }, client] = await Promise.all([load(), activeClient()]);
    return { ...config, auto: client.enabled, provider: client.provider };
  }

  async function saveConfig(input) {
    const normalized = normalizeWalletConfigInput(input);
    if (!normalized.ok) return normalized;

    await requestFn("/bot_settings?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { key: WALLET_CONFIG_KEY, value: normalized.value, updated_at: new Date().toISOString() },
    });
    reset();
    return { ok: true, config: await getConfig() };
  }

  async function getProviderSettings() {
    const { settings } = await load();
    return publicProviderSettings(settings);
  }

  async function saveProviderSettings(input) {
    const { providerStored } = await load();
    const normalized = normalizeProviderInput(input, providerStored);
    if (!normalized.ok) return normalized;

    await requestFn("/bot_settings?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { key: WALLET_PROVIDER_KEY, value: normalized.value, updated_at: new Date().toISOString() },
    });
    reset();
    const settings = await getProviderSettings();
    await log.record("info", "config", `Provayder: ${PROVIDER_NAMES[settings.mode]}`, {
      provider: settings.mode,
      data: { hamyon_shop: settings.hamyon.shopId || null, elderpay_shop: settings.elderpay.shopId || null },
    });
    return { ok: true, settings };
  }

  // Ulanishni tekshirish (admin "Tekshirish" tugmasi).
  //   Hamyon — status/info endpoint'i yo'q, kalitni faqat create tekshiradi:
  //   kichik test to'lov ochiladi va darhol bekor qilinadi (order_id
  //   `health-…`). Uning cancel callback'i kelsa — complete_url ham ishlaydi.
  //   ElderPay — kassa ma'lumoti (status, pay_type, oylik to'lov).
  async function testProvider(mode) {
    const { settings } = await load();
    const provider = PROVIDER_MODES.includes(mode) ? mode : settings.mode;
    if (provider === "manual") return { ok: false, provider, error: "manual_mode" };
    const client = await clientFor(provider);
    if (!client.enabled) return { ok: false, provider, error: "not_configured" };

    const started = Date.now();
    try {
      if (provider === "elderpay") {
        const info = await client.shopInfo();
        const result = { ok: info.status === "confirm", provider, latencyMs: Date.now() - started, shop: info };
        await log.record(result.ok ? "info" : "warn", "health", result.ok ? "ElderPay kassasi faol" : `ElderPay kassa holati: ${info.status || "?"}`, {
          provider,
          data: { latency_ms: result.latencyMs, pay_type: info.payType, shop_status: info.status },
        });
        return result;
      }

      const amount = 1000 + Math.floor(Math.random() * 99) + 1;
      let order;
      try {
        order = await client.createOrder({ amount, orderId: `health-${Date.now()}` });
      } catch (error) {
        // Shu summada ochiq to'lov bor — demak do'kon topildi, kalitlar to'g'ri.
        if (error.reason !== "conflict") throw error;
        const result = { ok: true, provider, latencyMs: Date.now() - started, card: null };
        await log.record("info", "health", "Hamyon kalitlari to'g'ri", { provider, data: { latency_ms: result.latencyMs } });
        return result;
      }
      await client.cancelOrder(order.order).catch((error) => log.record("warn", "health", `Test to'lovni bekor qilib bo'lmadi: ${error.message}`, { provider }));
      const result = { ok: true, provider, latencyMs: Date.now() - started, card: order.card || null };
      await log.record("info", "health", "Hamyon ulanishi ishlayapti", {
        provider,
        data: { latency_ms: result.latencyMs, card: order.card ? `•••• ${order.card.slice(-4)}` : null, payment_id: order.order },
      });
      return result;
    } catch (error) {
      await log.record("error", "health", error.message, { provider, data: { reason: error.reason || null } });
      return { ok: false, provider, error: error.reason || "unavailable", message: String(error.message || "").replace(/^\w+?_\w+?_\d*:?\s*/, "") };
    }
  }

  // Kabinet uchun: konfiguratsiyaning foydalanuvchiga ko'rinadigan qismi.
  // config — getConfig() natijasi (auto/provider shu yerda).
  function publicConfig(config) {
    return {
      // Hamyon har to'lovga o'z kartasini (topup.card), ElderPay page rejimida
      // pay_url beradi; ElderPay api rejimi va qo'lda rejim — admin kartasi.
      enabled: Boolean(config.enabled && (config.cardNumber || config.auto)),
      card: formatCardNumber(config.cardNumber),
      holder: config.cardHolder,
      bank: config.cardBank,
      min: config.min,
      max: config.max,
      presets: config.presets,
      auto: Boolean(config.auto),
      provider: config.auto ? config.provider : null,
    };
  }

  async function getBalance(userId) {
    const result = await rpc("wallet_get", { p_user_id: String(userId) });
    return Number(result && result.balance) || 0;
  }

  async function listTransactions(userId, limit = WALLET_HISTORY_LIMIT) {
    const params = new URLSearchParams({
      user_id: `eq.${String(userId)}`,
      select: "id,delta,balance_after,kind,order_id,note,created_at",
      order: "id.desc",
      limit: String(limit),
    });
    const rows = await requestFn(`/wallet_transactions?${params.toString()}`);
    return (Array.isArray(rows) ? rows : []).map(toPublicTransaction);
  }

  async function getTopup(userId, topupId) {
    if (!/^\d{1,19}$/.test(String(topupId || ""))) return null;
    const params = new URLSearchParams({
      id: `eq.${String(topupId)}`,
      user_id: `eq.${String(userId)}`,
      select: "*",
      limit: "1",
    });
    const rows = await requestFn(`/wallet_topups?${params.toString()}`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  // Kutilayotgan (muddati o'tmagan) oxirgi so'rov — kabinet qayta ochilganda tiklanadi.
  async function getActiveTopup(userId) {
    const params = new URLSearchParams({
      user_id: `eq.${String(userId)}`,
      status: "eq.pending",
      expires_at: `gt.${new Date().toISOString()}`,
      select: "*",
      order: "created_at.desc",
      limit: "1",
    });
    const rows = await requestFn(`/wallet_topups?${params.toString()}`);
    return Array.isArray(rows) && rows[0] ? toPublicTopup(rows[0]) : null;
  }

  function patchTopup(topupId, fields) {
    return requestFn(`/wallet_topups?id=eq.${encodeURIComponent(String(topupId))}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { ...fields, updated_at: new Date().toISOString() },
    });
  }

  async function rpcCancel(userId, topupId) {
    return rpc("wallet_cancel_topup", { p_user_id: String(userId), p_topup_id: String(topupId) });
  }

  // Provayder ulangan bo'lsa — aniq summa (band bo'lsa +1, +2 so'm, 021),
  // aks holda tasodifiy +1..999 (summa to'lovni ajratadigan yagona belgi).
  async function createTopupRow(client, userId, amount) {
    const args = {
      p_user_id: String(userId),
      p_amount: amount,
      p_ttl_minutes: client.enabled ? TOPUP_DEFAULTS.ttlMinutes : TOPUP_DEFAULTS.manualTtlMinutes,
      p_grace_minutes: client.enabled ? TOPUP_DEFAULTS.exactGraceMinutes : TOPUP_DEFAULTS.graceMinutes,
    };
    if (!client.enabled) {
      return rpc("wallet_create_topup", args);
    }
    try {
      return await rpc("wallet_create_topup", { ...args, p_exact: true });
    } catch (error) {
      // 021 migratsiyasi hali qo'llanmagan — eski funksiya (p_exact'siz).
      if (!/PGRST202|p_exact|Could not find the function/i.test(String(error?.message))) throw error;
      console.error("[WALLET_TOPUP_EXACT_MISSING]", error.message);
      return rpc("wallet_create_topup", args);
    }
  }

  // 1) bazada noyob summali so'rov; 2) provayderda shu summaga buyurtma.
  // Provayder conflict qaytarsa (shu summada boshqa faol to'lov) — so'rov bekor
  // qilinadi va boshqa summa bilan qayta uriniladi.
  async function createTopup(userId, amountRaw) {
    const [config, client] = await Promise.all([getConfig(), activeClient()]);
    if (!config.enabled || (!config.cardNumber && !client.enabled)) {
      return { ok: false, error: "topup_disabled" };
    }

    const amount = parsePositiveInt(amountRaw);
    if (!Number.isFinite(amount) || amount < config.min || amount > config.max) {
      return { ok: false, error: "invalid_amount", min: config.min, max: config.max };
    }

    const provider = client.provider;
    const ctx = (topupId, data) => ({ provider, topupId, userId, data });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await createTopupRow(client, userId, amount);

      if (!result || result.ok !== true) {
        return { ok: false, error: result?.error || "topup_failed" };
      }

      const topup = result.topup;
      if (!client.enabled) {
        return { ok: true, topup: toPublicTopup(topup) };
      }

      let order;
      try {
        order = await client.createOrder({ amount: Number(topup.pay_amount), userId, orderId: topup.id });
      } catch (error) {
        await rpcCancel(userId, topup.id).catch(() => {});
        if (error.reason === "conflict") continue;
        await log.record("error", "create", error.message, ctx(topup.id, { amount: Number(topup.pay_amount), reason: error.reason || null }));
        return { ok: false, error: "provider_unavailable" };
      }

      // Provayder summani o'zgartirib yuborsa — foydalanuvchi noto'g'ri summa
      // o'tkazmasligi uchun so'rovni yopamiz.
      if (order.amount !== Number(topup.pay_amount)) {
        await log.record("error", "create", `Provayder summani o'zgartirdi: ${topup.pay_amount} → ${order.amount}`, ctx(topup.id, { order: order.order }));
        await client.cancelOrder(order.order).catch(() => {});
        await rpcCancel(userId, topup.id).catch(() => {});
        return { ok: false, error: "provider_unavailable" };
      }

      // ElderPay api rejimida qayerga o'tkazishni faqat admin kartasi
      // ko'rsatadi — u yo'q bo'lsa to'lovni ochiq qoldirmaymiz.
      if (!order.card && !order.payUrl && !config.cardNumber) {
        await log.record("error", "create", "Provayder karta bermadi va admin kartasi kiritilmagan", ctx(topup.id, { order: order.order }));
        await client.cancelOrder(order.order).catch(() => {});
        await rpcCancel(userId, topup.id).catch(() => {});
        return { ok: false, error: "topup_disabled" };
      }

      // Provayderdagi to'lov bazaga bog'lanmasa — uni tekshirib bo'lmaydi.
      // Ochiq qoldirmaymiz: ikkala tomonda ham yopiladi (023 migratsiyasi
      // qo'llanmagan bo'lsa shu yerga tushadi).
      try {
        await patchTopup(topup.id, {
          provider,
          provider_order: order.order,
          card: order.card || null,
          pay_url: order.payUrl || null,
        });
      } catch (error) {
        await log.record("error", "create", `To'lovni bazaga bog'lab bo'lmadi: ${error.message}`, ctx(topup.id, { order: order.order }));
        await client.cancelOrder(order.order).catch(() => {});
        await rpcCancel(userId, topup.id).catch(() => {});
        return { ok: false, error: "wallet_unavailable" };
      }
      await log.record("info", "create", `To'lov ochildi: ${topup.pay_amount} so'm`, ctx(topup.id, {
        amount: Number(topup.pay_amount),
        order: order.order,
        card: order.card ? `•••• ${order.card.slice(-4)}` : null,
        attempt: attempt + 1,
      }));
      return { ok: true, topup: toPublicTopup({ ...topup, card: order.card, pay_url: order.payUrl }) };
    }

    await log.record("warn", "create", "Barcha summalar band (5 urinish)", { provider, userId, data: { amount } });
    return { ok: false, error: "busy" };
  }

  async function cancelTopup(userId, topupId) {
    const row = await getTopup(userId, topupId);
    if (!row) return { ok: false };
    if (row.provider_order && row.status === "pending") {
      const client = await clientFor(row.provider);
      if (client.enabled) {
        await client.cancelOrder(row.provider_order).catch((error) =>
          log.record("warn", "cancel", error.message, { provider: row.provider, topupId: row.id, userId })
        );
      }
    }
    const result = await rpcCancel(userId, topupId);
    return { ok: Boolean(result && result.ok) };
  }

  // Bitta tushumni balansga yozish (provayder check yoki admin).
  async function creditIncoming(txn, { topupId = null, confirmedBy = null, provider = "manual" } = {}) {
    const result = await rpc("wallet_credit_topup", {
      p_provider: provider,
      p_txn_id: txn.id || null,
      p_amount: txn.amount,
      p_paid_at: txn.paid_at || new Date().toISOString(),
      p_topup_id: topupId,
      p_confirmed_by: confirmedBy,
      p_grace_minutes: TOPUP_DEFAULTS.graceMinutes,
    });
    if (result?.status === "credited") {
      await log.record("info", "credit", `Balansga yozildi: ${result.amount ?? txn.amount} so'm`, {
        provider,
        topupId: result.topup_id || topupId,
        userId: result.user_id,
        data: { amount: Number(result.amount ?? txn.amount), via: confirmedBy || "auto" },
      });
    }
    return result;
  }

  // Provayder "paid" deb tasdiqlagan to'lovni balansga yozadi. Summa — o'z
  // bazamizdan; provayder boshqa summa aytsa yozilmaydi,
  // admin panelda qo'lda ko'riladi. Idempotent (wallet_credit_topup).
  async function creditPaidRow(row, { amount, paidAt, via } = {}) {
    const expected = Number(row.pay_amount);
    if (amount !== null && amount !== undefined && Number(amount) !== expected) {
      await log.record("error", "credit", `Summa mos emas: kutilgan ${expected}, kelgan ${amount}`, {
        provider: row.provider,
        topupId: row.id,
        userId: row.user_id,
        data: { order: row.provider_order, via },
      });
      return { credited: false, status: "amount_mismatch" };
    }
    const result = await creditIncoming(
      { id: row.provider_order, amount: expected, paid_at: paidAt || null },
      { topupId: row.id, provider: row.provider || "hamyon", confirmedBy: via || null }
    );
    return { credited: result?.status === "credited", status: "paid", result };
  }

  // Bitta so'rov holatini o'z provayderidan olib, to'langan bo'lsa balansga yozadi.
  // Natija: { credited, status, result? }
  async function syncTopupRow(row, via = "poll") {
    if (!row || row.status === "paid" || !row.provider_order) {
      return { credited: false, status: row?.status || null };
    }
    const client = await clientFor(row.provider || "hamyon");
    if (!client.enabled) return { credited: false, status: row.status };

    let remote;
    try {
      remote = await client.checkOrder(row.provider_order);
    } catch (error) {
      // To'lov provayderda topilmadi (404) — muddati o'tgan bo'lsa yopamiz.
      if (error.reason === "not_found" && row.status === "pending" && Date.parse(row.expires_at) < Date.now()) {
        await rpcCancel(row.user_id, row.id).catch(() => {});
        return { credited: false, status: "cancelled" };
      }
      await log.record(error.reason === "auth" ? "error" : "warn", "check", error.message, {
        provider: row.provider,
        topupId: row.id,
        userId: row.user_id,
        data: { reason: error.reason || null },
      });
      throw error;
    }

    if (remote.status === "paid") {
      return creditPaidRow(row, { amount: remote.amount, via });
    }

    if (remote.status === "cancel" && row.status === "pending") {
      await rpcCancel(row.user_id, row.id).catch(() => {});
      return { credited: false, status: "cancelled" };
    }

    return { credited: false, status: row.status };
  }

  // Kabinet "Tekshirish" / avtomatik so'rov.
  async function checkTopup(userId, topupId) {
    const row = await getTopup(userId, topupId);
    if (!row) return { ok: false, error: "not_found" };

    if (row.status === "paid") {
      return { ok: true, credited: false, topup: toPublicTopup(row), balance: await getBalance(userId) };
    }

    const client = row.provider_order ? await clientFor(row.provider || "hamyon") : null;
    if (!client || !client.enabled) {
      return { ok: true, credited: false, topup: toPublicTopup(row), auto: false };
    }

    let sync;
    try {
      sync = await syncTopupRow(row, "poll");
    } catch {
      return { ok: false, error: "provider_unavailable", topup: toPublicTopup(row) };
    }

    const fresh = (await getTopup(userId, topupId)) || row;
    return {
      ok: true,
      credited: sync.credited,
      topup: toPublicTopup(fresh),
      balance: await getBalance(userId),
    };
  }

  // Foydalanuvchi to'lab, oynani yopib qo'ygan bo'lsa ham pul yo'qolmasin:
  // so'nggi soatlardagi to'lanmagan buyurtmalar qayta tekshiriladi
  // (kabinet ochilganda — o'ziniki, admin panelda — hammasi). Har bir
  // so'rov o'z provayderi bilan.
  async function syncRecentTopups({ userId, limit = 10 } = {}) {
    const params = new URLSearchParams({
      status: "neq.paid",
      provider_order: "not.is.null",
      created_at: `gt.${new Date(Date.now() - TOPUP_DEFAULTS.syncWindowMinutes * 60000).toISOString()}`,
      select: "*",
      order: "created_at.desc",
      limit: String(limit),
    });
    if (userId) params.set("user_id", `eq.${String(userId)}`);

    const rows = await requestFn(`/wallet_topups?${params.toString()}`);
    const credited = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      try {
        const sync = await syncTopupRow(row, "sync");
        if (sync.credited) credited.push(sync.result);
      } catch (error) {
        console.error("[WALLET_PAY_SYNC]", row.id, error.message);
      }
    }
    return credited;
  }

  async function findTopupByOrder(order, orderId, provider) {
    const byOrder = await requestFn(
      `/wallet_topups?${new URLSearchParams({ provider_order: `eq.${order}`, select: "*", limit: "1" }).toString()}`
    );
    if (Array.isArray(byOrder) && byOrder[0]) return byOrder[0];

    // payment_id hali saqlanmagan bo'lishi mumkin (prepare create javobidan
    // oldin keladi) — order_id = wallet_topups.id bo'yicha.
    if (!/^\d{1,19}$/.test(String(orderId || ""))) return null;
    const byId = await requestFn(
      `/wallet_topups?${new URLSearchParams({ id: `eq.${orderId}`, select: "*", limit: "1" }).toString()}`
    );
    const row = Array.isArray(byId) && byId[0] ? byId[0] : null;
    if (!row || (row.provider_order && row.provider_order !== order)) return null;
    if (!row.provider_order) {
      await patchTopup(row.id, { provider, provider_order: order });
      row.provider_order = order;
      row.provider = provider;
    }
    return row;
  }

  // Provayder callback'i (hozircha faqat Hamyon: prepare_url / complete_url).
  // Imzo shu provayder kalitlari bilan tekshiriladi — panelda boshqa
  // provayder tanlangan bo'lsa ham ochiq Hamyon to'lovlari tasdiqlanadi.
  // → { httpStatus, credited, result?, userId?, amount? }
  //   403 — imzo noto'g'ri; 500 — vaqtinchalik xato (provayder qayta yuboradi);
  //   200 — qabul qilindi (topilmagan bo'lsa ham — qayta yuborish foyda bermaydi).
  async function handleProviderCallback(fields, provider = "hamyon") {
    const client = await clientFor(provider);
    const cb = client.parseCallback(fields || {});
    const base = { provider, data: { payment_id: fields?.payment_id || null, order_id: fields?.order_id || null, status: fields?.status || null, amount: fields?.amount || null } };
    if (!cb.ok) {
      await log.record(cb.error === "not_configured" ? "error" : "warn", "callback", `Callback rad etildi: ${cb.error}`, base);
      return { httpStatus: cb.error === "not_configured" ? 503 : cb.error === "invalid" ? 400 : 403, credited: false, status: cb.error };
    }

    // Admin paneldagi "Tekshirish" test to'lovi — callback URL ishlayotganini bildiradi.
    if (/^health-/.test(String(cb.orderId || ""))) {
      await log.record("info", "callback", `Test to'lov callback'i keldi (${cb.status})`, base);
      return { httpStatus: 200, credited: false, status: "health" };
    }

    const row = await findTopupByOrder(cb.order, cb.orderId, provider);
    if (!row) {
      await log.record("warn", "callback", `To'lov bazada topilmadi (${cb.status})`, base);
      return { httpStatus: 200, credited: false, status: "not_found" };
    }

    const ctx = { provider, topupId: row.id, userId: row.user_id, data: base.data };

    if (cb.status === "paid") {
      if (row.status === "paid") {
        await log.record("info", "callback", "To'lov allaqachon yozilgan (qayta callback)", ctx);
        return { httpStatus: 200, credited: false, status: "already_paid" };
      }
      await log.record("info", "callback", `To'landi: ${cb.amount ?? "?"} so'm`, ctx);
      const sync = await creditPaidRow(row, { amount: cb.amount, paidAt: cb.paidAt, via: "callback" });
      return {
        httpStatus: 200,
        credited: sync.credited,
        status: sync.status,
        result: sync.result,
        userId: String(row.user_id),
        amount: Number(row.pay_amount),
      };
    }

    if (cb.status === "cancel" && row.status === "pending") {
      await rpcCancel(row.user_id, row.id);
      await log.record("info", "callback", `Bekor qilindi${cb.reason ? ` (${cb.reason})` : ""}`, ctx);
      return { httpStatus: 200, credited: false, status: "cancelled" };
    }

    await log.record("info", "callback", `Holat: ${cb.status}`, ctx);
    return { httpStatus: 200, credited: false, status: cb.status };
  }

  // Kabinet "Tarix" uchun: balansga tushgan to'ldirishlar.
  async function listPaidTopups(userId, limit = 50) {
    const params = new URLSearchParams({
      user_id: `eq.${String(userId)}`,
      status: "eq.paid",
      select: "id,amount,pay_amount,paid_amount,status,provider,provider_order,created_at,expires_at,paid_at",
      order: "paid_at.desc",
      limit: String(limit),
    });
    const rows = await requestFn(`/wallet_topups?${params.toString()}`);
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      ...toPublicTopup(row),
      provider: row.provider === "manual" ? "manual" : row.provider || null,
      reference: row.provider_order || null,
    }));
  }

  // Admin panel → Feat: so'nggi 7 kun statistikasi va kartalar bo'yicha
  // tushumlar (Hamyon har to'lovga qaysi kartani berganini saqlaymiz —
  // shu orqali har bir kuzatilayotgan kartaga nima tushgani ko'rinadi).
  async function getStats({ now = Date.now() } = {}) {
    const { config } = await load();
    const today = dayStart(now);
    const weekStart = today - 6 * 86400000;
    const params = new URLSearchParams({
      created_at: `gt.${new Date(weekStart).toISOString()}`,
      select: "id,status,amount,pay_amount,paid_amount,provider,card,created_at,expires_at,paid_at",
      order: "created_at.desc",
      limit: "2000",
    });
    const rows = await requestFn(`/wallet_topups?${params.toString()}`);
    const list = Array.isArray(rows) ? rows : [];

    const empty = () => ({ created: 0, paid: 0, paidSum: 0, pending: 0, expired: 0, cancelled: 0 });
    const todayStats = empty();
    const week = empty();
    const daily = Array.from({ length: 7 }, (_, i) => ({ day: new Date(weekStart + i * 86400000 + TZ_OFFSET_MS).toISOString().slice(0, 10), paid: 0, paidSum: 0 }));
    const cards = new Map();
    const providers = {};
    const adminCard = config.cardNumber || "";

    for (const row of list) {
      const view = toPublicTopup(row);
      const createdMs = Date.parse(row.created_at || "");
      const paidMs = Date.parse(row.paid_at || "");
      const sum = Number(row.paid_amount ?? row.pay_amount) || 0;
      const buckets = createdMs >= today ? [week, todayStats] : [week];
      for (const bucket of buckets) {
        bucket.created += 1;
        if (view.status === "pending") bucket.pending += 1;
        if (view.status === "expired") bucket.expired += 1;
        if (view.status === "cancelled") bucket.cancelled += 1;
      }
      if (view.status !== "paid") continue;

      week.paid += 1;
      week.paidSum += sum;
      if (paidMs >= today || (!Number.isFinite(paidMs) && createdMs >= today)) {
        todayStats.paid += 1;
        todayStats.paidSum += sum;
      }
      const dayIndex = Math.floor((dayStart(Number.isFinite(paidMs) ? paidMs : createdMs) - weekStart) / 86400000);
      if (daily[dayIndex]) {
        daily[dayIndex].paid += 1;
        daily[dayIndex].paidSum += sum;
      }
      const provider = row.provider || "manual";
      providers[provider] = providers[provider] || { paid: 0, paidSum: 0 };
      providers[provider].paid += 1;
      providers[provider].paidSum += sum;

      const card = cleanCardNumber(row.card) || (provider === "manual" || provider === "elderpay" ? adminCard : "");
      if (card) {
        const entry = cards.get(card) || { card, paid: 0, paidSum: 0, todaySum: 0, lastPaidAt: null, providers: new Set() };
        entry.paid += 1;
        entry.paidSum += sum;
        if (paidMs >= today) entry.todaySum += sum;
        if (!entry.lastPaidAt || String(row.paid_at) > entry.lastPaidAt) entry.lastPaidAt = row.paid_at || null;
        entry.providers.add(provider);
        cards.set(card, entry);
      }
    }

    // Hamyon kartalari hali to'lov olmagan bo'lsa ham — so'nggi berilgan kartalar.
    for (const row of list) {
      const card = cleanCardNumber(row.card);
      if (card && !cards.has(card)) cards.set(card, { card, paid: 0, paidSum: 0, todaySum: 0, lastPaidAt: null, providers: new Set([row.provider || "hamyon"]) });
    }
    if (adminCard && !cards.has(adminCard)) {
      cards.set(adminCard, { card: adminCard, paid: 0, paidSum: 0, todaySum: 0, lastPaidAt: null, providers: new Set() });
    }

    const finished = week.paid + week.expired + week.cancelled;
    return {
      today: todayStats,
      week: { ...week, successRate: finished ? Math.round((week.paid / finished) * 100) : null },
      daily,
      providers,
      cards: [...cards.values()]
        .map((entry) => ({ ...entry, providers: [...entry.providers], isAdminCard: entry.card === adminCard }))
        .sort((a, b) => b.paidSum - a.paidSum || (b.isAdminCard ? 1 : 0) - (a.isAdminCard ? 1 : 0)),
    };
  }

  async function buyLimit(userId, packageId) {
    return rpc("wallet_buy_limit", { p_user_id: String(userId), p_package_id: String(packageId || "") });
  }

  async function buyFirstmail(userId, itemId) {
    return rpc("wallet_buy_firstmail", { p_user_id: String(userId), p_item_id: String(itemId || "") });
  }

  async function refundOrder(orderId, reason, reverseGoods = false) {
    return rpc("wallet_refund_order", {
      p_order_id: String(orderId),
      p_reason: cleanText(reason, 300) || null,
      p_reverse_goods: Boolean(reverseGoods),
    });
  }

  async function adminAdjust(userId, delta, note) {
    return rpc("wallet_admin_adjust", {
      p_user_id: String(userId),
      p_delta: Number(delta),
      p_note: cleanText(note, 300) || null,
    });
  }

  async function listTopups({ status, userId, limit = 100 } = {}) {
    const params = new URLSearchParams({ select: "*", order: "created_at.desc", limit: String(limit) });
    if (["pending", "paid", "expired", "cancelled"].includes(status)) params.set("status", `eq.${status}`);
    if (/^\d{1,20}$/.test(String(userId || ""))) params.set("user_id", `eq.${userId}`);
    const rows = await requestFn(`/wallet_topups?${params.toString()}`);
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      ...toPublicTopup(row),
      user_id: String(row.user_id),
      requested: Number(row.amount) || 0,
      provider: row.provider || null,
      provider_order: row.provider_order || null,
      provider_txn_id: row.provider_txn_id || null,
      confirmed_by: row.confirmed_by || null,
    }));
  }

  return {
    events: log,
    getPayClient,
    getConfig,
    saveConfig,
    publicConfig,
    getProviderSettings,
    saveProviderSettings,
    testProvider,
    getStats,
    getBalance,
    listTransactions,
    getActiveTopup,
    createTopup,
    cancelTopup,
    checkTopup,
    creditIncoming,
    handleProviderCallback,
    syncRecentTopups,
    listPaidTopups,
    buyLimit,
    buyFirstmail,
    refundOrder,
    adminAdjust,
    listTopups,
  };
}

module.exports = {
  PROVIDER_MODES,
  PROVIDER_NAMES,
  TOPUP_DEFAULTS,
  WALLET_CONFIG_KEY,
  WALLET_PROVIDER_KEY,
  createPayClient,
  createWallet,
  formatCardNumber,
  normalizeProviderInput,
  normalizeProviderSettings,
  normalizeWalletConfig,
  normalizeWalletConfigInput,
  publicProviderSettings,
  toPublicTopup,
  toPublicTransaction,
};
