import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isChatAllowed, loadConfig, resetConfig } from "./config.ts";

const TEST_CONFIG_DIR = "bot-data";
const TEST_CONFIG_PATH = `${TEST_CONFIG_DIR}/config.test.yml`;

beforeEach(() => {
  resetConfig();
  // Override config path for tests
  process.env.TELEGRAM_MCP_CONFIG = TEST_CONFIG_PATH;
  // Disable mock mode so we test real config loading
  delete process.env.TELEGRAM_MOCK;
  mkdirSync(TEST_CONFIG_DIR, { recursive: true });
});

afterEach(() => {
  resetConfig();
  delete process.env.TELEGRAM_MCP_CONFIG;
  // Restore mock mode for other test files
  process.env.TELEGRAM_MOCK = "true";
  try {
    rmSync(TEST_CONFIG_PATH);
  } catch {
    // ignore if file doesn't exist
  }
});

describe("loadConfig", () => {
  it("returns empty tools when no config file exists", () => {
    process.env.TELEGRAM_MCP_CONFIG = "nonexistent/config.yml";
    const config = loadConfig();
    expect(config.tools).toEqual({});
  });

  it("parses valid YAML config", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    enabled: true
    allowed_chats:
      - "me"
      - "123456"
`,
    );
    const config = loadConfig();
    expect(config.tools.delete_messages).toEqual({
      enabled: true,
      allowed_chats: ["me", "123456"],
    });
  });

  it("defaults enabled to false when omitted", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    allowed_chats:
      - "me"
`,
    );
    const config = loadConfig();
    expect(config.tools.delete_messages?.enabled).toBe(false);
  });

  it("throws on invalid YAML", () => {
    writeFileSync(TEST_CONFIG_PATH, "{{invalid yaml");
    expect(() => loadConfig()).toThrow("Failed to parse config");
  });

  it("returns permissive config in mock mode", () => {
    process.env.TELEGRAM_MOCK = "true";
    const config = loadConfig();
    expect(config.tools.delete_messages?.enabled).toBe(true);
    expect(config.tools.delete_messages?.allowed_chats).toContain("*");
  });
});

describe("isChatAllowed", () => {
  it("returns false when tool is disabled", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    enabled: false
    allowed_chats:
      - "me"
`,
    );
    loadConfig();
    expect(isChatAllowed("delete_messages", "me")).toBe(false);
  });

  it("returns false when allowed_chats is empty", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    enabled: true
    allowed_chats: []
`,
    );
    loadConfig();
    expect(isChatAllowed("delete_messages", "me")).toBe(false);
  });

  it("returns false when allowed_chats is omitted", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    enabled: true
`,
    );
    loadConfig();
    expect(isChatAllowed("delete_messages", "me")).toBe(false);
  });

  it("allows exact match", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    enabled: true
    allowed_chats:
      - "me"
      - "123456"
`,
    );
    loadConfig();
    expect(isChatAllowed("delete_messages", "me")).toBe(true);
    expect(isChatAllowed("delete_messages", "123456")).toBe(true);
    expect(isChatAllowed("delete_messages", "999")).toBe(false);
  });

  it("normalizes @username", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    enabled: true
    allowed_chats:
      - "@mychannel"
`,
    );
    loadConfig();
    expect(isChatAllowed("delete_messages", "mychannel")).toBe(true);
    expect(isChatAllowed("delete_messages", "@mychannel")).toBe(true);
  });

  it("accepts numeric chatId as number", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    enabled: true
    allowed_chats:
      - "100001"
`,
    );
    loadConfig();
    expect(isChatAllowed("delete_messages", 100001)).toBe(true);
    expect(isChatAllowed("delete_messages", "100001")).toBe(true);
  });

  it("allows wildcard *", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    enabled: true
    allowed_chats:
      - "*"
`,
    );
    loadConfig();
    expect(isChatAllowed("delete_messages", "anything")).toBe(true);
    expect(isChatAllowed("delete_messages", 999)).toBe(true);
  });

  it("is case insensitive", () => {
    writeFileSync(
      TEST_CONFIG_PATH,
      `
tools:
  delete_messages:
    enabled: true
    allowed_chats:
      - "Me"
`,
    );
    loadConfig();
    expect(isChatAllowed("delete_messages", "me")).toBe(true);
    expect(isChatAllowed("delete_messages", "ME")).toBe(true);
  });
});
