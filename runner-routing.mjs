// AsyncRunner DO obyektlarining nomlashuvi. worker-runtime.mjs va
// async-runner.mjs ikkalasi ham shu modulga qaraydi — aks holda ular
// o'zaro import qilib sikl hosil qilardi.

export const BIND_SHARD_COUNT = 20;
export const BIND_RUNNER_NAME_PREFIX = "bind";
export const BROADCAST_RUNNER_NAME = "broadcast";
export const MODE_RUNNER_NAME_PREFIX = "mode";

export const BIND_TASK_TTL_MS = 10 * 60 * 1000;
export const MODE_TTL_MS = 15 * 60 * 1000;
// "Do'kon" — kiritish rejimi emas, menyu holati: foydalanuvchi do'kon
// klaviaturasida uzoq turishi mumkin, shu sabab uning muddati uzunroq.
export const LONG_LIVED_MODE_TTL_MS = 12 * 60 * 60 * 1000;
export const LONG_LIVED_MODES = Object.freeze(["shop"]);

export function getModeTtlMs(mode) {
  return LONG_LIVED_MODES.includes(String(mode || "")) ? LONG_LIVED_MODE_TTL_MS : MODE_TTL_MS;
}

export function getBindRunnerName(chatId) {
  const raw = String(chatId || "");
  let hash = 0;

  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }

  return `${BIND_RUNNER_NAME_PREFIX}:${hash % BIND_SHARD_COUNT}`;
}

export function getModeRunnerName(userId) {
  return `${MODE_RUNNER_NAME_PREFIX}:${String(userId || "")}`;
}
