# RFC-001 Exec Plan: Auth Revoke on Expiry

## Goal

Ship the RFC-001 runtime auth-revoke flow so the long-lived `TelegramClient` singleton detects terminal Telegram auth loss, tears down local runtime session state, and makes MCP tool calls return a stable `auth required` JSON-RPC error with a re-auth URL. The change must preserve existing tool names, parameters, and success payloads, and let operators recover through the existing web auth flow without restarting the server.

## Scope

Files expected to change:

- `src/telegram.ts` — add revoke state, auth-error classification, cleanup orchestration, and the typed error surfaced to callers.
- `src/server.ts` — map `TelegramSessionExpiredError` to the RFC JSON-RPC error shape and thread request context into auth URL generation.
- `src/web-auth.ts` — implement and export a stable setup-token helper (`ensureSetupToken()`), so repeated `auth required` responses and startup logging reuse the same `/auth` link until successful web auth invalidates that token.
- `src/telegram.test.ts` and `src/server.test.ts` (new) or equivalent `src/*.test.ts` coverage added in the existing test layout.

Files explicitly out of scope:

- `src/auth.ts` — the CLI auth flow is not part of runtime revoke handling.
- MCP tool contracts — no new tools, no schema changes, no success-payload changes.
- Bun/TypeScript project config, `package.json` scripts, CI, and any `justfile` or repo automation changes.
- `bot-data/auth-session*` and `bot-data/web-auth-session*` handling outside the existing web-auth cleanup path.

## Phase 1: State model

Update `src/telegram.ts` to own revoke state next to the singleton:

- Add `let authCleanupPromise: Promise<void> | null = null`.
- Add `let currentSession: string | null = null` to track the session string bound to the active singleton; leave it `null` until `importSession()` and `connect()` both succeed, set it only after both calls succeed, and clear it when the singleton is destroyed.
- Add `type AuthRevokedState = { reason: string; revokedAt: string; session: string | null }` and `let authRevokedState: AuthRevokedState | null = null`.
- Add `export class TelegramSessionExpiredError extends Error` with `reason` and `revokedAt` fields so callers can distinguish auth loss from generic runtime errors.

Update `getTelegramClient()` to gate the real runtime path before creating a new client:

- Keep the existing mock-mode short-circuit intact.
- If `authCleanupPromise` is active, wait for it to settle with a bounded timeout (for example `Promise.race()` against a 10s timer). If the timeout fires, throw a descriptive, testable error such as `auth cleanup timed out after 10s`; do not wait indefinitely and do not proceed with singleton creation while cleanup is still stuck. If the promise settles normally and the session is still revoked, continue to throw `TelegramSessionExpiredError` instead of racing a second client build.
- When `authRevokedState` is set, treat all of the following as still revoked and throw `TelegramSessionExpiredError` immediately: `process.env.TELEGRAM_SESSION === undefined`, an empty string, a value equal to `authRevokedState.session`, or a `currentSession` value equal to `authRevokedState.session`. This comparison must use the session snapshot captured when cleanup started, not a later `.env` read.
- Only clear `authRevokedState` when `process.env.TELEGRAM_SESSION` contains a non-empty string that differs from both the captured revoked session and the last `currentSession`; that is the signal that a fresh web-auth session has been written and normal singleton creation may resume.
- Record the session string used for the current singleton in `currentSession` once `importSession()` and `connect()` succeed, and never infer it later from `.env`.

`closeTelegramClient()` stays a shutdown helper. Do not repurpose it for revoke cleanup; the revoke path needs logout plus persisted-state deletion, not only `disconnect()`.

## Phase 2: Error detection

Add terminal auth detection in `src/telegram.ts` and install it on the real mtcute client before any connection work:

- Define `const TERMINAL_AUTH_TEXTS = new Set(["AUTH_KEY_UNREGISTERED", "AUTH_KEY_INVALID", "AUTH_KEY_PERM_EMPTY", "AUTH_KEY_DUPLICATED", "SESSION_REVOKED", "SESSION_EXPIRED", "USER_DEACTIVATED"])`.
- Keep that set exact. Do not include `USER_DEACTIVATED_BAN`, and do not add broader `401`/`406` texts without an explicit RFC update.
- Add `function getAuthFailureReason(err: unknown): string | null` using `tl.RpcError.is(err)` and exact-text matching against `TERMINAL_AUTH_TEXTS`.
- Treat unknown `401`/`406` auth-like errors as investigation-only: log at `WARN` and rethrow them, but do not trigger cleanup unless the text is in the allowlist above.
- Add `attachAuthExpiryHandler(current: TelegramClient): void` and call it immediately after `new TelegramClient(...)`, before `importSession()` and `connect()`.

The handler should:

- Ignore non-auth failures such as `FLOOD_WAIT`, disconnects, and generic transport issues.
- Deduplicate concurrent signals by checking `authCleanupPromise` first.
- Start `autoLogoutCurrentSession(current, reason)` exactly once per revoked singleton.

