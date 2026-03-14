import { describe, expect, test } from "bun:test";

import { resetConfig } from "./config.ts";
import { parseChatId } from "./server.ts";

describe("send_message/send_file tool allowlist", () => {
  test("parseChatId supports 'me' and usernames", () => {
    expect(parseChatId("me")).toBe("me");
    expect(parseChatId("@neuraldeepchat")).toBe("@neuraldeepchat");
    expect(parseChatId("neuraldeepchat")).toBe("neuraldeepchat");
  });

  test("in mock mode, send_message is allowed for any chat (*)", async () => {
    resetConfig();
    const { isChatAllowed } = await import("./config.ts");
    expect(isChatAllowed("send_message", "me")).toBe(true);
    expect(isChatAllowed("send_message", "@somechat")).toBe(true);
  });

  test("in non-mock mode, missing config denies send_message by default", async () => {
    // bun test is executed with TELEGRAM_MOCK=true by default (see package.json).
    // This test explicitly forces non-mock behavior.
    const prevMock = process.env.TELEGRAM_MOCK;
    const prevConfig = process.env.TELEGRAM_MCP_CONFIG;

    try {
      process.env.TELEGRAM_MOCK = "false";
      // Point to a definitely-missing config path.
      process.env.TELEGRAM_MCP_CONFIG = "./bot-data/__missing_config_for_test__.yml";

      resetConfig();
      const { isChatAllowed } = await import("./config.ts");
      expect(isChatAllowed("send_message", "me")).toBe(false);
    } finally {
      if (prevMock === undefined) delete process.env.TELEGRAM_MOCK;
      else process.env.TELEGRAM_MOCK = prevMock;

      if (prevConfig === undefined) delete process.env.TELEGRAM_MCP_CONFIG;
      else process.env.TELEGRAM_MCP_CONFIG = prevConfig;

      resetConfig();
    }
  });
});
