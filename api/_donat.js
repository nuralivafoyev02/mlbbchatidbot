// ---------------------------------------------------------------------------
// Do'kon → Donat: o'yinlar va ularning paketlari (faqat admin panel uchun).
//
// Hozircha botga ulanmagan — ma'lumotlar to'liq yig'ilgandan keyin botdagi
// do'konga qo'shiladi. Firstmail kabi `bot_settings` jadvalida saqlanadi:
// har bir o'yin — bitta qator, `key = "shop_dn:<id>"`,
// `value = { name, note, markup, packs: [{ id, name, cost, markup }], ... }`.
// Paketlar o'yin ichida turadi — bitta o'yinda ular soni kam, shuning uchun
// alohida qator shart emas. Bot faqat `shop_fm:*` ni o'qiydi, `shop_dn:*`
// unga ko'rinmaydi.
//
// Narx hisobi: sotuv narxi = tannarx × (1 + ustama% / 100). Paketda ustama
// berilmasa (null), o'yinning standart ustamasi ishlatiladi.
// ---------------------------------------------------------------------------

const { generateShopItemId, isValidShopItemId } = require("./_shop.js");

const SHOP_DN_KEY_PREFIX = "shop_dn:";
const SHOP_DN_PAGE_SIZE = 1000;
const SHOP_DN_MAX_PACKS = 100;
const SHOP_DN_MAX_MARKUP = 1000;
const SHOP_DN_MAX_COST = 1_000_000_000;
const SHOP_DN_LIMITS = Object.freeze({
  name: 80,
  packName: 80,
  note: 300,
});

function cleanField(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

// "12", "12.5", "12,5", "12%" -> 12 / 12.5. Bo'sh -> null. Noto'g'ri -> NaN.
function parseMarkup(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).replace(/\s+/g, "").replace(/%$/, "").replace(",", ".");

  if (!text) {
    return null;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return NaN;
  }

  const number = Number(text);
  return number <= SHOP_DN_MAX_MARKUP ? number : NaN;
}

// "15 000", "15000" -> 15000. Bo'sh/noto'g'ri -> NaN.
function parseCost(value) {
  const text = String(value ?? "").replace(/\s+/g, "");

  if (!/^\d+$/.test(text)) {
    return NaN;
  }

  const number = Number(text);
  return number > 0 && number <= SHOP_DN_MAX_COST ? number : NaN;
}

function getEffectiveMarkup(pack, game) {
  if (pack && typeof pack.markup === "number") {
    return pack.markup;
  }

  return game && typeof game.markup === "number" ? game.markup : 0;
}

// So'm butun songa yaxlitlanadi.
function computePackPrice(cost, markup) {
  const base = Number(cost) || 0;
  const percent = Number(markup) || 0;
  const price = Math.round(base * (1 + percent / 100));

  return { cost: base, markup: percent, price, profit: price - base };
}

function normalizeGameInput(input = {}) {
  const name = cleanField(input.name, SHOP_DN_LIMITS.name);
  const note = cleanField(input.note, SHOP_DN_LIMITS.note);
  const markup = parseMarkup(input.markup);

  if (!name) {
    return { ok: false, error: "game_name_required" };
  }

  if (Number.isNaN(markup)) {
    return { ok: false, error: "markup_invalid" };
  }

  return { ok: true, value: { name, note, markup: markup ?? 0 } };
}

function normalizePackInput(input = {}) {
  const name = cleanField(input.name, SHOP_DN_LIMITS.packName);
  const cost = parseCost(input.cost);
  const markup = parseMarkup(input.markup);

  if (!name) {
    return { ok: false, error: "pack_name_required" };
  }

  if (Number.isNaN(cost)) {
    return { ok: false, error: "cost_invalid" };
  }

  if (Number.isNaN(markup)) {
    return { ok: false, error: "markup_invalid" };
  }

  return { ok: true, value: { name, cost, markup } };
}

function normalizePackRecord(raw = {}) {
  if (!raw || !isValidShopItemId(raw.id) || !raw.name) {
    return null;
  }

  const cost = Number(raw.cost);

  return {
    id: String(raw.id),
    name: String(raw.name),
    cost: Number.isFinite(cost) && cost > 0 ? cost : 0,
    markup: typeof raw.markup === "number" && Number.isFinite(raw.markup) ? raw.markup : null,
  };
}

// Saqlangan qatorni + hisoblangan narxlarni qaytaradi (admin panel uchun).
function normalizeGameRecord(row = {}) {
  const key = String(row.key || "");
  const id = key.startsWith(SHOP_DN_KEY_PREFIX) ? key.slice(SHOP_DN_KEY_PREFIX.length) : String(row.id || "");
  const value = row.value && typeof row.value === "object" ? row.value : row;

  if (!id || !value.name) {
    return null;
  }

  const markup = Number(value.markup);
  const game = {
    id,
    name: String(value.name || ""),
    note: String(value.note || ""),
    markup: Number.isFinite(markup) ? markup : 0,
    created_at: value.created_at || row.updated_at || null,
    updated_at: value.updated_at || row.updated_at || null,
  };
  const packs = (Array.isArray(value.packs) ? value.packs : []).map(normalizePackRecord).filter(Boolean);

  game.packs = packs.map((pack) => {
    const priced = computePackPrice(pack.cost, getEffectiveMarkup(pack, game));
    return { ...pack, effective_markup: priced.markup, price: priced.price, profit: priced.profit };
  });

  return game;
}

