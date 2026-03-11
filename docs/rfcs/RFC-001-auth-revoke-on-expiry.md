# RFC-001: Auto-logout on Telegram session expiry or revocation

- Status: Draft
- Date: 2026-03-11 UTC
- Scope: Runtime session handling for the long-lived `TelegramClient` singleton

## Summary

When Telegram revokes or expires the MTProto session used by this server, the current runtime keeps a broken singleton in memory and continues to surface opaque failures. This RFC proposes a single auto-logout path that detects terminal auth errors from mtcute, clears the local runtime session state, and returns a clean JSON-RPC error that tells MCP clients re-authentication is required.

There are no MCP tool API changes. Tool names, parameters, and success payloads remain unchanged.

## Problem

Today the runtime client is created once in `src/telegram.ts` and then shared by all tool calls. It uses:

- `process.env.TELEGRAM_SESSION` as the imported string session
- `bot-data/session` as the mtcute SQLite storage file
- a module-level singleton that stays alive until process shutdown

Separately, `src/auth.ts` uses `bot-data/auth-session` only for interactive setup. That means revocation handling must target the runtime store in `src/telegram.ts`, not the one-off auth helper client.

This means a revoked session fails badly in two ways:

1. Background mtcute errors can surface on `client.onError`, but the server does not currently subscribe to that event.
2. Foreground tool failures bubble into `src/server.ts`, which currently converts unexpected errors into a generic JSON-RPC `-32603` / HTTP 500 response.

The result is a broken runtime that either hangs on reconnect work inside mtcute or repeatedly returns generic errors, while the revoked session string and SQLite storage remain in place.

The existing `closeTelegramClient()` helper is also not enough for this path because it only disconnects the client; it does not run `logOut()`, `notifyLoggedOut()`, or clear persisted session artifacts.

## Confirmed mtcute behavior

The installed package layout in this repo uses:

- `node_modules/@mtcute/core/network/network-manager.js`
- `node_modules/@mtcute/core/client.js`
- `node_modules/@mtcute/core/highlevel/base.js`
- `node_modules/@mtcute/core/highlevel/client.d.ts`
- `node_modules/@mtcute/tl/index.js`

Key findings from those files:

### Error surfacing path

- `NetworkManagerParams.emitError` is typed as `(err: Error) => void`.
- `MtClient` requires `onError: (err: unknown) => void` and passes it into `NetworkManager` as `emitError`.
- `BaseTelegramClient` converts that callback into the public `onError: Emitter<Error>` surface.
- `TelegramClient` exposes that emitter directly via `Object.defineProperty(this, "onError", { value: this._client.onError })`.

In short: low-level mtcute network/auth failures can already reach the application through `client.onError`.

### Login/logout helpers already exist

mtcute already exposes the primitives needed for a clean local logout flow:

- `notifyLoggedIn(auth): Promise<RawUser>`
- `notifyLoggedOut(): Promise<void>`
- `logOut(): Promise<LogOutResult>`

Important implementation detail:

- `logOut()` performs `auth.logOut` first and only then calls `notifyLoggedOut()`.
- `notifyLoggedOut()` clears mtcute's local auth state, resets sessions, clears the stored self user, and deletes non-primary DC auth keys.

This matters because a session that has already been revoked may cause `auth.logOut` itself to fail. The server therefore needs a best-effort `logOut()` followed by a `notifyLoggedOut()` fallback.

### Existing internal mtcute recovery is partial

mtcute already recovers one narrow case internally:

- `network-manager.js` retries `AUTH_KEY_UNREGISTERED` for non-primary/exported auth keys by re-exporting auth to the target DC.

That is useful, but it does not solve the primary-session-expired case that breaks the server's singleton.

## Exact auth-related errors to handle

The runtime auto-logout path should treat the following as terminal auth loss when they surface to the application:

| Match | Type | Why it is terminal |
| --- | --- | --- |
| `AUTH_KEY_UNREGISTERED` | `RpcError.text` | The auth key backing the session is no longer valid |
| `SESSION_REVOKED` | `RpcError.text` | Telegram invalidated the authorization |
| `SESSION_EXPIRED` | `RpcError.text` | The authorization expired |
| `USER_DEACTIVATED` | `RpcError.text` | The account is deactivated |
| `USER_DEACTIVATED_BAN` | `RpcError.text` | The account is deactivated/banned; mtcute already treats it like revoked auth in auth startup |
| `RpcError.UNAUTHORIZED` (`401`) | `RpcError.code` | Fallback bucket for auth-loss errors that do not use one of the exact strings above |

Notes:

- `SESSION_REVOKED`, `USER_DEACTIVATED`, and `USER_DEACTIVATED_BAN` are already handled specially by mtcute's auth startup flow.
- `SESSION_EXPIRED` is present in mtcute's TL error descriptions even if the current repo does not explicitly branch on it yet.
- `UNAUTHORIZED` in mtcute is a numeric RPC error class (`401`), not necessarily a literal text string.

