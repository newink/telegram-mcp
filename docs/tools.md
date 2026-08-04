# MCP Tools Reference

Write tools require explicit opt-in in `bot-data/config.yml`. With no config,
all write tools are disabled.

Every message object uses:

| Field | Type | Meaning |
|---|---|---|
| `id` | number | Message ID inside the chat |
| `date` | ISO string | Telegram message timestamp |
| `chatId` | string | Stable chat identity |
| `chat` | string or null | Chat display name |
| `chatUsername` | string or null | Public source username |
| `senderId` | string or null | Stable sender identity |
| `sender` | string | Sender display name |
| `senderUsername` | string or null | Sender username without `@` |
| `senderHandle` | string or null | Sender username with `@` |
| `text` | string | Text or caption, otherwise `[no text]` |
| `mediaType` | string or null | Telegram media type |
| `sourceUrl` | string or null | Canonical public message URL |

`sourceUrl` is null for private groups, direct messages, and sources without a
public username.

## search_dialogs

Search dialogs by display name or username.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `query` | string | yes | — |
| `limit` | positive integer | no | `10` |

Returns `{ query, count, dialogs }`; each dialog has `type`, `id`, `name`,
`username`, and `unreadCount`.

## get_messages

Fetch messages from one chat with optional date or unread filters.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `chatId` | string | yes | — |
| `limit` | integer `1..500` | no | `20` |
| `minDate` | ISO string | no | — |
| `maxDate` | ISO string | no | — |
| `onlyUnread` | boolean | no | `false` |
| `markAsRead` | boolean | no | `false` |

With a date filter, messages are returned oldest to newest and tied timestamps
are ordered by message ID.

Returns:

```json
{
  "chatId": "@project_alpha",
  "mode": "date_search",
  "limit": 500,
  "filters": {
    "minDate": "2026-07-30T07:00:00.000Z",
    "maxDate": "2026-07-30T09:00:00.000Z",
    "onlyUnread": false,
    "markAsRead": false
  },
  "count": 3,
  "limitReached": false,
  "messages": []
}
```

`limitReached` is true when `count` equals the requested limit. It signals
possible truncation, so a summary agent must split the interval before
claiming complete coverage.

## search_messages

Full-text search globally or within one chat.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `query` | string | yes | — |
| `chatId` | string | no | all chats |
| `limit` | positive integer | no | `20` |
| `minDate` | ISO string | no | — |
| `maxDate` | ISO string | no | — |

Use this for explicit keyword searches, not complete range retrieval.

## media_download

Download media from a message.

| Parameter | Type | Required |
|---|---|---|
| `chatId` | string | yes |
| `messageId` | positive integer | yes |
| `filename` | string | yes |

Returns the saved filename, media type, and formatted source message.

## message_from_link

Fetch a message from a public or private `t.me` message link.

| Parameter | Type | Required |
|---|---|---|
| `link` | string | yes |

Returns `{ link, found, message? }`.

The remaining tools write to Telegram. `send_message`, `send_file`, and
`delete_messages` each require:

```yaml
tools:
  send_message:
    enabled: true
    allowed_chats:
      - "me"
```

Each tool checks its own named block and the requested chat on every call.
These tools are outside the read-only summary workflow.

## send_message

Parameters: `chatId`, `text`, optional `disableWebPreview` (default `true`).

## send_file

Parameters: `chatId`, `filePath`, optional `caption`.

## delete_messages

Parameters: `chatId`, non-empty `messageIds`, optional `revoke` (default
`true`).
