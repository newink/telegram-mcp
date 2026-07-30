![telegram-mcp cover](docs/cover.jpg)

<div align="center">

# telegram-mcp

**Turn Telegram group history into source-linked summaries with Codex or Claude.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.x-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-6366f1)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-passing-22c55e)](src/smoke.test.ts)
[![Docker](https://img.shields.io/docker/pulls/newink/telegram-mcp)](https://hub.docker.com/r/newink/telegram-mcp)

</div>

---

## What is this?

**telegram-mcp** is an [MCP server](https://modelcontextprotocol.io) and a
portable agent skill for summarizing Telegram discussions over exact time
ranges. It uses **MTProto** rather than Bot API, so it can read groups and
channels already available to your Telegram account without adding a bot.

Connect it to Codex, Claude, or another MCP client. The client resolves the
requested source, reads complete bounded windows, removes overlap, and returns
topic and participant summaries with traceable source links.

---

## Summary-first use cases

**One group**

```text
Summarize @project_alpha from 30 July 2026 10:00 to 12:00 Europe/Moscow.
Include participant contributions, decisions, risks, resources, and sources.
```

**Several groups**

```text
Summarize Project Alpha and Build Room from Monday 09:00 until now.
Keep coverage and sources separate for each group, then show shared topics.
```

**Search and research**

- Find a historical message or exact resource link.
- Compare how several communities discussed the same topic.
- Download and inspect referenced media when the user asks for it.

---

## Tools

| Tool | Description |
|------|-------------|
| `search_dialogs` | Search chats, groups, and channels by name or username |
| `get_messages` | Fetch messages with date range, unread filter, and mark-as-read support |
| `search_messages` | Full-text search across all chats or within a specific chat |
| `media_download` | Download media (photo, video, document) from a message to a local file |
| `message_from_link` | Fetch a message by its `t.me/...` link |
| `delete_messages` | Delete messages from a chat (requires opt-in via `bot-data/config.yml`) |
| `send_message` | Send a text message to a chat (requires opt-in via `bot-data/config.yml`) |
| `send_file` | Send a local file to a chat as a document (requires opt-in via `bot-data/config.yml`) |

Full reference with parameters and examples → [docs/tools.md](docs/tools.md)

---

## Quick Start

### 1. Get Telegram API credentials

Go to [my.telegram.org](https://my.telegram.org), create an app, and grab your `API_ID` and `API_HASH`.

### 2. Install

```bash
git clone https://github.com/newink/telegram-mcp.git
cd telegram-mcp
bun install

cp .env.example .env
# Fill in TELEGRAM_API_ID and TELEGRAM_API_HASH
```

### 3. Start and authorize via browser

```bash
bun start
```

If no session is configured, the server starts in setup mode and prints an auth URL:

```
WARN: auth required — open URL to connect Telegram account
      url: "http://localhost:3000/auth?token=a3f9b2c1-..."
```

Open the URL in your browser — you'll see an auth page where you can sign in with a **QR code** (scan with Telegram → Settings → Devices → Link Desktop Device) or your **phone number**. After signing in, the session is saved to `.env` and the server is ready.

> **One-time token** — the `/auth` URL is only valid once per server start and expires after successful login. Restarting the server generates a new token.

That's it. Point your MCP client at `http://localhost:3000/mcp`.

---

### Prefer the terminal? Use `bun run auth`

```bash
bun run auth
# Interactive CLI: QR code or phone number, saves session to .env
bun start
```

Both flows produce the same result — pick whichever fits your setup.

---

## Docker

Run with Docker Compose — no Bun installation needed:

```bash
cp .env.example .env
# Fill in TELEGRAM_API_ID and TELEGRAM_API_HASH

docker compose up
```

The first time you start the container without a `TELEGRAM_SESSION`, it will print an auth URL — open it in your browser to sign in. The session is persisted to `./bot-data/` so you only need to auth once.

<details>
<summary>Manual docker run</summary>

```bash
docker build -t telegram-mcp .

docker run -p 3000:3000 \
  --env-file .env \
  -e ENV_FILE=/app/bot-data/.env \
  -v ./bot-data:/app/bot-data \
  telegram-mcp
```

</details>

### Pull pre-built image

```bash
# Latest stable
docker pull newink/telegram-mcp

# Or from GitHub Container Registry
docker pull ghcr.io/newink/telegram-mcp
```

Supported platforms: `linux/amd64`, `linux/arm64` (Raspberry Pi, Apple Silicon via Rosetta).

---

## How the summary agent works

1. Normalize the inclusive start, end, and timezone.
2. Resolve each group or channel without guessing ambiguous names.
3. Read up to 500 messages per bounded request without marking them as read.
4. Split saturated intervals into smaller overlapping windows.
5. Verify coverage and stop safely on Telegram access errors.
6. Deduplicate overlaps and sort messages chronologically.
7. Cluster substantive topics and attribute each claim to participants.
8. Cite public Telegram messages and preserve external URLs exactly.
9. Separate facts from conclusions and disclose partial reads or uninspected
   attachments.

The packaged skill is
[`.agents/skills/telegram-summary/SKILL.md`](.agents/skills/telegram-summary/SKILL.md).
It is read-only: summary requests never invoke Telegram write tools.

Representative result:

```text
### Runtime upgrade
- Anna (@anna) proposed the upgrade after mock CI.
- Boris (@boris) identified a container compatibility risk and requested a smoke test.
- Decision: run both checks before reconsidering the upgrade.
- Sources: https://t.me/project_alpha/5101, https://t.me/project_alpha/5102
```

Private groups receive message IDs instead of fabricated public links. Media
contents are excluded unless the attachment was explicitly downloaded and
inspected.

---

## Connect to Your AI Client

### Codex

This repository includes `.codex/config.toml`:

```toml
[mcp_servers.telegram]
url = "http://localhost:3000/mcp"
```

Start the MCP server, open the repository in Codex, and ask for a
date-and-source summary. The packaged skill provides the orchestration
contract.

### Claude Desktop

Start the server first (`bun start`), then add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### mcporter / OpenClaw

```json
{
  "mcpServers": {
    "telegram": {
      "baseUrl": "http://localhost:3000/mcp"
    }
  }
}
```

### Direct HTTP (any client)

```bash
# Initialize session first, then call tools:
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_dialogs","arguments":{"query":"news"}}}'
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_API_ID` | Yes* | From [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_API_HASH` | Yes* | From [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_SESSION` | Yes* | Generated by browser auth or `bun run auth` |
| `PORT` | No | Server port (default: `3000`) |
| `LOG_LEVEL` | No | Pino log level: `trace\|debug\|info\|warn\|error` (default: `info`) |
| `TELEGRAM_MOCK` | No | Set `true` to use mock data (no real Telegram needed) |
| `TELEGRAM_MCP_CONFIG` | No | Write-tool allowlist path (default: `bot-data/config.yml`) |
| `KEEPALIVE_INTERVAL_MS` | No | Session keepalive interval (default: 6 hours) |

*Not required when `TELEGRAM_MOCK=true`.

---

## Development

```bash
bun dev              # Start with hot reload
bun test             # Run tests (uses mock automatically)
bun run typecheck    # TypeScript check
bun run lint         # Biome lint + format
bun run lint:fix     # Auto-fix lint issues
bun run knip         # Find dead code
bun run audit        # Dead code, docs, env coverage, and TODO checks
```

**Mock mode** — develop and test without a real Telegram account:

```bash
TELEGRAM_MOCK=true bun dev   # server with fake data
TELEGRAM_MOCK=true bun test  # run tests
```

Mock data includes sample dialogs, messages, and media — enough to build and test new tools without touching the real API.

Project structure and architecture → [docs/architecture.md](docs/architecture.md)
MTProto specifics and gotchas → [docs/mtproto.md](docs/mtproto.md)
Adding new tools → [docs/tools.md](docs/tools.md)
Testing and BDD scenarios → [docs/testing.md](docs/testing.md)

---

## Built With

- [Bun](https://bun.sh) — runtime & package manager
- [mtcute](https://github.com/mtcute/mtcute) — MTProto client for TypeScript
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server SDK
- [Zod](https://github.com/colinhacks/zod) — schema validation
- [Biome](https://biomejs.dev) — linter & formatter

---

## License

MIT
