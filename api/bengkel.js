const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const TELEGRAM_API_ID = Number(process.env.TELEGRAM_API_ID);
const TELEGRAM_API_HASH = cleanEnv(process.env.TELEGRAM_API_HASH);
const TELEGRAM_SESSION = cleanEnv(process.env.TELEGRAM_SESSION);
const BRIDGE_SECRET = cleanEnv(
  process.env.BRIDGE_SECRET || process.env.MLBB_BIND_INFO_API_KEY
);
const DEFAULT_BOT_USERNAME =
  sanitizeTelegramUsername(process.env.BENGKEL_BOT_USERNAME) || "bengkelmlbb_bot";
const RESPONSE_TIMEOUT_MS = parseBoundedNumber(
  process.env.BENGKEL_RESPONSE_TIMEOUT_MS,
  50000,
  5000,
  55000
);
const POLL_INTERVAL_MS = parseBoundedNumber(
  process.env.BENGKEL_POLL_INTERVAL_MS,
  1200,
  400,
  5000
);

let clientPromise = null;
let requestChain = Promise.resolve();

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        service: "mlbb-bengkel-bridge",
        bot_username: DEFAULT_BOT_USERNAME,
      });
    }

    if (req.method !== "POST") {
      return sendJson(res, 405, {
        ok: false,
        error: "method_not_allowed",
      });
    }

    const body = parseBody(req.body);

    if (!validateBridgeSecret(req, body)) {
      return sendJson(res, 401, {
        ok: false,
        error: "unauthorized",
      });
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "POST" && url.pathname === "/resolve-username") {
      return handleResolveUsername(res, body);
    }

    const payload = normalizeLookupPayload(body);

    if (!payload.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: payload.error,
      });
    }

    const result = await enqueueLookup(() => lookupBengkel(payload));

    return sendJson(res, 200, {
      ok: true,
      result: {
        text: result.text,
        message_id: result.messageId,
        bot_username: payload.botUsername,
      },
    });
  } catch (error) {
    console.error("[BENGKEL_BRIDGE_ERROR]", error);
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.publicMessage || "bridge_failed",
    });
  }
};

function enqueueLookup(task) {
  const run = requestChain.then(task, task);
  requestChain = run.catch(() => {});
  return run;
}

async function lookupBengkel(payload) {
  const client = await getClient();
  const peer = await client.getEntity(payload.botUsername);
  const sent = await client.sendMessage(peer, {
    message: payload.message,
  });
  const reply = await waitForBotReply(client, peer, sent.id);
  const text = extractTelegramMessageText(reply);

  if (!text) {
    throw createPublicError(502, "empty_bot_response");
  }

  return {
    text,
    messageId: reply.id,
  };
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = createClient();
  }

  return clientPromise;
}

async function createClient() {
  if (!Number.isInteger(TELEGRAM_API_ID) || TELEGRAM_API_ID <= 0) {
    throw createPublicError(500, "telegram_api_id_missing");
  }

  if (!TELEGRAM_API_HASH) {
    throw createPublicError(500, "telegram_api_hash_missing");
  }

  if (!TELEGRAM_SESSION) {
    throw createPublicError(500, "telegram_session_missing");
  }

  const client = new TelegramClient(
    new StringSession(TELEGRAM_SESSION),
    TELEGRAM_API_ID,
    TELEGRAM_API_HASH,
    {
      connectionRetries: 3,
    }
  );

  await client.connect();

  if (!(await client.isUserAuthorized())) {
    throw createPublicError(500, "telegram_session_unauthorized");
  }

  return client;
}

async function waitForBotReply(client, peer, sentMessageId) {
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const messages = await client.getMessages(peer, {
      limit: 10,
    });
    const reply = [...messages]
      .filter((message) => {
        const id = Number(message?.id || 0);
        return id > Number(sentMessageId || 0) && !message.out;
      })
      .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))[0];

    if (reply) {
      return reply;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw createPublicError(504, "bengkel_bot_timeout");
}

function normalizeLookupPayload(body = {}) {
  const accountId = cleanEnv(body.account_id || body.accountId || body.player_id);
  const zoneId = cleanEnv(body.zone_id || body.zoneId || body.server_id);
  const botUsername =
    sanitizeTelegramUsername(body.bot_username || body.botUsername) ||
    DEFAULT_BOT_USERNAME;
  const message = cleanEnv(body.message) || `/info ${accountId} ${zoneId}`;

  if (!accountId || !zoneId) {
    return {
      ok: false,
      error: "account_id_or_zone_id_missing",
    };
  }

  if (!/^\d{4,20}$/.test(accountId) || !/^\d{1,10}$/.test(zoneId)) {
    return {
      ok: false,
      error: "account_id_or_zone_id_invalid",
    };
  }

  return {
    ok: true,
    accountId,
    zoneId,
    botUsername,
    message,
  };
}

function validateBridgeSecret(req, body = {}) {
  if (!BRIDGE_SECRET) {
    return true;
  }

  const provided = cleanEnv(
    req.headers["x-bridge-secret"] ||
      req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
      body.x_key ||
      body.secret
  );

  return timingSafeEqual(provided, BRIDGE_SECRET);
}

function parseBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "object") {
    return body;
  }

  try {
    return JSON.parse(String(body));
  } catch {
    return {};
  }
}

function sendJson(res, statusCode, payload) {
  return res.status(statusCode).json(payload);
}

function extractTelegramMessageText(message = {}) {
  return cleanEnv(message.message || message.text || message.rawText);
}

function sanitizeTelegramUsername(value) {
  const username = cleanEnv(value).replace(/^@+/, "");

  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : "";
}

function cleanEnv(value) {
  return String(value ?? "").trim();
}

function parseBoundedNumber(value, fallback, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function timingSafeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));

  if (!left.length || left.length !== right.length) {
    return false;
  }

  return require("node:crypto").timingSafeEqual(left, right);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPublicError(statusCode, publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}

async function handleResolveUsername(res, body) {
  const username = sanitizeTelegramUsername(body.username);

  if (!username) {
    return sendJson(res, 400, {
      ok: false,
      error: "username_invalid",
    });
  }

  try {
    const result = await enqueueLookup(() => resolveUsername(username));

    return sendJson(res, 200, {
      ok: true,
      result,
    });
  } catch (error) {
    console.error("[RESOLVE_USERNAME_ERROR]", error);
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.publicMessage || "resolve_failed",
    });
  }
}

async function resolveUsername(username) {
  const client = await getClient();
  const peer = await client.getEntity(username);

  if (!peer) {
    throw createPublicError(404, "user_not_found");
  }

  const profile = {
    id: Number(peer.id || 0),
    username: peer.username || "",
    first_name: peer.firstName || peer.first_name || "",
    last_name: peer.lastName || peer.last_name || "",
    type: peer.className || "User",
    is_self: peer.self || false,
    is_contact: peer.contact || false,
    is_mutual_contact: peer.mutualContact || false,
    is_premium: peer.premium || false,
    is_fake: peer.fake || false,
    is_scam: peer.scam || false,
    is_support: peer.support || false,
    is_verified: peer.verified || false,
    restriction_reason: peer.restrictionReason || "",
    access_hash: Number(peer.accessHash || 0),
  };

  return profile;
}
