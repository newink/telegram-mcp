import { TelegramClient } from "@mtcute/bun";
import { Dispatcher } from "@mtcute/dispatcher";

let client: TelegramClient | null = null;
let dispatcher: Dispatcher | null = null;

export async function getTelegramClient(): Promise<TelegramClient> {
  if (client) return client;

  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const session = process.env.TELEGRAM_SESSION;

  if (!apiId || !apiHash) {
    throw new Error(
      "TELEGRAM_API_ID and TELEGRAM_API_HASH env vars are required. Run `bun auth` first.",
    );
  }

  if (!session) {
    throw new Error(
      "TELEGRAM_SESSION env var is required. Run `bun auth` first.",
    );
  }

  client = new TelegramClient({
    apiId,
    apiHash: apiHash!,
    storage: "bot-data/session",
  });

  console.log("Importing Telegram session...");
  await client.importSession(session);

  console.log("Connecting to Telegram...");
  await client.connect();
  console.log("Connected to Telegram.");

  dispatcher = Dispatcher.for(client);

  return client;
}

export function getDispatcher(): Dispatcher {
  if (!dispatcher) throw new Error("Telegram client not initialized");
  return dispatcher;
}