## Phase 3: Cleanup flow

Implement the revoke cleanup in `src/telegram.ts` as a single helper, for example `autoLogoutCurrentSession(current, reason): Promise<void>`.

Required order:

1. Capture the active session first from module state, not from `.env` (`const revokedSession = currentSession`), then capture `revokedAt`, set `authRevokedState = { reason, revokedAt, session: revokedSession }` from that exact snapshot, and assign `authCleanupPromise` before awaiting anything. The implementation should follow the usual `const cleanup = (async () => { ... })(); authCleanupPromise = cleanup; await cleanup;` pattern so Phase 1 always compares against the exact session snapshot present when cleanup started, even if a later `/auth` flow writes a different session string while cleanup is still running.
2. Best-effort `await current.logOut()`.
3. If `logOut()` fails, log at `WARN` and call `await current.notifyLoggedOut()` as the local-state fallback.
4. `await current.destroy()` and clear the module-level `client` if it still points at `current`.
5. Clear runtime session artifacts:
   - remove `TELEGRAM_SESSION` from `.env` via `loadEnv()` / `saveEnv()` in its own `try/catch`
   - delete `process.env.TELEGRAM_SESSION` in its own `try/catch`
   - remove `bot-data/session` in its own `try/catch`
   - remove `bot-data/session-wal` in its own `try/catch`
   - remove `bot-data/session-shm` in its own `try/catch`
6. Always clear `authCleanupPromise` in `finally`, even if logout, notify, or filesystem cleanup fails.

Constraints for this phase:

- The cleanup is best-effort. A failed `logOut()` must not block `notifyLoggedOut()`, file deletion, or future `auth required` responses.
- `.env` updates and every session-file deletion are also best-effort: each operation gets its own `try/catch`, logs failures at `WARN`, does not rethrow, and does not block `authRevokedState`, `authCleanupPromise` cleanup, or future `TelegramSessionExpiredError` responses even if files remain on disk.
- Do not delete `bot-data/auth-session*` or `bot-data/web-auth-session*`; those are owned by separate auth flows.
- Multiple `client.onError` events, in-flight tool calls, and any explicit cleanup callers must converge on the same `authCleanupPromise`.
- If shutdown begins during revoke cleanup, `SIGINT` / `SIGTERM` handlers should check `authCleanupPromise` first and await that shared promise before exiting. If no promise exists yet but the process is already handling a revoked singleton, the signal path should explicitly call and await `autoLogoutCurrentSession(current, reason)` rather than starting parallel cleanup work. The `finally` block in `autoLogoutCurrentSession()` still owns clearing `authCleanupPromise`.

## Phase 4: `server.ts` mapping

Map revoked-session failures in `src/server.ts`, not in `src/auth.ts`.

Implementation plan:

- Introduce a request-scoped wrapper for tool handlers in `src/server.ts` because MCP SDK `1.26.x` converts uncaught handler exceptions to generic internal errors before the outer `fetch()` catch can shape the response.
- Export `withTelegramClient(handler)` from `src/telegram.ts`. It should call `getTelegramClient()`, pass the singleton into the supplied handler, catch `TelegramSessionExpiredError`, and rethrow a tagged auth-required error understood by `src/server.ts`. Tool bodies should call this helper instead of adding revoke-specific `try/catch` logic or calling `getTelegramClient()` directly.
- Keep the request-aware error mapping centralized in `src/server.ts`: `createMcpServer()` / `registerTools()` should thread the current `Request` and `port` into one outer wrapper that catches only the tagged auth-required failure from `withTelegramClient()` and converts it to the RFC response. Individual `server.tool(...)` callbacks stay clean and only implement tool logic.
- In that outer wrapper, convert the tagged auth-required failure from `withTelegramClient()` / `getTelegramClient()` to a stable MCP/JSON-RPC error:
  - `code: -32001`
  - `message: "Telegram session expired or was revoked. Re-authentication is required."`
  - `data: { authRequired: true, reason, revokedAt, authUrl }`
- Keep the existing generic `-32603` path for unrelated failures.

`authUrl` generation must follow the RFC decision order:

- `PUBLIC_BASE_URL` first if set.
- Otherwise, implement `isTrustedProxy(clientIp)` in `src/server.ts` using `process.env.TRUSTED_PROXY_IPS` as a comma-separated allowlist of literal IPs and CIDR blocks. An empty or unset env var means no proxies are trusted.
- Extract the immediate peer IP from the connection socket first. If that runtime path is unavailable, fall back to the rightmost `X-Forwarded-For` entry only for trust evaluation. If the peer IP is not in `TRUSTED_PROXY_IPS`, treat the request as untrusted.
- If the peer IP is trusted and `X-Forwarded-For` is present, walk the list from right to left so the rightmost trusted hops are stripped and the first untrusted hop becomes the effective originating client IP for logging and auditing.
- Accept `X-Forwarded-Host` and `X-Forwarded-Proto` only when the peer IP is trusted. If the trust check fails, ignore forwarded headers entirely, log at `WARN`, and fall back to `PUBLIC_BASE_URL` or `http://localhost:${port}`.
- Validate every header-derived value before use:
  - hostname: no control characters, must parse as a valid host or host:port value
  - scheme: only `http` or `https`
