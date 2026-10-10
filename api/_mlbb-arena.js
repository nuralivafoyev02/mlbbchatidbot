// ---------------------------------------------------------------------------
// Mobile Legends akkauntini botga ulash — Rone Arena API (arena.rone.dev).
//
// Oqim: send-vc (o'yin ichidagi pochtaga 4 xonali kod) → login (JWT) →
// user/* endpointlari (Authorization: Bearer <jwt>) → logout.
//
// Bu modulni bot.js (Cloudflare Worker) ham, account.js (Vercel, shaxsiy
// Mini App) ham ishlatadi. Fayl nomi `_` bilan boshlanadi — Vercel uni
// alohida endpoint deb hisoblamaydi.
//
// Shu yerda yana:
//   * JWT'ni Supabase'da shifrlab saqlash (AES-256-GCM) — sealArenaToken /
//     openArenaToken;
//   * Telegram Mini App initData imzosini tekshirish — verifyTelegramInitData;
//   * rank_level (yulduzlar yig'indisi) → "Epic III ★2" — formatRankLevel.
// ---------------------------------------------------------------------------

const crypto = require("node:crypto");

const DEFAULT_ARENA_API_URL = "https://arena.rone.dev/api";
const DEFAULT_ARENA_TIMEOUT_MS = 15000;
const ARENA_LANGS = Object.freeze(["en", "id", "ru", "es", "pt", "tr", "ar", "de", "fr", "it", "ja", "ko", "th", "vi", "zh-CN", "zh-TW", "km"]);
const VERIFICATION_CODE_RE = /^\d{4,6}$/;
const ROLE_ID_RE = /^\d{5,12}$/;
const ZONE_ID_RE = /^\d{1,8}$/;
const MATCH_ID_RE = /^\d{1,25}$/;
const CURSOR_RE = /^\d{1,25}$/;

class ArenaError extends Error {
  constructor(reason, message, meta = {}) {
    super(message || reason);
    this.name = "ArenaError";
    this.reason = reason;
    this.status = meta.status ?? null;
    this.code = meta.code ?? null;
  }
}

function cleanBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  return text || DEFAULT_ARENA_API_URL;
}

