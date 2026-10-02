// ---------------------------------------------------------------------------
// Do'kon (shop) — Firstmail pochtalar ombori.
//
// Ma'lumotlar alohida migratsiya talab qilmasligi uchun mavjud
// `bot_settings` jadvalida saqlanadi: har bir pochta — bitta qator,
// `key = "shop_fm:<id>"`, `value = { email, password, price, note, status, ... }`.
// Shunday qilib har bir yozuv atomik yangilanadi (bitta katta JSON massiv
// emas), bot ham, admin panel ham bir xil manbadan o'qiydi.
//
// Fayl nomi `_` bilan boshlanadi — Vercel uni alohida API endpoint deb
// hisoblamaydi; bot.js (Cloudflare Worker) va miniapp.js (Vercel) uni
// `require` orqali ishlatadi.
// ---------------------------------------------------------------------------

const crypto = require("node:crypto");

const SHOP_FM_KEY_PREFIX = "shop_fm:";
const SHOP_FM_STATUS_AVAILABLE = "available";
const SHOP_FM_STATUS_SOLD = "sold";
// Supabase PostgREST bitta javobda ko'pi bilan ~1000 qator qaytaradi —
// ro'yxat sahifalab o'qiladi.
const SHOP_FM_PAGE_SIZE = 1000;
const SHOP_FM_MAX_PAGES = 20;
const SHOP_FM_LIMITS = Object.freeze({
  email: 254,
  password: 200,
  price: 40,
  note: 300,
});

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
const SHOP_FM_ID_RE = /^[a-z0-9]{6,24}$/;

