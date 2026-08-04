import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completeAuthForTests,
  ensureSetupToken,
  handleAuthStatus,
  resetSetupTokenForTests,
} from "./web-auth.ts";
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

describe("web auth credential persistence", () => {
  it("persists runtime API credentials when saving a new session", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-web-auth-"));
    const envFile = join(tempDir, ".env");
    const originalEnvFile = process.env.ENV_FILE;
    const originalApiId = process.env.TELEGRAM_API_ID;
    const originalApiHash = process.env.TELEGRAM_API_HASH;
    const originalSession = process.env.TELEGRAM_SESSION;

    try {
      await writeFile(envFile, "TELEGRAM_SESSION=old-session\n");
      process.env.ENV_FILE = envFile;
      process.env.TELEGRAM_API_ID = "123456";
      process.env.TELEGRAM_API_HASH = "runtime-api-hash";
      process.env.TELEGRAM_SESSION = "old-session";

      await completeAuthForTests(
        { exportSession: async () => "fresh-session" } as never,
        { displayName: "Test User", username: "test" } as never,
      );

      const saved = await readFile(envFile, "utf8");
      expect(saved).toContain("TELEGRAM_API_ID=123456\n");
      expect(saved).toContain("TELEGRAM_API_HASH=runtime-api-hash\n");
      expect(saved).toContain("TELEGRAM_SESSION=fresh-session\n");
    } finally {
      if (originalEnvFile === undefined) delete process.env.ENV_FILE;
      else process.env.ENV_FILE = originalEnvFile;

      if (originalApiId === undefined) delete process.env.TELEGRAM_API_ID;
      else process.env.TELEGRAM_API_ID = originalApiId;

      if (originalApiHash === undefined) delete process.env.TELEGRAM_API_HASH;
      else process.env.TELEGRAM_API_HASH = originalApiHash;

      if (originalSession === undefined) delete process.env.TELEGRAM_SESSION;
      else process.env.TELEGRAM_SESSION = originalSession;

      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
