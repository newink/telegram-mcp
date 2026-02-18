import { describe, expect, it } from "bun:test";

describe("smoke", () => {
  it("mock mode is enabled in test", () => {
    expect(process.env.TELEGRAM_MOCK).toBe("true");
  });
});
