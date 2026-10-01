import botHandler from "./api/bot.js";
import {
  getBroadcastResultFromJob,
  getBroadcastTuning,
  mergeBroadcastJob,
  normalizeBroadcastJob,
  runBroadcastSlice,
} from "./broadcast-core.mjs";
import { createInternalRequest, jsonResponse, runVercelHandler } from "./worker-runtime.mjs";
import {
  BIND_RUNNER_NAME_PREFIX,
  BIND_SHARD_COUNT,
  BIND_TASK_TTL_MS,
  BROADCAST_RUNNER_NAME,
  getBindRunnerName,
  getModeRunnerName,
  getModeTtlMs,
  MODE_RUNNER_NAME_PREFIX,
  MODE_TTL_MS,
} from "./runner-routing.mjs";

const BIND_TASK_KEY = "bind:tasks";
const BROADCAST_JOB_KEY = "broadcast:job";
const BROADCAST_JOB_TTL_MS = 60 * 60 * 1000;
const BIND_REARM_DELAY_MS = 50;
const MAX_BIND_TASKS_PER_OBJECT = 20;
const MAX_BROADCAST_JOB_BYTES = 1_500_000;
const MODE_KEY = "mode:user";

export {
  BIND_RUNNER_NAME_PREFIX,
  BROADCAST_RUNNER_NAME,
  getBindRunnerName,
  getModeRunnerName,
  MODE_RUNNER_NAME_PREFIX,
  MODE_TTL_MS,
};

function trimBroadcastJobToStorageLimit(job) {
  let candidate = job;

  while (JSON.stringify(candidate).length > MAX_BROADCAST_JOB_BYTES) {
    const overflow = Math.max(1, candidate.chatIds.length - 1000);
    const chatIds = candidate.chatIds.slice(0, Math.max(0, candidate.chatIds.length - overflow));

    if (chatIds.length === candidate.chatIds.length) {
      break;
    }

    candidate = { ...candidate, chatIds };
  }

  return candidate;
}

export class AsyncRunner {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  get kind() {
    const name = String(this.state?.id?.name || "");

    if (name === BROADCAST_RUNNER_NAME || name.startsWith("broadcast:")) {
      return "broadcast";
    }

    if (name.startsWith(MODE_RUNNER_NAME_PREFIX)) {
      return "mode";
    }

    return "bind";
  }