// Bot tillari (uz/ru/en) → Arena `lang` (o'zbekcha yo'q, inglizchaga tushadi).
function toArenaLang(lang) {
  const value = String(lang || "").trim();
  return ARENA_LANGS.includes(value) ? value : "en";
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Arena xatolari bir necha xil ko'rinishda keladi:
//   * HTTP 401 + {status:"error", code:"UNAUTHORIZED"|"UPSTREAM_REQUEST_FAILED"}
//   * HTTP 200 + {code: 1002, message: "auth is empty"} (token yaroqsiz)
//   * HTTP 200 + {code: -20007} (send-vc: akkaunt topilmadi va h.k.)
//   * HTTP 422 VALIDATION_ERROR, HTTP 500 INTERNAL_SERVER_ERROR
function classifyArenaFailure(status, payload) {
  const stringCode = typeof payload?.code === "string" ? payload.code.toUpperCase() : "";
  const numericCode = typeof payload?.code === "number" ? payload.code : null;
  const message = String(payload?.message || payload?.msg || "");

  if (status === 401 || status === 403 || stringCode === "UNAUTHORIZED" || numericCode === 1002 || /auth is empty|unauthori[sz]ed|token (?:is )?(?:invalid|expired)/i.test(message)) {
    return "unauthorized";
  }

  // Moonton endpointni o'chirib qo'ygan ("接口下线" — interfeys offline).
  if (numericCode === 10407 || /接口下线/.test(message)) {
    return "unavailable";
  }

  if (status === 429 || /RATE_LIMIT/.test(stringCode)) {
    return "rate_limit";
  }

  if (status === 422 || stringCode === "VALIDATION_ERROR") {
    return "invalid_input";
  }

  if (status >= 500) {
    return "upstream";
  }

  if (numericCode !== null && numericCode !== 0) {
    return "rejected";
  }

  return "upstream";
}

function createArenaClient(options = {}) {
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_ARENA_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  // Masalan proxy kaliti (x-arena-proxy-key) — arena-proxy.mjs.
  const extraHeaders = options.headers && typeof options.headers === "object" ? options.headers : {};

  async function request(method, path, { token, query, body } = {}) {
    const url = new URL(`${baseUrl}${path}`);

    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = { ...extraHeaders, Accept: "application/json" };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error?.name === "AbortError" ? "timeout" : "network";
      throw new ArenaError(reason, `Arena ${method} ${path}: ${error?.message || reason}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const payload = safeJsonParse(text);

    if (response.ok && payload && payload.code === 0) {
      return payload.data;
    }

    const reason = classifyArenaFailure(response.status, payload);
    const detailType = payload?.details?.type || "";
    // JSON bo'lmagan javob (masalan Cloudflare blok sahifasi) yoki proxy xatosi
    // logda ko'rinsin: qaysi hostga ketdi va javob boshi.
    const detail = payload
      ? `${String(payload.code ?? payload.error ?? "")} ${String(payload.message || payload.msg || "").slice(0, 160)}`
      : text.replace(/\s+/g, " ").slice(0, 120);
    const error = new ArenaError(
      reason,
      `Arena ${method} ${path} (${url.host}): HTTP ${response.status} ${detail}`.trim(),
      { status: response.status, code: payload?.code ?? null }
    );
    error.detailType = detailType;
    throw error;
  }

  function assertAccount(roleId, zoneId) {
    if (!ROLE_ID_RE.test(String(roleId || "")) || !ZONE_ID_RE.test(String(zoneId || ""))) {
      throw new ArenaError("invalid_input", "Invalid role/zone id");
    }
  }

  return {
    baseUrl,

    async sendVerificationCode(roleId, zoneId) {
      assertAccount(roleId, zoneId);
      try {
        await request("POST", "/user/auth/send-vc", {
          body: { role_id: Number(roleId), zone_id: Number(zoneId) },
        });
      } catch (error) {
        // code != 0 — Moonton kodni yubormadi (ko'pincha akkaunt topilmadi).
        if (error instanceof ArenaError && error.reason === "rejected") {
          error.reason = "send_failed";
        }
        throw error;
      }
      return { ok: true };
    },

    async login(roleId, zoneId, code) {
      assertAccount(roleId, zoneId);
      const vc = String(code || "").trim();

      if (!VERIFICATION_CODE_RE.test(vc)) {
        throw new ArenaError("invalid_code", "Verification code must be 4-6 digits");
      }

      let data;
      try {
        data = await request("POST", "/user/auth/login", {
          body: { role_id: Number(roleId), zone_id: Number(zoneId), vc: Number(vc) },
        });
      } catch (error) {
        // Noto'g'ri/eskirgan kodda Arena HTTP 500 (ResponseValidationError)
        // yoki code != 0 qaytaradi.
        if (
          error instanceof ArenaError &&
          (error.reason === "rejected" || error.reason === "invalid_input" || error.detailType === "ResponseValidationError")
        ) {
          error.reason = "invalid_code";
        }
        throw error;
      }

      const jwt = typeof data?.jwt === "string" ? data.jwt.trim() : "";

      if (!jwt) {
        throw new ArenaError("invalid_code", "Login response without jwt");
      }

      return {
        jwt,
        roleId: String(data.roleid ?? roleId),
        zoneId: String(data.zoneid ?? zoneId),
        time: Number(data.time) || null,
      };
    },

    async logout(token) {
      await request("POST", "/user/auth/logout", { token });
      return { ok: true };
    },

    async getInfo(token, lang) {
      return request("GET", "/user/info", { token, query: { lang: toArenaLang(lang) } });
    },

    async getStats(token, lang) {
      return request("GET", "/user/stats", { token, query: { lang: toArenaLang(lang) } });
    },

    async getSeasons(token, lang) {
      const data = await request("GET", "/user/season", { token, query: { lang: toArenaLang(lang) } });
      return Array.isArray(data?.sids) ? data.sids.filter((sid) => Number.isInteger(sid)) : [];
    },

    async getMatches(token, { sid, limit = 10, cursor, lang } = {}) {
      return request("GET", "/user/matches", {
        token,
        query: { sid: toSeasonId(sid), limit: clampLimit(limit, 20), last_cursor: toCursor(cursor), lang: toArenaLang(lang) },
      });
    },

    async getMatchDetail(token, { matchId, sid, lang } = {}) {
      const id = String(matchId || "");
      if (!MATCH_ID_RE.test(id)) {
        throw new ArenaError("invalid_input", "Invalid match id");
      }
      return request("GET", `/user/matches/${id}`, {
        token,
        query: { sid: toSeasonId(sid), lang: toArenaLang(lang) },
      });
    },

    async getFrequentHeroes(token, { sid, limit = 10, cursor, lang } = {}) {
      return request("GET", "/user/heroes/frequent", {
        token,
        query: { sid: toSeasonId(sid), limit: clampLimit(limit, 30), last_cursor: toCursor(cursor), lang: toArenaLang(lang) },
      });
    },

    async getMatchesByHero(token, { heroId, sid, limit = 10, cursor, lang } = {}) {
      const hero = String(heroId ?? "");
      if (!/^\d{1,6}$/.test(hero)) {
        throw new ArenaError("invalid_input", "Invalid hero id");
      }
      return request("GET", `/user/matches/hero/${hero}`, {
        token,
        query: { sid: toSeasonId(sid), limit: clampLimit(limit, 20), last_cursor: toCursor(cursor), lang: toArenaLang(lang) },
      });
    },

    async getFriends(token, { sid, lang } = {}) {
      return request("GET", "/user/friends", { token, query: { sid: toSeasonId(sid), lang: toArenaLang(lang) } });
    },

    async getPrivacy(token, lang) {
      return request("GET", "/user/privacy/settings", { token, query: { lang: toArenaLang(lang) } });
    },

    async setPrivacy(token, visible, lang) {
      return request("POST", "/user/privacy/settings", {
        token,
        query: { visibility: visible ? "visible" : "invisible", lang: toArenaLang(lang) },
      });
    },
  };
}

function toSeasonId(value) {
  const sid = Number(value);
  if (!Number.isInteger(sid) || sid < 0 || sid > 100000) {
    throw new ArenaError("invalid_input", "Invalid season id");
  }
  return sid;
}

function toCursor(value) {
  const cursor = String(value ?? "").trim();
  return CURSOR_RE.test(cursor) ? cursor : undefined;
}

function clampLimit(value, max) {
  const limit = Math.trunc(Number(value));
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(limit, max);
}

// ---------------------------------------------------------------------------
// JWT'ni saqlash: "v1:<iv>.<tag>.<ciphertext>" (base64url, AES-256-GCM).
// Kalit — MLBB_LINK_SECRET; bo'lmasa Supabase service key'dan olinadi
// (ikkala runtime — Worker va Vercel — da ham mavjud). Kalit yo'q bo'lsa
// "p1:<token>" (shifrlanmagan) ko'rinishida saqlanadi.
// ---------------------------------------------------------------------------
function deriveLinkKey(secret) {
  const text = String(secret || "").trim();
  return text ? crypto.createHash("sha256").update(`mlbb-link:v1:${text}`).digest() : null;
}

function resolveLinkSecret(env = {}) {
  for (const value of [env.MLBB_LINK_SECRET, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_KEY, env.SUPABASE_SECRET_KEY]) {
    if (value && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function sealArenaToken(token, secret) {
  const value = String(token || "");
  const key = deriveLinkKey(secret);

  if (!key) {
    return `p1:${value}`;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function openArenaToken(sealed, secret) {
  const value = String(sealed || "");

  if (value.startsWith("p1:")) {
    return value.slice(3) || null;
  }

  if (!value.startsWith("v1:")) {
    return null;
  }

  const key = deriveLinkKey(secret);
  const parts = value.slice(3).split(".");

  if (!key || parts.length !== 3) {
    return null;
  }

  try {
    const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8") || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Telegram Mini App initData tekshiruvi
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// ---------------------------------------------------------------------------
function verifyTelegramInitData(initData, botToken, { maxAgeSec = 24 * 60 * 60, now = Date.now() } = {}) {
  const raw = String(initData || "");
  const token = String(botToken || "").trim();

  if (!raw || !token) {
    return { ok: false, error: "missing" };
  }

  const params = new URLSearchParams(raw);
  const hash = params.get("hash") || "";

  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return { ok: false, error: "bad_hash" };
  }

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest();
  const received = Buffer.from(hash.toLowerCase(), "hex");

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return { ok: false, error: "bad_hash" };
  }

  const authDate = Number(params.get("auth_date"));

  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, error: "bad_auth_date" };
  }

  if (maxAgeSec > 0 && now / 1000 - authDate > maxAgeSec) {
    return { ok: false, error: "expired" };
  }

  const user = safeJsonParse(params.get("user") || "");

  if (!user || !/^\d{1,19}$/.test(String(user.id ?? ""))) {
    return { ok: false, error: "no_user" };
  }

  return { ok: true, user, authDate };
}

// ---------------------------------------------------------------------------
// rank_level — yulduzlar yig'indisi (Arena /academy/ranks jadvali bo'yicha):
// Warrior 1-10, Elite 11-25, Master 26-45, Grandmaster 46-75, Epic 76-105,
// Legend 106-135, 136+ — Mythic (yulduz = level - 136).
// ---------------------------------------------------------------------------
const RANK_TABLE = Object.freeze([
  { name: "Warrior", divisions: [["III", 1, 4], ["II", 5, 7], ["I", 8, 10]] },
  { name: "Elite", divisions: [["III", 11, 15], ["II", 16, 20], ["I", 21, 25]] },
  { name: "Master", divisions: [["IV", 26, 30], ["III", 31, 35], ["II", 36, 40], ["I", 41, 45]] },
  { name: "Grandmaster", divisions: [["V", 46, 51], ["IV", 52, 57], ["III", 58, 63], ["II", 64, 69], ["I", 70, 75]] },
  { name: "Epic", divisions: [["V", 76, 81], ["IV", 82, 87], ["III", 88, 93], ["II", 94, 99], ["I", 100, 105]] },
  { name: "Legend", divisions: [["V", 106, 111], ["IV", 112, 117], ["III", 118, 123], ["II", 124, 129], ["I", 130, 135]] },
]);
const MYTHIC_START = 136;

function formatRankLevel(value) {
  const level = Math.trunc(Number(value));

  if (!Number.isFinite(level) || level <= 0) {
    return null;
  }

  if (level >= MYTHIC_START) {
    const stars = level - MYTHIC_START;
    const tier = stars >= 100 ? "Mythical Immortal" : stars >= 50 ? "Mythical Glory" : stars >= 25 ? "Mythical Honor" : "Mythic";
    return { tier, division: "", stars, label: `${tier} ★${stars}` };
  }

  for (const rank of RANK_TABLE) {
    for (const [division, start, end] of rank.divisions) {
      if (level >= start && level <= end) {
        const stars = level - start;
        return { tier: rank.name, division, stars, label: `${rank.name} ${division} ★${stars}` };
      }
    }
  }

  return null;
}

function isValidVerificationCode(value) {
  return VERIFICATION_CODE_RE.test(String(value || "").trim());
}

module.exports = {
  ArenaError,
  DEFAULT_ARENA_API_URL,
  classifyArenaFailure,
  createArenaClient,
  formatRankLevel,
  isValidVerificationCode,
  openArenaToken,
  resolveLinkSecret,
  sealArenaToken,
  toArenaLang,
  verifyTelegramInitData,
};
