# MTProto & mtcute

## What is MTProto?

MTProto is Telegram's native protocol (not the Bot API). It provides full userbot access — everything a regular Telegram client can do.

## mtcute

We use [@mtcute/bun](https://mtcute.dev/) — a TypeScript MTProto library with first-class Bun support.

Key classes used:
- `TelegramClient` — main client, handles connection and API calls
- `FileLocation` — represents downloadable media
- `Message` — message object with text, media, sender info
- `Dispatcher` — event handling (currently unused, removed as dead code)

## Authentication

MTProto requires a real phone number. No sandbox/test accounts exist.

1. Get `API_ID` and `API_HASH` from https://my.telegram.org
2. Run `bun auth` — displays QR code, you scan with Telegram mobile
3. Exports a session string → set as `TELEGRAM_SESSION` env var

Session strings are sensitive — they grant full account access.

## Common Pitfalls

### FLOOD_WAIT
Telegram rate-limits aggressively. Any API call can return `FLOOD_WAIT_X` (wait X seconds). mtcute handles basic flood wait automatically but long waits (>60s) should be logged and possibly aborted.

### Chat ID Types
- Users: positive numbers
- Groups: negative numbers (legacy) or access hash based
- Channels: negative numbers prefixed with -100
- Usernames: `@username` strings

`parseChatId()` in server.ts converts digit-only chat IDs to `bigint` and preserves usernames as strings.

### bigint IDs
Some Telegram IDs are `bigint`. JSON.stringify fails on bigint. Always use `jsonResponse()` helper which converts bigint to string.

### Session Storage
Session data is stored in `bot-data/session` (SQLite via mtcute). The session string in `TELEGRAM_SESSION` is the initial import; ongoing state lives in the SQLite file.

## API Methods Used

| mtcute method | Used in tool |
|--------------|-------------|
| `iterDialogs()` | `search_dialogs` |
| `iterHistory()` | `get_messages` |
| `iterSearchMessages()` | `get_messages` (date filter) |
| `getPeerDialogs()` | `get_messages` (unread mode) |
| `readHistory()` | `get_messages` (markAsRead) |
| `getMessages()` | `media_download` |
| `downloadToFile()` | `media_download` |
| `getMessageByLink()` | `message_from_link` |
