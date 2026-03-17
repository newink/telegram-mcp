import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { TelegramClient, tl } from "@mtcute/bun";
import { loadEnv, saveEnv } from "./env.ts";
import { log } from "./logger.ts";

const AUTH_CLEANUP_TIMEOUT_MS = 10_000;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const AUTHORIZATION_TTL_DAYS = 365;

export const TERMINAL_AUTH_TEXTS = new Set([
  "AUTH_KEY_UNREGISTERED",
  "AUTH_KEY_INVALID",
  "AUTH_KEY_PERM_EMPTY",
  "AUTH_KEY_DUPLICATED",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "USER_DEACTIVATED",
]);

type AuthRevokedState = {
  reason: string;
  revokedAt: string;
  session: string | null;
};

type TelegramAuthRequiredError = {
  readonly type: "telegram_auth_required";
  readonly reason: string;
  readonly revokedAt: string;
};

let client: TelegramClient | null = null;
let authCleanupPromise: Promise<void> | null = null;
let currentSession: string | null = null;
let authRevokedState: AuthRevokedState | null = null;
let cleanupTimeoutMs = AUTH_CLEANUP_TIMEOUT_MS;
let keepaliveTimer: Timer | null = null;
let keepaliveRunId = 0;
const INVALID_SESSION_REASON = "invalid_session_string";
const INVALID_SESSION_ERROR_NAMES = new Set([
  "invalidsession",
  "malformedsession",
  "unsupportedsessionversion",
]);
const INVALID_SESSION_MESSAGE_PATTERNS = [
  /invalid session/i,
  /malformed session/i,
  /unsupported session/i,
];

type TelegramClientFactory = (
  options: ConstructorParameters<typeof TelegramClient>[0],
) => TelegramClient;

const defaultTelegramClientFactory: TelegramClientFactory = (options) =>
  new TelegramClient(options);
let telegramClientFactory: TelegramClientFactory = defaultTelegramClientFactory;

export class TelegramSessionExpiredError extends Error {
  constructor(
    readonly reason: string,
    readonly revokedAt: string,
  ) {
    super("Telegram session expired or was revoked.");
    this.name = "TelegramSessionExpiredError";
  }
}

export function isSessionConfigured(): boolean {
  if (process.env.TELEGRAM_MOCK === "true") return true;
  return Boolean(process.env.TELEGRAM_SESSION);
}

export function getAuthFailureReason(err: unknown): string | null {
  if (!tl.RpcError.is(err)) return null;
  return TERMINAL_AUTH_TEXTS.has(err.text) ? err.text : null;
}

function isInvalidSessionError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const error = err as { message?: unknown; name?: unknown };

  const name = typeof error.name === "string" ? error.name.toLowerCase() : null;
  if (name && INVALID_SESSION_ERROR_NAMES.has(name)) {
    return true;
  }

  const message = typeof error.message === "string" ? error.message : null;
  return message
    ? INVALID_SESSION_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
    : false;
}

function isUnknownAuthRpcError(err: unknown): err is tl.RpcError {
  return (
    tl.RpcError.is(err) &&
    !TERMINAL_AUTH_TEXTS.has(err.text) &&
    (err.code === tl.RpcError.UNAUTHORIZED || err.code === tl.RpcError.NOT_ACCEPTABLE)
  );
}

function warnUnexpectedAuthRpcError(err: tl.RpcError, context: string): void {
  log.warn(
    {
      code: err.code,
      text: err.text,
    },
    `unexpected Telegram auth error during ${context}`,
  );
}

function getRevokedSessionError(): TelegramSessionExpiredError | null {
  const revoked = authRevokedState;
  if (!revoked) return null;

  const session = process.env.TELEGRAM_SESSION;
  if (session && session !== revoked.session && session !== currentSession) {
    authRevokedState = null;
    return null;
  }

  return new TelegramSessionExpiredError(revoked.reason, revoked.revokedAt);
}

