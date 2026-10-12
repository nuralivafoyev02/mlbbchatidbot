// ---------------------------------------------------------------------------
// Shaxsiy kabinet → Sozlamalar → "Guruhlarimiz" ro'yxati.
//
// Faqat admin panel orqali boshqariladi (api/miniapp.js: cabinet_groups_*).
// bot_settings `cabinet_groups` = { items: [{ id, name, link }], updated_at }.
// Havola faqat https:// (t.me, telegram.me yoki boshqa sayt) yoki @username;
// @username t.me havolasiga aylantiriladi.
// ---------------------------------------------------------------------------

const crypto = require("node:crypto");

const CABINET_GROUPS_KEY = "cabinet_groups";
const CABINET_GROUPS_MAX = 12;
const NAME_MAX = 40;

function cleanName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

// → to'g'ri havola yoki "".
function normalizeGroupLink(value) {
  const text = String(value ?? "").trim();
  const handle = /^@([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(text);
  if (handle) return `https://t.me/${handle[1]}`;
  if (/^(t\.me|telegram\.me)\//i.test(text)) return normalizeGroupLink(`https://${text}`);
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return "";
  if (text.length > 300) return "";
  return url.toString();
}

function isTelegramLink(link) {
  try {
    return /^(t\.me|telegram\.me)$/i.test(new URL(link).hostname);
  } catch {
    return false;
  }
}

function newId() {
  return crypto.randomBytes(5).toString("hex");
}

// Admin kiritgan ro'yxatni tekshiradi. → { ok, items } | { ok: false, error, index }
function normalizeGroupsInput(input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > CABINET_GROUPS_MAX) return { ok: false, error: "groups_limit" };
  const items = [];
  const seen = new Set();
  for (let index = 0; index < list.length; index += 1) {
    const raw = list[index] && typeof list[index] === "object" ? list[index] : {};
    const name = cleanName(raw.name);
    const link = normalizeGroupLink(raw.link);
    if (!name) return { ok: false, error: "group_name_invalid", index };
    if (!link) return { ok: false, error: "group_link_invalid", index };
    let id = /^[a-f0-9]{6,16}$/.test(String(raw.id || "")) ? String(raw.id) : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    items.push({ id, name, link });
  }
  return { ok: true, items };
}

function toPublicGroup(item) {
  return { id: item.id, name: item.name, link: item.link, telegram: isTelegramLink(item.link) };
}

// requestFn — Supabase REST so'rovchisi: (path, { method, body, prefer }) => data
function createCabinetGroupsStore(requestFn) {
  async function list() {
    const rows = await requestFn(`/bot_settings?key=eq.${CABINET_GROUPS_KEY}&select=value&limit=1`);
    const value = Array.isArray(rows) && rows[0] ? rows[0].value : null;
    const parsed = normalizeGroupsInput(value && Array.isArray(value.items) ? value.items : []);
    return parsed.ok ? parsed.items : [];
  }

  async function save(input) {
    const parsed = normalizeGroupsInput(input);
    if (!parsed.ok) return parsed;
    const now = new Date().toISOString();
    await requestFn("/bot_settings?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { key: CABINET_GROUPS_KEY, value: { items: parsed.items, updated_at: now }, updated_at: now },
    });
    return { ok: true, items: parsed.items };
  }

  return { list, save };
}

module.exports = {
  CABINET_GROUPS_KEY,
  CABINET_GROUPS_MAX,
  createCabinetGroupsStore,
  normalizeGroupLink,
  normalizeGroupsInput,
  toPublicGroup,
};
