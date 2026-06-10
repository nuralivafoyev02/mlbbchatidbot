const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

loadEnvFile(path.join(__dirname, "..", ".env"));

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = String(process.env.TELEGRAM_API_HASH || "").trim();

if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
  console.error("TELEGRAM_API_ID va TELEGRAM_API_HASH envlarini kiriting.");
  process.exit(1);
}

const rl = readline.createInterface({ input, output });
const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
});

async function ask(question) {
  return (await rl.question(question)).trim();
}

async function main() {
  try {
    await client.start({
      phoneNumber: () => ask("Telegram telefon raqami (+998...): "),
      password: () => ask("2FA parol bo‘lsa kiriting: "),
      phoneCode: () => ask("Telegram kod: "),
      onError: (error) => console.error(error),
    });

    console.log("");
    console.log("TELEGRAM_SESSION quyida:");
    console.log(client.session.save());
    console.log("");
    console.log("Bu qiymatni hosting env secret sifatida saqlang, repo'ga yozmang.");
  } finally {
    rl.close();
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const text = fs.readFileSync(filePath, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