- Reconstruct the final URL with a safe builder such as ``new URL(path, `${proto}://${host}`)`` instead of string concatenation.
- If the proxy trust check fails or any forwarded header fails validation, log at `WARN`, ignore those headers, and fall back to the documented safe base URL path.
- Fall back to `http://localhost:${port}` for local development.

`src/web-auth.ts` must expose a stable setup-token helper:

- Implement `ensureSetupToken()` so it generates and caches a token on first call, returns the cached token on later calls, and does not mint a fresh token per response.
- Use `ensureSetupToken()` from both startup logging and the revoke/auth-required response path so the same re-auth URL stays stable until successful `/auth` completion clears the cached token.
- Keep the existing successful-auth code path that clears `setupToken`; that invalidation remains the boundary for minting a new token.
- Do not log the raw token value when calling `ensureSetupToken()`; logs may say that a setup URL exists or was reused, but the token itself only belongs in the returned `authUrl`.

## Validation

Automated coverage:

- Add `src/telegram.test.ts` for `TERMINAL_AUTH_TEXTS` classification, unknown-`401` non-cleanup behavior, fail-fast `getTelegramClient()` behavior, the bounded cleanup-wait timeout branch, and cleanup deduplication when multiple revocation signals arrive concurrently.
- Add filesystem/env cleanup tests that assert `.env`, `process.env.TELEGRAM_SESSION`, and `bot-data/session*` sidecars are removed while `bot-data/auth-session*` and `bot-data/web-auth-session*` must be explicitly verified to remain unchanged.
- Add `src/server.test.ts` for the JSON-RPC mapping: `-32001`, `authRequired: true`, correct `reason`, and an `authUrl` built from the selected base URL source.
- Add targeted cleanup-failure tests that stub the Telegram client wrapper or mtcute client methods so `logOut()` throws, `notifyLoggedOut()` throws, or both do. Use Bun spies or module stubs around the revoke-flow wrapper where possible, explicitly cover forced `client.logOut()` failures and separate forced `notifyLoggedOut()` failures, and assert in every case that runtime state is still cleared and the revoked singleton is not recreated until a fresh `/auth` flow writes a new session.
- Keep existing mock-mode tests green; non-auth failures must still surface through the normal error path.

Manual validation:

- Start the server with a real session, revoke that session from Telegram settings, and confirm the next tool call returns the auth-required error instead of `-32603`.
- Treat forced cleanup-failure scenarios as integration-test-only validations. Simulate them by mocking `client.logOut()` to throw with `jest.spyOn(...)` or Bun's `mock.module(...)`, separately mocking `notifyLoggedOut()` to throw, and disabling network or blackholing the Telegram endpoint to trigger timeout-style failures.
- In each of those integration-test-only failure cases, assert that runtime state is still cleared even when `logOut()` / `notifyLoggedOut()` fail and that the revoked singleton is not recreated until a fresh `/auth` completes.
- Complete the existing `/auth` web flow and confirm the next tool call builds a fresh singleton without restarting the process.
- Check edge cases explicitly: concurrent revocation signals, repeated auth-required requests, failed `notifyLoggedOut()`, and non-auth mtcute errors such as `FLOOD_WAIT`.
- Treat network-induced cleanup failures as integration-test-only checks: temporarily disable network connectivity, blackhole the Telegram endpoint, or use any available mtcute test utilities to induce timeouts/failures around `logOut()` / `notifyLoggedOut()`, then verify that runtime state is still cleared and the revoked singleton stays unavailable until a fresh `/auth` completes.

Recommended commands before opening the PR:

- `bun test`
- `bun run typecheck`

## Definition of done

- [ ] Phase 1 state-model changes are implemented in `src/telegram.ts`.
- [ ] Phase 2 auth-error detection is installed on the runtime client before `importSession()` / `connect()`.
- [ ] Phase 3 cleanup performs best-effort logout, fallback local logout, and runtime session artifact deletion only for `bot-data/session*`.
- [ ] Phase 4 `src/server.ts` mapping returns the RFC auth-required JSON-RPC payload with a re-auth URL.
- [ ] Automated tests cover classifier logic, concurrent cleanup, failed logout fallback, non-auth errors, and server error mapping.
- [ ] `bun test` and `bun run typecheck` pass.
- [ ] CodeRabbit review comments are addressed.
- [ ] PR is ready to merge.
