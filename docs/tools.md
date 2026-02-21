# MCP Tools Reference

## Configuration

Write tools (e.g. `delete_messages`) require explicit opt-in via `bot-data/config.yml`.
See `bot-data/config.example.yml` for the full schema.

If no config file is present, all write tools are disabled.

---

## search_dialogs

Search Telegram dialogs by display name or username.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string | yes | — | Search query (min 1 char) |
| limit | number | no | 10 | Max results |

**Returns:** `{ query, count, dialogs: [{ type, id, name, username, unreadCount }] }`

**Example:**
```bash
curl -X POST http://localhost:3000/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_dialogs","arguments":{"query":"john"}}}'
```

## get_messages

Get messages from a chat with optional filtering.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chatId | string | yes | — | Numeric ID or @username |
| limit | number | no | 20 | Max messages |
| minDate | string | no | — | ISO date, messages after |
| maxDate | string | no | — | ISO date, messages before |
| onlyUnread | boolean | no | false | Only unread messages |
| markAsRead | boolean | no | false | Mark as read after fetch |

**Modes:**
- Default: `iterHistory()` — latest messages
- Date filter: `iterSearchMessages()` — when minDate/maxDate set
- Unread: `iterHistory(minId: lastReadIngoing)` — when onlyUnread=true

**Returns:** `{ chatId, mode, limit, filters, count, messages: [{ id, date, sender, chat, text, mediaType }] }`

## search_messages

Search messages by text query. Searches globally or within a specific chat.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string | yes | — | Search text (min 1 char) |
| chatId | string | no | — | Scope to specific chat (numeric ID or @username) |
| limit | number | no | 20 | Max messages |
| minDate | string | no | — | ISO date, messages after |
| maxDate | string | no | — | ISO date, messages before |

**Returns:** `{ query, chatId, count, messages: [{ id, date, sender, chat, text, mediaType }] }`

**Example:**
```bash
curl -X POST http://localhost:3000/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_messages","arguments":{"query":"meeting","chatId":"100001"}}}'
```

## media_download

Download media from a message to a local file.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| chatId | string | yes | Numeric ID or @username |
| messageId | number | yes | Message ID with media |
| filename | string | yes | Local path to save file |

**Returns:** `{ status, chatId, messageId, filename, mediaType, message }`

**Errors:** Throws if message not found, no media, or media type not downloadable.

## message_from_link

Fetch a message by its Telegram link.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| link | string | yes | t.me link (e.g. `https://t.me/channel/123`) |

**Returns:** `{ link, found, message? }`

## delete_messages

Delete messages from a chat. Requires config opt-in.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chatId | string | yes | — | Numeric ID or @username |
| messageIds | number[] | yes | — | Message IDs to delete |
| revoke | boolean | no | false | Delete for all participants |

**Returns:** `{ chatId, deletedCount, messageIds, revoke }`

**Config required:** Must be enabled in `bot-data/config.yml` with the target chat in `allowed_chats`. Throws an error if not configured.
