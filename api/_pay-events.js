// ---------------------------------------------------------------------------
// To'lov tizimi jurnali (supabase/024_wallet_events.sql → wallet_events).
//
// Admin panel → Feat: holat kartalari (oxirgi callback, oxirgi xato, API
// holati) va "Jurnal" shu yozuvlardan quriladi. Jadval hali yaratilmagan
// bo'lsa yoki yozishda xato bo'lsa — to'lov oqimi to'xtamaydi, faqat logga
// tushadi. Bir xil xato (masalan Hamyon ishlamay qolganda har 5 s polling)
// bitta instansiyada 60 s ichida bir marta yoziladi.
// ---------------------------------------------------------------------------

const LEVELS = Object.freeze(["info", "warn", "error"]);
const THROTTLE_MS = 60 * 1000;
const RETENTION_DAYS = 30;
const recent = new Map();

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Maxfiy qiymatlar jurnalga tushmaydi.
function scrubData(data) {
  if (!data || typeof data !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (/key|sign|secret|token|password/i.test(key)) continue;
    if (value === undefined) continue;
    out[key] = typeof value === "string" ? value.slice(0, 200) : value;
  }
  return out;
}

function toBigint(value) {
  return /^\d{1,19}$/.test(String(value ?? "")) ? String(value) : null;
}

function createPayEvents(requestFn, { now = () => Date.now() } = {}) {
  let disabled = false;

  async function record(level, kind, message, extra = {}) {
    const lvl = LEVELS.includes(level) ? level : "info";
    const text = cleanText(message, 300);
    const line = `[WALLET_EVENT] ${lvl} ${kind} ${extra.provider || "-"} ${text}`;
    if (lvl === "error") console.error(line);
    else console.log(line);
    if (disabled) return;

    if (lvl !== "info") {
      const fingerprint = `${lvl}|${kind}|${extra.provider || ""}|${extra.topupId || extra.data?.payment_id || ""}|${text}`;
      const last = recent.get(fingerprint) || 0;
      if (now() - last < THROTTLE_MS) return;
      recent.set(fingerprint, now());
      if (recent.size > 200) recent.delete(recent.keys().next().value);
    }

    try {
      await requestFn("/wallet_events", {
        method: "POST",
        prefer: "return=minimal",
        body: {
          level: lvl,
          kind: cleanText(kind, 30) || "other",
          provider: extra.provider ? cleanText(extra.provider, 20) : null,
          topup_id: toBigint(extra.topupId),
          user_id: toBigint(extra.userId),
          message: text,
          data: scrubData(extra.data),
        },
      });
    } catch (error) {
      // 024 migratsiyasi qo'llanmagan — shu instansiyada boshqa urinmaymiz.
      if (/wallet_events|42P01|PGRST205/.test(String(error?.message))) disabled = true;
      console.error("[WALLET_EVENT_WRITE]", error?.message);
    }
  }

  // → { available, events } — jadval yo'q bo'lsa available=false.
  async function list({ level, kind, limit = 60 } = {}) {
    const params = new URLSearchParams({ select: "*", order: "created_at.desc", limit: String(Math.min(Number(limit) || 60, 200)) });
    if (level === "problems") params.set("level", "in.(warn,error)");
    else if (LEVELS.includes(level)) params.set("level", `eq.${level}`);
    if (kind && /^[a-z_]{1,30}$/.test(kind)) params.set("kind", `eq.${kind}`);
    try {
      const rows = await requestFn(`/wallet_events?${params.toString()}`);
      return {
        available: true,
        events: (Array.isArray(rows) ? rows : []).map((row) => ({
          id: String(row.id),
          at: row.created_at || null,
          level: row.level,
          kind: row.kind,
          provider: row.provider || null,
          topup_id: row.topup_id ? String(row.topup_id) : null,
          user_id: row.user_id ? String(row.user_id) : null,
          message: row.message || "",
          data: row.data && typeof row.data === "object" ? row.data : {},
        })),
      };
    } catch (error) {
      console.error("[WALLET_EVENT_LIST]", error?.message);
      return { available: false, events: [] };
    }
  }

  async function latest(filter) {
    const params = new URLSearchParams({ select: "*", order: "created_at.desc", limit: "1", ...filter });
    try {
      const rows = await requestFn(`/wallet_events?${params.toString()}`);
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch {
      return null;
    }
  }

  async function count(filter) {
    const params = new URLSearchParams({ select: "id", limit: "500", ...filter });
    try {
      const rows = await requestFn(`/wallet_events?${params.toString()}`);
      return Array.isArray(rows) ? rows.length : 0;
    } catch {
      return 0;
    }
  }

  // Holat kartalari: oxirgi callback, oxirgi xato, oxirgi muvaffaqiyatli API
  // chaqiruvi va 24 soatdagi xatolar soni.
  async function health(provider) {
    const since = new Date(now() - 24 * 3600 * 1000).toISOString();
    const scope = provider ? { provider: `eq.${provider}` } : {};
    const [callback, error, ok, errors24h] = await Promise.all([
      latest({ ...scope, kind: "eq.callback" }),
      latest({ ...scope, level: "eq.error" }),
      latest({ ...scope, level: "eq.info", kind: "in.(create,health,credit,callback)" }),
      count({ ...scope, level: "eq.error", created_at: `gt.${since}` }),
    ]);
    const pick = (row) => (row ? { at: row.created_at, kind: row.kind, message: row.message } : null);
    return { lastCallback: pick(callback), lastError: pick(error), lastOk: pick(ok), errors24h };
  }

  async function prune() {
    const before = new Date(now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
    try {
      await requestFn(`/wallet_events?created_at=lt.${encodeURIComponent(before)}`, { method: "DELETE", prefer: "return=minimal" });
    } catch (error) {
      console.error("[WALLET_EVENT_PRUNE]", error?.message);
    }
  }

  return { record, list, health, prune };
}

// Testlar uchun: takrorlanish filtrini tozalash.
function resetThrottle() {
  recent.clear();
}

module.exports = { createPayEvents, resetThrottle, scrubData };
