import handler from "./api/bot.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

export default {
  async fetch(request, env, ctx) {
    const body = await parseRequestBody(request);
    const req = createVercelRequest(request, body);

    if (shouldQueueBindInfoUpdate(body) && isAuthorizedWebhook(request, env)) {
      await sendBindInfoWaitMessage(body, env);
      await queueBindInfoUpdate(body, env, ctx);

      return jsonResponse({
        ok: true,
        queued: true,
      });
    }

    return runVercelHandler(req);
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await runVercelHandler(createInternalRequest(message.body, env));
        if (typeof message.ack === "function") {
          message.ack();
        }
      } catch (error) {
        console.error("[QUEUE_BIND_INFO_ERROR]", error);
        if (typeof message.ack === "function") {
          message.ack();
        }
      }
    }
  },
};

async function runVercelHandler(req) {
  const res = createVercelResponse();

  await handler(req, res);

  return res.toResponse();
}

function createVercelRequest(request, body) {
  const url = new URL(request.url);

  return {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    query: Object.fromEntries(url.searchParams.entries()),
    body,
  };
}

function createVercelResponse() {
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

async function parseRequestBody(request) {
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

function createInternalRequest(body, env) {
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

function shouldQueueBindInfoUpdate(update) {
  const message =
    update?.message ||
    update?.edited_message ||
    update?.channel_post ||
    update?.edited_channel_post ||
    null;
  const text = String(message?.text || "").trim();

  if (!text) {
    return false;
  }

  if (message?.chat?.type && message.chat.type !== "private") {
    return false;
  }

  return /^\/(?:info|bind|ulanish|ulamalar)(?:@\w+)?\s+\d/i.test(text);
}

async function queueBindInfoUpdate(update, env, ctx) {
  const queuedUpdate = {
    ...update,
    __skip_bind_wait: true,
  };

  if (env?.BIND_INFO_QUEUE?.send) {
    await env.BIND_INFO_QUEUE.send(queuedUpdate);
    return;
  }

  ctx.waitUntil(runVercelHandler(createInternalRequest(queuedUpdate, env)));
}

async function sendBindInfoWaitMessage(update, env) {
  const chatId = getChatId(update);

  if (!chatId || !env?.TELEGRAM_BOT_TOKEN) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTelegramTimeoutMs(env));

  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: [
          "⏳ <b>Ulanmalar tekshirilmoqda...</b>",
          "",
          "Iltimos, kutib turing. Bu biroz vaqt olishi mumkin.",
        ].join("\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    console.error("[QUEUE_WAIT_MESSAGE_ERROR]", error);
  } finally {
    clearTimeout(timeout);
  }
}

function getTelegramTimeoutMs(env) {
  const value = Number(env?.TELEGRAM_TIMEOUT_MS);

  if (!Number.isFinite(value)) {
    return 5000;
  }

  return Math.min(10000, Math.max(800, value));
}

function getChatId(update) {
  return (
    update?.message?.chat?.id ||
    update?.edited_message?.chat?.id ||
    update?.channel_post?.chat?.id ||
    update?.edited_channel_post?.chat?.id ||
    null
  );
}

function isAuthorizedWebhook(request, env) {
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

function timingSafeEqual(leftValue, rightValue) {
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

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}