function generateShopItemId() {
  return `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

function isValidShopItemId(id) {
  return SHOP_FM_ID_RE.test(String(id || ""));
}

function cleanField(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeFirstmailInput(input = {}) {
  const email = cleanField(input.email, SHOP_FM_LIMITS.email).toLowerCase();
  const password = String(input.password ?? "").trim().slice(0, SHOP_FM_LIMITS.password);
  const price = cleanField(input.price, SHOP_FM_LIMITS.price);
  const note = cleanField(input.note, SHOP_FM_LIMITS.note);

  if (!email) {
    return { ok: false, error: "email_required" };
  }

  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "email_invalid" };
  }

  return { ok: true, value: { email, password, price, note } };
}

// "email:parol", "email parol", "email|parol", "email;parol" — har qatorda bitta.
function parseBulkFirstmails(text) {
  const items = [];
  const invalid = [];
  const seen = new Set();

  String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const match = line.match(/^(\S+@\S+?)\s*(?:[:|;,\t ]\s*(.*))?$/);
      const email = match ? match[1] : "";
      const password = match && match[2] ? match[2].trim() : "";
      const normalized = normalizeFirstmailInput({ email, password });

      if (!normalized.ok) {
        invalid.push({ line: index + 1, text: line.slice(0, 80), error: normalized.error });
        return;
      }

      if (seen.has(normalized.value.email)) {
        return;
      }

      seen.add(normalized.value.email);
      items.push(normalized.value);
    });

  return { items, invalid };
}

function normalizeFirstmailRecord(row = {}) {
  const key = String(row.key || "");
  const id = key.startsWith(SHOP_FM_KEY_PREFIX) ? key.slice(SHOP_FM_KEY_PREFIX.length) : String(row.id || "");
  const value = row.value && typeof row.value === "object" ? row.value : row;

  if (!id || !value.email) {
    return null;
  }

  return {
    id,
    email: String(value.email || ""),
    password: String(value.password || ""),
    price: String(value.price || ""),
    note: String(value.note || ""),
    status: value.status === SHOP_FM_STATUS_SOLD ? SHOP_FM_STATUS_SOLD : SHOP_FM_STATUS_AVAILABLE,
    created_at: value.created_at || row.updated_at || null,
    updated_at: value.updated_at || row.updated_at || null,
    sold_at: value.status === SHOP_FM_STATUS_SOLD ? value.sold_at || null : null,
  };
}

// Sotuvdagilar avval (yangilari tepada), sotilganlar oxirida (oxirgi sotilgan tepada).
function sortFirstmails(items = []) {
  const time = (value) => {
    const ms = Date.parse(value || "");
    return Number.isFinite(ms) ? ms : 0;
  };

  return items.slice().sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === SHOP_FM_STATUS_AVAILABLE ? -1 : 1;
    }

    if (a.status === SHOP_FM_STATUS_SOLD) {
      return time(b.sold_at) - time(a.sold_at) || time(b.created_at) - time(a.created_at);
    }

    return time(b.created_at) - time(a.created_at);
  });
}

function filterFirstmails(items = [], query = "") {
  const q = String(query || "").trim().toLowerCase();

  if (!q) {
    return items;
  }

  return items.filter((item) =>
    [item.email, item.price, item.note, item.id].some((field) => String(field || "").toLowerCase().includes(q))
  );
}

// "abcdef@firstmail.ltd" -> "abc•••@firstmail.ltd"
function maskShopEmail(email) {
  const value = String(email || "");
  const at = value.lastIndexOf("@");

  if (at <= 0) {
    return value ? `${value.slice(0, 2)}•••` : "";
  }

  const local = value.slice(0, at);
  const domain = value.slice(at);
  const visible = local.length <= 3 ? local.slice(0, 1) : local.slice(0, 3);

  return `${visible}•••${domain}`;
}

// "15000" -> "15 000 so'm"; boshqa ko'rinishlar (masalan "$2") o'zgarmaydi.
function formatShopPrice(price, currencyLabel = "so'm") {
  const value = String(price || "").trim();

  if (!value) {
    return "";
  }

  if (/^\d+$/.test(value)) {
    return `${value.replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${currencyLabel}`.trim();
  }

  return value;
}

// Narx faqat raqamlardan iborat bo'lsa summaga qo'shiladi ("15 000" ham bo'ladi).
function parseShopPriceNumber(price) {
  const value = String(price || "").replace(/\s+/g, "");
  return /^\d+$/.test(value) ? Number(value) : 0;
}

function summarizeFirstmails(items = []) {
  const counts = { total: items.length, available: 0, sold: 0 };
  const sums = { available: 0, sold: 0 };

  items.forEach((item) => {
    const key = item.status === SHOP_FM_STATUS_SOLD ? "sold" : "available";
    counts[key] += 1;
    sums[key] += parseShopPriceNumber(item.price);
  });

  return { counts, sums };
}

function getShopKey(id) {
  return `${SHOP_FM_KEY_PREFIX}${id}`;
}

// requestFn — Supabase REST so'rovchisi: (path, { method, body, prefer }) => data
function createFirstmailStore(requestFn) {
  if (typeof requestFn !== "function") {
    throw new Error("createFirstmailStore: requestFn is required");
  }

  async function list() {
    const rows = [];

    for (let page = 0; page < SHOP_FM_MAX_PAGES; page += 1) {
      const params = new URLSearchParams();
      params.set("key", `like.${SHOP_FM_KEY_PREFIX}*`);
      params.set("select", "key,value,updated_at");
      params.set("order", "key.asc");
      params.set("limit", String(SHOP_FM_PAGE_SIZE));
      params.set("offset", String(page * SHOP_FM_PAGE_SIZE));

      const chunk = await requestFn(`/bot_settings?${params.toString()}`);
      const batch = Array.isArray(chunk) ? chunk : [];
      rows.push(...batch);

      if (batch.length < SHOP_FM_PAGE_SIZE) {
        break;
      }
    }

    const items = rows.map(normalizeFirstmailRecord).filter(Boolean);

    return sortFirstmails(items);
  }

  async function get(id) {
    if (!isValidShopItemId(id)) {
      return null;
    }

    const rows = await requestFn(
      `/bot_settings?key=eq.${encodeURIComponent(getShopKey(id))}&select=key,value,updated_at&limit=1`
    );

    return Array.isArray(rows) && rows[0] ? normalizeFirstmailRecord(rows[0]) : null;
  }

  async function write(id, value) {
    const now = new Date().toISOString();
    const rows = await requestFn("/bot_settings?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: { key: getShopKey(id), value, updated_at: now },
    });
    const row = Array.isArray(rows) ? rows[0] : rows;

    return normalizeFirstmailRecord(row && row.key ? row : { key: getShopKey(id), value });
  }

  async function create(input) {
    const normalized = normalizeFirstmailInput(input);

    if (!normalized.ok) {
      return normalized;
    }

    const existing = await list();

    if (existing.some((item) => item.email === normalized.value.email)) {
      return { ok: false, error: "email_exists" };
    }

    const now = new Date().toISOString();
    const item = await write(generateShopItemId(), {
      ...normalized.value,
      status: SHOP_FM_STATUS_AVAILABLE,
      created_at: now,
      updated_at: now,
      sold_at: null,
    });

    return { ok: true, item };
  }

  async function createMany(inputs = [], shared = {}) {
    const existing = await list();
    const known = new Set(existing.map((item) => item.email));
    const created = [];
    const skipped = [];

    for (const input of inputs) {
      const normalized = normalizeFirstmailInput({
        ...input,
        price: input.price || shared.price,
        note: input.note || shared.note,
      });

      if (!normalized.ok) {
        skipped.push({ email: String(input.email || ""), error: normalized.error });
        continue;
      }

      if (known.has(normalized.value.email)) {
        skipped.push({ email: normalized.value.email, error: "email_exists" });
        continue;
      }

      const now = new Date().toISOString();
      const item = await write(generateShopItemId(), {
        ...normalized.value,
        status: SHOP_FM_STATUS_AVAILABLE,
        created_at: now,
        updated_at: now,
        sold_at: null,
      });

      known.add(normalized.value.email);
      created.push(item);
    }

    return { ok: true, created, skipped };
  }

  async function update(id, patch = {}) {
    const current = await get(id);

    if (!current) {
      return { ok: false, error: "not_found" };
    }

    const normalized = normalizeFirstmailInput({
      email: patch.email !== undefined ? patch.email : current.email,
      password: patch.password !== undefined ? patch.password : current.password,
      price: patch.price !== undefined ? patch.price : current.price,
      note: patch.note !== undefined ? patch.note : current.note,
    });

    if (!normalized.ok) {
      return normalized;
    }

    if (normalized.value.email !== current.email) {
      const existing = await list();

      if (existing.some((item) => item.id !== current.id && item.email === normalized.value.email)) {
        return { ok: false, error: "email_exists" };
      }
    }

    const item = await write(current.id, {
      ...normalized.value,
      status: current.status,
      created_at: current.created_at,
      updated_at: new Date().toISOString(),
      sold_at: current.sold_at,
    });

    return { ok: true, item };
  }

  async function setSold(id, sold = true) {
    const current = await get(id);

    if (!current) {
      return { ok: false, error: "not_found" };
    }

    const now = new Date().toISOString();
    const item = await write(current.id, {
      email: current.email,
      password: current.password,
      price: current.price,
      note: current.note,
      status: sold ? SHOP_FM_STATUS_SOLD : SHOP_FM_STATUS_AVAILABLE,
      created_at: current.created_at,
      updated_at: now,
      sold_at: sold ? now : null,
    });

    return { ok: true, item };
  }

  async function remove(id) {
    if (!isValidShopItemId(id)) {
      return { ok: false, error: "not_found" };
    }

    await requestFn(`/bot_settings?key=eq.${encodeURIComponent(getShopKey(id))}`, { method: "DELETE" });

    return { ok: true };
  }

  return { list, get, create, createMany, update, setSold, remove };
}

module.exports = {
  SHOP_FM_KEY_PREFIX,
  SHOP_FM_STATUS_AVAILABLE,
  SHOP_FM_STATUS_SOLD,
  SHOP_FM_LIMITS,
  createFirstmailStore,
  filterFirstmails,
  formatShopPrice,
  generateShopItemId,
  isValidShopItemId,
  maskShopEmail,
  normalizeFirstmailInput,
  normalizeFirstmailRecord,
  parseBulkFirstmails,
  parseShopPriceNumber,
  sortFirstmails,
  summarizeFirstmails,
};
