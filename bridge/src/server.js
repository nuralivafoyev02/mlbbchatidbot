const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

loadEnvFile(path.join(__dirname, "..", ".env"));

const PORT = parseBoundedNumber(process.env.PORT, 8788, 1, 65535);
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
  90000,
  5000,
  120000
);
const POLL_INTERVAL_MS = parseBoundedNumber(
  process.env.BENGKEL_POLL_INTERVAL_MS,
  1200,
  400,
  5000
);
const MAX_BODY_BYTES = parseBoundedNumber(
  process.env.BRIDGE_MAX_BODY_BYTES,
  20 * 1024,
  1024,
  256 * 1024
);

let clientPromise = null;
let requestChain = Promise.resolve();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "mlbb-bengkel-bridge",
        bot_username: DEFAULT_BOT_USERNAME,
      });
    }

    if (req.method === "POST" && url.pathname === "/resolve-username") {
      return handleResolveUsername(req, res, url);
    }

    if (req.method !== "POST" || url.pathname !== "/bengkel") {
      return sendJson(res, 404, {
        ok: false,
        error: "not_found",
      });
    }

    const body = await readJsonBody(req);
    const auth = validateBridgeSecret(req, body, url);

    if (!auth.ok) {
      return sendJson(res, 401, {
        ok: false,
        error: "unauthorized",
      });
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
    console.error("[BRIDGE_ERROR]", error);
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.publicMessage || "bridge_failed",
    });
  }
});

server.listen(PORT, () => {
  console.log(`MLBB Bengkel bridge listening on :${PORT}`);
});

async function handleResolveUsername(req, res, url) {
  try {
    const body = await readJsonBody(req);
    const auth = validateBridgeSecret(req, body, url);

    if (!auth.ok) {
      return sendJson(res, 401, {
        ok: false,
        error: "unauthorized",
      });
    }

    const username = sanitizeTelegramUsername(body.username);

    if (!username) {
      return sendJson(res, 400, {
        ok: false,
        error: "username_invalid",
      });
    }

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
    isremium: peer.premium || false,
    is_fake: peer.fake || false,
    is_scam: peer.scam || false,
    is_support: peer.support || false,
    is_verified: peer.verified || false,
    restriction_reason: peer.restrictionReason || "",
    access_hash: Number(peer.accessHash || 0),
  };

  return profile;
}

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
      connectionRetries: 5,
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

function validateBridgeSecret(req, body = {}, url) {
  if (!BRIDGE_SECRET) {
    return { ok: true };
  }

  const provided = cleanEnv(
    req.headers["x-bridge-secret"] ||
      req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
      body.x_key ||
      body.secret ||
      url.searchParams.get("secret")
  );

  return {
    ok: timingSafeEqual(provided, BRIDGE_SECRET),
  };
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;

    if (total > MAX_BODY_BYTES) {
      throw createPublicError(413, "body_too_large");
    }

    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw createPublicError(400, "invalid_json");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
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

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const text = fs.readFileSync(filePath, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
