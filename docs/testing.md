# Testing

## Mock Mode

Since MTProto requires real authentication, all testing uses a mock client.

```bash
TELEGRAM_MOCK=true bun dev     # Start server with mock data
TELEGRAM_MOCK=true bun test    # Run test suite
```

When `TELEGRAM_MOCK=true`, `getTelegramClient()` returns a mock client from `src/mock/client.ts` instead of connecting to Telegram.

## Mock Data (Fixtures)

Defined in `src/mock/fixtures.ts`:

- **3 user chats**: Alice Johnson, Bob Smith, Charlie Dev
- **2 groups**: Project Alpha, Random Chat
- **2 channels**: Tech News, Announcements
- Each has 5-10 messages
- One chat includes a media message (photo)

## Writing Tests

Tests use Bun's built-in test runner. Place test files in `src/__tests__/`.

```typescript
import { describe, test, expect } from "bun:test";
// Tests automatically use mock when TELEGRAM_MOCK=true
```

## Adding Mock Data

Edit `src/mock/fixtures.ts` to add chats or messages. The mock client in `src/mock/client.ts` reads from these fixtures.

To support a new tool in mock mode, add the corresponding method to `MockTelegramClient` in `src/mock/client.ts`.
