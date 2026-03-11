import { BlockList, isIP } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { FileLocation, type Message } from "@mtcute/bun";
import { z } from "zod";
import { isChatAllowed, loadConfig } from "./config.ts";
import { log } from "./logger.ts";
import {
  TelegramSessionExpiredError,
  closeTelegramClient,
  getTelegramClient,
  isTelegramAuthRequiredError,
  isSessionConfigured,
  withTelegramClient,
} from "./telegram.ts";
import {
  ensureSetupToken,
  handleAuthCode,
  handleAuthPage,
  handleAuthPassword,
  handleAuthStart,
  handleAuthStatus,
} from "./web-auth.ts";

const AUTH_REQUIRED_ERROR_CODE = -32001;
const AUTH_REQUIRED_MESSAGE =
  "Telegram session expired or was revoked. Re-authentication is required.";

type RequestContext = {
  request: Request;
  peerIp: string | null;
  port: number;
};

type RegisteredTool = {
  enabled: boolean;
};

type McpServerInternals = {
  _registeredTools: Record<string, RegisteredTool>;
  createToolError(errorMessage: string): {
    content: Array<{ type: "text"; text: string }>;
    isError: true;
  };
  executeToolHandler(tool: RegisteredTool, args: unknown, extra: unknown): Promise<unknown>;
  validateToolInput(tool: RegisteredTool, args: unknown, toolName: string): Promise<unknown>;
  validateToolOutput(tool: RegisteredTool, result: unknown, toolName: string): Promise<void>;
};

export function createMcpServer(context: RequestContext) {
  const server = new McpServer({
    name: "mcp-telegram",
    version: "0.1.0",
  });

  registerTools(server);
  installToolRequestHandler(server, context);

  return server;
}

function installToolRequestHandler(server: McpServer, context: RequestContext): void {
  const internals = server as unknown as McpServerInternals;

  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = internals._registeredTools[request.params.name];
    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    }

    if (!tool.enabled) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} disabled`);
    }

    try {
      const args = await internals.validateToolInput(tool, request.params.arguments, request.params.name);
      const result = (await internals.executeToolHandler(tool, args, extra)) as Record<string, unknown>;
      await internals.validateToolOutput(tool, result, request.params.name);
      return result;
    } catch (err) {
      if (isTelegramAuthRequiredError(err)) {
        throw new McpError(AUTH_REQUIRED_ERROR_CODE, AUTH_REQUIRED_MESSAGE, {
          authRequired: true,
          reason: err.reason,
          revokedAt: err.revokedAt,
          authUrl: buildAuthUrl(context),
        });
      }

      if (err instanceof McpError) {
        throw err;
      }

      return internals.createToolError(err instanceof Error ? err.message : String(err));
    }
  });
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

function splitCommaHeader(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseForwardedIp(value: string): string | null {
  if (value.startsWith("[") && value.includes("]")) {
    const end = value.indexOf("]");
    const candidate = value.slice(1, end);
    return isIP(candidate) ? candidate : null;
  }

  if (isIP(value)) {
    return value;
  }

  const lastColon = value.lastIndexOf(":");
  if (lastColon > 0 && value.indexOf(":") === lastColon) {
    const host = value.slice(0, lastColon);
    const port = value.slice(lastColon + 1);
    if (/^\d+$/.test(port) && isIP(host)) {
      return host;
    }
  }

  return null;
}

function getTrustedProxyBlockList(): BlockList | null {
  const trustedProxyIps = splitCommaHeader(process.env.TRUSTED_PROXY_IPS ?? null);
  if (trustedProxyIps.length === 0) return null;

  const blockList = new BlockList();
  let added = 0;

  for (const entry of trustedProxyIps) {
    if (entry.includes("/")) {
      const [address, prefix] = entry.split("/", 2);
      if (!address || !prefix) {
        log.warn({ entry }, "ignoring invalid TRUSTED_PROXY_IPS CIDR entry");
        continue;
      }
      const family = isIP(address);
      const prefixLength = Number(prefix);

      if (!family || Number.isNaN(prefixLength)) {
        log.warn({ entry }, "ignoring invalid TRUSTED_PROXY_IPS CIDR entry");
        continue;
      }

      blockList.addSubnet(address, prefixLength, family === 6 ? "ipv6" : "ipv4");
      added += 1;
      continue;
    }

    const family = isIP(entry);
    if (!family) {
      log.warn({ entry }, "ignoring invalid TRUSTED_PROXY_IPS literal entry");
      continue;
    }

    blockList.addAddress(entry, family === 6 ? "ipv6" : "ipv4");
    added += 1;
  }

  return added > 0 ? blockList : null;
}

export function isTrustedProxy(clientIp: string | null): boolean {
  if (!clientIp) return false;

  const blockList = getTrustedProxyBlockList();
  if (!blockList) return false;

  const family = isIP(clientIp);
  if (!family) return false;

  return blockList.check(clientIp, family === 6 ? "ipv6" : "ipv4");
}

function getForwardedChain(request: Request): string[] {
  return splitCommaHeader(request.headers.get("x-forwarded-for"))
    .map(parseForwardedIp)
    .filter((value): value is string => value !== null);
}

function getEffectiveForwardedClientIp(forwardedChain: string[]): string | null {
  if (forwardedChain.length === 0) return null;

  for (let index = forwardedChain.length - 1; index >= 0; index -= 1) {
    const candidate = forwardedChain[index];
    if (!candidate) continue;
    if (!isTrustedProxy(candidate)) {
      return candidate;
    }
  }

  return forwardedChain[0] ?? null;
}

function validateForwardedHost(value: string | null): string | null {
  const host = splitCommaHeader(value)[0];
  if (!host) return null;

  if (/[\u0000-\u001F\u007F]/.test(host)) return null;
  if (/[/?#@]/.test(host)) return null;

  try {
    const parsed = new URL(`http://${host}`);
    return parsed.host || null;
  } catch {
    return null;
  }
}

