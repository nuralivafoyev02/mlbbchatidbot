const assert = require("node:assert/strict");
const test = require("node:test");

const donat = require("../api/_donat.js");
const shop = require("../api/_shop.js");

// Soxta Supabase: faqat bot_settings jadvali.
function createFakeBotSettings() {
  const rows = new Map();

  function handle(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const url = new URL(`https://fake.local/rest/v1${path}`);
    const keyFilter = url.searchParams.get("key") || "";

    if (method === "GET") {
      if (keyFilter.startsWith("eq.")) {
        const row = rows.get(keyFilter.slice(3));
        return row ? [JSON.parse(JSON.stringify(row))] : [];
      }

      if (keyFilter.startsWith("like.")) {
        const prefix = keyFilter.slice(5).replace(/\*$/, "");
        return [...rows.values()]
          .filter((row) => row.key.startsWith(prefix))
          .map((row) => JSON.parse(JSON.stringify(row)));
      }

      return [...rows.values()];
    }

    if (method === "POST") {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      const row = JSON.parse(JSON.stringify({ key: body.key, value: body.value, updated_at: body.updated_at }));
      rows.set(row.key, row);
      return [row];
    }

    if (method === "DELETE") {
      rows.delete(keyFilter.slice(3));
      return [];
    }

    return [];
  }

  return { rows, handle };
}

test("donat: parseMarkup accepts percents and rejects junk", () => {
  assert.equal(donat.parseMarkup("15"), 15);
  assert.equal(donat.parseMarkup("12,5%"), 12.5);
  assert.equal(donat.parseMarkup(""), null);
  assert.equal(donat.parseMarkup(null), null);
  assert.ok(Number.isNaN(donat.parseMarkup("-5")));
  assert.ok(Number.isNaN(donat.parseMarkup("abc")));
  assert.ok(Number.isNaN(donat.parseMarkup("1001")));
});

test("donat: computePackPrice rounds to whole so'm", () => {
  assert.deepEqual(donat.computePackPrice(15000, 15), { cost: 15000, markup: 15, price: 17250, profit: 2250 });
  assert.deepEqual(donat.computePackPrice(9999, 12.5), { cost: 9999, markup: 12.5, price: 11249, profit: 1250 });
  assert.equal(donat.computePackPrice(1000, 0).price, 1000);
});

test("donat: game + packs CRUD with default and custom markup", async () => {
  const fake = createFakeBotSettings();
  const store = donat.createDonatStore(fake.handle);

  const created = await store.saveGame({ name: "Mobile Legends", markup: "10" });
  assert.equal(created.ok, true);
  const gameId = created.game.id;
  assert.ok(fake.rows.has(`shop_dn:${gameId}`));

  assert.equal((await store.saveGame({ name: "mobile legends" })).error, "game_exists");
  assert.equal((await store.saveGame({ name: "" })).error, "game_name_required");

  let result = await store.savePack(gameId, { name: "257 diamonds", cost: "50 000" });
  assert.equal(result.ok, true);
  result = await store.savePack(gameId, { name: "86 diamonds", cost: "15000", markup: "20" });
  assert.equal(result.ok, true);

  const [cheap, big] = result.game.packs;
  assert.equal(cheap.name, "86 diamonds", "packs sorted by cost");
  assert.equal(cheap.markup, 20);
  assert.equal(cheap.price, 18000);
  assert.equal(big.markup, null);
  assert.equal(big.effective_markup, 10);
  assert.equal(big.price, 55000);
  assert.equal(big.profit, 5000);

  // O'yin foizi o'zgarsa — faqat standart foizli paketlar narxi o'zgaradi.
  await store.saveGame({ id: gameId, name: "Mobile Legends", markup: "5" });
  const game = await store.get(gameId);
  assert.equal(game.packs.find((p) => p.id === big.id).price, 52500);
  assert.equal(game.packs.find((p) => p.id === cheap.id).price, 18000);

  // Hisoblangan maydonlar bazaga yozilmaydi.
  const stored = fake.rows.get(`shop_dn:${gameId}`).value;
  assert.equal(stored.packs[0].price, undefined);

  assert.equal((await store.savePack(gameId, { name: "x", cost: "0" })).error, "cost_invalid");
  assert.equal((await store.savePack(gameId, { name: "x", cost: "100", markup: "abc" })).error, "markup_invalid");
  assert.equal((await store.savePack(gameId, { name: "86 Diamonds", cost: "100" })).error, "pack_exists");
  assert.equal((await store.savePack("nope000", { name: "x", cost: "100" })).error, "game_not_found");

  const edited = await store.savePack(gameId, { id: cheap.id, name: "86 diamonds", cost: "16000", markup: "" });
  assert.equal(edited.game.packs.find((p) => p.id === cheap.id).markup, null);

  const removed = await store.removePack(gameId, cheap.id);
  assert.equal(removed.game.packs.length, 1);
  assert.equal((await store.removePack(gameId, cheap.id)).error, "pack_not_found");

  assert.deepEqual(donat.summarizeGames(await store.list()), { games: 1, packs: 1 });
  await store.removeGame(gameId);
  assert.equal((await store.list()).length, 0);
});

test("donat: data stays invisible to the bot's Firstmail store", async () => {
  const fake = createFakeBotSettings();
  await donat.createDonatStore(fake.handle).saveGame({ name: "PUBG", markup: "10" });
  await shop.createFirstmailStore(fake.handle).create({ email: "a@firstmail.ltd", price: "1000" });

  const firstmails = await shop.createFirstmailStore(fake.handle).list();
  assert.equal(firstmails.length, 1);
  assert.equal(firstmails[0].email, "a@firstmail.ltd");
});
