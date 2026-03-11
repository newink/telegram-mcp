import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelegramClient, tl } from "@mtcute/bun";
import {
  TERMINAL_AUTH_TEXTS,
  TelegramSessionExpiredError,
  attachAuthExpiryHandler,
  autoLogoutCurrentSession,
  getAuthFailureReason,
  getTelegramClient,
  resetTelegramState,
  setAuthCleanupPromiseForTests,
  setAuthRevokedStateForTests,
  setCleanupTimeoutMsForTests,
  setCurrentSessionForTests,
} from "./telegram.ts";
import { resetSetupTokenForTests } from "./web-auth.ts";

const ORIGINAL_CWD = process.cwd();
const ENV_KEYS = [
  "ENV_FILE",
  "PUBLIC_BASE_URL",
  "TELEGRAM_API_HASH",
  "TELEGRAM_API_ID",
  "TELEGRAM_MOCK",
  "TELEGRAM_SESSION",
  "TRUSTED_PROXY_IPS",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

type Deferred<T> = {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
};

type FakeClient = {
  calls: {
    destroy: number;
    disconnect: number;
    logOut: number;
    notifyLoggedOut: number;
  };
  client: TelegramClient;
  emit(err: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function createFakeClient(options?: {
  destroy?(): Promise<void>;
  disconnect?(): Promise<void>;
  logOut?(): Promise<void>;
  notifyLoggedOut?(): Promise<void>;
}): FakeClient {
  const listeners: Array<(err: unknown) => void> = [];
  const calls = {
    destroy: 0,
    disconnect: 0,
    logOut: 0,
    notifyLoggedOut: 0,
  };

  return {
    calls,
    client: {
      async destroy() {
        calls.destroy += 1;
        await options?.destroy?.();
      },
      async disconnect() {
        calls.disconnect += 1;
        await options?.disconnect?.();
      },
      async logOut() {
        calls.logOut += 1;
        await options?.logOut?.();
      },
      async notifyLoggedOut() {
        calls.notifyLoggedOut += 1;
        await options?.notifyLoggedOut?.();
      },
      onError: {
        add(listener: (err: unknown) => void) {
          listeners.push(listener);
        },
      },
    } as unknown as TelegramClient,
    emit(err: unknown) {
      for (const listener of listeners) {
        listener(err);
      }
    },
  };
}

function writeRuntimeArtifacts(session = "revoked-session"): void {
  mkdirSync("bot-data", { recursive: true });
  writeFileSync(process.env.ENV_FILE!, `TELEGRAM_SESSION=${session}\nKEEP=1\n`);
  process.env.TELEGRAM_SESSION = session;
  writeFileSync("bot-data/session", "runtime");
  writeFileSync("bot-data/session-wal", "runtime-wal");
  writeFileSync("bot-data/session-shm", "runtime-shm");
  writeFileSync("bot-data/auth-session", "auth");
  writeFileSync("bot-data/auth-session-wal", "auth-wal");
  writeFileSync("bot-data/web-auth-session", "web-auth");
  writeFileSync("bot-data/web-auth-session-wal", "web-auth-wal");
}

function expectRuntimeArtifactsRemoved(): void {
  expect(existsSync("bot-data/session")).toBe(false);
  expect(existsSync("bot-data/session-wal")).toBe(false);
  expect(existsSync("bot-data/session-shm")).toBe(false);
  expect(process.env.TELEGRAM_SESSION).toBeUndefined();
  expect(readFileSync(process.env.ENV_FILE!, "utf8")).toBe("KEEP=1\n");
}

function expectAuthArtifactsRemain(): void {
  expect(existsSync("bot-data/auth-session")).toBe(true);
  expect(existsSync("bot-data/auth-session-wal")).toBe(true);
  expect(existsSync("bot-data/web-auth-session")).toBe(true);
  expect(existsSync("bot-data/web-auth-session-wal")).toBe(true);
}

function createRpcError(code: number, text: string): tl.RpcError {
  return new tl.RpcError(code, text as never);
}

describe("telegram auth revoke", () => {
  let tempDir: string;
  let originalEnv: Partial<Record<EnvKey, string | undefined>>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    tempDir = mkdtempSync(join(tmpdir(), "telegram-auth-revoke-"));
    process.chdir(tempDir);

    resetTelegramState();
    resetSetupTokenForTests();

    process.env.ENV_FILE = join(tempDir, ".env");
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.TELEGRAM_API_HASH;
    delete process.env.TELEGRAM_API_ID;
    delete process.env.TELEGRAM_MOCK;
    delete process.env.TELEGRAM_SESSION;
    delete process.env.TRUSTED_PROXY_IPS;
  });

  afterEach(() => {
    resetTelegramState();
    resetSetupTokenForTests();
    process.chdir(ORIGINAL_CWD);
    rmSync(tempDir, { force: true, recursive: true });

    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  it("matches the exact terminal auth text allowlist", () => {
    expect(new Set(TERMINAL_AUTH_TEXTS)).toEqual(
      new Set([
        "AUTH_KEY_UNREGISTERED",
        "AUTH_KEY_INVALID",
        "AUTH_KEY_PERM_EMPTY",
        "AUTH_KEY_DUPLICATED",
        "SESSION_REVOKED",
        "SESSION_EXPIRED",
        "USER_DEACTIVATED",
      ]),
    );
    expect(TERMINAL_AUTH_TEXTS.has("USER_DEACTIVATED_BAN")).toBe(false);
    expect(getAuthFailureReason(createRpcError(tl.RpcError.UNAUTHORIZED, "SESSION_REVOKED"))).toBe(
      "SESSION_REVOKED",
    );
    expect(getAuthFailureReason(createRpcError(tl.RpcError.NOT_ACCEPTABLE, "AUTH_KEY_DUPLICATED"))).toBe(
      "AUTH_KEY_DUPLICATED",
    );
    expect(
      getAuthFailureReason(createRpcError(tl.RpcError.UNAUTHORIZED, "USER_DEACTIVATED_BAN")),
    ).toBeNull();
  });

  it("ignores unknown 401 auth errors without starting cleanup", async () => {
    const fake = createFakeClient();

    writeRuntimeArtifacts("still-valid-session");
    setCurrentSessionForTests("still-valid-session");
    attachAuthExpiryHandler(fake.client);

    fake.emit(createRpcError(tl.RpcError.UNAUTHORIZED, "SESSION_PASSWORD_NEEDED"));
    await Bun.sleep(0);

    expect(fake.calls.logOut).toBe(0);
    expect(fake.calls.notifyLoggedOut).toBe(0);
    expect(fake.calls.destroy).toBe(0);
    expect(process.env.TELEGRAM_SESSION).toBe("still-valid-session");
    expect(existsSync("bot-data/session")).toBe(true);
  });

  it("fails fast when the current runtime session is still revoked", async () => {
    setAuthRevokedStateForTests({
      reason: "SESSION_REVOKED",
      revokedAt: "2026-03-11T00:00:00.000Z",
      session: "revoked-session",
    });
    process.env.TELEGRAM_SESSION = "revoked-session";

    await expect(getTelegramClient()).rejects.toEqual(
      expect.objectContaining({
        name: "TelegramSessionExpiredError",
        reason: "SESSION_REVOKED",
        revokedAt: "2026-03-11T00:00:00.000Z",
      }),
    );
  });

  it("times out while waiting for auth cleanup to finish", async () => {
    setCleanupTimeoutMsForTests(25);
    setAuthCleanupPromiseForTests(new Promise(() => undefined));

    await expect(getTelegramClient()).rejects.toThrow("auth cleanup timed out after 25ms");
  });

  it("deduplicates concurrent revoke cleanup triggered by repeated auth errors", async () => {
    const logoutGate = createDeferred<void>();
    const cleanupDone = createDeferred<void>();
    const fake = createFakeClient({
      async destroy() {
        cleanupDone.resolve(undefined);
      },
      async logOut() {
        await logoutGate.promise;
      },
    });

    writeRuntimeArtifacts();
    setCurrentSessionForTests("revoked-session");
    attachAuthExpiryHandler(fake.client);

    fake.emit(createRpcError(tl.RpcError.UNAUTHORIZED, "SESSION_REVOKED"));
    fake.emit(createRpcError(tl.RpcError.UNAUTHORIZED, "SESSION_REVOKED"));

    expect(fake.calls.logOut).toBe(1);

    logoutGate.resolve(undefined);
    await cleanupDone.promise;
    await Bun.sleep(10);

    expect(fake.calls.notifyLoggedOut).toBe(0);
    expect(fake.calls.destroy).toBe(1);
    expectRuntimeArtifactsRemoved();
  });

  it("removes runtime session artifacts but leaves auth flow session files intact", async () => {
    const fake = createFakeClient();

    writeRuntimeArtifacts();
    setCurrentSessionForTests("revoked-session");

    await autoLogoutCurrentSession(fake.client, "SESSION_REVOKED");

    expect(fake.calls.logOut).toBe(1);
    expect(fake.calls.destroy).toBe(1);
    expectRuntimeArtifactsRemoved();
    expectAuthArtifactsRemain();
  });

  it("falls back to notifyLoggedOut when logOut fails and still blocks client recreation", async () => {
    const fake = createFakeClient({
      async logOut() {
        throw new Error("logOut failed");
      },
    });

    writeRuntimeArtifacts();
    setCurrentSessionForTests("revoked-session");

    await autoLogoutCurrentSession(fake.client, "SESSION_REVOKED");

    expect(fake.calls.logOut).toBe(1);
    expect(fake.calls.notifyLoggedOut).toBe(1);
    expect(fake.calls.destroy).toBe(1);
    expectRuntimeArtifactsRemoved();
    expectAuthArtifactsRemain();

    await expect(getTelegramClient()).rejects.toBeInstanceOf(TelegramSessionExpiredError);
  });

  it("still clears runtime state when both logOut and notifyLoggedOut fail", async () => {
    const fake = createFakeClient({
      async logOut() {
        throw new Error("logOut failed");
      },
      async notifyLoggedOut() {
        throw new Error("notifyLoggedOut failed");
      },
    });

    writeRuntimeArtifacts();
    setCurrentSessionForTests("revoked-session");

    await autoLogoutCurrentSession(fake.client, "SESSION_REVOKED");

    expect(fake.calls.logOut).toBe(1);
    expect(fake.calls.notifyLoggedOut).toBe(1);
    expect(fake.calls.destroy).toBe(1);
    expectRuntimeArtifactsRemoved();
    expectAuthArtifactsRemain();

    await expect(getTelegramClient()).rejects.toBeInstanceOf(TelegramSessionExpiredError);
  });
});
