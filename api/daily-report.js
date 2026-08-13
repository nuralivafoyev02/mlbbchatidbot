const crypto = require("node:crypto");
const bot = require("./bot.js");

const CRON_SECRET = cleanEnv(process.env.CRON_SECRET);
const WEBHOOK_SECRET = cleanEnv(process.env.TELEGRAM_WEBHOOK_SECRET);

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        service: "mlbb-daily-report",
        endpoint: "/api/daily-report",
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "method_not_allowed",
      });
    }

    const expected = CRON_SECRET || WEBHOOK_SECRET;

    if (!expected || !isAuthorized(req, expected)) {
      return res.status(401).json({
        ok: false,
        error: "unauthorized",
      });
    }

    const result = await bot.sendDailyUsageReport();

    return res.status(200).json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error("[DAILY_REPORT_ENDPOINT_ERROR]", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

function isAuthorized(req, expected) {
  const auth = cleanEnv(req.headers?.authorization);
  const provided = auth.replace(/^Bearer\s+/i, "").replace(/\s+/g, "");

  return timingSafeEqual(provided, expected);
}

function timingSafeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));

  if (!left.length || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function cleanEnv(value) {
  return String(value ?? "").trim();
}
