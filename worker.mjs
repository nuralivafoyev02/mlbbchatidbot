import handler from "./api/bot.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};
const BIND_INFO_COMMAND_RE = /^\/(?:info|bind|ulanish|ulamalar|ulanmalar)(?:@\w+)?(?:\s|$)/i;
const BROADCAST_QUEUE_NAME = "mlbbchatidbot-broadcast";
const BROADCAST_CONSUMER_CHUNK_SIZE = 10;
const BROADCAST_CHUNK_DELAY_MS = 250;

export default {
  async fetch(request, env, ctx) {
    const body = await parseRequestBody(request);
    const req = createVercelRequest(request, body);

    if (shouldQueueBindInfoUpdate(body) && isAuthorizedWebhook(request, env)) {
      const waitMessage = await sendBindInfoWaitMessage(body, env);
      await queueBindInfoUpdate(body, env, ctx, waitMessage);

      return jsonResponse({
        ok: true,
        queued: true,
      });
    }

    return runVercelHandler(req, env);
  },

  async queue(batch, env) {
    if (batch.queue === BROADCAST_QUEUE_NAME) {
      for (const message of batch.messages) {
        try {
          await processBroadcastMessage(message.body, env);
          if (typeof message.ack === "function") {
            message.ack();
          }
        } catch (error) {
          console.error("[QUEUE_BROADCAST_ERROR]", error);
          // ack qilinmaydi — platform max_retries bo'yicha qayta yuboradi
        }
      }

      return;
    }

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

  async scheduled(event, env, ctx) {
    try {
      await handler.sendDailyUsageReport(env);
    } catch (error) {
      console.error("[DAILY_USAGE_REPORT_ERROR]", error);
    }
  },
};

async function runVercelHandler(req, env = {}) {
  const res = createVercelResponse();

  await handler(req, res, env);

  return res.toResponse();
}

async function processBroadcastMessage(body = {}, env = {}) {
  const { chatIds, payload, adminChatId, total, sent = 0, failed = 0 } = body || {};

  if (!payload) {
    return;
  }

  if (!Array.isArray(chatIds) || chatIds.length === 0) {
    const recipients = await handler.getBroadcastChatIds();

    if (!recipients.length) {
      console.error("[QUEUE_BROADCAST_EMPTY_RECIPIENTS]");
      await sendBroadcastReportSafe(adminChatId, { total: 0, sent: 0, failed: 0 });
      return;
    }

    await processBroadcastChunk(recipients, payload, env, {
      adminChatId,
      total: recipients.length,
      sent,
      failed,
    });
    return;
  }

  await processBroadcastChunk(chatIds, payload, env, {
    adminChatId,
    total,
    sent,
    failed,
  });
}

async function processBroadcastChunk(chatIds, payload, env, meta = {}) {
  const chunk = chatIds.slice(0, BROADCAST_CONSUMER_CHUNK_SIZE);

  const results = await Promise.allSettled(
    chunk.map((chatId) => sendBroadcastWithRetry(chatId, payload))
  );

  const sent =
    Number(meta.sent || 0) +
    results.filter((result) => result.status === "fulfilled").length;
  const failed =
    Number(meta.failed || 0) +
    results.filter((result) => result.status === "rejected").length;

  const remaining = chatIds.slice(chunk.length);

  if (remaining.length > 0 && env?.BROADCAST_QUEUE?.send) {
    try {
      await env.BROADCAST_QUEUE.send({
        chatIds: remaining,
        payload,
        adminChatId: meta.adminChatId,
        total: meta.total,
        sent,
        failed,
      });
    } catch (error) {
      console.error("[QUEUE_BROADCAST_CONTINUE_ERROR]", error);
    }
  } else if (meta.adminChatId) {
    await sendBroadcastReportSafe(meta.adminChatId, {
      total: Number(meta.total) || chatIds.length,
      sent,
      failed,
    });
  }

  await sleep(BROADCAST_CHUNK_DELAY_MS);
}

async function sendBroadcastReportSafe(adminChatId, result) {
  if (!adminChatId) {
    return;
  }

  try {
    await handler.sendBroadcastReport(adminChatId, result);
  } catch (error) {
    console.error("[QUEUE_BROADCAST_REPORT_ERROR]", error);
  }
}

async function sendBroadcastWithRetry(chatId, payload) {
  try {
    await handler.sendBroadcastPayload(chatId, payload);
  } catch (error) {
    // O'tkinchi xatolik (masalan 429 rate limit) bo'lsa bir marta qayta urinamiz
    await sleep(1000);
    await handler.sendBroadcastPayload(chatId, payload);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  if (
    message?.chat?.type &&
    !["private", "group", "supergroup"].includes(message.chat.type)
  ) {
    return false;
  }

  if (BIND_INFO_COMMAND_RE.test(text) && hasMlbbIdPair(text)) {
    return true;
  }

  return isBindInfoPromptReply(message) && hasMlbbIdPair(text);
}

async function queueBindInfoUpdate(update, env, ctx, waitMessage = null) {
  const queuedUpdate = {
    ...update,
    __skip_bind_wait: true,
  };

  if (waitMessage?.chatId && waitMessage?.messageId) {
    queuedUpdate.__bind_wait_message = {
      chatId: waitMessage.chatId,
      messageId: waitMessage.messageId,
    };
  }

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
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: [
          "🙏 <b>Ulanmalar tekshirilmoqda...</b>",
          "",
          "Iltimos, kutib turing. Bu biroz vaqt olishi mumkin.",
        ].join("\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    const data = await safeJson(response);
    const messageId = data?.result?.message_id;

    if (messageId) {
      return {
        chatId,
        messageId,
      };
    }
  } catch (error) {
    console.error("[QUEUE_WAIT_MESSAGE_ERROR]", error);
  } finally {
    clearTimeout(timeout);
  }

  return null;
}

function isBindInfoPromptReply(message = {}) {
  const replyText = String(message.reply_to_message?.text || "");

  return /Ulanmalar/i.test(replyText) && /Account ID/i.test(replyText);
}

function hasMlbbIdPair(text) {
  return /\d{4,20}\D+\d{1,10}/.test(String(text || ""));
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
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
