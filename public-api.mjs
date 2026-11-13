// Ommaviy API: faqat nickname + region (botdagi oddiy "server aniqlash").
//
//   GET https://mlbb.nurali.uz/v1/check?id=<account_id>&zone=<zone_id>
//   GET https://mlbb.nurali.uz/v1/check/<account_id>/<zone_id>
//   Token: "Authorization: Bearer mlbb_…" | "X-API-Token: mlbb_…" | ?token=mlbb_…
//
// Cloudflare Worker'da ishlaydi (Vercel/Mumbai emas): so'rov foydalanuvchiga
// eng yaqin Cloudflare PoP'da javob oladi, mlbb.nurali.uz allaqachon proxied
// bo'lgani uchun alohida DNS yozuvi kerak emas.
//
// Kesh qavatlari (har biri keyingisini chaqirmaslik uchun):
//   1) isolate RAM (Map)                — ~0 ms
//   2) Cloudflare Cache API (PoP bo'yicha) — ~1-5 ms
//   3) upstream (api.isan.eu.org)        — ~0.6-1.2 s
// Bir xil id+zone uchun parallel so'rovlar bitta upstream chaqiruvga
// birlashtiriladi; upstream yiqilsa eskirgan (stale) javob qaytariladi.
// Token tekshiruvi ham RAM + Cache API'da 60 s saqlanadi — Supabase (Mumbai)
// har so'rovda chaqirilmaydi, foydalanish hisobi 30 s'da bir marta yoziladi.
// Rate limit: token boshiga daqiqasiga RATE_LIMIT ta so'rov (Cloudflare Rate
// Limiting binding — PUBLIC_API_LIMITER; bo'lmasa isolate RAM'idagi hisob).
// Hujjat: https://docs-mlbb.nurali.uz (docs-site/).

const API_PREFIX = "/v1";
const DEFAULT_LOOKUP_URL = "https://api.isan.eu.org/nickname/ml";
const CACHE_PATH = "/__cache/v1";

const FRESH_SEC = 30 * 60;          // topilgan nickname shuncha "yangi" hisoblanadi
const STALE_SEC = 24 * 60 * 60;     // upstream yiqilsa shuncha eski javob ham beriladi
const NOT_FOUND_SEC = 2 * 60;       // "topilmadi" javobi
const TOKEN_OK_SEC = 60;            // token bekor qilinsa shuncha vaqtda kuchga kiradi
const TOKEN_BAD_SEC = 30;
const USAGE_FLUSH_MS = 30 * 1000;
const UPSTREAM_TIMEOUT_MS = 6000;
const MEM_LIMIT = 20000;
export const RATE_LIMIT = 60;          // wrangler.jsonc dagi ratelimits.simple.limit bilan bir xil
const RATE_WINDOW_SEC = 60;
const CONTACT = "@vafoyev_n";
const DOCS_URL = "https://docs-mlbb.nurali.uz";
const TOKEN_HINT = `Token olish uchun Telegram orqali ${CONTACT} ga yozing. Hujjat: ${DOCS_URL}`;

const lookupMem = new Map();
const tokenMem = new Map();
const inflight = new Map();
const pendingUsage = new Map();
const rateMem = new Map();
let lastUsageFlushAt = 0;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "authorization, x-api-token, content-type",
  "access-control-max-age": "86400",
  "access-control-expose-headers": "x-cache, server-timing",
};