## Proposed solution

### 1. Install the handler in `src/telegram.ts`

The auth-expiry handler should live in `src/telegram.ts`, not `src/auth.ts`.

Why:

- `src/telegram.ts` owns the long-lived singleton used by MCP tools.
- `src/auth.ts` creates a short-lived interactive client for `bun auth`; it is not the runtime client used by tool calls.
- The runtime bug is specifically a singleton lifecycle problem.

### 2. Subscribe to `client.onError` before connect

When constructing the real runtime `TelegramClient`, register exactly one `onError` listener before `importSession()` and `connect()`.

That listener should:

- check whether the error is an auth-related `RpcError`
- ignore non-auth failures
- start one idempotent cleanup flow for terminal auth loss

### 3. Run a one-shot auto-logout cleanup flow

When a terminal auth error is detected:

1. Mark the runtime as `reauth required` so new requests fail fast.
2. Best-effort call `client.logOut()`.
3. If `logOut()` fails because the session is already dead, call `client.notifyLoggedOut()` directly.
4. Destroy the mtcute client.
5. Clear all persisted runtime session artifacts.
6. Return future tool requests as a clean JSON-RPC auth error instead of generic internal failure.

### 4. Clear both session sources

The cleanup must remove both of these:

- `TELEGRAM_SESSION` from `.env` and `process.env`
- the SQLite runtime storage at `bot-data/session` and sidecars (`bot-data/session-wal`, `bot-data/session-shm`)

Deleting the SQLite file is important because mtcute documents that `importSession()` is ignored when storage already contains authorization unless `force` is used. Keeping a stale revoked SQLite store risks reusing the broken state even after a new session string is written.

### 5. Return a clean JSON-RPC error

After cleanup, tool calls should fail with an intentional JSON-RPC server error such as:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "Telegram session expired or was revoked. Re-authentication is required.",
    "data": {
      "authRequired": true,
      "reason": "SESSION_REVOKED"
    }
  },
  "id": null
}
```

The exact numeric code can still be finalized, but the important behavior is:

- not `-32603`
- not a raw mtcute stack trace
- clearly actionable for an MCP client or operator

## Re-authentication flow

The existing web auth flow is already the best path for no-restart recovery:

- `src/server.ts` already exposes `/auth`, `/auth/start`, `/auth/code`, `/auth/password`, and `/auth/status`.
- `src/web-auth.ts` already writes the new session into both `.env` and `process.env.TELEGRAM_SESSION`.
- After that, the next call to `getTelegramClient()` can build a fresh singleton without restarting the server.

Important limitation:

- Running `bun auth` externally updates `.env`, but it does not mutate the running server process's `process.env`. That path still requires a server restart unless the runtime is changed to reload env files.

## Migration

No breaking MCP API changes are introduced.

- No tool names change.
- No request schemas change.
- No success payloads change.
- The only behavior change is failure mode: revoked sessions become explicit `reauth required` errors instead of generic transport/runtime failures.

## Alternatives considered

### Handle only tool-call exceptions

Rejected. That misses background failures surfaced via `client.onError`, which is exactly where mtcute can report broken sessions outside a current RPC call.

### Put the handler in `src/auth.ts`

Rejected. `src/auth.ts` is an interactive setup script and does not own the runtime singleton used by MCP tools.

### Restart the whole process on auth loss

Rejected for this RFC. Process restart is heavier than necessary and still leaves open questions around stale local session files. The server already has a web auth flow that can recover in-process.

## Decisions on previously open questions

1. **JSON-RPC error code**: Use `-32001` for `auth required`. This is in the custom server error range (`-32099` to `-32000`) and is distinct from the generic `-32603` (internal error). Implementations must not use `-32603` for auth-loss errors.

2. **authUrl in error payload**: Include `authUrl` in the JSON-RPC error `data` object so MCP clients can surface it without server-side log access. Derive the URL from `PUBLIC_BASE_URL` env var if set; otherwise construct it from the `X-Forwarded-Host` / `origin` request header; fall back to `http://localhost:{port}` only as a last resort. Never log the raw token — log only that an auth URL was generated.

3. **401 allowlist**: Every `401` RpcError does NOT automatically trigger auto-logout. Require either (a) one of the known `TERMINAL_AUTH_TEXTS` strings, or (b) a `401` code combined with a text that matches the allowlist set. This avoids accidentally destroying sessions on transient or unexpected 401 variants.

4. **Observability**: Structured logs at `WARN` level are sufficient. No tombstone file on disk. The `authRevokedState` in-memory object serves as the runtime signal; log entries provide the audit trail.
