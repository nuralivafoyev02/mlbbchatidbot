import botHandler from "./api/bot.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

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

  await botHandler(req, res, env, ctx);

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