// Saqlash uchun — hisoblangan maydonlarsiz.
function toStoredGame(game) {
  return {
    name: game.name,
    note: game.note,
    markup: game.markup,
    packs: (game.packs || []).map((pack) => ({
      id: pack.id,
      name: pack.name,
      cost: pack.cost,
      markup: pack.markup,
    })),
    created_at: game.created_at,
    updated_at: game.updated_at,
  };
}

function sortGames(games = []) {
  return games.slice().sort((a, b) => a.name.localeCompare(b.name, "uz", { sensitivity: "base" }));
}

function summarizeGames(games = []) {
  return {
    games: games.length,
    packs: games.reduce((sum, game) => sum + game.packs.length, 0),
  };
}

function getDonatKey(id) {
  return `${SHOP_DN_KEY_PREFIX}${id}`;
}

// requestFn — Supabase REST so'rovchisi: (path, { method, body, prefer }) => data
function createDonatStore(requestFn) {
  if (typeof requestFn !== "function") {
    throw new Error("createDonatStore: requestFn is required");
  }

  async function list() {
    const params = new URLSearchParams();
    params.set("key", `like.${SHOP_DN_KEY_PREFIX}*`);
    params.set("select", "key,value,updated_at");
    params.set("order", "key.asc");
    params.set("limit", String(SHOP_DN_PAGE_SIZE));

    const rows = await requestFn(`/bot_settings?${params.toString()}`);
    const games = (Array.isArray(rows) ? rows : []).map(normalizeGameRecord).filter(Boolean);

    return sortGames(games);
  }

  async function get(id) {
    if (!isValidShopItemId(id)) {
      return null;
    }

    const rows = await requestFn(
      `/bot_settings?key=eq.${encodeURIComponent(getDonatKey(id))}&select=key,value,updated_at&limit=1`
    );

    return Array.isArray(rows) && rows[0] ? normalizeGameRecord(rows[0]) : null;
  }

  async function write(game) {
    const now = new Date().toISOString();
    const stored = toStoredGame({ ...game, updated_at: now });
    const rows = await requestFn("/bot_settings?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: { key: getDonatKey(game.id), value: stored, updated_at: now },
    });
    const row = Array.isArray(rows) ? rows[0] : rows;

    return normalizeGameRecord(row && row.key ? row : { key: getDonatKey(game.id), value: stored });
  }

  function hasDuplicateName(items, name, exceptId) {
    const target = name.toLowerCase();
    return items.some((item) => item.id !== exceptId && item.name.toLowerCase() === target);
  }

  async function saveGame(input = {}) {
    const normalized = normalizeGameInput(input);

    if (!normalized.ok) {
      return normalized;
    }

    const games = await list();
    const id = input.id ? String(input.id) : "";
    const current = id ? games.find((game) => game.id === id) : null;

    if (id && !current) {
      return { ok: false, error: "game_not_found" };
    }

    if (hasDuplicateName(games, normalized.value.name, id)) {
      return { ok: false, error: "game_exists" };
    }

    const now = new Date().toISOString();
    const game = await write({
      id: current ? current.id : generateShopItemId(),
      ...normalized.value,
      packs: current ? current.packs : [],
      created_at: current ? current.created_at : now,
    });

    return { ok: true, game };
  }

  async function removeGame(id) {
    if (!isValidShopItemId(id)) {
      return { ok: false, error: "game_not_found" };
    }

    await requestFn(`/bot_settings?key=eq.${encodeURIComponent(getDonatKey(id))}`, { method: "DELETE" });

    return { ok: true };
  }

  async function savePack(gameId, input = {}) {
    const game = await get(gameId);

    if (!game) {
      return { ok: false, error: "game_not_found" };
    }

    const normalized = normalizePackInput(input);

    if (!normalized.ok) {
      return normalized;
    }

    const packId = input.id ? String(input.id) : "";
    const index = packId ? game.packs.findIndex((pack) => pack.id === packId) : -1;

    if (packId && index < 0) {
      return { ok: false, error: "pack_not_found" };
    }

    if (hasDuplicateName(game.packs, normalized.value.name, packId)) {
      return { ok: false, error: "pack_exists" };
    }

    if (index < 0 && game.packs.length >= SHOP_DN_MAX_PACKS) {
      return { ok: false, error: "pack_limit" };
    }

    const packs = game.packs.slice();

    if (index >= 0) {
      packs[index] = { id: packId, ...normalized.value };
    } else {
      packs.push({ id: generateShopItemId(), ...normalized.value });
    }

    // Paketlar tannarx bo'yicha o'sib boradi — ro'yxat doim tartibli.
    packs.sort((a, b) => a.cost - b.cost);

    return { ok: true, game: await write({ ...game, packs }) };
  }

  async function removePack(gameId, packId) {
    const game = await get(gameId);

    if (!game) {
      return { ok: false, error: "game_not_found" };
    }

    const packs = game.packs.filter((pack) => pack.id !== String(packId || ""));

    if (packs.length === game.packs.length) {
      return { ok: false, error: "pack_not_found" };
    }

    return { ok: true, game: await write({ ...game, packs }) };
  }

  return { list, get, saveGame, removeGame, savePack, removePack };
}

module.exports = {
  SHOP_DN_KEY_PREFIX,
  SHOP_DN_LIMITS,
  SHOP_DN_MAX_PACKS,
  computePackPrice,
  createDonatStore,
  getEffectiveMarkup,
  normalizeGameInput,
  normalizeGameRecord,
  normalizePackInput,
  parseCost,
  parseMarkup,
  summarizeGames,
};
