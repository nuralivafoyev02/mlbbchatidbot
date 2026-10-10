// ---------------------------------------------------------------------------
// Balans (hamyon) — supabase/020_wallet.sql ustidagi server qatlami.
//
// Pul bilan bog'liq har bir amal Postgres funksiyasida (bitta tranzaksiya):
// bu yerda faqat chaqiruv, natijani normallashtirish va to'ldirishni
// Hamyon API orqali ochish/tekshirish (api/_hamyon.js) bor.
//
// Karta rekvizitlari: bot_settings `wallet_config` (admin panel) → env
// (WALLET_CARD_NUMBER / WALLET_CARD_HOLDER / WALLET_CARD_BANK).
// ---------------------------------------------------------------------------

const hamyon = require("./_hamyon.js");

const WALLET_CONFIG_KEY = "wallet_config";
const TOPUP_DEFAULTS = Object.freeze({
  min: 5000,
  max: 5000000,
  // Hamyon buyurtmasi 5 daqiqa amal qiladi; Hamyon ulanmagan bo'lsa
  // (admin qo'lda tasdiqlaydi) so'rov 30 daqiqa turadi.
  ttlMinutes: hamyon.ORDER_TTL_MINUTES,
  manualTtlMinutes: 30,
  graceMinutes: 60,
  // Hamyon rejimida bekor qilingan/muddati o'tgan summa shuncha vaqt
  // boshqaga berilmaydi (Hamyon buyurtmasi 5 daqiqa yashaydi).
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
function createWallet(requestFn, { env = process.env, fetchFn = fetch, payClient } = {}) {
  if (typeof requestFn !== "function") {
    throw new Error("createWallet: requestFn is required");
  }

  const rpc = (name, args) => requestFn(`/rpc/${name}`, { method: "POST", body: args });
  const client = payClient || hamyon.createHamyonClient({ config: hamyon.resolveHamyonConfig(env), fetchFn });

  async function getConfig() {
    let stored = null;
    try {
      const rows = await requestFn(`/bot_settings?key=eq.${WALLET_CONFIG_KEY}&select=value&limit=1`);
      stored = Array.isArray(rows) && rows[0] ? rows[0].value : null;
    } catch (error) {
      console.error("[WALLET_CONFIG]", error?.message);
    }
    return normalizeWalletConfig(stored, env);
  }

  async function saveConfig(input) {
    const normalized = normalizeWalletConfigInput(input);
    if (!normalized.ok) return normalized;

    await requestFn("/bot_settings?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { key: WALLET_CONFIG_KEY, value: normalized.value, updated_at: new Date().toISOString() },
    });
    return { ok: true, config: await getConfig() };
  }

  // Kabinet uchun: konfiguratsiyaning foydalanuvchiga ko'rinadigan qismi.
  function publicConfig(config) {
    return {
      // Hamyon page rejimida karta o'rniga to'lov kartasi (topup.card) bo'ladi.
      enabled: Boolean(config.enabled && (config.cardNumber || client.enabled)),
      card: formatCardNumber(config.cardNumber),
      holder: config.cardHolder,
      bank: config.cardBank,
      min: config.min,
      max: config.max,
      presets: config.presets,
      auto: client.enabled,
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

  // Hamyon ulangan bo'lsa — aniq summa (band bo'lsa +1, +2 so'm, 021),
  // aks holda tasodifiy +1..999 (summa to'lovni ajratadigan yagona belgi).
  async function createTopupRow(userId, amount) {
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

  // 1) bazada noyob summali so'rov; 2) Hamyon API'da shu summaga buyurtma.
  // Hamyon conflict qaytarsa (shu summada boshqa faol to'lov) — so'rov bekor
  // qilinadi va boshqa summa bilan qayta uriniladi.
  async function createTopup(userId, amountRaw) {
    const config = await getConfig();
    if (!config.enabled || (!config.cardNumber && !client.enabled)) {
      return { ok: false, error: "topup_disabled" };
    }

    const amount = parsePositiveInt(amountRaw);
    if (!Number.isFinite(amount) || amount < config.min || amount > config.max) {
      return { ok: false, error: "invalid_amount", min: config.min, max: config.max };
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await createTopupRow(userId, amount);

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
        console.error("[WALLET_HAMYON_CREATE]", error.message);
        return { ok: false, error: "provider_unavailable" };
      }

      // Hamyon summani o'zgartirib yuborsa — foydalanuvchi noto'g'ri summa
      // o'tkazmasligi uchun so'rovni yopamiz.
      if (order.amount !== Number(topup.pay_amount)) {
        console.error("[WALLET_HAMYON_AMOUNT]", topup.pay_amount, order.amount);
        await client.cancelOrder(order.order).catch(() => {});
        await rpcCancel(userId, topup.id).catch(() => {});
        return { ok: false, error: "provider_unavailable" };
      }

      // Hamyon'dagi to'lov bazaga bog'lanmasa — uni tekshirib bo'lmaydi.
      // Ochiq qoldirmaymiz: ikkala tomonda ham yopiladi (023 migratsiyasi
      // qo'llanmagan bo'lsa shu yerga tushadi).
      try {
        await patchTopup(topup.id, {
          provider: client.provider,
          provider_order: order.order,
          card: order.card || null,
        });
      } catch (error) {
        console.error("[WALLET_HAMYON_SAVE]", topup.id, error.message);
        await client.cancelOrder(order.order).catch(() => {});
        await rpcCancel(userId, topup.id).catch(() => {});
        return { ok: false, error: "wallet_unavailable" };
      }
      return { ok: true, topup: toPublicTopup({ ...topup, card: order.card }) };
    }

    return { ok: false, error: "busy" };
  }

  async function cancelTopup(userId, topupId) {
    const row = await getTopup(userId, topupId);
    if (!row) return { ok: false };
    if (row.provider_order && row.status === "pending") {
      await client.cancelOrder(row.provider_order).catch((error) => console.error("[WALLET_HAMYON_CANCEL]", error.message));
    }
    const result = await rpcCancel(userId, topupId);
    return { ok: Boolean(result && result.ok) };
  }

  // Bitta tushumni balansga yozish (Hamyon check yoki admin).
  async function creditIncoming(txn, { topupId = null, confirmedBy = null, provider = client.provider } = {}) {
    return rpc("wallet_credit_topup", {
      p_provider: provider,
      p_txn_id: txn.id || null,
      p_amount: txn.amount,
      p_paid_at: txn.paid_at || new Date().toISOString(),
      p_topup_id: topupId,
      p_confirmed_by: confirmedBy,
      p_grace_minutes: TOPUP_DEFAULTS.graceMinutes,
    });
  }

  // Hamyon "paid" deb tasdiqlagan to'lovni balansga yozadi. Summa — o'z
  // bazamizdan (Hamyon tavsiyasi); Hamyon boshqa summa aytsa yozilmaydi,
  // admin panelda qo'lda ko'riladi. Idempotent (wallet_credit_topup).
  async function creditPaidRow(row, { amount, paidAt } = {}) {
    const expected = Number(row.pay_amount);
    if (amount !== null && amount !== undefined && Number(amount) !== expected) {
      console.error("[WALLET_HAMYON_AMOUNT_MISMATCH]", row.id, expected, amount);
      return { credited: false, status: "amount_mismatch" };
    }
    const result = await creditIncoming(
      { id: row.provider_order, amount: expected, paid_at: paidAt || null },
      { topupId: row.id, provider: client.provider }
    );
    return { credited: result?.status === "credited", status: "paid", result };
  }

  // Bitta so'rov holatini Hamyon'dan olib, to'langan bo'lsa balansga yozadi.
  // Natija: { credited, status, result? }
  async function syncTopupRow(row) {
    if (!row || row.status === "paid" || !row.provider_order || !client.enabled) {
      return { credited: false, status: row?.status || null };
    }

    const remote = await client.checkOrder(row.provider_order);

    if (remote.status === "paid") {
      return creditPaidRow(row, { amount: remote.amount });
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

    if (!row.provider_order || !client.enabled) {
      return { ok: true, credited: false, topup: toPublicTopup(row), auto: false };
    }

    let sync;
    try {
      sync = await syncTopupRow(row);
    } catch (error) {
      console.error("[WALLET_HAMYON_CHECK]", error.message);
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
  // (kabinet ochilganda — o'ziniki, admin panelda — hammasi).
  async function syncRecentTopups({ userId, limit = 10 } = {}) {
    if (!client.enabled) return [];

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
        const sync = await syncTopupRow(row);
        if (sync.credited) credited.push(sync.result);
      } catch (error) {
        console.error("[WALLET_HAMYON_SYNC]", row.id, error.message);
      }
    }
    return credited;
  }

  async function findTopupByOrder(order, orderId) {
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
      await patchTopup(row.id, { provider: client.provider, provider_order: order });
      row.provider_order = order;
    }
    return row;
  }

  // Hamyon complete_url / prepare_url callback'i.
  // → { httpStatus, credited, result?, userId?, amount? }
  //   403 — imzo noto'g'ri; 500 — vaqtinchalik xato (Hamyon qayta yuboradi);
  //   200 — qabul qilindi (topilmagan bo'lsa ham — qayta yuborish foyda bermaydi).
  async function handleProviderCallback(fields) {
    const cb = client.parseCallback(fields);
    if (!cb.ok) {
      console.error("[WALLET_HAMYON_CALLBACK]", cb.error, fields?.payment_id || "");
      return { httpStatus: cb.error === "not_configured" ? 503 : cb.error === "invalid" ? 400 : 403, credited: false };
    }

    const row = await findTopupByOrder(cb.order, cb.orderId);
    if (!row) {
      console.error("[WALLET_HAMYON_CALLBACK]", "not_found", cb.order, cb.orderId || "", cb.status);
      return { httpStatus: 200, credited: false, status: "not_found" };
    }

    if (cb.status === "paid") {
      if (row.status === "paid") return { httpStatus: 200, credited: false, status: "already_paid" };
      const sync = await creditPaidRow(row, { amount: cb.amount, paidAt: cb.paidAt });
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
      return { httpStatus: 200, credited: false, status: "cancelled" };
    }

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
      provider: row.provider === "manual" ? "manual" : row.provider ? "hamyon" : null,
      reference: row.provider_order || null,
    }));
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
    payClient: client,
    getConfig,
    saveConfig,
    publicConfig,
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
  TOPUP_DEFAULTS,
  WALLET_CONFIG_KEY,
  createWallet,
  formatCardNumber,
  normalizeWalletConfig,
  normalizeWalletConfigInput,
  toPublicTopup,
  toPublicTransaction,
};
