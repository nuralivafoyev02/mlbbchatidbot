// ---------------------------------------------------------------------------
// Rone Arena API uchun proxy (Cloudflare Worker).
//
// arena.rone.dev Cloudflare ortida va Vercel (AWS) IP'laridan kelgan
// so'rovlarga HTTP 403 qaytaradi, Cloudflare Worker'dan esa javob beradi.
// Shuning uchun Shaxsiy kabinet (api/account.js, Vercel) Arena'ga shu yerdan
// boradi: MLBB_ARENA_API_URL=https://<worker>/arena-proxy.
//
// Ochiq proxy bo'lib qolmasligi uchun:
//   * `x-arena-proxy-key` sarlavhasi ARENA_PROXY_KEY secret'iga teng bo'lishi
//     shart (secret o'rnatilmagan bo'lsa marshrut umuman yo'q — 404);
//   * faqat GET/POST va faqat Arena'ning `/user/...` yo'llari;
//   * faqat Accept / Content-Type / Authorization sarlavhalari uzatiladi.
// ---------------------------------------------------------------------------

export const ARENA_PROXY_PREFIX = "/arena-proxy";
const ARENA_UPSTREAM = "https://arena.rone.dev/api";
const ARENA_PATH_RE = /^\/user\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){0,4}$/;
const MAX_BODY_BYTES = 4096;
const UPSTREAM_TIMEOUT_MS = 20000;

function proxyJson(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Uzunligi ham, mazmuni ham vaqt bo'yicha sizdirilmaydi.
function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function isArenaProxyRequest(request) {
  return new URL(request.url).pathname.startsWith(`${ARENA_PROXY_PREFIX}/`);
}

export async function handleArenaProxy(request, env = {}, fetchImpl = fetch) {
  const secret = String(env.ARENA_PROXY_KEY || "").trim();
  if (!secret) return proxyJson(404, { error: "not_found" });

  if (!safeEqual(request.headers.get("x-arena-proxy-key") || "", secret)) {
    return proxyJson(403, { error: "forbidden" });
  }

  const url = new URL(request.url);
  const path = url.pathname.slice(ARENA_PROXY_PREFIX.length);
  if (!ARENA_PATH_RE.test(path)) return proxyJson(404, { error: "not_found" });
  if (request.method !== "GET" && request.method !== "POST") {
    return proxyJson(405, { error: "method_not_allowed" });
  }

  let body;
  if (request.method === "POST") {
    body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      return proxyJson(413, { error: "too_large" });
    }
  }

  const headers = { Accept: "application/json" };
  const contentType = request.headers.get("content-type");
  const authorization = request.headers.get("authorization");
  if (contentType) headers["Content-Type"] = contentType;
  if (authorization) headers.Authorization = authorization;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetchImpl(`${ARENA_UPSTREAM}${path}${url.search}`, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    console.error("[ARENA_PROXY]", path, error?.name === "AbortError" ? "timeout" : error?.message);
    return proxyJson(504, { error: "upstream_unreachable" });
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok) console.error("[ARENA_PROXY]", request.method, path, upstream.status);
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}
