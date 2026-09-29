import botHandler from "./api/bot.js";
import { getModeRunnerName, MODE_TTL_MS } from "./runner-routing.mjs";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

// Rejim (masalan "profile_add") isolate RAM'ida saqlansa, yangi isolate'ga
// tushgan keyingi xabarda yo'qoladi. Shu sababli Durable Object'da saqlanadi,
// RAM esa tez-tez o'qilishi uchun front-cache sifatida ishlatiladi.
const modeCache = new Map();

function readCachedMode(userId) {
  const entry = modeCache.get(String(userId || ""));

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.at > MODE_TTL_MS) {
    modeCache.delete(String(userId));
    return null;
  }

  return entry.mode;
}

function writeCachedMode(userId, mode) {
  const key = String(userId || "");

  if (!key) {
    return;
  }

  if (mode) {
    modeCache.set(key, { mode, at: Date.now() });
  } else {
    modeCache.delete(key);
  }
}

function getModeStub(env, userId) {
  const namespace = env?.ASYNC_RUNNER;

  if (!userId || !namespace || typeof namespace.idFromName !== "function") {
    return null;
  }

  try {
    return namespace.get(namespace.idFromName(getModeRunnerName(userId)));
  } catch {
    return null;
  }
}

export function createUserModeStore(env = {}) {
  const available = typeof env?.ASYNC_RUNNER?.idFromName === "function";

  return {
    durable: available,

    async get(userId) {
      const cached = readCachedMode(userId);

      if (cached) {
        return cached;
      }

      const stub = getModeStub(env, userId);

      if (!stub) {
        return null;
      }

      try {
        const response = await stub.fetch(
          `https://async-runner.internal/mode?userId=${encodeURIComponent(String(userId))}`
        );

        if (!response.ok) {
          return null;
        }

        const data = await safeJson(response);
        const mode = data?.mode ? String(data.mode) : null;

        writeCachedMode(userId, mode);

        return mode;
      } catch (error) {
        console.error("[USER_MODE_READ_ERROR]", error);
        return null;
      }
    },

    async set(userId, mode) {
      writeCachedMode(userId, mode);

      const stub = getModeStub(env, userId);

      if (!stub) {
        return;
      }

      try {
        await stub.fetch("https://async-runner.internal/mode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, mode: mode || null }),
        });
      } catch (error) {
        console.error("[USER_MODE_WRITE_ERROR]", error);
      }
    },

    async clear(userId) {
      return this.set(userId, null);
    },
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

export async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function getTelegramTimeoutMs(env) {
  const value = Number(env?.TELEGRAM_TIMEOUT_MS);

  if (!Number.isFinite(value)) {
    return 5000;
  }

  return Math.min(10000, Math.max(800, value));
}

export function createVercelRequest(request, body) {
  const url = new URL(request.url);

  return {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    query: Object.fromEntries(url.searchParams.entries()),
    body,
  };
}

export async function parseRequestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return {};
  }

  const text = await request.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createVercelResponse() {
  return {
    statusCode: 200,
    headers: { ...JSON_HEADERS },
    body: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    json(payload) {
      this.headers["content-type"] = JSON_HEADERS["content-type"];
      this.body = JSON.stringify(payload);
      return this;
    },
    send(payload) {
      this.body = typeof payload === "string" ? payload : JSON.stringify(payload);
      return this;
    },
    end(payload = "") {
      if (payload) {
        this.send(payload);
      }

      return this;
    },
    toResponse() {
      return new Response(this.body, {
        status: this.statusCode,
        headers: this.headers,
      });
    },
  };
}

export function createInternalRequest(body, env) {
  return {
    method: "POST",
    headers: {
      "x-telegram-bot-api-secret-token": String(env?.TELEGRAM_WEBHOOK_SECRET || ""),
    },
    query: {},
    body: {
      ...body,
      __skip_bind_wait: true,
    },
  };
}

export async function runVercelHandler(req, env = {}, ctx = null) {
  const res = createVercelResponse();

  await botHandler(req, res, env, ctx, { userModeStore: createUserModeStore(env) });

  return res.toResponse();
}

export function getChatId(update) {
  return (
    update?.message?.chat?.id ||
    update?.edited_message?.chat?.id ||
    update?.channel_post?.chat?.id ||
    update?.edited_channel_post?.chat?.id ||
    null
  );
}

export function isAuthorizedWebhook(request, env) {
  const expected = String(env?.TELEGRAM_WEBHOOK_SECRET || "").trim();

  if (!expected) {
    return true;
  }

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-telegram-bot-api-secret-token") ||
    url.searchParams.get("secret") ||
    "";

  return timingSafeEqual(provided, expected);
}

export function timingSafeEqual(leftValue, rightValue) {
  const left = new TextEncoder().encode(String(leftValue || ""));
  const right = new TextEncoder().encode(String(rightValue || ""));

  if (!left.length || left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }

  return mismatch === 0;
}
