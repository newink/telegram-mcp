# RFC-001 Exec Plan: Auth Revoke on Expiry

## Goal

Ship the RFC-001 runtime auth-revoke flow so the long-lived `TelegramClient` singleton detects terminal Telegram auth loss, tears down local runtime session state, and makes MCP tool calls return a stable `auth required` JSON-RPC error with a re-auth URL. The change must preserve existing tool names, parameters, and success payloads, and let operators recover through the existing web auth flow without restarting the server.

## Scope

Files expected to change:

- `src/telegram.ts` — add revoke state, auth-error classification, cleanup orchestration, and the typed error surfaced to callers.
- `src/server.ts` — map `TelegramSessionExpiredError` to the RFC JSON-RPC error shape and thread request context into auth URL generation.
- `src/web-auth.ts` — only if needed to expose a stable setup-token helper (for example `ensureSetupToken()`), so repeated `auth required` responses reuse the same `/auth` link until re-auth completes.
- `src/telegram.test.ts` and `src/server.test.ts` (new) or equivalent `src/*.test.ts` coverage added in the existing test layout.

Files explicitly out of scope:

- `src/auth.ts` — the CLI auth flow is not part of runtime revoke handling.
- MCP tool contracts — no new tools, no schema changes, no success-payload changes.
- Bun/TypeScript project config, `package.json` scripts, CI, and any `justfile` or repo automation changes.
- `bot-data/auth-session*` and `bot-data/web-auth-session*` handling outside the existing web-auth cleanup path.

## Phase 1: State model

Update `src/telegram.ts` to own revoke state next to the singleton:

- Add `let authCleanupPromise: Promise<void> | null = null`.
- Add `type AuthRevokedState = { reason: string; revokedAt: string; session: string | null }` and `let authRevokedState: AuthRevokedState | null = null`.
- Add `export class TelegramSessionExpiredError extends Error` with `reason` and `revokedAt` fields so callers can distinguish auth loss from generic runtime errors.

Update `getTelegramClient()` to gate the real runtime path before creating a new client:

- Keep the existing mock-mode short-circuit intact.
- If `authCleanupPromise` is active, wait for it to settle and then throw `TelegramSessionExpiredError` instead of racing a second client build.
- If `authRevokedState` is set and `process.env.TELEGRAM_SESSION` still matches the revoked session, throw `TelegramSessionExpiredError` immediately.
- If a fresh session string has been written since revocation, clear `authRevokedState` and continue with normal singleton creation so web re-auth can recover in-process.
- Record the session string used for the current singleton once `importSession()` and `connect()` succeed.

`closeTelegramClient()` stays a shutdown helper. Do not repurpose it for revoke cleanup; the revoke path needs logout plus persisted-state deletion, not only `disconnect()`.

## Phase 2: Error detection

Add terminal auth detection in `src/telegram.ts` and install it on the real mtcute client before any connection work:

- Define `const TERMINAL_AUTH_TEXTS = new Set(["AUTH_KEY_UNREGISTERED", "SESSION_REVOKED", "SESSION_EXPIRED", "USER_DEACTIVATED", "USER_DEACTIVATED_BAN"])`.
- Add `function getAuthFailureReason(err: unknown): string | null` using `tl.RpcError.is(err)` and exact-text matching against `TERMINAL_AUTH_TEXTS`.
- Treat unknown `401` errors as investigation-only: log at `WARN`, but do not trigger cleanup unless the text is in the allowlist from the RFC.
- Add `attachAuthExpiryHandler(current: TelegramClient): void` and call it immediately after `new TelegramClient(...)`, before `importSession()` and `connect()`.

The handler should:

- Ignore non-auth failures such as `FLOOD_WAIT`, disconnects, and generic transport issues.
- Deduplicate concurrent signals by checking `authCleanupPromise` first.
- Start `autoLogoutCurrentSession(current, reason)` exactly once per revoked singleton.

## Phase 3: Cleanup flow

