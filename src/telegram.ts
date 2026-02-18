import { TelegramClient } from "@mtcute/bun";

let client: TelegramClient | null = null;

export async function getTelegramClient(): Promise<TelegramClient> {
  if (client) return client;

  // Mock mode: return fake client with in-memory data
  if (process.env.TELEGRAM_MOCK === "true") {
    const { createMockClient } = await import("./mock/client.ts");
    const mockClient = createMockClient() as unknown as TelegramClient;
    client = mockClient;
    console.log("Using mock Telegram client");
    return client;
  }

  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const session = process.env.TELEGRAM_SESSION;

  if (!apiId || !apiHash) {
    throw new Error(
      "TELEGRAM_API_ID and TELEGRAM_API_HASH env vars are required. Run `bun auth` first.",
    );
  }

  if (!session) {
    throw new Error("TELEGRAM_SESSION env var is required. Run `bun auth` first.");
  }

  client = new TelegramClient({
    apiId,
    apiHash: apiHash as string,
    storage: "bot-data/session",
  });

  console.log("Importing Telegram session...");
  await client.importSession(session);

  console.log("Connecting to Telegram...");
  await client.connect();
  console.log("Connected to Telegram.");

  return client;
}