export function isPublicApiPath(pathname) {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

export async function handlePublicApi(request, env = {}, ctx) {
  const startedAt = Date.now();
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply(405, { ok: false, error: "method_not_allowed" }, startedAt);
  }

  const parts = url.pathname.slice(API_PREFIX.length).split("/").filter(Boolean);

  if (parts.length === 0) {
    return reply(200, {
      ok: true,
      service: "mlbb-check",
      endpoint: `${url.origin}${API_PREFIX}/check?id=<account_id>&zone=<zone_id>`,
      auth: "Authorization: Bearer <token>",
      rate_limit: `${RATE_LIMIT} so'rov / daqiqa (token boshiga)`,
      docs: DOCS_URL,
      openapi: `${DOCS_URL}/openapi.json`,
      contact: `Telegram: ${CONTACT}`,
    }, startedAt, { "cache-control": "public, max-age=300" });
  }

  if (parts[0] !== "check") {
    return reply(404, { ok: false, error: "not_found" }, startedAt);
  }

  const q = url.searchParams;
  const accountId = clean(parts[1] || q.get("id") || q.get("account_id"));
  const zoneId = clean(parts[2] || q.get("zone") || q.get("zone_id") || q.get("server"));

  if (!/^\d{1,12}$/.test(accountId) || !/^\d{1,8}$/.test(zoneId)) {
    return reply(400, {
      ok: false,
      error: "invalid_params",
      message: "id (1-12 raqam) va zone (1-8 raqam) talab qilinadi: /v1/check?id=1290132154&zone=15246",
    }, startedAt);
  }

  const token = readToken(request, q);
  if (!token) {
    return reply(401, { ok: false, error: "token_required", message: TOKEN_HINT }, startedAt);
  }

  const auth = await checkToken(token, env, url.origin);
  if (!auth.ok) {
    const body = { ok: false, error: auth.error };
    if (auth.status !== 503) body.message = TOKEN_HINT;
    return reply(auth.status || 401, body, startedAt);
  }

  if (!(await withinRateLimit(env, `tok:${auth.id}`))) {
    return reply(429, {
      ok: false,
      error: "rate_limited",
      message: `Limit: daqiqasiga ${RATE_LIMIT} ta so'rov. ${RATE_WINDOW_SEC} soniyadan keyin qayta urining. Ko'proq kerak bo'lsa: Telegram ${CONTACT}`,
    }, startedAt, { "retry-after": String(RATE_WINDOW_SEC), "x-ratelimit-limit": String(RATE_LIMIT) });
  }

  countUsage(auth.id, env, ctx);

  const result = await lookup(accountId, zoneId, env, ctx, url.origin);
  const extra = { "x-cache": result.source };

  if (result.found) {
    return reply(200, {
      ok: true,
      account_id: accountId,
      zone_id: zoneId,
      nickname: result.nickname,
      region: result.region,
      server_type: serverType(zoneId, env),
    }, startedAt, { ...extra, "cache-control": "private, max-age=60", "x-ratelimit-limit": String(RATE_LIMIT) });
  }

  if (result.notFound) {
    return reply(404, { ok: false, error: "account_not_found", account_id: accountId, zone_id: zoneId }, startedAt, extra);
  }

  return reply(502, { ok: false, error: "upstream_unavailable" }, startedAt, extra);
}

// ---------------------------------------------------------------------------
// Lookup + kesh
// ---------------------------------------------------------------------------
async function lookup(accountId, zoneId, env, ctx, origin) {
  const key = `${accountId}:${zoneId}`;
  const now = Date.now();

  const mem = lookupMem.get(key);
  if (mem && mem.freshUntil > now) {
    return { ...mem.value, source: "HIT-MEM" };
  }

  const cacheKey = `${origin}${CACHE_PATH}/ml/${accountId}/${zoneId}`;
  let stale = mem && mem.staleUntil > now ? mem : null;

  const edge = await cacheGet(cacheKey);
  if (edge && edge.freshUntil > now) {
    memSet(lookupMem, key, edge);
    return { ...edge.value, source: "HIT-EDGE" };
  }
  if (edge && edge.staleUntil > now && (!stale || edge.freshUntil > stale.freshUntil)) {
    stale = edge;
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchUpstream(accountId, zoneId, env).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }

  const value = await pending;

  if (value.error) {
    if (stale) {
      return { ...stale.value, source: "STALE" };
    }
    return { ...value, source: "MISS" };
  }

  const ttl = value.found ? FRESH_SEC : NOT_FOUND_SEC;
  const keep = value.found ? STALE_SEC : NOT_FOUND_SEC;
  const entry = { value, freshUntil: now + ttl * 1000, staleUntil: now + keep * 1000 };

  memSet(lookupMem, key, entry);
  waitUntil(ctx, cachePut(cacheKey, entry, keep));

  return { ...value, source: "MISS" };
}

