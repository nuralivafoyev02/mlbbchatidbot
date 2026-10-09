// ---------------------------------------------------------------------------
// Shaxsiy kabinet → Do'kon → Tarix (supabase/019_shop_orders.sql).
//
// Kabinetdan yuborilgan har bir xarid so'rovi `shop_orders` ga yoziladi.
// Yozish "best effort": jadval hali yo'q bo'lsa xarid so'rovi baribir ketadi.
// ---------------------------------------------------------------------------

const SHOP_ORDER_KINDS = Object.freeze(["firstmail", "limit", "donat"]);
const SHOP_ORDER_STATUSES = Object.freeze(["pending", "done", "cancelled", "refunded"]);
// 020_wallet.sql ustunlari (paid_amount, delivery, note) — bo'lmasa eski ro'yxat.
const SHOP_ORDER_FIELDS = "id,kind,item_id,title,price,price_text,status,created_at";
const SHOP_ORDER_WALLET_FIELDS = `${SHOP_ORDER_FIELDS},paid_amount,delivery,note,refunded_at`;

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

// Firstmail login/paroli faqat bajarilgan (qaytarilmagan) buyurtmada egasiga ko'rinadi.
function publicDelivery(row) {
  const delivery = row.delivery && typeof row.delivery === "object" ? row.delivery : null;
  if (!delivery || row.status !== "done") return null;
  if (row.kind === "firstmail" && delivery.email) {
    return { email: String(delivery.email), password: String(delivery.password || "") };
  }
  if (row.kind === "limit" && delivery.kind) {
    return { kind: String(delivery.kind), amount: Number(delivery.amount) || 0 };
  }
  return null;
}

function toPublicShopOrder(row = {}) {
  const delivery = publicDelivery(row);
  return {
    id: row.id,
    kind: row.kind,
    // Sotib olingan pochta egasiga to'liq ko'rinadi (bazada yashirilgan holda turadi).
    title: (delivery && delivery.email) || row.title || "",
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    price_text: row.price_text || "",
    status: SHOP_ORDER_STATUSES.includes(row.status) ? row.status : "pending",
    paid: Number(row.paid_amount) > 0,
    delivery,
    note: row.status === "refunded" ? String(row.note || "") : "",
    created_at: row.created_at || null,
    refunded_at: row.refunded_at || null,
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
  const query = (select) => new URLSearchParams({
    user_id: `eq.${String(userId)}`,
    select,
    order: "created_at.desc",
    limit: String(limit),
  }).toString();

  let rows;
  try {
    rows = await requestFn(`/shop_orders?${query(SHOP_ORDER_WALLET_FIELDS)}`);
  } catch (error) {
    // 020 migratsiyasi hali qo'llanmagan — yangi ustunlarsiz o'qiymiz.
    if (!/column|42703|PGRST/i.test(String(error?.message))) throw error;
    rows = await requestFn(`/shop_orders?${query(SHOP_ORDER_FIELDS)}`);
  }
  return (Array.isArray(rows) ? rows : []).map(toPublicShopOrder);
}

// Admin panel: foydalanuvchi buyurtmalari yoki hammasi (oxirgilari).
async function listShopOrders(requestFn, { userId, limit = 100 } = {}) {
  const params = new URLSearchParams({ select: `user_id,${SHOP_ORDER_WALLET_FIELDS}`, order: "created_at.desc", limit: String(limit) });
  if (/^\d{1,20}$/.test(String(userId || ""))) params.set("user_id", `eq.${userId}`);
  const rows = await requestFn(`/shop_orders?${params.toString()}`);
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...toPublicShopOrder(row),
    user_id: String(row.user_id),
    item_id: row.item_id || null,
    paid_amount: Number(row.paid_amount) || 0,
    note: String(row.note || ""),
  }));
}

module.exports = {
  SHOP_ORDER_KINDS,
  SHOP_ORDER_STATUSES,
  buildShopOrder,
  listShopOrders,
  listUserShopOrders,
  recordShopOrder,
  toPublicShopOrder,
};
