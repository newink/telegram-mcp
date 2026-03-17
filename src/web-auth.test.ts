import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ensureSetupToken, handleAuthStatus, resetSetupTokenForTests } from "./web-auth.ts";
import { getAuthPageHtml } from "./web-auth-page.ts";

describe("web auth SSE status stream", () => {
  let token: string;

  beforeEach(() => {
    resetSetupTokenForTests();
    token = ensureSetupToken();
  });

  afterEach(() => {
    resetSetupTokenForTests();
  });

  it("does not emit a placeholder waiting event when the SSE stream opens", async () => {
    const response = handleAuthStatus(
      new Request(`http://localhost/auth/status?token=${token}`),
      new URL(`http://localhost/auth/status?token=${token}`),
    );

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const firstRead = reader!.read().then(() => "chunk");
    const outcome = await Promise.race([
      firstRead,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 25)),
    ]);

    expect(outcome).toBe("timeout");
    await reader!.cancel();
  });
});

describe("web auth page QR state handling", () => {
  it("guards the waiting state until a real QR image is visible", () => {
    const html = getAuthPageHtml("test-token");

    expect(html).toContain(
      "currentStep === 'qr' && document.getElementById('qr-img').style.display !== 'none'",
    );
  });
});
