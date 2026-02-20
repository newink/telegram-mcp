import { TelegramClient } from "@mtcute/bun";
import { log } from "./logger.ts";

let client: TelegramClient | null = null;

export async function getTelegramClient(): Promise<TelegramClient> {
  if (client) return client;

  // Mock mode: return fake client with in-memory data
  if (process.env.TELEGRAM_MOCK === "true") {
    const { createMockClient } = await import("./mock/client.ts");
    const mockClient = createMockClient() as unknown as TelegramClient;
    client = mockClient;
    log.info("using mock telegram client");
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
    disableUpdates: true,
  });

  log.info("importing telegram session");
  await client.importSession(session);

  log.info("connecting to telegram");
  await client.connect();
  log.info("connected to telegram");

  return client;
}
