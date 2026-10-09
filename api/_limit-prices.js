// ---------------------------------------------------------------------------
// Do'kon → Limit narxlari (admin panel orqali to'ldiriladi).
//
// Shaxsiy kabinetdagi "$" tugmasi shu ro'yxatni ko'rsatadi. Firstmail/Donat
// kabi `bot_settings` jadvalida: har bir paket — bitta qator,
// `key = "shop_lp:<id>"`, `value = { kind, amount, price, title, note, hit }`.
//   kind   — full_info | reset_pw (ulanmalar tekshiruvi botda yo'q — sotilmaydi;
//            eski bind_info yozuvlari ro'yxatga chiqmaydi)
//   amount — nechta limit
//   price  — narx, so'm (butun son)
//   hit    — "Mashhur" belgisi
// ---------------------------------------------------------------------------

const { generateShopItemId, isValidShopItemId } = require("./_shop.js");

const SHOP_LP_KEY_PREFIX = "shop_lp:";
const SHOP_LP_KINDS = Object.freeze(["full_info", "reset_pw"]);
const SHOP_LP_MAX_ITEMS = 60;
const SHOP_LP_MAX_AMOUNT = 100000;
const SHOP_LP_MAX_PRICE = 1_000_000_000;
const SHOP_LP_LIMITS = Object.freeze({ title: 40, note: 200 });

function cleanField(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parsePositiveInt(value, max) {
  const text = String(value ?? "").replace(/\s+/g, "");

  if (!/^\d+$/.test(text)) {
    return NaN;
  }

  const number = Number(text);
  return number > 0 && number <= max ? number : NaN;
}

function normalizeLimitPriceInput(input = {}) {
  const kind = String(input.kind || "");
  const amount = parsePositiveInt(input.amount, SHOP_LP_MAX_AMOUNT);
  const price = parsePositiveInt(input.price, SHOP_LP_MAX_PRICE);

  if (!SHOP_LP_KINDS.includes(kind)) {
    return { ok: false, error: "kind_invalid" };
  }

  if (Number.isNaN(amount)) {
    return { ok: false, error: "amount_invalid" };
  }

  if (Number.isNaN(price)) {
    return { ok: false, error: "price_invalid" };
  }

  return {
    ok: true,
    value: {
      kind,
      amount,
      price,
      title: cleanField(input.title, SHOP_LP_LIMITS.title),
      note: cleanField(input.note, SHOP_LP_LIMITS.note),
      hit: input.hit === true || input.hit === "true" || input.hit === 1 || input.hit === "1",
    },
  };
}

function normalizeLimitPriceRecord(row = {}) {
  const key = String(row.key || "");
  const id = key.startsWith(SHOP_LP_KEY_PREFIX) ? key.slice(SHOP_LP_KEY_PREFIX.length) : String(row.id || "");
  const value = row.value && typeof row.value === "object" ? row.value : row;
  const amount = Number(value.amount);
  const price = Number(value.price);

  if (!isValidShopItemId(id) || !SHOP_LP_KINDS.includes(value.kind) || !(amount > 0) || !(price > 0)) {
    return null;
  }

  return {
    id,
    kind: value.kind,
    amount,
    price,
    title: String(value.title || ""),
    note: String(value.note || ""),
    hit: value.hit === true,
    created_at: value.created_at || row.updated_at || null,
    updated_at: value.updated_at || row.updated_at || null,
  };
}

// Tur bo'yicha (full_info → reset_pw), keyin miqdor bo'yicha.
function sortLimitPrices(items = []) {
  return items.slice().sort((a, b) =>
    SHOP_LP_KINDS.indexOf(a.kind) - SHOP_LP_KINDS.indexOf(b.kind) || a.amount - b.amount || a.price - b.price
  );
}

// Kabinetga — faqat kerakli maydonlar.
function toPublicLimitPrice(item) {
  return {
    id: item.id,
    kind: item.kind,
    amount: item.amount,
    price: item.price,
    title: item.title,
    note: item.note,
    hit: item.hit,
  };
}

function getLimitPriceKey(id) {
  return `${SHOP_LP_KEY_PREFIX}${id}`;
}

// requestFn — Supabase REST so'rovchisi: (path, { method, body, prefer }) => data
function createLimitPriceStore(requestFn) {
  if (typeof requestFn !== "function") {
    throw new Error("createLimitPriceStore: requestFn is required");
  }

  async function list() {
    const params = new URLSearchParams();
    params.set("key", `like.${SHOP_LP_KEY_PREFIX}*`);
    params.set("select", "key,value,updated_at");
    params.set("limit", String(SHOP_LP_MAX_ITEMS * 2));

    const rows = await requestFn(`/bot_settings?${params.toString()}`);
    return sortLimitPrices((Array.isArray(rows) ? rows : []).map(normalizeLimitPriceRecord).filter(Boolean));
  }

  async function get(id) {
    if (!isValidShopItemId(id)) {
      return null;
    }

    const rows = await requestFn(
      `/bot_settings?key=eq.${encodeURIComponent(getLimitPriceKey(id))}&select=key,value,updated_at&limit=1`
    );

    return Array.isArray(rows) && rows[0] ? normalizeLimitPriceRecord(rows[0]) : null;
  }

  async function save(input = {}) {
    const normalized = normalizeLimitPriceInput(input);

    if (!normalized.ok) {
      return normalized;
    }

    const id = input.id ? String(input.id) : "";
    const items = await list();
    const current = id ? items.find((item) => item.id === id) : null;

    if (id && !current) {
      return { ok: false, error: "item_not_found" };
    }

    if (!current && items.length >= SHOP_LP_MAX_ITEMS) {
      return { ok: false, error: "item_limit" };
    }

    const duplicate = items.some((item) =>
      item.id !== id && item.kind === normalized.value.kind && item.amount === normalized.value.amount
    );

    if (duplicate) {
      return { ok: false, error: "item_exists" };
    }

    const now = new Date().toISOString();
    const itemId = current ? current.id : generateShopItemId();
    const value = {
      ...normalized.value,
      created_at: current ? current.created_at : now,
      updated_at: now,
    };
    const rows = await requestFn("/bot_settings?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: { key: getLimitPriceKey(itemId), value, updated_at: now },
    });
    const row = Array.isArray(rows) ? rows[0] : rows;

    return {
      ok: true,
      item: normalizeLimitPriceRecord(row && row.key ? row : { key: getLimitPriceKey(itemId), value }),
    };
  }

  async function remove(id) {
    if (!isValidShopItemId(id)) {
      return { ok: false, error: "item_not_found" };
    }

    await requestFn(`/bot_settings?key=eq.${encodeURIComponent(getLimitPriceKey(id))}`, { method: "DELETE" });
    return { ok: true };
  }

  return { list, get, save, remove };
}

module.exports = {
  SHOP_LP_KEY_PREFIX,
  SHOP_LP_KINDS,
  SHOP_LP_LIMITS,
  SHOP_LP_MAX_ITEMS,
  createLimitPriceStore,
  normalizeLimitPriceInput,
  normalizeLimitPriceRecord,
  sortLimitPrices,
  toPublicLimitPrice,
};
