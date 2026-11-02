const assert = require("node:assert/strict");
const test = require("node:test");

const { JebrayResellerError, requestDeviceLogout } = require("../api/_jebray-reseller.js");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("Jebray device logout sends only the selected step and keeps the reseller key server-side", async () => {
  const calls = [];
  const result = await requestDeviceLogout({
    type: "send-code",
    email: "owner@example.test",
    password: "Pass1234",
    code: "111111",
  }, {
    apiKey: "test-reseller-key",
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse({ success: true, message: "Verification code sent to email" });
    },
  });

  assert.deepEqual(result, { ok: true, type: "send-code", cost: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.jebray.com/reseller/v1/logout");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["X-API-Key"], "test-reseller-key");
  assert.deepEqual(calls[0].body, {
    type: "send-code",
    email: "owner@example.test",
    password: "Pass1234",
  });
});

test("Jebray device logout rejects invalid inputs before making a provider request", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ success: true });
  };
  const options = { apiKey: "test-reseller-key", fetchImpl };

  await assert.rejects(
    requestDeviceLogout({ type: "send-code", email: "owner@example.test", password: "weak" }, options),
    (error) => error instanceof JebrayResellerError && error.reason === "invalid_password"
  );
  await assert.rejects(
    requestDeviceLogout({ type: "verify-code1", email: "owner@example.test", code: "12ab" }, options),
    (error) => error instanceof JebrayResellerError && error.reason === "invalid_code"
  );
  await assert.rejects(
    requestDeviceLogout({ type: "cancel", email: "bad-email" }, options),
    (error) => error instanceof JebrayResellerError && error.reason === "invalid_email"
  );
  assert.equal(calls, 0);
});

test("Jebray final-step transport failure is reported as an unknown outcome without retry", async () => {
  let calls = 0;
  await assert.rejects(
    requestDeviceLogout({ type: "verify-code2", email: "owner@example.test", code: "123456" }, {
      apiKey: "test-reseller-key",
      fetchImpl: async () => {
        calls += 1;
        throw new Error("connection lost");
      },
    }),
    (error) => error instanceof JebrayResellerError && error.reason === "result_unknown"
  );
  assert.equal(calls, 1);
});

test("Jebray final-step response exposes only documented cost, not arbitrary provider fields", async () => {
  const result = await requestDeviceLogout({
    type: "verify-code2",
    email: "owner@example.test",
    code: "654321",
  }, {
    apiKey: "test-reseller-key",
    fetchImpl: async () => jsonResponse({
      success: true,
      message: "All devices logged out successfully",
      cost: 25000,
      balance_after: 405000,
      password: "should-not-be-returned",
    }),
  });

  assert.deepEqual(result, { ok: true, type: "verify-code2", cost: 25000 });
});