async function fetchUpstream(accountId, zoneId, env) {
  const url = new URL(clean(env.MLBB_LOOKUP_API_URL) || DEFAULT_LOOKUP_URL);
  url.searchParams.set("id", accountId);
  url.searchParams.set("zone", zoneId);

  // Tarmoq xatosi / 5xx bo'lsa bir marta qayta urinadi (DNS yoki TCP uzilishi).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url.toString(), {
        headers: { accept: "application/json", "user-agent": "MLBB-Check-API/1.0" },
      }, UPSTREAM_TIMEOUT_MS);

      const text = await response.text();
      const data = safeJson(text);

      if (response.ok && data) {
        const nickname = pickNickname(data);
        const failed = [false, "false", "error", "failed", "not_found"].includes(data.success ?? data.ok ?? data.status);
        if (nickname && !failed) {
          return { found: true, nickname, region: pickRegion(data) };
        }
        return { notFound: true };
      }

      // Upstream (Cloudflare Worker) noto'g'ri id/zone'da 500 "error code: 1101" beradi.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return { notFound: true };
      }
      if (/error code:\s*1101/i.test(text)) {
        return { notFound: true };
      }
    } catch (error) {
      console.error("[PUBLIC_API_UPSTREAM]", error?.name || "", error?.message || error);
    }
  }

  return { error: "upstream_unavailable" };
}

function pickNickname(data) {
  const value =
    data.nickname || data.username || data.name || data.userName || data.ign ||
    data?.data?.nickname || data?.data?.username || data?.data?.name || data?.data?.ign ||
    data?.result?.nickname || data?.result?.username || data?.result?.name;
  return value ? String(value).trim() : "";
}

function pickRegion(data) {
  const value =
    data.region || data.country ||
    data?.data?.region || data?.data?.country ||
    data?.result?.region || data?.result?.country || null;
  return value ? String(value).trim() : null;
}

