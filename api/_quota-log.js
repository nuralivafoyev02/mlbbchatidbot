// ---------------------------------------------------------------------------
// Limitlar tarixi (supabase/018_quota_usage_events.sql).
//
// Bot limit ishlatilganda yoki admin limit berganda bitta qator yozadi —
// shaxsiy kabinet "qaysi limit qaysi akkauntga ketgani"ni shundan ko'rsatadi.
// Yozish xatosi asosiy ishni to'xtatmasligi kerak — chaqiruvchi catch qiladi.
// ---------------------------------------------------------------------------

const QUOTA_KINDS = Object.freeze(["full_info", "reset_pw", "bind_info"]);
const QUOTA_SOURCES = Object.freeze(["use", "admin", "purchase"]);

// "someone@gmail.com" -> "so•••@gmail.com" — tarixda pochta to'liq saqlanmaydi.
function maskEmail(email) {
  const value = String(email || "").trim();
  const at = value.lastIndexOf("@");

  if (at <= 0) {
    return value ? `${value.slice(0, 2)}•••` : "";
  }

  const local = value.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}•••${value.slice(at)}`.slice(0, 120);
}

function cleanId(value, pattern) {
  const text = String(value ?? "").trim();
  return pattern.test(text) ? text : null;
}

function buildQuotaEvent({ userId, kind, delta, source = "use", accountId, zoneId, target, remaining } = {}) {
  const user = cleanId(userId, /^\d{1,20}$/);
  const amount = Number(delta);

  if (!user || !QUOTA_KINDS.includes(kind) || !QUOTA_SOURCES.includes(source) || !Number.isInteger(amount) || amount === 0) {
    return null;
  }

  return {
    user_id: user,
    kind,
    delta: amount,
    source,
    account_id: cleanId(accountId, /^\d{1,20}$/),
    zone_id: cleanId(zoneId, /^\d{1,10}$/),
    target: target ? String(target).slice(0, 120) : null,
    remaining: Number.isInteger(remaining) ? remaining : null,
  };
}

// requestFn — Supabase REST so'rovchisi: (path, { method, body, prefer }) => data
async function logQuotaEvent(requestFn, input) {
  const event = buildQuotaEvent(input);

  if (!event) {
    return false;
  }

  await requestFn("/quota_usage_events", {
    method: "POST",
    body: event,
    prefer: "return=minimal",
  });

  return true;
}

module.exports = {
  QUOTA_KINDS,
  buildQuotaEvent,
  logQuotaEvent,
  maskEmail,
};
