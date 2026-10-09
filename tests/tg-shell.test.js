const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { SHELL_MARKER, injectTelegramShell } = require("../api/_tg-shell.js");

test("tg-shell: replaces the marker with style + script", () => {
  const html = injectTelegramShell(`<head>${SHELL_MARKER}</head>`, { color: "#0b1020" });

  assert.ok(!html.includes(SHELL_MARKER));
  assert.match(html, /<style id="tg-shell-style">/);
  assert.match(html, /<script id="tg-shell-script">/);
  assert.match(html, /requestFullscreen/);
  assert.match(html, /setHeaderColor\("#0b1020"\)/);
  assert.match(html, /--top-space/);
  assert.match(html, /MLBBBOT/);
});

test("tg-shell: ignores invalid colors and pages without the marker", () => {
  const html = injectTelegramShell(`<head>${SHELL_MARKER}</head>`, { color: "red;</script>" });
  assert.match(html, /setHeaderColor\("#0a0e1a"\)/);
  assert.equal(injectTelegramShell("<head></head>"), "<head></head>");
});

test("tg-shell: both mini apps carry the marker and never force exitFullscreen", () => {
  for (const file of ["index.html", "account-miniapp.html"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "api", file), "utf8");
    assert.ok(source.includes(SHELL_MARKER), `${file}: marker yo'q`);
    assert.ok(!source.includes("exitFullscreen"), `${file}: exitFullscreen qolib ketgan`);
  }
});
