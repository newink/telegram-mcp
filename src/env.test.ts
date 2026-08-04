import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEnvFileToProcess } from "./env.ts";

describe("applyEnvFileToProcess", () => {
  const originalEnvFile = process.env.ENV_FILE;
  const originalSession = process.env.TELEGRAM_SESSION;

  afterEach(() => {
    if (originalEnvFile === undefined) delete process.env.ENV_FILE;
    else process.env.ENV_FILE = originalEnvFile;

    if (originalSession === undefined) delete process.env.TELEGRAM_SESSION;
    else process.env.TELEGRAM_SESSION = originalSession;
  });

  it("loads missing runtime environment values from ENV_FILE", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-mcp-env-"));
    const envFile = join(tempDir, ".env");

    try {
      await writeFile(envFile, "TELEGRAM_SESSION=saved-session\n");
      process.env.ENV_FILE = envFile;
      delete process.env.TELEGRAM_SESSION;

      applyEnvFileToProcess();

      const env = process.env as Record<string, string | undefined>;
      expect(env.TELEGRAM_SESSION).toBe("saved-session");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
