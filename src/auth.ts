import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { TelegramClient } from "@mtcute/bun";
import qrcode from "qrcode-terminal";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function loadEnv(): Record<string, string> {
  const envPath = ".env";
  const entries: Record<string, string> = {};

  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) entries[match[1]?.trim()] = match[2]?.trim() ?? "";
    }
  }

  return entries;
}

function saveEnv(entries: Record<string, string>) {
  const lines = Object.entries(entries).map(([k, v]) => `${k}=${v}`);
  writeFileSync(".env", `${lines.join("\n")}\n`);
}

function showQr(url: string) {
  qrcode.generate(url, { small: true }, (code: string) => {
    console.log(`\n${code}`);
  });
}

async function main() {
  console.log("\n  Telegram MCP — Auth Setup\n");

  const env = loadEnv();

  const apiId = env.TELEGRAM_API_ID || (await ask("  API ID (from https://my.telegram.org): "));
  const apiHash = env.TELEGRAM_API_HASH || (await ask("  API Hash: "));

  if (!apiId || !apiHash) {
    console.error("\n  Both API ID and API Hash are required.");
    process.exit(1);
  }

  const method = await ask("  Auth method — [1] QR code (recommended)  [2] Phone number: ");

  mkdirSync("bot-data", { recursive: true });

  const client = new TelegramClient({
    apiId: Number(apiId),
    apiHash,
    storage: "bot-data/auth-session",
  });

  let user: { displayName: string; username?: string | null };

  if (method === "2") {
    console.log("\n  Phone auth flow...\n");
    user = await client.start({
      phone: () => ask("  Phone number: "),
      code: () => ask("  Code: "),
      password: () => ask("  2FA Password: "),
      codeSentCallback: (sent) => {
        const hints: Record<string, string> = {
          app: "Check your Telegram app for a message from Telegram",
          sms: "Check your SMS messages",
          call: "You will receive a phone call",
          flash_call: "You will receive a flash call",
          missed_call:
            "You will receive a missed call — the code is the last digits of the phone number",
        };
        const hint = hints[sent.type] ?? `Type: ${sent.type}`;
        console.log(`\n  Code sent via ${sent.type}. ${hint}.\n`);
      },
      invalidCodeCallback: (type) => {
        console.log(`\n  Invalid ${type}, try again.\n`);
      },
    });
  } else {
    console.log("\n  Scan this QR code with Telegram on your phone:");
    console.log("  Open Telegram → Settings → Devices → Link Desktop Device\n");
    user = await client.start({
      qrCodeHandler: (url, expires) => {
        showQr(url);
        const sec = Math.round((expires.getTime() - Date.now()) / 1000);
        console.log(`  Expires in ${sec}s — waiting for scan...\n`);
      },
      password: () => ask("  2FA Password: "),
    });
  }

  console.log(`\n  Logged in as ${user.displayName} (@${user.username ?? "N/A"})`);

  const session = await client.exportSession();

  env.TELEGRAM_API_ID = String(apiId);
  env.TELEGRAM_API_HASH = apiHash;
  env.TELEGRAM_SESSION = session;
  saveEnv(env);

  console.log("  Session saved to .env\n");

  await client.destroy();
  rl.close();
}

main().catch((err) => {
  const errText = err?.text ?? String(err);
  if (/FLOOD_WAIT/i.test(errText)) {
    const seconds = err.seconds ?? "unknown";
    console.error(`\n  Rate limited! Wait ${seconds} seconds before trying again.\n`);
  } else if (/SEND_CODE_UNAVAILABLE/i.test(errText)) {
    console.error("\n  All code delivery methods exhausted. Wait ~24h and try again.\n");
  } else {
    console.error("Error:", err);
  }
  rl.close();
  process.exit(1);
});
