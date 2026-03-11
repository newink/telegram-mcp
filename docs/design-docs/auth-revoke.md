# Auth revoke auto-logout design

## Goal

Implement clean runtime recovery when Telegram invalidates the server's MTProto session.

Desired behavior:

1. Detect auth-loss errors from mtcute as soon as they hit the runtime singleton.
2. Tear down the broken local session deterministically.
3. Make MCP requests fail fast with `auth required` instead of generic internal errors.
4. Let operators re-authenticate through the existing web auth flow without restarting the server.

## Where the change goes

### `src/telegram.ts` owns the runtime handler

Add the auth-expiry detection and cleanup logic in `src/telegram.ts`.

Reasons:

- It owns the singleton `TelegramClient` used by all tools.
- It already owns connection bootstrap (`importSession()` + `connect()`).
- It is the right place to guard against rebuilding a client while cleanup is in progress.

### `src/server.ts` maps typed auth errors to JSON-RPC

Keep transport-specific behavior in `src/server.ts`:

- catch a typed `TelegramSessionExpiredError`
- generate or expose the re-auth URL using the existing web auth flow
- return a stable JSON-RPC error payload

### `src/auth.ts` stays unchanged

Do not put the auto-logout logic in `src/auth.ts`.

That file is only used by `bun auth`, creates its own short-lived client, and writes a session string for initial setup. It does not own the long-lived runtime client that serves MCP requests.

## Recommended state model

Add explicit runtime auth state alongside the existing singleton:

```ts
let client: TelegramClient | null = null
let authCleanupPromise: Promise<void> | null = null
let authRevokedState: {
  reason: string
  revokedAt: string
} | null = null
```

Behavior:

- `client` remains the current singleton.
- `authCleanupPromise` deduplicates concurrent auth-failure events.
- `authRevokedState` lets `getTelegramClient()` fail fast with a typed error until a fresh session is configured.

## Auth error classification

Use mtcute's `RpcError` shape, not ad-hoc string parsing alone.

```ts
import { tl } from "@mtcute/bun"

const TERMINAL_AUTH_TEXTS = new Set([
  "AUTH_KEY_UNREGISTERED",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "USER_DEACTIVATED",
  "USER_DEACTIVATED_BAN",
])

function getAuthFailureReason(err: unknown): string | null {
  if (!tl.RpcError.is(err)) return null

  if (TERMINAL_AUTH_TEXTS.has(err.text)) {
    return err.text
  }

  if (err.code === tl.RpcError.UNAUTHORIZED) {
    return err.text || "UNAUTHORIZED"
  }

  return null
}
```

Notes:

- Treat surfaced `AUTH_KEY_UNREGISTERED` as terminal for the runtime singleton.
- It is fine that mtcute already retries one non-primary-DC `AUTH_KEY_UNREGISTERED` branch internally; this handler only runs when the error escapes to the application.

## Runtime handler sketch

Register the listener immediately after constructing the real runtime client and before `importSession()` / `connect()`.

Callsite example — exact initialization order in `getTelegramClient()`:

```ts
client = new TelegramClient({
  apiId,
  apiHash: apiHash as string,
  storage: "bot-data/session",
  disableUpdates: true,
})

// Attach BEFORE importSession/connect so no auth error can escape unhandled
attachAuthExpiryHandler(client)

await client.importSession(session)
await client.connect()
```

Handler implementation:

```ts
function attachAuthExpiryHandler(current: TelegramClient): void {
  current.onError.add((err) => {
    const reason = getAuthFailureReason(err)
    if (!reason) return

    if (authCleanupPromise) return

    authCleanupPromise = autoLogoutCurrentSession(current, reason).finally(() => {
      authCleanupPromise = null
    })
  })
}

async function autoLogoutCurrentSession(current: TelegramClient, reason: string): Promise<void> {
  authRevokedState = {
    reason,
    revokedAt: new Date().toISOString(),
  }

  try {
    await current.logOut()
  } catch (logoutErr) {
    if (!getAuthFailureReason(logoutErr)) {
      log.warn({ err: logoutErr }, "logOut failed during auth cleanup")
    }

    await current.notifyLoggedOut().catch((notifyErr) => {
      log.warn({ err: notifyErr }, "notifyLoggedOut fallback failed")
    })
  }

  await current.destroy().catch((destroyErr) => {
    log.warn({ err: destroyErr }, "destroy after auth revoke failed")
  })

  if (client === current) {
    client = null
  }

  await clearPersistedRuntimeSession(reason)
}
```

Important details:

- `logOut()` is best-effort only.
- `notifyLoggedOut()` is the fallback because mtcute only calls it after a successful `auth.logOut` RPC.
- `destroy()` is preferable to `disconnect()` here because the client is no longer trustworthy.
- The cleanup flag must be set before awaiting anything so duplicate `onError` events do not start multiple deletion flows.

## `getTelegramClient()` behavior after revoke

Add a fast-fail check at the top of `getTelegramClient()`.

```ts
export class TelegramSessionExpiredError extends Error {
  constructor(
    readonly reason: string,
    readonly revokedAt: string,
  ) {
    super("Telegram session expired or was revoked")
  }
}

export async function getTelegramClient(): Promise<TelegramClient> {
  if (authRevokedState) {
    throw new TelegramSessionExpiredError(
      authRevokedState.reason,
      authRevokedState.revokedAt,
    )
  }

  if (authCleanupPromise) {
    await authCleanupPromise
    throw new TelegramSessionExpiredError("cleanup_in_progress", new Date().toISOString())
  }

  // existing singleton construction continues here
}
```

This avoids recreating a new client from stale storage while cleanup is still happening.

