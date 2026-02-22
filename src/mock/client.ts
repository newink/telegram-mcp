/**
 * Mock TelegramClient for testing without real Telegram connection.
 * Implements the subset of TelegramClient methods used by server.ts tools.
 */

import { MOCK_CHATS, type MockChat, type MockMessage } from "./fixtures.ts";

function findChat(chatId: string | number): MockChat | undefined {
  if (typeof chatId === "string") {
    const username = chatId.replace(/^@/, "");
    return MOCK_CHATS.find((c) => c.username === username);
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

    async *iterHistory(chatId: string | number, opts?: { limit?: number; minId?: number }) {
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
      chatId?: string | number;
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

    async getPeerDialogs(chatIds: (string | number)[]) {
      return chatIds.map((id) => {
        const chat = findChat(id);
        if (!chat) return undefined;
        return {
          ...toMockDialog(chat),
          lastReadIngoing: chat.lastReadIngoing,
        };
      });
    },

    async readHistory(_chatId: string | number) {
      // no-op in mock
    },

    async getMessages(chatId: string | number, messageIds: number[]) {
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
      _chatId: string | number,
      _messageIds: number[],
      _opts?: { revoke?: boolean },
    ) {
      // no-op in mock
    },

    async sendText(chatId: string | number, text: string, _params?: unknown) {
      const chat = findChat(chatId) || MOCK_CHATS[0] as MockChat; // fallback to first chat if not found
      if (!chat) {
          throw new Error("No mock chat available");
      }
      const msgId = Math.max(0, ...chat.messages.map((m) => m.id)) + 1;
      const newMsg: MockMessage = {
        id: msgId,
        date: new Date(),
        text,
        senderName: "Me",
      };
      
      // We don't actually mutate MOCK_CHATS here to keep tests deterministic,
      // but we return a properly formatted mock message.
      return toMockMessageObj(newMsg, chat);
    },

    // Stub for connect/importSession used in telegram.ts
    async connect() {},
    async importSession(_session: string) {},
  };
}