function validateForwardedProto(value: string | null): "http" | "https" | null {
  const proto = splitCommaHeader(value)[0]?.toLowerCase();
  if (proto === "http" || proto === "https") {
    return proto;
  }
  return null;
}

function getPublicBaseUrl(): URL | null {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) return null;

  try {
    return new URL(baseUrl);
  } catch (err) {
    log.warn({ err, publicBaseUrl: baseUrl }, "invalid PUBLIC_BASE_URL; falling back");
    return null;
  }
}

function getForwardedBaseUrl(context: RequestContext): URL | null {
  const forwardedChain = getForwardedChain(context.request);
  const peerIp = context.peerIp ?? forwardedChain[forwardedChain.length - 1] ?? null;
  const hasForwardedHeaders =
    forwardedChain.length > 0 ||
    context.request.headers.has("x-forwarded-host") ||
    context.request.headers.has("x-forwarded-proto");

  if (!isTrustedProxy(peerIp)) {
    if (hasForwardedHeaders) {
      log.warn({ peerIp }, "ignoring forwarded headers from untrusted proxy");
    }
    return null;
  }

  const forwardedHost = validateForwardedHost(context.request.headers.get("x-forwarded-host"));
  const forwardedProto = validateForwardedProto(context.request.headers.get("x-forwarded-proto"));

  if (!forwardedHost || !forwardedProto) {
    if (hasForwardedHeaders) {
      log.warn({ peerIp }, "ignoring invalid forwarded auth URL headers");
    }
    return null;
  }

  const effectiveClientIp = getEffectiveForwardedClientIp(forwardedChain);
  if (effectiveClientIp) {
    log.info({ clientIp: effectiveClientIp, peerIp }, "using trusted proxy headers for auth URL");
  }

  try {
    return new URL("/", `${forwardedProto}://${forwardedHost}`);
  } catch (err) {
    log.warn({ err, forwardedHost, forwardedProto }, "failed to build auth URL from forwarded headers");
    return null;
  }
}

function getAuthBaseUrl(context: RequestContext | null): URL {
  const publicBaseUrl = getPublicBaseUrl();
  if (publicBaseUrl) {
    return publicBaseUrl;
  }

  if (context) {
    const forwardedBaseUrl = getForwardedBaseUrl(context);
    if (forwardedBaseUrl) {
      return forwardedBaseUrl;
    }
    return new URL(`http://localhost:${context.port}`);
  }

  return new URL(`http://localhost:${process.env.PORT ?? "3000"}`);
}

export function buildAuthUrl(context: RequestContext): string {
  const url = new URL("/auth", getAuthBaseUrl(context));
  url.searchParams.set("token", ensureSetupToken());
  return url.toString();
}

function logStartupAuthRequired(port: number, reason?: string): void {
  ensureSetupToken();

  const authPath = new URL("/auth", getPublicBaseUrl() ?? new URL(`http://localhost:${port}`)).toString();
  log.warn(
    { authPath, reason },
    "auth required — open the web auth page to connect Telegram",
  );
}

export function parseChatId(chatId: string): string | number {
  return /^-?\d+$/.test(chatId) ? Number(chatId) : chatId;
}