Implement the revoke cleanup in `src/telegram.ts` as a single helper, for example `autoLogoutCurrentSession(current, reason): Promise<void>`.

Required order:

1. Set `authRevokedState` and `authCleanupPromise` before awaiting anything.
2. Best-effort `await current.logOut()`.
3. If `logOut()` fails, log at `WARN` and call `await current.notifyLoggedOut()` as the local-state fallback.
4. `await current.destroy()` and clear the module-level `client` if it still points at `current`.
5. Clear runtime session artifacts:
   - remove `TELEGRAM_SESSION` from `.env` via `loadEnv()` / `saveEnv()`
   - delete `process.env.TELEGRAM_SESSION`
   - remove `bot-data/session`, `bot-data/session-wal`, and `bot-data/session-shm`
6. Always clear `authCleanupPromise` in `finally`.

Constraints for this phase:

- The cleanup is best-effort. A failed `logOut()` must not block `notifyLoggedOut()`, file deletion, or future `auth required` responses.
- Do not delete `bot-data/auth-session*` or `bot-data/web-auth-session*`; those are owned by separate auth flows.
- Multiple `client.onError` events and in-flight tool calls must converge on the same cleanup promise.

## Phase 4: `server.ts` mapping

Map revoked-session failures in `src/server.ts`, not in `src/auth.ts`.

Implementation plan:

- Introduce a request-scoped wrapper for tool handlers in `src/server.ts` because MCP SDK `1.26.x` converts uncaught handler exceptions to generic internal errors before the outer `fetch()` catch can shape the response.
- Change `createMcpServer()` / `registerTools()` to accept the current `Request` and `port`, or add an equivalent closure-based wrapper around every `server.tool(...)` callback.
- In that wrapper, catch `TelegramSessionExpiredError` from `getTelegramClient()` (or a small `withTelegramClient()` helper from `src/telegram.ts`) and convert it to a stable MCP/JSON-RPC error:
  - `code: -32001`
  - `message: "Telegram session expired or was revoked. Re-authentication is required."`
  - `data: { authRequired: true, reason, revokedAt, authUrl }`
- Keep the existing generic `-32603` path for unrelated failures.

`authUrl` generation must follow the RFC decision order:

- `PUBLIC_BASE_URL` first if set.
- Otherwise use forwarded/origin headers only when they come from a trusted proxy check implemented in `src/server.ts`.
- Fall back to `http://localhost:${port}` for local development.

If repeated auth-required responses need a stable token, add a narrow helper in `src/web-auth.ts` such as `ensureSetupToken()` and reuse it from both startup logging and revoke responses. Do not log the raw token.

## Validation

Automated coverage:

- Add `src/telegram.test.ts` for `TERMINAL_AUTH_TEXTS` classification, unknown-`401` non-cleanup behavior, fail-fast `getTelegramClient()` behavior, and cleanup deduplication when multiple revocation signals arrive concurrently.
- Add filesystem/env cleanup tests that assert `.env`, `process.env.TELEGRAM_SESSION`, and `bot-data/session*` sidecars are removed while `bot-data/auth-session*` and `bot-data/web-auth-session*` are left alone.
- Add `src/server.test.ts` for the JSON-RPC mapping: `-32001`, `authRequired: true`, correct `reason`, and an `authUrl` built from the selected base URL source.
- Keep existing mock-mode tests green; non-auth failures must still surface through the normal error path.

Manual validation:

- Start the server with a real session, revoke that session from Telegram settings, and confirm the next tool call returns the auth-required error instead of `-32603`.
- Verify that a failed `logOut()` still clears runtime state and that the server does not recreate the revoked singleton.
- Complete the existing `/auth` web flow and confirm the next tool call builds a fresh singleton without restarting the process.
- Check edge cases explicitly: concurrent revocation signals, repeated auth-required requests, failed `notifyLoggedOut()`, and non-auth mtcute errors such as `FLOOD_WAIT`.

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