  // DO stub'ga `stub.fetch("https://...")` deb chaqirish mumkin — shuning uchun
  // string ham, Request ham qabul qilinadi.
  async fetch(request, init) {
    const req = typeof request === "string" ? new Request(request, init) : request;
    const url = new URL(req.url);

    if (req.method === "GET") {
      if (url.pathname === "/mode") {
        return this.handleModeGet(url);
      }

      return this.handleStatus();
    }

    if (req.method === "DELETE") {
      if (url.pathname === "/mode") {
        return this.handleModeSet({ userId: url.searchParams.get("userId"), mode: null });
      }

      return jsonResponse({ ok: false, error: "Unknown route" }, 404);
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    let body = {};

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (url.pathname === "/broadcast") {
      return this.handleBroadcastStart(body);
    }

    if (url.pathname === "/bind") {
      return this.handleBindSubmit(body);
    }

    if (url.pathname === "/mode") {
      return this.handleModeSet(body);
    }

    return jsonResponse({ ok: false, error: "Unknown route" }, 404);
  }

  async handleModeGet(url) {
    if (this.kind !== "mode") {
      return jsonResponse({ ok: false, error: "Not a mode runner" }, 400);
    }

    const userId = String(url.searchParams.get("userId") || "");
    const stored = await this.state.storage.get(MODE_KEY);

    if (!stored || stored.userId !== userId || Date.now() - Number(stored.at || 0) > getModeTtlMs(stored.mode)) {
      return jsonResponse({ ok: true, mode: null });
    }

    return jsonResponse({ ok: true, mode: stored.mode || null });
  }

  async handleModeSet(body = {}) {
    if (this.kind !== "mode") {
      return jsonResponse({ ok: false, error: "Not a mode runner" }, 400);
    }

    const userId = String(body?.userId || "");
    const mode = body?.mode ? String(body.mode).slice(0, 32) : null;

    if (!userId) {
      return jsonResponse({ ok: false, error: "userId required" }, 400);
    }

    if (!mode) {
      await this.state.storage.delete(MODE_KEY);
      return jsonResponse({ ok: true, mode: null });
    }

    await this.state.storage.put(MODE_KEY, { userId, mode, at: Date.now() });

    return jsonResponse({ ok: true, mode });
  }

  async handleStatus() {
    const envProbe = ["TELEGRAM_BOT_TOKEN", "SUPABASE_URL"].map((key) => ({
      key,
      inProcessEnv: Boolean(process.env?.[key]),
      inEnv: Boolean(this.env?.[key]),
    }));

    if (this.kind === "broadcast") {
      const job = await this.state.storage.get(BROADCAST_JOB_KEY);

      return jsonResponse({
        ok: true,
        kind: this.kind,
        name: this.state?.id?.name || null,
        envProbe,
        job: job ? getBroadcastResultFromJob(job) : null,
        remaining: Array.isArray(job?.chatIds) ? job.chatIds.length : 0,
      });
    }

    const tasks = await this.readBindTasks();

    return jsonResponse({
      ok: true,
      kind: this.kind,
      name: this.state?.id?.name || null,
      envProbe,
      pendingBindTasks: tasks.length,
    });
  }

  async handleBindSubmit(body = {}) {
    const update = body?.update || body;

    if (!update || typeof update !== "object") {
      return jsonResponse({ ok: false, error: "Invalid update" }, 400);
    }

    const tasks = await this.readBindTasks();

    if (tasks.length >= MAX_BIND_TASKS_PER_OBJECT) {
      return jsonResponse({ ok: false, error: "Runner busy" }, 429);
    }

    const taskId = String(update.update_id ?? `${Date.now()}:${tasks.length}`);

    if (tasks.some((task) => task.id === taskId)) {
      return jsonResponse({ ok: true, duplicate: true });
    }

    tasks.push({ id: taskId, at: Date.now(), update });
    await this.state.storage.put(BIND_TASK_KEY, tasks);
    await this.state.storage.setAlarm(Date.now());

    return jsonResponse({ ok: true, queued: true, taskId });
  }

  async handleBroadcastStart(body = {}) {
    const payload = body?.payload || null;
    const adminChatId = body?.adminChatId ? String(body.adminChatId) : "";

    if (!payload) {
      return jsonResponse({ ok: false, error: "Missing payload" }, 400);
    }

    const running = await this.state.storage.get(BROADCAST_JOB_KEY);

    if (running && Array.isArray(running.chatIds) && running.chatIds.length > 0) {
      return jsonResponse({ ok: false, error: "Broadcast already running" }, 409);
    }

    const recipients = await botHandler.getBroadcastChatIds();

    if (!recipients.length) {
      console.error("[BROADCAST_NO_RECIPIENTS]");
      await this.sendReport(adminChatId, {
        total: 0,
        sent: 0,
        blocked: 0,
        inactive: 0,
        initiate: 0,
        errors: 0,
      });

      return jsonResponse({ ok: true, total: 0, started: false });
    }

    const job = normalizeBroadcastJob({
      id: body?.id ? String(body.id) : `bcast-${Date.now()}`,
      payload,
      adminChatId,
      chatIds: recipients,
      total: recipients.length,
    });
    const stored = trimBroadcastJobToStorageLimit(job);

    if (stored.total !== recipients.length) {
      console.error("[BROADCAST_AUDIENCE_TRUNCATED]", {
        from: recipients.length,
        to: stored.total,
      });
    }

    await this.state.storage.put(BROADCAST_JOB_KEY, stored);
    await this.state.storage.setAlarm(Date.now());

    return jsonResponse({ ok: true, queued: true, total: stored.total });
  }

  async readBindTasks() {
    const stored = await this.state.storage.get(BIND_TASK_KEY);

    if (!Array.isArray(stored)) {
      return [];
    }

    const now = Date.now();

    return stored.filter((task) => now - Number(task?.at || 0) < BIND_TASK_TTL_MS);
  }

  async alarm() {
    try {
      if (this.kind === "broadcast") {
        await this.drainBroadcast();
        return;
      }

      if (this.kind === "mode") {
        return;
      }

      await this.drainBind();
    } catch (error) {
      // Alarm faqat 6 marta qayta uriniladi — keyingi alarmni o'zimiz
      // qo'yib qo'yamiz, aks holda zanjir butunlay to'xtab qoladi.
      console.error("[ASYNC_RUNNER_ALARM_ERROR]", error);

      try {
        await this.state.storage.setAlarm(Date.now() + 1000);
      } catch (rearmError) {
        console.error("[ASYNC_RUNNER_ALARM_REARM_ERROR]", rearmError);
      }
    }
  }

  async drainBind() {
    const tasks = await this.readBindTasks();
    const task = tasks.shift();

    await this.state.storage.put(BIND_TASK_KEY, tasks);

    if (task?.update) {
      try {
        await runVercelHandler(createInternalRequest(task.update, this.env), this.env, this.state);
      } catch (error) {
        console.error("[ASYNC_RUNNER_BIND_ERROR]", error);
      }
    }

    if (tasks.length > 0) {
      await this.state.storage.setAlarm(Date.now() + BIND_REARM_DELAY_MS);
    }
  }

  async drainBroadcast() {
    const stored = await this.state.storage.get(BROADCAST_JOB_KEY);

    if (!stored) {
      return;
    }

    if (Date.now() - Number(stored.updatedAt || 0) > BROADCAST_JOB_TTL_MS) {
      await this.finishBroadcast(stored, true);
      return;
    }

    const tune = getBroadcastTuning(this.env);
    const slice = await runBroadcastSlice({
      env: this.env,
      job: stored,
      tune,
      deadlineAt: Date.now() + tune.runBudgetMs,
      cooldownUntil: stored.cooldownUntil,
    });

    const job = mergeBroadcastJob(stored, slice);

    if (slice.finished) {
      await this.finishBroadcast(job, false);
      return;
    }

    await this.state.storage.put(BROADCAST_JOB_KEY, job);

    const rearmDelay = Math.max(0, job.cooldownUntil - Date.now());

    await this.state.storage.setAlarm(Date.now() + rearmDelay);
  }

  async finishBroadcast(job, expired) {
    await this.state.storage.delete(BROADCAST_JOB_KEY);

    if (expired) {
      console.error("[BROADCAST_JOB_EXPIRED]");
    }

    await this.sendReport(job?.adminChatId, getBroadcastResultFromJob(job));
  }

  async sendReport(adminChatId, result) {
    if (!adminChatId) {
      return;
    }

    try {
      await botHandler.sendBroadcastReport(adminChatId, result);
    } catch (error) {
      console.error("[BROADCAST_REPORT_ERROR]", error);
    }
  }
}