function registerTools(server: McpServer) {
  server.tool(
    "search_dialogs",
    "Search your Telegram dialogs by display name or username. Returns matching users, groups, and channels with their IDs.",
    {
      query: z.string().min(1).describe("Search query"),
      limit: z.number().int().positive().default(10).describe("Max results to return"),
    },
    async ({ query, limit }) =>
      withTelegramClient(async (tg) => {
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
      }),
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
      const parsedMinDate = parseIsoDate(minDate, "minDate");
      const parsedMaxDate = parseIsoDate(maxDate, "maxDate");

      if (parsedMinDate && parsedMaxDate && parsedMinDate.getTime() > parsedMaxDate.getTime()) {
        throw new Error("Invalid date range: minDate must be <= maxDate");
      }

      return withTelegramClient(async (tg) => {
        const fetched: Message[] = [];
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
      const chatId = rawChatId ? parseChatId(rawChatId) : undefined;
      const parsedMinDate = parseIsoDate(minDate, "minDate");
      const parsedMaxDate = parseIsoDate(maxDate, "maxDate");

      if (parsedMinDate && parsedMaxDate && parsedMinDate.getTime() > parsedMaxDate.getTime()) {
        throw new Error("Invalid date range: minDate must be <= maxDate");
      }

      return withTelegramClient(async (tg) => {
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

      return withTelegramClient(async (tg) => {
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
      });
    },
  );

  server.tool(
    "message_from_link",
    "Fetch a single message by its Telegram link (e.g. https://t.me/channel/123 or https://t.me/c/123456/789).",
    {
      link: z.string().min(1).describe("Telegram message link"),
    },
    async ({ link }) =>
      withTelegramClient(async (tg) => {
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
      }),
  );

  server.tool(
    "delete_messages",
    "Delete messages from a Telegram chat. Requires explicit opt-in in bot-data/config.yml.",
    {
      chatId: z
        .string()
        .describe('Numeric chat ID (as string), @username, or "me" for Saved Messages'),
      messageIds: z
        .array(z.number().int().positive())
        .min(1)
        .describe("Message IDs to delete. Pass multiple to bulk-delete in one call."),
      revoke: z
        .boolean()
        .default(true)
        .describe(
          "Delete for all participants (true) or only for yourself (false). Default: true.",
        ),
    },
    async ({ chatId: rawChatId, messageIds, revoke }) => {
      if (!isChatAllowed("delete_messages", rawChatId)) {
        const configPath = process.env.TELEGRAM_MCP_CONFIG ?? "bot-data/config.yml";
        throw new Error(
          `delete_messages is not allowed for chat "${rawChatId}". ` +
            `Add it to allowed_chats in ${configPath}.`,
        );
      }

      const chatId = parseChatId(rawChatId);
      return withTelegramClient(async (tg) => {
        await tg.deleteMessagesById(chatId, messageIds, { revoke });

        return jsonResponse({
          chatId,
          deletedCount: messageIds.length,
          messageIds,
          revoke,
        });
      });
    },
  );
}

export async function startServer() {
  const port = parseInt(process.env.PORT || "3000", 10);

  try {
    loadConfig();
  } catch (err) {
    log.error({ err }, "config error");
    process.exit(1);
  }

  Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      log.info(
        {
          method: req.method,
          path: url.pathname,
          accept: req.headers.get("accept"),
        },
        "incoming request",
      );

      if (url.pathname === "/auth" && req.method === "GET") {
        return handleAuthPage(url);
      }
      if (url.pathname === "/auth/status" && req.method === "GET") {
        return handleAuthStatus(req, url);
      }
      if (url.pathname === "/auth/start" && req.method === "POST") {
        return handleAuthStart(req, url);
      }
      if (url.pathname === "/auth/code" && req.method === "POST") {
        return handleAuthCode(req, url);
      }
      if (url.pathname === "/auth/password" && req.method === "POST") {
        return handleAuthPassword(req, url);
      }

      if (url.pathname !== "/mcp") {
        return new Response("Not Found", { status: 404 });
      }

      try {
        const context: RequestContext = {
          request: req,
          peerIp: server.requestIP(req)?.address ?? null,
          port,
        };
        const mcpServer = createMcpServer(context);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        await mcpServer.connect(transport);
        return transport.handleRequest(req);
      } catch (err) {
        log.error({ err }, "request handling error");
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal error" },
            id: null,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    },
  });

  log.info({ port }, "mcp telegram server listening");

  if (isSessionConfigured()) {
    try {
      await getTelegramClient();
    } catch (err) {
      if (err instanceof TelegramSessionExpiredError) {
        logStartupAuthRequired(port, err.reason);
      } else {
        log.error({ err }, "failed to connect to telegram");
        process.exit(1);
      }
    }
  } else {
    if (!process.env.TELEGRAM_API_ID || !process.env.TELEGRAM_API_HASH) {
      log.warn(
        "TELEGRAM_API_ID and TELEGRAM_API_HASH are not set — add them to .env before authenticating",
      );
    }
    logStartupAuthRequired(port);
  }

  async function shutdown() {
    log.info("shutting down");
    await closeTelegramClient().catch((err) => log.error({ err }, "error closing telegram client"));
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
