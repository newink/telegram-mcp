# Architecture

## System boundary

`telegram-mcp` exposes atomic Telegram operations. Codex, Claude, or another
MCP client owns the reasoning loop and produces the final summary.

```text
User request
    |
Codex / Claude + telegram-summary skill
    |
Streamable HTTP MCP endpoint (/mcp)
    |
MCP tools (src/server.ts)
    |
TelegramClient singleton (src/telegram.ts)
    |
Telegram MTProto
```

The server does not embed an LLM, schedule background summaries, or combine
reading and writing into one tool.

## Summary orchestration

The portable `.agents/skills/telegram-summary/SKILL.md` directs the MCP client
to:

1. normalize the requested time range;
2. resolve each source;
3. read bounded message windows;
4. split saturated windows and verify coverage;
5. deduplicate and sort messages;
6. summarize topics and participant contributions;
7. cite sources and state limitations.

Multiple sources are retrieved independently so coverage remains auditable.
The agent may combine shared topics only after retrieval.

## Components

### `src/index.ts`

Loads the configured environment file and starts the server.

### `src/server.ts`

- creates an MCP server for each stateless HTTP request;
- registers all Telegram tools;
- validates input with Zod;
- formats bigint-safe JSON;
- exposes browser authentication routes;
- converts messages into stable identity and source metadata.

### `src/telegram.ts`

- owns the single real `TelegramClient`;
- connects lazily and supports keepalive checks;
- returns the mock client when `TELEGRAM_MOCK=true`;
- surfaces terminal authentication failures for re-authentication.

### `src/web-auth.ts` and `src/auth.ts`

Provide browser and terminal Telegram authentication. Both persist the session
to the configured environment file.

### `src/config.ts`

Loads the write-tool allowlist from `bot-data/config.yml` or
`TELEGRAM_MCP_CONFIG`. Missing configuration leaves every write tool disabled.

### `src/mock/`

Contains deterministic dialogs, messages, senders, and media used by all
automated tests. Tests never connect to Telegram.

## Read and write boundaries

Read tools are available to MCP clients. `send_message`, `send_file`, and
`delete_messages` are separate capabilities guarded by explicit per-tool chat
allowlists. The summary skill never invokes them.

## Failure behavior

MTProto may return `FLOOD_WAIT`, revoked sessions, or inaccessible history.
The server surfaces failures; the orchestration layer reports the covered and
missing intervals rather than automatically retrying or claiming completeness.

## Network security

The MCP endpoint has no built-in application authentication. Bind it to a
trusted network, localhost, VPN, or authenticated reverse proxy. Forwarded
authentication URLs are accepted only from configured trusted proxies.
