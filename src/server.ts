import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { FileLocation, type Message } from "@mtcute/bun";
import { z } from "zod";
import { log } from "./logger.ts";
import { getTelegramClient } from "./telegram.ts";

function createMcpServer() {
  const server = new McpServer({
    name: "mcp-telegram",
    version: "0.1.0",
  });
  registerTools(server);
  return server;
}

function jsonResponse(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          payload,
          (_key, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        ),
      },
    ],
  };
}

function parseIsoDate(value: string | undefined, fieldName: string) {
  if (!value) return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}: expected ISO date string`);
  }

  return parsed;
}

function normalizeDialogType(peer: {
  type?: string;
  chatType?: string;
}): "user" | "group" | "channel" {
  if (peer.type === "user" || peer.type === "bot") return "user";

  const chatType = peer.chatType ?? peer.type;
  if (chatType === "channel") return "channel";

  return "group";
}

function formatMessage(msg: Message) {
  return {
    id: msg.id,
    date: msg.date.toISOString(),
    sender: msg.sender?.displayName ?? "Unknown",
    chat: msg.chat?.displayName ?? null,
    text: msg.text || "[no text]",
    mediaType: msg.media?.type ?? null,
  };
}

function parseChatId(chatId: string): string | number {
  return /^\d+$/.test(chatId) ? Number(chatId) : chatId;
}

function registerTools(server: McpServer) {
  server.tool(
    "search_dialogs",
    "Search your Telegram dialogs by display name or username. Returns matching users, groups, and channels with their IDs.",
    {
      query: z.string().min(1).describe("Search query"),
      limit: z.number().int().positive().default(10).describe("Max results to return"),
    },
    async ({ query, limit }) => {
      const tg = await getTelegramClient();
      const normalizedQuery = query.toLowerCase();
      const dialogs: Array<{
        type: "user" | "group" | "channel";
        id: number;
        name: string;
        username: string | null;
        unreadCount: number;
      }> = [];

      for await (const dialog of tg.iterDialogs()) {
        const name = dialog.peer.displayName ?? "";
        const username = dialog.peer.username ?? null;
        const match =
          name.toLowerCase().includes(normalizedQuery) ||
          username?.toLowerCase().includes(normalizedQuery);
        if (!match) continue;

        dialogs.push({
          type: normalizeDialogType(dialog.peer),
          id: dialog.peer.id,
          name,
          username,
          unreadCount: dialog.unreadCount,
        });

        if (dialogs.length >= limit) break;
      }

      return jsonResponse({
        query,
        count: dialogs.length,
        dialogs,
      });
    },
  );

  server.tool(
    "get_messages",
    "Get messages from a Telegram chat. Supports date range filtering, unread-only mode, and marking messages as read. Use a numeric chat ID or @username as chatId.",
    {
      chatId: z.string().describe("Numeric chat ID (as string) or @username"),
      limit: z.number().int().positive().default(20).describe("Max messages"),
      minDate: z.string().optional().describe("Only messages after this ISO date"),
      maxDate: z.string().optional().describe("Only messages before this ISO date"),
      onlyUnread: z.boolean().default(false).describe("Only fetch unread messages"),
      markAsRead: z.boolean().default(false).describe("Mark fetched messages as read"),
    },
    async ({ chatId: rawChatId, limit, minDate, maxDate, onlyUnread, markAsRead }) => {
      const chatId = parseChatId(rawChatId);
      const tg = await getTelegramClient();
      const parsedMinDate = parseIsoDate(minDate, "minDate");
      const parsedMaxDate = parseIsoDate(maxDate, "maxDate");
      const fetched: Message[] = [];

      if (parsedMinDate && parsedMaxDate && parsedMinDate.getTime() > parsedMaxDate.getTime()) {
        throw new Error("Invalid date range: minDate must be <= maxDate");
      }

      let mode: "history" | "unread" | "date_search" = "history";

      if (parsedMinDate || parsedMaxDate) {
        mode = "date_search";
        for await (const msg of tg.iterSearchMessages({
          chatId,
          minDate: parsedMinDate,
          maxDate: parsedMaxDate,
          limit,
        })) {
          fetched.push(msg);
        }
      } else if (onlyUnread) {
        mode = "unread";
        const [dialog] = await tg.getPeerDialogs([chatId]);
        if (!dialog) {
          throw new Error(`Dialog not found for chatId: ${chatId}`);
        }

        for await (const msg of tg.iterHistory(chatId, {
          minId: dialog.lastReadIngoing,
          limit,
        })) {
          fetched.push(msg);
        }
      } else {
        for await (const msg of tg.iterHistory(chatId, { limit })) {
          fetched.push(msg);
        }
      }

      if (markAsRead) {
        await tg.readHistory(chatId);
      }

      return jsonResponse({
        chatId,
        mode,
        limit,
        filters: {
          minDate: parsedMinDate?.toISOString() ?? null,
          maxDate: parsedMaxDate?.toISOString() ?? null,
          onlyUnread,
          markAsRead,
        },
        count: fetched.length,
        messages: fetched.map(formatMessage),
      });
    },
  );

  server.tool(
    "search_messages",
    "Search messages by text query. Searches globally or within a specific chat.",
    {
      query: z.string().min(1).describe("Search text"),
      chatId: z.string().optional().describe("Scope to specific chat (numeric ID or @username)"),
      limit: z.number().int().positive().default(20).describe("Max messages"),
      minDate: z.string().optional().describe("Only messages after this ISO date"),
      maxDate: z.string().optional().describe("Only messages before this ISO date"),
    },
    async ({ query, chatId: rawChatId, limit, minDate, maxDate }) => {
      const tg = await getTelegramClient();
      const chatId = rawChatId ? parseChatId(rawChatId) : undefined;
      const parsedMinDate = parseIsoDate(minDate, "minDate");
      const parsedMaxDate = parseIsoDate(maxDate, "maxDate");

      if (parsedMinDate && parsedMaxDate && parsedMinDate.getTime() > parsedMaxDate.getTime()) {
        throw new Error("Invalid date range: minDate must be <= maxDate");
      }

      const messages: ReturnType<typeof formatMessage>[] = [];
      for await (const msg of tg.iterSearchMessages({
        chatId,
        query,
        minDate: parsedMinDate,
        maxDate: parsedMaxDate,
        limit,
      })) {
        messages.push(formatMessage(msg));
      }

      return jsonResponse({
        query,
        chatId: chatId ?? null,
        count: messages.length,
        messages,
      });
    },
  );

  server.tool(
    "media_download",
    "Download media (photo, video, document, etc.) from a specific message to a local file. Requires the chat ID and message ID.",
    {
      chatId: z.string().describe("Numeric chat ID (as string) or @username"),
      messageId: z.number().int().positive().describe("Message ID containing media"),
      filename: z.string().min(1).describe("Local file path to save to"),
    },
    async ({ chatId: rawChatId, messageId, filename }) => {
      const chatId = parseChatId(rawChatId);
      const tg = await getTelegramClient();
      const [msg] = await tg.getMessages(chatId, [messageId]);

      if (!msg) {
        throw new Error(`Message not found: ${chatId}/${messageId}`);
      }

      if (!msg.media) {
        throw new Error(`Message ${messageId} has no media`);
      }

      if (!(msg.media instanceof FileLocation)) {
        throw new Error(`Media type "${msg.media.type}" cannot be downloaded as a file`);
      }

      await tg.downloadToFile(filename, msg.media);

      return jsonResponse({
        status: "downloaded",
        chatId,
        messageId,
        filename,
        mediaType: msg.media.type,
        message: formatMessage(msg),
      });
    },
  );

  server.tool(
    "message_from_link",
    "Fetch a single message by its Telegram link (e.g. https://t.me/channel/123 or https://t.me/c/123456/789).",
    {
      link: z.string().min(1).describe("Telegram message link"),
    },
    async ({ link }) => {
      const tg = await getTelegramClient();
      const msg = await tg.getMessageByLink(link);

      if (!msg) {
        return jsonResponse({
          link,
          found: false,
        });
      }

      return jsonResponse({
        link,
        found: true,
        message: formatMessage(msg),
      });
    },
  );
}

interface Session {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

const sessions = new Map<string, Session>();

function jsonRpcError(code: number, message: string, status: number) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function startServer() {
  const port = parseInt(process.env.PORT || "3000", 10);

  // @ts-expect-error: Bun types require `routes` but fetch-only mode works at runtime
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      log.info(
        {
          method: req.method,
          path: url.pathname,
          accept: req.headers.get("accept"),
          session: req.headers.get("mcp-session-id") ?? "none",
        },
        "incoming request",
      );

      if (url.pathname !== "/mcp") {
        return new Response("Not Found", { status: 404 });
      }

      const sessionId = req.headers.get("mcp-session-id");

      // Known session — route all methods (POST, GET, DELETE) to its transport
      if (sessionId && sessions.has(sessionId)) {
        return sessions.get(sessionId)?.transport.handleRequest(req);
      }

      // Unknown session ID — stale or invalid
      if (sessionId) {
        return jsonRpcError(-32001, "Session not found", 404);
      }

      // --- No session ID below ---

      if (req.method !== "POST") {
        return jsonRpcError(-32000, "Bad Request: Mcp-Session-Id required", 400);
      }

      // Parse body once to check if it's an initialize request
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonRpcError(-32700, "Parse error: Invalid JSON", 400);
      }

      if (!isInitializeRequest(body)) {
        return jsonRpcError(-32000, "Bad Request: No valid session ID provided", 400);
      }

      // --- New session ---
      const server = createMcpServer();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          sessions.set(sid, { server, transport });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };

      await server.connect(transport);
      return transport.handleRequest(req, { parsedBody: body });
    },
  });

  log.info({ port }, "mcp telegram server listening");

  // Connect to Telegram eagerly so errors surface at startup
  try {
    await getTelegramClient();
  } catch (err) {
    log.error({ err }, "failed to connect to telegram");
    process.exit(1);
  }

  // Graceful shutdown: close all sessions
  process.on("SIGINT", async () => {
    for (const [sid, { transport }] of sessions) {
      try {
        await transport.close();
      } catch (err) {
        log.error({ err, sid }, "error closing session");
      }
    }
    process.exit(0);
  });
}