## Session file cleanup steps

Implement a dedicated helper for persisted runtime cleanup.

```ts
async function clearPersistedRuntimeSession(reason: string): Promise<void> {
  log.warn({ reason }, "telegram session revoked; clearing local session state")

  const env = loadEnv()
  delete env.TELEGRAM_SESSION
  saveEnv(env)
  delete process.env.TELEGRAM_SESSION

  for (const path of [
    "bot-data/session",
    "bot-data/session-wal",
    "bot-data/session-shm",
  ]) {
    await rm(path, { force: true })
  }
}
```

Why each step matters:

- Remove `.env` entry so future restarts do not re-import a revoked string session.
- Remove `process.env.TELEGRAM_SESSION` so the live process knows auth is gone.
- Remove SQLite runtime files because mtcute ignores `importSession()` when storage already contains authorization unless `force` is used.

Do not delete these as part of runtime auto-logout:

- `bot-data/web-auth-session*` — temporary web-auth flow storage, already cleaned by `cleanupAuthClient()`.
- `bot-data/auth-session*` — CLI auth scratch storage used by `bun auth`, not the runtime singleton.

## JSON-RPC mapping in `src/server.ts`

The server already has a single request-level catch block. Extend that path to recognize the typed auth error and return a clean response.

```ts
try {
  // existing request handling
} catch (err) {
  if (err instanceof TelegramSessionExpiredError) {
    const token = ensureSetupToken()
    const authBase =
      process.env.PUBLIC_BASE_URL ??
      (request.headers.get("x-forwarded-host")
        ? `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("x-forwarded-host")}`
        : request.headers.get("origin")) ??
      `http://localhost:${port}`
    const authUrl = `${authBase}/auth?token=${token}`

    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Telegram session expired or was revoked. Re-authentication is required.",
          data: {
            authRequired: true,
            reason: err.reason,
            authUrl,
          },
        },
        id: null,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    )
  }

  // existing generic internal error path
}
```

Recommended behavior:

- Use `-32001` (not `-32603`) — distinct, actionable code for auth loss.
- Include `authRequired: true` so MCP clients can distinguish this from transient failures.
- Prefer HTTP 503 over 500 because the service can recover after operator action.
- Never include the raw token in logs — only in the JSON-RPC `data.authUrl` payload.

### Note: MCP SDK v1.26 exception interception

MCP SDK v1.26.0 wraps tool handler invocations and converts unhandled exceptions to generic `InternalError` responses before the outer server catch block sees them. This means `TelegramSessionExpiredError` thrown inside a tool handler will be swallowed.

Two safe patterns to work around this:

**Option A — throw `McpError` inside each tool handler:**

```ts
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js"

// At the top of every tool handler that calls getTelegramClient():
try {
  const client = await getTelegramClient()
  // ...
} catch (err) {
  if (err instanceof TelegramSessionExpiredError) {
    throw new McpError(
      -32001,
      "Telegram session expired. Re-authentication is required.",
      { authRequired: true, reason: err.reason },
    )
  }
  throw err
}
```

**Option B — wrapper utility:**

```ts
export async function withTelegramClient<T>(
  fn: (client: TelegramClient) => Promise<T>
): Promise<T> {
  try {
    const client = await getTelegramClient()
    return await fn(client)
  } catch (err) {
    if (err instanceof TelegramSessionExpiredError) {
      throw new McpError(-32001, err.message, { authRequired: true, reason: err.reason })
    }
    throw err
  }
}
```

Option B is preferred — it centralizes the conversion and keeps tool handlers clean. The implementation phase will add `withTelegramClient()` to `src/telegram.ts` and wrap all tool calls in `src/server.ts`.

## Reconnect flow for MCP clients

The clean reconnect path is:

1. Telegram revokes the session.
2. `client.onError` triggers the auto-logout cleanup.
3. Runtime session state is cleared and future MCP tool calls return `auth required`.
4. Operator opens the existing `/auth` URL and completes QR or phone auth.
5. `src/web-auth.ts` writes the new session to both `.env` and `process.env.TELEGRAM_SESSION`.
6. The next tool call lazily creates a fresh singleton and reconnects.

This means MCP clients do not need a new tool contract. They only need to surface the returned error cleanly and retry after re-authentication.

### Important operator note

If the operator uses external `bun auth` instead of the built-in web auth flow:

- the new session string is written to `.env`
- the already-running server process does not automatically reload `.env`
- a restart is still required unless the runtime is extended to re-read env files

For no-restart recovery, prefer the existing `/auth` flow.

## Edge cases

### Multiple concurrent errors

A single revoked session can surface through both:

- `client.onError`
- an in-flight tool call

The `authCleanupPromise` guard keeps cleanup idempotent.

### `logOut()` after revocation

If Telegram already invalidated the auth key, `auth.logOut` may fail. That is expected. The local cleanup must continue via `notifyLoggedOut()` fallback plus file deletion.

### Non-auth network failures

Do not trigger cleanup for:

- `FLOOD_WAIT`
- transport disconnects
- generic internal Telegram server errors
- transient connectivity problems

Those should continue through existing error handling.

## Suggested validation plan

Because this repo avoids real Telegram access in tests, validate the implementation with mockable/unit-level coverage:

1. A classifier test for `getAuthFailureReason()` using synthetic `RpcError`s.
2. A cleanup test proving `.env`, `process.env`, and SQLite sidecars are removed.
3. A server test verifying `TelegramSessionExpiredError` becomes JSON-RPC `auth required`.
4. A manual smoke check with a real account only if needed, by revoking the session from Telegram settings while the server is running.
