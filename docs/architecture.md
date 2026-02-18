# Architecture

## Overview

telegram-mcp is an MCP (Model Context Protocol) server that exposes Telegram functionality as tools via Streamable HTTP transport.

```
Client (Claude/OpenClaw/mcporter)
  ↕ HTTP POST/GET/DELETE on /mcp
MCP Server (server.ts)
  ↕ Tool calls
TelegramClient singleton (telegram.ts)
  ↕ MTProto
Telegram servers
```

## Components

### `src/index.ts`
Entry point. Calls `startServer()`.

### `src/server.ts`
- Creates `McpServer` instances (one per session)
- Registers all MCP tools via `registerTools()`
- Manages HTTP transport with `WebStandardStreamableHTTPServerTransport`
- Session lifecycle: initialize → route by `Mcp-Session-Id` header → cleanup on close
- Helper functions: `jsonResponse()` (bigint-safe), `formatMessage()`, `parseChatId()`

### `src/telegram.ts`
- Singleton `TelegramClient` from `@mtcute/bun`
- `getTelegramClient()` — lazy init, connects on first call
- When `TELEGRAM_MOCK=true`, returns mock client instead (see [testing.md](testing.md))
- Auth via session string (`TELEGRAM_SESSION` env var)

### `src/auth.ts`
- Interactive QR-code authentication flow
- Generates session string for `TELEGRAM_SESSION`
- Run via `bun auth`

### `src/mock/`
- `client.ts` — Mock implementation of TelegramClient interface
- `fixtures.ts` — In-memory test data (chats, messages, media)
- Used when `TELEGRAM_MOCK=true`

## Session Management

Each MCP client gets its own session (UUID). Sessions are stored in a `Map<string, {server, transport}>`. All sessions share the same TelegramClient singleton.

Request routing:
1. POST without session ID + `initialize` method → create new session
2. Any request with valid session ID → route to session's transport
3. Unknown session ID → 404
4. DELETE → close session

## Security Considerations

- The `/mcp` endpoint has no authentication (runs on private network / tailscale)
- All current tools are read-only
- Future write tools (send/forward) should use a chat whitelist
