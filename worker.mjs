import handler, { enrichPremiumEmojis } from "./api/bot.js";
import {
  getBroadcastTuning,
  mergeBroadcastJob,
  normalizeBroadcastJob,
  runBroadcastSlice,
} from "./broadcast-core.mjs";
import { AsyncRunner, getBindRunnerName } from "./async-runner.mjs";
import { handleArenaProxy, isArenaProxyRequest } from "./arena-proxy.mjs";
import {
  createInternalRequest,
  createVercelRequest,
  getChatId,
  getTelegramTimeoutMs,
  isAuthorizedWebhook,
  jsonResponse,
  parseRequestBody,
  runVercelHandler,
  safeJson,
} from "./worker-runtime.mjs";

const BIND_INFO_COMMAND_RE = /^\/(?:info|bind|ulanish|ulamalar|ulanmalar)(?:@\w+)?(?:\s|$)/i;
const BROADCAST_QUEUE_NAME = "mlbbchatidbot-broadcast";
const RUNNER_BASE_URL = "https://async-runner.internal";
const QUEUE_MESSAGE_WARN_BYTES = 100_000;

export { AsyncRunner };

export default {
  async fetch(request, env, ctx) {
    // Shaxsiy kabinet (Vercel) → Arena: Vercel IP'lari Arena'da bloklangan.
    if (isArenaProxyRequest(request)) {
      return handleArenaProxy(request, env);
    }

    const body = await parseRequestBody(request);
    const req = createVercelRequest(request, body);

    if (shouldDeferBindInfoUpdate(body) && isAuthorizedWebhook(request, env)) {
      const waitMessage = await sendBindInfoWaitMessage(body, env);
      await dispatchBindInfoUpdate(body, env, ctx, waitMessage);

      return jsonResponse({
        ok: true,
        queued: true,
      });
    }

    return runVercelHandler(req, env, ctx);
  },

  async queue(batch, env) {
    if (batch.queue === BROADCAST_QUEUE_NAME) {
      for (const message of batch.messages) {
        try {
          await processBroadcastMessage(message.body, env);
        } catch (error) {
          console.error("[QUEUE_BROADCAST_ERROR]", error);
        }

        if (typeof message.ack === "function") {
          message.ack();
        }
      }

      return;
    }

    for (const message of batch.messages) {
      try {
        await runVercelHandler(createInternalRequest(message.body, env), env);
      } catch (error) {
        console.error("[QUEUE_BIND_INFO_ERROR]", error);
      }

      if (typeof message.ack === "function") {
        message.ack();
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

async function processBroadcastMessage(body = {}, env = {}) {
  const job = normalizeBroadcastJob(body);

  if (!job.payload) {
    return;
  }

  if (job.chatIds.length === 0) {
    const recipients = await handler.getBroadcastChatIds();

    if (!recipients.length) {
      console.error("[QUEUE_BROADCAST_EMPTY_RECIPIENTS]");
      await sendBroadcastReportSafe(job.adminChatId, {
        total: 0,
        sent: 0,
        blocked: 0,
        inactive: 0,
        initiate: 0,
        errors: 0,
      });
      return;
    }

    job.chatIds = recipients;
    job.total = recipients.length;
  }

  const tune = getBroadcastTuning(env);
  const slice = await runBroadcastSlice({
    env,
    job,
    tune,
    deadlineAt: Date.now() + tune.runBudgetMs,
    cooldownUntil: job.cooldownUntil,
  });
  const nextJob = mergeBroadcastJob(job, slice);

  if (!slice.finished && env?.BROADCAST_QUEUE?.send) {
    try {
      await env.BROADCAST_QUEUE.send(toQueueMessage(nextJob));
      return;
    } catch (error) {
      console.error("[QUEUE_BROADCAST_CONTINUE_ERROR]", error);
    }
  }

  await sendBroadcastReportSafe(nextJob.adminChatId, {
    total: nextJob.total,
    sent: nextJob.sent,
    blocked: nextJob.blocked,
    inactive: nextJob.inactive,
    initiate: nextJob.initiate,
    errors: nextJob.errors,
  });
}

function toQueueMessage(job) {
  const message = {
    chatIds: job.chatIds,
    payload: job.payload,
    adminChatId: job.adminChatId,
    total: job.total,
    sent: job.sent,
    blocked: job.blocked,
    inactive: job.inactive,
    initiate: job.initiate,
    errors: job.errors,
    rateLimited: job.rateLimited,
    cooldownUntil: job.cooldownUntil,
  };
  const size = JSON.stringify(message).length;

  if (size > QUEUE_MESSAGE_WARN_BYTES) {
    console.error("[QUEUE_BROADCAST_MESSAGE_LARGE]", { bytes: size, remaining: job.chatIds.length });
  }

  return message;
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

function shouldDeferBindInfoUpdate(update) {
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

  if (
    BIND_INFO_COMMAND_RE.test(text) && hasMlbbIdPair(text)
  ) {
    return true;
  }

  return isBindInfoPromptReply(message) && hasMlbbIdPair(text);
}

function buildQueuedBindInfoUpdate(update, waitMessage = null) {
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

  return queuedUpdate;
}

function getBindRunnerStub(env, update) {
  const namespace = env?.ASYNC_RUNNER;

  if (!namespace || typeof namespace.idFromName !== "function") {
    return null;
  }

  try {
    return namespace.get(namespace.idFromName(getBindRunnerName(getChatId(update))));
  } catch (error) {
    console.error("[BIND_RUNNER_ID_ERROR]", error);
    return null;
  }
}

async function dispatchBindInfoUpdate(update, env, ctx, waitMessage = null) {
  const queuedUpdate = buildQueuedBindInfoUpdate(update, waitMessage);
  const stub = getBindRunnerStub(env, update);

  if (stub) {
    try {
      const response = await stub.fetch(`${RUNNER_BASE_URL}/bind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ update: queuedUpdate }),
      });

      if (response.ok) {
        return;
      }

      throw new Error(`AsyncRunner rejected bind task: ${response.status}`);
    } catch (error) {
      console.error("[BIND_RUNNER_SUBMIT_ERROR]", error);
    }
  }

  if (env?.BIND_INFO_QUEUE?.send) {
    try {
      await env.BIND_INFO_QUEUE.send(queuedUpdate);
      return;
    } catch (error) {
      console.error("[BIND_INFO_QUEUE_SUBMIT_ERROR]", error);
    }
  }

  ctx?.waitUntil?.(runVercelHandler(createInternalRequest(queuedUpdate, env), env, ctx));
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
        text: enrichPremiumEmojis([
          "🙏 <b>Ulanmalar tekshirilmoqda...</b>",
          "",
          "Iltimos, kutib turing. Bu biroz vaqt olishi mumkin.",
        ].join("\n")),
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