async function clearRuntimeSessionArtifacts(revokedSession: string | null): Promise<void> {
  const envFile = process.env.ENV_FILE ?? ".env";

  if (existsSync(envFile)) {
    try {
      const env = loadEnv();
      if (env.TELEGRAM_SESSION === revokedSession) {
        delete env.TELEGRAM_SESSION;
        saveEnv(env);
      }
    } catch (err) {
      log.warn({ err }, "failed to remove TELEGRAM_SESSION from .env");
    }
  }

  if (process.env.TELEGRAM_SESSION === revokedSession) {
    delete process.env.TELEGRAM_SESSION;
  }

  try {
    await rm("bot-data/session", { force: true });
  } catch (err) {
    log.warn({ err }, "failed to delete bot-data/session");
  }

  try {
    await rm("bot-data/session-wal", { force: true });
  } catch (err) {
    log.warn({ err }, "failed to delete bot-data/session-wal");
  }

  try {
    await rm("bot-data/session-shm", { force: true });
  } catch (err) {
    log.warn({ err }, "failed to delete bot-data/session-shm");
  }
}

async function waitForAuthCleanup(cleanup: Promise<void>): Promise<void> {
  const outcome = await Promise.race<"settled" | "timed_out">([
    cleanup.then(() => "settled"),
    new Promise<"timed_out">((resolve) => {
      setTimeout(() => resolve("timed_out"), cleanupTimeoutMs);
    }),
  ]);

  if (outcome === "timed_out") {
    const duration =
      cleanupTimeoutMs % 1000 === 0 ? `${cleanupTimeoutMs / 1000}s` : `${cleanupTimeoutMs}ms`;
    throw new Error(`auth cleanup timed out after ${duration}`);
  }
}

const MIN_KEEPALIVE_INTERVAL_MS = 60_000; // 1 minute floor
const MAX_SAFE_TIMER_MS = 2 ** 31 - 1; // setTimeout/setInterval max safe delay

function getKeepaliveIntervalMs(): number {
  const env = process.env.KEEPALIVE_INTERVAL_MS;
  if (env) {
    const n = Number(env);
    if (
      Number.isFinite(n) &&
      Number.isInteger(n) &&
      n >= MIN_KEEPALIVE_INTERVAL_MS &&
      n <= MAX_SAFE_TIMER_MS
    )
      return n;
    log.warn(
      { value: env, minMs: MIN_KEEPALIVE_INTERVAL_MS },
      "invalid KEEPALIVE_INTERVAL_MS, using default",
    );
  }
  return DEFAULT_KEEPALIVE_INTERVAL_MS;
}

async function setMaxAuthorizationTTL(current: TelegramClient): Promise<void> {
  try {
    await current.call({
      _: "account.setAuthorizationTTL",
      authorizationTtlDays: AUTHORIZATION_TTL_DAYS,
    });
    log.info({ ttlDays: AUTHORIZATION_TTL_DAYS }, "set authorization TTL");
  } catch (err) {
    log.warn({ err }, "failed to set authorization TTL (non-fatal)");
  }
}

