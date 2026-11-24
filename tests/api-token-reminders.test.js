const assert = require("node:assert/strict");
const test = require("node:test");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

// 2026-11-25 10:05 Toshkent (05:05 UTC) — reminder vaqti.
const NOW = Date.parse("2026-11-25T05:05:00Z");
const ENV = {
  API_TOKEN_REMINDERS: "true",
  TELEGRAM_BOT_TOKEN: "1:t",
  SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_KEY: "k",
  ADMIN_IDS: "5081175125,7396686285",
};

function backend(tokens) {
  const sent = [];
  const patches = [];
  const fetchImpl = async (url, options = {}) => {
    const href = decodeURIComponent(String(url));
    if (href.startsWith("https://api.telegram.org/")) {
      const body = JSON.parse(options.body);
      sent.push(body);
      return jsonResponse(body.chat_id === "999" ? { ok: false, description: "chat not found" } : { ok: true });
    }
    if (options.method === "PATCH") {
      const id = Number(href.match(/id=eq\.(\d+)/)[1]);
      const row = tokens.find((t) => t.id === id);
      const body = JSON.parse(options.body);
      patches.push({ id, ...body });
      if (row.expiry_reminded_for && Date.parse(row.expiry_reminded_for) === Date.parse(body.expiry_reminded_for)) return jsonResponse([]);
      row.expiry_reminded_for = body.expiry_reminded_for;
      return jsonResponse([row]);
    }
    const lo = href.match(/expires_at\.gt\.([^,]+),/)[1];
    const hi = href.match(/expires_at\.lte\.([^)]+)\)/)[1];
    return jsonResponse(tokens.filter((t) => !t.is_revoked && t.expires_at > lo && t.expires_at <= hi));
  };
  return { fetchImpl, sent, patches };
}

test("api token reminders: once per expiry, owner + admins, only on prod and in daytime", async () => {
  const { runApiTokenReminders, isReminderTick } = await import("../api-token-reminders.mjs");
  const tokens = [
    { id: 1, title: "shop.uz", token_prefix: "mlbb_aa...", expires_at: "2026-12-01T19:00:00.000Z", owner_user_id: 7700, is_revoked: false, expiry_reminded_for: null },
    { id: 2, title: "noowner", token_prefix: "mlbb_bb...", expires_at: "2026-11-30T10:00:00.000Z", owner_user_id: null, is_revoked: false, expiry_reminded_for: null },
    { id: 3, title: "far", token_prefix: "mlbb_cc...", expires_at: "2027-03-01T00:00:00.000Z", owner_user_id: 7701, is_revoked: false, expiry_reminded_for: null },
    { id: 4, title: "revoked", token_prefix: "mlbb_dd...", expires_at: "2026-11-28T00:00:00.000Z", owner_user_id: 7702, is_revoked: true, expiry_reminded_for: null },
    { id: 5, title: "gone", token_prefix: "mlbb_ee...", expires_at: "2026-11-29T00:00:00.000Z", owner_user_id: 999, is_revoked: false, expiry_reminded_for: null },
  ];
  const b = backend(tokens);

  assert.equal((await runApiTokenReminders({ env: { ...ENV, API_TOKEN_REMINDERS: "" }, fetchImpl: b.fetchImpl, now: NOW })).skipped, "disabled");
  assert.equal(isReminderTick(Date.parse("2026-11-25T20:05:00Z")), false, "01:05 Tashkent — night");
  assert.equal(isReminderTick(Date.parse("2026-11-25T05:25:00Z")), false, "not the first tick of the hour");
  assert.equal(isReminderTick(NOW), true);

  const first = await runApiTokenReminders({ env: ENV, fetchImpl: b.fetchImpl, now: NOW });
  assert.deepEqual(first.sent.map((s) => [s.id, s.owner]).sort(), [[1, "sent"], [2, null], [5, "failed"]]);

  const owner = b.sent.find((m) => m.chat_id === "7700");
  assert.match(owner.text, /shop\.uz/);
  assert.match(owner.text, /02\.12\.2026/);
  assert.match(owner.text, /7 kun qoldi/);
  assert.match(owner.text, /@vafoyev_n/);
  const adminMsgs = b.sent.filter((m) => ["5081175125", "7396686285"].includes(m.chat_id));
  assert.equal(adminMsgs.length, 6, "3 tokens × 2 admins");
  assert.ok(adminMsgs.some((m) => /noowner/.test(m.text) && /kiritilmagan/.test(m.text)));
  assert.ok(adminMsgs.some((m) => /gone/.test(m.text) && /yetib bormadi/.test(m.text)));
  assert.ok(!b.sent.some((m) => /far|revoked/.test(m.text)));

  // Keyingi soatda — qayta yuborilmaydi.
  const sentBefore = b.sent.length;
  const second = await runApiTokenReminders({ env: ENV, fetchImpl: b.fetchImpl, now: NOW + 3600000 });
  assert.equal(second.sent.length, 0);
  assert.equal(b.sent.length, sentBefore);

  // Uzaytirildi (yangi expires_at, oyna ichida) — yangi muddat uchun yana bir marta.
  tokens[0].expires_at = "2026-12-02T05:00:00.000Z";
  const third = await runApiTokenReminders({ env: ENV, fetchImpl: b.fetchImpl, now: NOW + 2 * 3600000 });
  assert.deepEqual(third.sent.map((s) => s.id), [1]);
});
