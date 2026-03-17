import { describe, expect, it } from "bun:test";
import { parseChatId } from "./server.ts";

describe("parseChatId", () => {
  it("converts positive numeric string to bigint", () => {
    expect(parseChatId("123456")).toBe(123456n);
  });

  it("converts negative numeric string to bigint", () => {
    expect(parseChatId("-1002402061247")).toBe(-1002402061247n);
  });

  it("keeps @username as string", () => {
    expect(parseChatId("@username")).toBe("@username");
  });

  it("keeps plain username as string", () => {
    expect(parseChatId("username")).toBe("username");
  });

  it("converts zero to bigint", () => {
    expect(parseChatId("0")).toBe(0n);
  });

  it("keeps string with mixed digits and letters as string", () => {
    expect(parseChatId("abc123")).toBe("abc123");
  });

  it("keeps empty string as string", () => {
    expect(parseChatId("")).toBe("");
  });

  it("keeps string with spaces as string", () => {
    expect(parseChatId("123 456")).toBe("123 456");
  });

  it("converts single digit negative to bigint", () => {
    expect(parseChatId("-1")).toBe(-1n);
  });

  it("preserves precision for large numeric IDs", () => {
    expect(parseChatId("9007199254740993")).toBe(9007199254740993n);
  });

  it("keeps bare minus sign as string", () => {
    expect(parseChatId("-")).toBe("-");
  });
});
