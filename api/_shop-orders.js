// ---------------------------------------------------------------------------
// Shaxsiy kabinet → Do'kon → Tarix (supabase/019_shop_orders.sql).
//
// Kabinetdan yuborilgan har bir xarid so'rovi `shop_orders` ga yoziladi.
// Yozish "best effort": jadval hali yo'q bo'lsa xarid so'rovi baribir ketadi.
// ---------------------------------------------------------------------------

const SHOP_ORDER_KINDS = Object.freeze(["firstmail", "limit", "donat"]);
const SHOP_ORDER_STATUSES = Object.freeze(["pending", "done", "cancelled"]);
const SHOP_ORDER_FIELDS = "id,kind,item_id,title,price,price_text,status,created_at";

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function buildShopOrder({ userId, kind, itemId, title, price, priceText } = {}) {
  const user = String(userId ?? "");
  const amount = Number(price);

  if (!/^\d{1,20}$/.test(user) || !SHOP_ORDER_KINDS.includes(kind)) {
    return null;
  }

  return {
    user_id: user,
    kind,
    item_id: itemId ? cleanText(itemId, 40) : null,
    title: cleanText(title, 120),
    price: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null,
    price_text: priceText ? cleanText(priceText, 60) : null,
  };
}

function toPublicShopOrder(row = {}) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title || "",
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    price_text: row.price_text || "",
    status: SHOP_ORDER_STATUSES.includes(row.status) ? row.status : "pending",
    created_at: row.created_at || null,
  };
}

// requestFn — Supabase REST so'rovchisi: (path, { method, body, prefer }) => data
async function recordShopOrder(requestFn, input) {
  const order = buildShopOrder(input);
  if (!order) return null;

  try {
    const rows = await requestFn(`/shop_orders?select=${SHOP_ORDER_FIELDS}`, {
      method: "POST",
      prefer: "return=representation",
      body: order,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return toPublicShopOrder(row && row.kind ? row : { ...order, created_at: new Date().toISOString() });
  } catch (error) {
    console.error("[SHOP_ORDER_LOG]", error?.message);
    return null;
  }
}

async function listUserShopOrders(requestFn, userId, limit = 50) {
  const params = new URLSearchParams({
    user_id: `eq.${String(userId)}`,
    select: SHOP_ORDER_FIELDS,
    order: "created_at.desc",
    limit: String(limit),
  });
  const rows = await requestFn(`/shop_orders?${params.toString()}`);
  return (Array.isArray(rows) ? rows : []).map(toPublicShopOrder);
}

module.exports = {
  SHOP_ORDER_KINDS,
  SHOP_ORDER_STATUSES,
  buildShopOrder,
  listUserShopOrders,
  recordShopOrder,
  toPublicShopOrder,
};
