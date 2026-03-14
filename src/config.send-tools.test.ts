import { describe, expect, test } from "bun:test";

import { resetConfig } from "./config.ts";

describe("mock write tools", () => {
  test("mock config allows send_message and send_file", async () => {
    resetConfig();
    const { isChatAllowed } = await import("./config.ts");

    expect(isChatAllowed("send_message", "me")).toBe(true);
    expect(isChatAllowed("send_file", "me")).toBe(true);
  });
});
