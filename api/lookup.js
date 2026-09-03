const crypto = require("node:crypto");

const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL).replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = resolveServiceKey(process.env);
const SUPABASE_TIMEOUT_MS = parseBoundedNumber(
  process.env.SUPABASE_TIMEOUT_MS,
  2500,
  300,
  8000
);
const MLBB_LOOKUP_API_URL =
  cleanEnv(process.env.MLBB_LOOKUP_API_URL) ||
  "https://api.isan.eu.org/nickname/ml";
const LOOKUP_TIMEOUT_MS = parseBoundedNumber(
  process.env.MLBB_LOOKUP_TIMEOUT_MS,
  8000,
  800,
  20000
);
const DEFAULT_LANG = "uz";
const SUPPORT_USERNAME = cleanEnv(process.env.SUPPORT_USERNAME) || "vafoyev_n";

const ACCESS_DENIED_MESSAGE =
  "API dan foydalanish uchun @vafoyev_n ga Telegram orqali murojaat qiling, " +
  "sizga Token ochib berishi yoki access berishi mumkin.";

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET" && !isLookupRequest(req)) {
      return res.status(200).json({
        ok: true,
        service: "mlbb-public-lookup",
        endpoint: "/api/lookup",
        usage: "?account_id=&zone_id=&token=",
      });
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const query = req.query || {};
    let body = {};
    if (req.method === "POST" && typeof req.body === "object" && req.body) {
      body = req.body;
    }

    const accountId =
      cleanToken(query.account_id || body.account_id || query.id || body.id) ||
      "";
    const zoneId =
      cleanToken(query.zone_id || body.zone_id || query.zone || body.zone) || "";
    const token =
      cleanToken(
        query.token ||
          body.token ||
          body.x_token ||
          req.headers?.["x-api-token"]
      ) || extractBearer(req.headers?.authorization) || "";

    if (!accountId || !zoneId) {
      return res.status(400).json({
        ok: false,
        error: "account_id va zone_id talab qilinadi (masalan: ...?account_id=1290132154&zone_id=15246&token=...)",
      });
    }

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "token_talab_qilinadi",
        message: ACCESS_DENIED_MESSAGE,
      });
    }

    const auth = await checkToken(token);
    if (!auth.ok) {
      return res.status(401).json({
        ok: false,
        error: auth.error,
        message: ACCESS_DENIED_MESSAGE,
      });
    }

    const result = await lookupMlbb(accountId, zoneId);
    void recordUsage(auth.tokenId).catch(() => {});

    if (!result.ok) {
      return res.status(404).json({
        ok: false,
        error: result.reason || "not_found",
        accountId,
        zoneId,
      });
    }

    return res.status(200).json({
      ok: true,
      game: "Mobile Legends: Bang Bang",
      account_id: accountId,
      zone_id: zoneId,
      nickname: result.nickname,
      region: result.region,
      server_type: result.serverType,
    });
  } catch (error) {
    console.error("[LOOKUP_ENDPOINT_ERROR]", error);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};

function isLookupRequest(req) {
  const query = req.query || {};
  return Boolean(
    (query.account_id || query.zone_id || query.id || query.zone || query.token)
  );
}

async function lookupMlbb(accountId, zoneId) {
  try {
    const url = new URL(MLBB_LOOKUP_API_URL);
    url.searchParams.set("id", accountId);
    url.searchParams.set("zone", zoneId);

    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      timeoutMs: LOOKUP_TIMEOUT_MS,
    });

    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return { ok: false, reason: "lookup_provider_error" };
    }

    const nickname =
      data?.nickname ||
      data?.name ||
      data?.username ||
      data?.data?.nickname ||
      data?.data?.name ||
      null;
    const region =
      data?.region ||
      data?.country ||
      data?.server ||
      data?.data?.region ||
      data?.data?.country ||
      null;

    if (!nickname) {
      return { ok: false, reason: data?.message || "not_found" };
    }

    const serverType =
      data?.server_type || data?.serverType || data?.type || null;

    return { ok: true, nickname, region, serverType };
  } catch (error) {
    console.error("[LOOKUP_PROVIDER_ERROR]", error);
    return {
      ok: false,
      reason: "provider_unreachable",
    };
  }
}

async function checkToken(rawToken) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { ok: false, error: "config_error" };
  }

  const hash = crypto
    .createHash("sha256")
    .update(String(rawToken))
    .digest("hex");

  try {
    const rows = await supabaseRequest(
      `/api_tokens?token_hash=eq.${hash}&select=id,title,expires_at,is_revoked&limit=1`
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "token_not_found" };
    }

    const row = rows[0];

    if (row.is_revoked) {
      return { ok: false, error: "token_revoked" };
    }

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, error: "token_expired" };
    }

    return { ok: true, tokenId: row.id };
  } catch (error) {
    console.error("[TOKEN_CHECK_ERROR]", error);
    return { ok: false, error: "config_error" };
  }
}

async function recordUsage(tokenId) {
  if (!tokenId || !SUPABASE_URL) {
    return;
  }
  try {
    await supabaseRequest(`/api_tokens?id=eq.${tokenId}`, {
      method: "PATCH",
      body: {
        last_used_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[TOKEN_USAGE_ERROR]", error);
  }
}

async function supabaseRequest(path, options = {}) {
  const { method = "GET", body } = options;
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}: ${text}`);
  }

  return json;
}

function resolveServiceKey(env) {
  const candidates = [
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_SERVICE_KEY,
    env.SUPABASE_SECRET_KEY,
    env.SUPABASE_SERVICE_ROLE,
    env.SUPABASE_SERVICE_ROLE_SECRET,
    env.SUPABASE_SERVICE_RELE_KEY,
  ];

  for (const key of candidates) {
    if (key && String(key).trim()) {
      return String(key).trim();
    }
  }

  return "";
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractBearer(authHeader) {
  if (!authHeader) {
    return "";
  }
  return cleanToken(String(authHeader).replace(/^Bearer\s+/i, ""));
}

function cleanToken(value) {
  return String(value ?? "").trim();
}

function cleanEnv(value) {
  return String(value ?? "").trim();
}

function parseBoundedNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}
