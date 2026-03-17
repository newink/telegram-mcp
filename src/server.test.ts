import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildAuthUrl, createMcpServer } from "./server.ts";
import { resetTelegramState, setAuthRevokedStateForTests } from "./telegram.ts";
import { resetSetupTokenForTests } from "./web-auth.ts";

const ENV_KEYS = [
  "PUBLIC_BASE_URL",
  "TELEGRAM_MOCK",
  "TELEGRAM_SESSION",
  "TRUSTED_PROXY_IPS",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

async function createConnectedClient(
  request: Request,
  peerIp: string | null,
  port = 3000,
): Promise<{ client: Client; server: ReturnType<typeof createMcpServer> }> {
  const server = createMcpServer({ request, peerIp, port });
  const client = new Client({
    name: "server-test-client",
    version: "0.1.0",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return { client, server };
}

describe("server auth required mapping", () => {
  let originalEnv: Partial<Record<EnvKey, string | undefined>>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    resetTelegramState();
    resetSetupTokenForTests();

    delete process.env.PUBLIC_BASE_URL;
    delete process.env.TELEGRAM_MOCK;
    delete process.env.TELEGRAM_SESSION;
    delete process.env.TRUSTED_PROXY_IPS;
  });

  afterEach(() => {
    resetTelegramState();
    resetSetupTokenForTests();

    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  it("maps revoked sessions to a -32001 MCP error with authRequired metadata", async () => {
    process.env.PUBLIC_BASE_URL = "https://public.example.com";
    setAuthRevokedStateForTests({
      reason: "SESSION_REVOKED",
      revokedAt: "2026-03-11T00:00:00.000Z",
      session: "revoked-session",
    });

    const { client, server } = await createConnectedClient(
      new Request("http://localhost/mcp"),
      null,
    );

    try {
      await expect(
        client.callTool({
          name: "search_dialogs",
          arguments: { query: "alice", limit: 1 },
        }),
      ).rejects.toMatchObject({
        code: -32001,
        message: expect.stringContaining(
          "Telegram session expired or was revoked. Re-authentication is required.",
        ),
        data: expect.objectContaining({
          authRequired: true,
          reason: "SESSION_REVOKED",
          revokedAt: "2026-03-11T00:00:00.000Z",
          authUrl: expect.stringMatching(
            /^https:\/\/public\.example\.com\/auth\?token=[0-9a-f-]+$/,
          ),
        }),
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("builds auth URLs from trusted proxy headers when PUBLIC_BASE_URL is unset", () => {
    process.env.TRUSTED_PROXY_IPS = "127.0.0.1,10.0.0.0/8";

    const authUrl = buildAuthUrl({
      request: new Request("http://localhost/mcp", {
        headers: {
          "x-forwarded-for": "203.0.113.10, 10.2.3.4",
          "x-forwarded-host": "proxy.example.com",
          "x-forwarded-proto": "https",
        },
      }),
      peerIp: "127.0.0.1",
      port: 3000,
    });

    expect(authUrl).toMatch(/^https:\/\/proxy\.example\.com\/auth\?token=[0-9a-f-]+$/);
  });

  it("falls back to localhost auth URLs when proxy headers are untrusted", async () => {
    process.env.TRUSTED_PROXY_IPS = "10.0.0.0/8";
    setAuthRevokedStateForTests({
      reason: "SESSION_EXPIRED",
      revokedAt: "2026-03-11T01:00:00.000Z",
      session: "expired-session",
    });

    const request = new Request("http://localhost/mcp", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.2.3.4",
        "x-forwarded-host": "ignored.example.com",
        "x-forwarded-proto": "https",
      },
    });
    const { client, server } = await createConnectedClient(request, "192.0.2.5", 4321);

    try {
      await expect(
        client.callTool({
          name: "search_dialogs",
          arguments: { query: "alice", limit: 1 },
        }),
      ).rejects.toMatchObject({
        code: -32001,
        data: expect.objectContaining({
          authRequired: true,
          reason: "SESSION_EXPIRED",
          authUrl: expect.stringMatching(/^http:\/\/localhost:4321\/auth\?token=[0-9a-f-]+$/),
        }),
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("sanitizes send_file upload errors before returning them to MCP clients", async () => {
    process.env.TELEGRAM_MOCK = "true";

    const { client, server } = await createConnectedClient(
      new Request("http://localhost/mcp"),
      null,
    );
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-mcp-send-file-"));
    const filePath = join(tempDir, "__mock_eacces__.txt");
    await writeFile(filePath, "test");

    try {
      const result = await client.callTool({
        name: "send_file",
        arguments: {
          chatId: "me",
          filePath,
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: "text",
          text: "File upload failed: permission denied",
        },
      ]);
      expect(JSON.stringify(result)).not.toContain(filePath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await Promise.all([client.close(), server.close()]);
    }
  });
});
