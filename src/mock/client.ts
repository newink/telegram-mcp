/**
 * Mock TelegramClient for testing without real Telegram connection.
 * Implements the subset of TelegramClient methods used by server.ts tools.
 */

import { MOCK_CHATS, type MockChat, type MockMessage } from "./fixtures.ts";

type MockChatId = string | number | bigint;

function findChat(chatId: MockChatId): MockChat | undefined {
  if (typeof chatId === "string") {
    const username = chatId.replace(/^@/, "");
    return MOCK_CHATS.find((c) => c.username === username);
  }
  if (typeof chatId === "bigint") {
    return MOCK_CHATS.find((c) => BigInt(c.id) === chatId);
  }
  return MOCK_CHATS.find((c) => c.id === chatId);
}

function toMockMessageObj(msg: MockMessage, chat: MockChat) {
  return {
    id: msg.id,
    date: msg.date,
    text: msg.text || "",
    sender: { displayName: msg.senderName },
    chat: { displayName: chat.name },
    media: msg.mediaType ? { type: msg.mediaType, [Symbol.toStringTag]: "FileLocation" } : null,
  };
}

function toMockDialog(chat: MockChat) {
  return {
    peer: {
      id: chat.id,
      displayName: chat.name,
      username: chat.username ?? null,
      type: chat.type === "user" ? "user" : chat.type,
      chatType: chat.type,
    },
    unreadCount: chat.unreadCount,
    lastReadIngoing: chat.lastReadIngoing,
  };
}

export function createMockClient() {
  return {
    async *iterDialogs() {
      for (const chat of MOCK_CHATS) {
        yield toMockDialog(chat);
      }
    },

    async *iterHistory(chatId: MockChatId, opts?: { limit?: number; minId?: number }) {
      const chat = findChat(chatId);
      if (!chat) return;
      let messages = [...chat.messages].reverse(); // newest first
      if (opts?.minId) {
        const minId = opts.minId;
        messages = messages.filter((m) => m.id > minId);
      }
      const limit = opts?.limit ?? 20;
      for (const msg of messages.slice(0, limit)) {
        yield toMockMessageObj(msg, chat);
      }
    },

    async *iterSearchMessages(opts?: {
      chatId?: MockChatId;
      query?: string;
      minDate?: Date;
      maxDate?: Date;
      limit?: number;
    }) {
      const chats = opts?.chatId ? [findChat(opts.chatId)].filter(Boolean) : MOCK_CHATS;
      const limit = opts?.limit ?? 20;
      let count = 0;

      for (const chat of chats as MockChat[]) {
        for (const msg of [...chat.messages].reverse()) {
          if (count >= limit) return;
          if (opts?.query && !msg.text.toLowerCase().includes(opts.query.toLowerCase())) continue;
          if (opts?.minDate && msg.date < opts.minDate) continue;
          if (opts?.maxDate && msg.date > opts.maxDate) continue;
          yield toMockMessageObj(msg, chat);
          count++;
        }
      }
    },

    async getPeerDialogs(chatIds: MockChatId[]) {
      return chatIds.map((id) => {
        const chat = findChat(id);
        if (!chat) return undefined;
        return {
          ...toMockDialog(chat),
          lastReadIngoing: chat.lastReadIngoing,
        };
      });
    },

    async readHistory(_chatId: MockChatId) {
      // no-op in mock
    },

    async getMessages(chatId: MockChatId, messageIds: number[]) {
      const chat = findChat(chatId);
      if (!chat) return messageIds.map(() => null);
      return messageIds.map((id) => {
        const msg = chat.messages.find((m) => m.id === id);
        if (!msg) return null;
        return toMockMessageObj(msg, chat);
      });
    },

    async downloadToFile(filename: string, _media: unknown) {
      // In mock mode, create an empty file
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filename, "MOCK_MEDIA_CONTENT");
    },

    async getMessageByLink(link: string) {
      // Parse link and try to find message
      const match = link.match(/\/(\d+)\s*$/);
      if (!match) return null;
      const msgId = Number(match[1]);
      for (const chat of MOCK_CHATS) {
        const msg = chat.messages.find((m) => m.id === msgId);
        if (msg) return toMockMessageObj(msg, chat);
      }
      return null;
    },

    async deleteMessagesById(
      _chatId: MockChatId,
      _messageIds: number[],
      _opts?: { revoke?: boolean },
    ) {
      // no-op in mock
    },

    async sendText(_chatId: MockChatId, text: string, _opts?: { disableWebPreview?: boolean }) {
      return {
        id: Math.floor(Math.random() * 100000),
        date: new Date(),
        text,
        sender: { displayName: "Mock User" },
        chat: { displayName: "Mock Chat" },
        media: null,
      };
    },

    async sendMedia(_chatId: MockChatId, args: { type: string; file: string; caption?: string }) {
      if (args.file.includes("__mock_eacces__")) {
        throw Object.assign(new Error(`EACCES: permission denied, open '${args.file}'`), {
          code: "EACCES",
        });
      }

      return {
        id: Math.floor(Math.random() * 100000),
        date: new Date(),
        text: args.caption ?? "",
        sender: { displayName: "Mock User" },
        chat: { displayName: "Mock Chat" },
        media: { type: args.type },
      };
    },

    // Stubs for connect/importSession/call/getMe used in telegram.ts
    async connect() {},
    async importSession(_session: string) {},
    async call(_request: unknown) {
      return {};
    },
    async getMe() {
      return { id: 100001, displayName: "Mock User", username: "mockuser" };
    },
  };
}