export function serverType(zoneId, env = {}) {
  const zone = Number(zoneId);
  const ranges = String(env.ADVANCED_SERVER_RANGES || "57001-57999")
    .split(",")
    .map((part) => part.trim().split("-").map((n) => Number(n.trim())))
    .filter(([from]) => Number.isFinite(from));

  const advanced = ranges.some(([from, to = from]) => zone >= Math.min(from, to) && zone <= Math.max(from, to));
  return advanced ? "Advanced Server" : "Original Server";
}

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------
async function withinRateLimit(env, key) {
  const limiter = env.PUBLIC_API_LIMITER;
  if (limiter && typeof limiter.limit === "function") {
    try {
      const { success } = await limiter.limit({ key });
      return success;
    } catch (error) {
      console.error("[PUBLIC_API_RATELIMIT]", error?.message || error);
    }
  }

  // Zaxira: isolate ichidagi sobit oyna (taxminiy, faqat bitta isolate uchun).
  const now = Date.now();
  const windowStart = now - (now % (RATE_WINDOW_SEC * 1000));
  const entry = rateMem.get(key);
  if (!entry || entry.windowStart !== windowStart) {
    memSet(rateMem, key, { windowStart, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------
function readToken(request, query) {
  const bearer = clean(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  return clean(bearer || request.headers.get("x-api-token") || query.get("token"));
}

async function checkToken(rawToken, env, origin) {
  if (!/^mlbb_[a-f0-9]{40}$/.test(rawToken)) {
    return { ok: false, error: "token_invalid" };
  }

  const hash = await sha256Hex(rawToken);
  const now = Date.now();

  const mem = tokenMem.get(hash);
  if (mem && mem.until > now) {
    return mem.result;
  }

  const cacheKey = `${origin}${CACHE_PATH}/tok/${hash}`;
  const edge = await cacheGet(cacheKey);
  if (edge && edge.until > now) {
    memSet(tokenMem, hash, edge);
    return edge.result;
  }

  const result = await loadToken(hash, env);
  if (result.status === 503) {
    return result; // Supabase vaqtincha yo'q — keshlamaymiz
  }

  let ttl = (result.ok ? TOKEN_OK_SEC : TOKEN_BAD_SEC) * 1000;
  if (result.ok && result.expiresAt) {
    ttl = Math.max(0, Math.min(ttl, result.expiresAt - now));
  }

  const entry = { result, until: now + ttl };
  memSet(tokenMem, hash, entry);
  if (ttl >= 1000) {
    await cachePut(cacheKey, entry, Math.ceil(ttl / 1000));
  }
  return result;
}

async function loadToken(hash, env) {
  try {
    const rows = await supabase(env, `/api_tokens?token_hash=eq.${hash}&select=id,expires_at,is_revoked&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row) return { ok: false, error: "token_not_found" };
    if (row.is_revoked) return { ok: false, error: "token_revoked" };

    const expiresAt = row.expires_at ? Date.parse(row.expires_at) : 0;
    if (expiresAt && expiresAt <= Date.now()) return { ok: false, error: "token_expired" };

    return { ok: true, id: row.id, expiresAt };
  } catch (error) {
    console.error("[PUBLIC_API_TOKEN]", error?.message || error);
    return { ok: false, status: 503, error: "auth_unavailable" };
  }
}

// Har so'rovda Supabase'ga yozmaslik uchun hisob RAM'da yig'iladi.
function countUsage(tokenId, env, ctx) {
  if (!tokenId) return;
  pendingUsage.set(tokenId, (pendingUsage.get(tokenId) || 0) + 1);

  if (Date.now() - lastUsageFlushAt < USAGE_FLUSH_MS) return;
  lastUsageFlushAt = Date.now();
  waitUntil(ctx, flushUsage(env));
}

export async function flushUsage(env) {
  const batch = [...pendingUsage.entries()];
  pendingUsage.clear();

  for (const [id, hits] of batch) {
    try {
      await supabase(env, "/rpc/api_token_hit", { method: "POST", body: { p_id: id, p_hits: hits } });
    } catch (error) {
      // 026_api_token_hit.sql hali ishga tushirilmagan bo'lsa — hech bo'lmasa vaqtni yozamiz.
      try {
        await supabase(env, `/api_tokens?id=eq.${id}`, {
          method: "PATCH",
          body: { last_used_at: new Date().toISOString() },
        });
      } catch (fallbackError) {
        console.error("[PUBLIC_API_USAGE]", fallbackError?.message || fallbackError);
      }
    }
  }
}

async function supabase(env, path, options = {}) {
  const base = clean(env.SUPABASE_URL).replace(/\/+$/, "");
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEY);
  if (!base || !key) throw new Error("supabase_not_configured");

  const headers = { apikey: key, accept: "application/json" };
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetchWithTimeout(`${base}/rest/v1${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }, 4000);

  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${text.slice(0, 160)}`);
  return text ? safeJson(text) : null;
}

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------
function getEdgeCache() {
  return typeof caches !== "undefined" && caches?.default ? caches.default : null;
}

async function cacheGet(key) {
  const cache = getEdgeCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(key);
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

async function cachePut(key, entry, ttlSec) {
  const cache = getEdgeCache();
  if (!cache) return;
  try {
    await cache.put(key, new Response(JSON.stringify(entry), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSec}` },
    }));
  } catch (error) {
    console.error("[PUBLIC_API_CACHE]", error?.message || error);
  }
}

function memSet(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MEM_LIMIT) {
    map.delete(map.keys().next().value);
  }
}

function reply(status, body, startedAt, headers = {}) {
  const ms = Date.now() - startedAt;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "server-timing": `total;dur=${ms}`,
      ...headers,
    },
  });
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function waitUntil(ctx, promise) {
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(promise);
  } else {
    promise.catch(() => {});
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

// Testlar uchun.
export function resetPublicApiState() {
  lookupMem.clear();
  tokenMem.clear();
  inflight.clear();
  pendingUsage.clear();
  rateMem.clear();
  lastUsageFlushAt = 0;
}
