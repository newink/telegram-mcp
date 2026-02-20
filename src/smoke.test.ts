import { describe, expect, it } from "bun:test";
import { createMockClient } from "./mock/client.ts";

describe("smoke", () => {
  it("mock mode is enabled in test", () => {
    expect(process.env.TELEGRAM_MOCK).toBe("true");
  });
});

describe("search_messages", () => {
  it("finds messages matching query globally", async () => {
    const client = createMockClient();
    const results = [];
    for await (const msg of client.iterSearchMessages({ query: "bug" })) {
      results.push(msg);
    }
    expect(results.length).toBeGreaterThan(0);
    for (const msg of results) {
      expect(msg.text.toLowerCase()).toContain("bug");
    }
  });

  it("scopes search to a specific chat", async () => {
    const client = createMockClient();
    const results = [];
    for await (const msg of client.iterSearchMessages({ chatId: 100002, query: "bug" })) {
      results.push(msg);
    }
    expect(results.length).toBe(1);
    expect(results[0]!.chat.displayName).toBe("Bob Smith");
  });

  it("returns empty when no messages match", async () => {
    const client = createMockClient();
    const results = [];
    for await (const msg of client.iterSearchMessages({ query: "xyznonexistent" })) {
      results.push(msg);
    }
    expect(results.length).toBe(0);
  });
});