function stopKeepalive(): void {
  keepaliveRunId += 1;
  if (keepaliveTimer) {
    clearTimeout(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function startKeepalive(current: TelegramClient): void {
  stopKeepalive();
  const runId = keepaliveRunId;
  const intervalMs = getKeepaliveIntervalMs();

  function scheduleNext(): void {
    if (runId !== keepaliveRunId) return;
    keepaliveTimer = setTimeout(async () => {
      if (runId !== keepaliveRunId) return;
      if (authRevokedState || authCleanupPromise) {
        scheduleNext();
        return;
      }
      try {
        await current.getMe();
        log.debug("session keepalive ok");
      } catch (err) {
        log.warn({ err }, "session keepalive failed");
      }
      if (runId === keepaliveRunId) scheduleNext();
    }, intervalMs);

    if (keepaliveTimer && typeof keepaliveTimer.unref === "function") {
      keepaliveTimer.unref();
    }
  }

  scheduleNext();
  log.info({ intervalMs }, "session keepalive started");
}

export function attachAuthExpiryHandler(current: TelegramClient): void {
  current.onError.add((err) => {
    const reason = getAuthFailureReason(err);
    if (reason) {
      if (!authCleanupPromise) {
        void autoLogoutCurrentSession(current, reason);
      }
      return;
    }

    if (isUnknownAuthRpcError(err)) {
      warnUnexpectedAuthRpcError(err, "runtime error handling");
    }
  });
}

export async function autoLogoutCurrentSession(
  current: TelegramClient,
  reason: string,
): Promise<void> {
  if (authCleanupPromise) {
    await authCleanupPromise;
    return;
  }

  const revokedSession = currentSession;
  const revokedAt = new Date().toISOString();

  const cleanup = (async () => {
    stopKeepalive();

    authRevokedState = {
      reason,
      revokedAt,
      session: revokedSession,
    };

    log.warn({ reason, revokedAt }, "telegram session expired or was revoked");

    try {
      await current.logOut();
    } catch (err) {
      log.warn({ err }, "logOut failed during auth cleanup");
      try {
        await current.notifyLoggedOut();
      } catch (notifyErr) {
        log.warn({ err: notifyErr }, "notifyLoggedOut fallback failed during auth cleanup");
      }
    }

    try {
      await current.destroy();
    } catch (err) {
      log.warn({ err }, "destroy failed during auth cleanup");
    } finally {
      if (client === current) {
        client = null;
      }
      currentSession = null;
    }

    await clearRuntimeSessionArtifacts(revokedSession);
  })().finally(() => {
    authCleanupPromise = null;
  });

  authCleanupPromise = cleanup;
  await cleanup;
}

export async function closeTelegramClient(): Promise<void> {
  stopKeepalive();
  if (authCleanupPromise) {
    await authCleanupPromise;
    return;
  }

  if (authRevokedState && client) {
    await autoLogoutCurrentSession(client, authRevokedState.reason);
    return;
  }

  if (!client) return;

  const current = client;
  try {
    await current.disconnect();
  } finally {
    if (client === current) {
      client = null;
    }
    currentSession = null;
  }
}

type MtcuteChatId = Parameters<TelegramClient["iterHistory"]>[0];
type MtcuteSendChatId = Parameters<TelegramClient["sendText"]>[0];

// mtcute expects numeric peer IDs as number, even for channel/supergroup IDs.
type TelegramChatId = string | number;
type TelegramSendChatId = string | number;
export type TelegramSendMediaArgs = Parameters<TelegramClient["sendMedia"]>[1];

export function toMtcuteChatId(chatId: TelegramChatId): MtcuteChatId {
  return chatId as MtcuteChatId;
}

export function toMtcuteSendChatId(chatId: TelegramSendChatId): MtcuteSendChatId {
  return chatId as MtcuteSendChatId;
}

export async function getTelegramClient(): Promise<TelegramClient> {
  if (process.env.TELEGRAM_MOCK === "true") {
    if (!client) {
      const { createMockClient } = await import("./mock/client.ts");
      client = createMockClient() as unknown as TelegramClient;
      log.info("using mock telegram client");
    }
    return client;
  }

  if (authCleanupPromise) {
    await waitForAuthCleanup(authCleanupPromise);
  }

  const revokedError = getRevokedSessionError();
  if (revokedError) {
    throw revokedError;
  }

  if (client) return client;

  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const session = process.env.TELEGRAM_SESSION;

  if (!apiId || !apiHash) {
    throw new Error(
      "TELEGRAM_API_ID and TELEGRAM_API_HASH env vars are required. Run `bun auth` first.",
    );
  }

  if (!session) {
    throw new Error("TELEGRAM_SESSION env var is required. Run `bun auth` first.");
  }

  const current = telegramClientFactory({
    apiId,
    apiHash,
    storage: "bot-data/session",
    disableUpdates: true,
  });

  client = current;
  attachAuthExpiryHandler(current);

  try {
    log.info("importing telegram session");
    try {
      await current.importSession(session);
    } catch (err) {
      if (!tl.RpcError.is(err) && isInvalidSessionError(err)) {
        const revokedAt = new Date().toISOString();
        const revokedSession = session;

        log.warn(
          { err },
          "invalid or incompatible session string - clearing and requiring re-auth",
        );

        authRevokedState = {
          reason: INVALID_SESSION_REASON,
          revokedAt,
          session: revokedSession,
        };

        try {
          await current.destroy();
        } catch (destroyErr) {
          log.warn({ err: destroyErr }, "destroy failed while clearing invalid session");
        } finally {
          if (client === current) {
            client = null;
          }
          currentSession = null;
        }

        await clearRuntimeSessionArtifacts(session);
        throw new TelegramSessionExpiredError(INVALID_SESSION_REASON, revokedAt);
      }

      throw err;
    }

    log.info("connecting to telegram");
    await current.connect();
    log.info("connected to telegram");

    currentSession = session;
    void setMaxAuthorizationTTL(current);
    startKeepalive(current);
    return current;
  } catch (err) {
    if (err instanceof TelegramSessionExpiredError) {
      throw err;
    }

    if (client === current) {
      client = null;
    }

    const reason = getAuthFailureReason(err);
    if (reason) {
      await autoLogoutCurrentSession(current, reason);
      const revokedAfterCleanup = getRevokedSessionError();
      if (revokedAfterCleanup) {
        throw revokedAfterCleanup;
      }
    }

    if (authCleanupPromise) {
      await waitForAuthCleanup(authCleanupPromise);
      const revokedAfterWait = getRevokedSessionError();
      if (revokedAfterWait) {
        throw revokedAfterWait;
      }
    }

    if (isUnknownAuthRpcError(err)) {
      warnUnexpectedAuthRpcError(err, "client bootstrap");
    }

    throw err;
  }
}

function createTelegramAuthRequiredError(
  error: TelegramSessionExpiredError,
): TelegramAuthRequiredError {
  return {
    type: "telegram_auth_required",
    reason: error.reason,
    revokedAt: error.revokedAt,
  };
}

export function isTelegramAuthRequiredError(err: unknown): err is TelegramAuthRequiredError {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    err.type === "telegram_auth_required" &&
    "reason" in err &&
    typeof err.reason === "string" &&
    "revokedAt" in err &&
    typeof err.revokedAt === "string"
  );
}

export async function withTelegramClient<T>(
  handler: (current: TelegramClient) => Promise<T> | T,
): Promise<T> {
  try {
    return await handler(await getTelegramClient());
  } catch (err) {
    if (err instanceof TelegramSessionExpiredError) {
      throw createTelegramAuthRequiredError(err);
    }
    throw err;
  }
}

export function resetTelegramState(): void {
  stopKeepalive();
  client = null;
  authCleanupPromise = null;
  currentSession = null;
  authRevokedState = null;
  cleanupTimeoutMs = AUTH_CLEANUP_TIMEOUT_MS;
  telegramClientFactory = defaultTelegramClientFactory;
}

export function setAuthCleanupPromiseForTests(cleanup: Promise<void> | null): void {
  authCleanupPromise = cleanup;
}

export function setAuthRevokedStateForTests(state: AuthRevokedState | null): void {
  authRevokedState = state;
}

export function setCurrentSessionForTests(session: string | null): void {
  currentSession = session;
}

export function setCleanupTimeoutMsForTests(timeoutMs: number): void {
  cleanupTimeoutMs = timeoutMs;
}

export function setTelegramClientFactoryForTests(factory: TelegramClientFactory | null): void {
  telegramClientFactory = factory ?? defaultTelegramClientFactory;
}

export function getKeepaliveTimerForTests(): Timer | null {
  return keepaliveTimer;
}
