import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { FileLocation, type Message } from "@mtcute/bun";
import { z } from "zod";
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
          (_key, value) =>
            typeof value === "bigint" ? value.toString() : value,
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
      limit: z
        .number()
        .int()
        .positive()
        .default(10)
        .describe("Max results to return"),
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
          (username && username.toLowerCase().includes(normalizedQuery));
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
      minDate: z
        .string()
        .optional()
        .describe("Only messages after this ISO date"),
      maxDate: z
        .string()
        .optional()
        .describe("Only messages before this ISO date"),
      onlyUnread: z
        .boolean()
        .default(false)
        .describe("Only fetch unread messages"),
      markAsRead: z
        .boolean()
        .default(false)
        .describe("Mark fetched messages as read"),
    },
    async ({ chatId: rawChatId, limit, minDate, maxDate, onlyUnread, markAsRead }) => {
      const chatId = parseChatId(rawChatId);
      const tg = await getTelegramClient();
      const parsedMinDate = parseIsoDate(minDate, "minDate");
      const parsedMaxDate = parseIsoDate(maxDate, "maxDate");
      const fetched: Message[] = [];

      if (
        parsedMinDate &&
        parsedMaxDate &&
        parsedMinDate.getTime() > parsedMaxDate.getTime()
      ) {
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
    "media_download",
    "Download media (photo, video, document, etc.) from a specific message to a local file. Requires the chat ID and message ID.",
    {
      chatId: z.string().describe("Numeric chat ID (as string) or @username"),
      messageId: z
        .number()
        .int()
        .positive()
        .describe("Message ID containing media"),
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
        throw new Error(
          `Media type "${msg.media.type}" cannot be downloaded as a file`,
        );
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

const transports = new Map<
  string,
  WebStandardStreamableHTTPServerTransport
>();

export async function startServer() {
  const port = parseInt(process.env.PORT || "3000", 10);

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      console.log(`[${req.method}] ${url.pathname} Accept: ${req.headers.get("accept")} Session: ${req.headers.get("mcp-session-id") ?? "none"}`);

      if (url.pathname !== "/mcp") {
        return new Response("Not Found", { status: 404 });
      }

      const sessionId = req.headers.get("mcp-session-id");

      if (sessionId && transports.has(sessionId)) {
        return transports.get(sessionId)!.handleRequest(req);
      }

      if (sessionId) {
        return new Response("Session not found", { status: 404 });
      }

      if (req.method === "GET") {
        return new Response("MCP Streamable HTTP endpoint", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      if (req.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (req.method === "POST") {
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            transports.set(sid, transport);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
          }
        };

        const server = createMcpServer();
        await server.connect(transport);
        return transport.handleRequest(req);
      }

      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST, DELETE" },
      });
    },
  });

  console.log(
    `MCP Telegram server listening on http://localhost:${port}/mcp`,
  );

  // Connect to Telegram eagerly so errors surface at startup
  try {
    await getTelegramClient();
  } catch (err) {
    console.error("Failed to connect to Telegram:", err);
    process.exit(1);
  }
}
