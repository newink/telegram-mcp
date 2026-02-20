import { mkdirSync } from "node:fs";
import { type SentCode, TelegramClient, type User } from "@mtcute/bun";
import { loadEnv, saveEnv } from "./env.ts";
import { log } from "./logger.ts";
import { getAuthPageHtml } from "./web-auth-page.ts";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let setupToken: string | null = null;
let authClient: TelegramClient | null = null;
let sentCodeInfo: SentCode | null = null;
let authPhone: string | null = null;
let passwordResolver: ((pw: string) => void) | null = null;
const sseControllers = new Set<ReadableStreamDefaultController>();

// ---------------------------------------------------------------------------
// Token lifecycle
// ---------------------------------------------------------------------------
export function generateSetupToken(): string {
  setupToken = crypto.randomUUID();
  return setupToken;
}

function validateToken(token: string | null): boolean {
  return setupToken !== null && token === setupToken;
}

function invalidateToken(): void {
  setupToken = null;
}

// ---------------------------------------------------------------------------
// SSE broadcast
// ---------------------------------------------------------------------------
type SSEEvent =
  | { type: "waiting" }
  | { type: "qr"; url: string }
  | { type: "code_sent"; delivery: string; length: number }
  | { type: "password_required" }
  | { type: "success"; user: string }
  | { type: "error"; message: string };

function broadcastSSE(event: SSEEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const controller of sseControllers) {
    try {
      controller.enqueue(new TextEncoder().encode(data));
    } catch {
      sseControllers.delete(controller);
    }
  }
}

function closeAllSSE(): void {
  for (const controller of sseControllers) {
    try {
      controller.close();
    } catch {
      // already closed
    }
  }
  sseControllers.clear();
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
function tokenFromUrl(url: URL): string | null {
  return url.searchParams.get("token");
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function handleAuthPage(url: URL): Response {
  if (!validateToken(tokenFromUrl(url))) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(getAuthPageHtml(setupToken!), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function handleAuthStatus(_req: Request, url: URL): Response {
  if (!validateToken(tokenFromUrl(url))) {
    return jsonError("Invalid token", 403);
  }

  const stream = new ReadableStream({
    start(controller) {
      sseControllers.add(controller);
      // Send initial waiting event
      const data = `data: ${JSON.stringify({ type: "waiting" })}\n\n`;
      controller.enqueue(new TextEncoder().encode(data));
    },
    cancel(controller) {
      sseControllers.delete(controller);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function handleAuthStart(req: Request, url: URL): Promise<Response> {
  if (!validateToken(tokenFromUrl(url))) {
    return jsonError("Invalid token", 403);
  }

  let body: { method?: string; phone?: string };
  try {
    body = (await req.json()) as { method?: string; phone?: string };
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const method = body.method;
  if (method !== "qr" && method !== "phone") {
    return jsonError('method must be "qr" or "phone"', 400);
  }

  if (method === "phone" && !body.phone) {
    return jsonError("phone is required for phone method", 400);
  }

  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    return jsonError("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env", 400);
  }

  // Clean up any previous auth attempt
  await cleanupAuthClient();

  mkdirSync("bot-data", { recursive: true });

  authClient = new TelegramClient({
    apiId: Number(apiId),
    apiHash,
    storage: "bot-data/web-auth-session",
  });

  if (method === "qr") {
    // Start QR flow async — broadcasts via SSE, don't await
    startQrFlow(authClient).catch((err) => {
      log.error({ err }, "QR auth flow error");
      broadcastSSE({ type: "error", message: errorText(err) });
    });
    return Response.json({ ok: true, method: "qr" });
  }

  // Phone flow — connect and send code
  try {
    await authClient.connect();
    const result = await authClient.sendCode({ phone: body.phone! });

    // sendCode can return User if already logged in
    if ("phoneCodeHash" in result) {
      sentCodeInfo = result as SentCode;
      authPhone = body.phone!;
      broadcastSSE({
        type: "code_sent",
        delivery: (result as SentCode).type,
        length: (result as SentCode).length,
      });
      return Response.json({ ok: true, method: "phone" });
    }

    // Already authenticated — treat as User
    await completeAuth(authClient, result as User);
    return Response.json({ ok: true, method: "phone" });
  } catch (err) {
    log.error({ err }, "phone auth start error");
    broadcastSSE({ type: "error", message: errorText(err) });
    return jsonError(errorText(err), 500);
  }
}

export async function handleAuthCode(req: Request, url: URL): Promise<Response> {
  if (!validateToken(tokenFromUrl(url))) {
    return jsonError("Invalid token", 403);
  }

  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (!body.code) {
    return jsonError("code is required", 400);
  }

  if (!authClient || !sentCodeInfo || !authPhone) {
    return jsonError("No pending phone auth — call /auth/start first", 400);
  }

  try {
    const user = await authClient.signIn({
      phone: authPhone,
      phoneCodeHash: sentCodeInfo.phoneCodeHash,
      phoneCode: body.code,
    });
    await completeAuth(authClient, user);
    return Response.json({ ok: true });
  } catch (err: unknown) {
    if (isRpcError(err, "SESSION_PASSWORD_NEEDED")) {
      broadcastSSE({ type: "password_required" });
      return Response.json({ ok: true, passwordRequired: true });
    }
    log.error({ err }, "code verification error");
    broadcastSSE({ type: "error", message: errorText(err) });
    return jsonError(errorText(err), 500);
  }
}

export async function handleAuthPassword(req: Request, url: URL): Promise<Response> {
  if (!validateToken(tokenFromUrl(url))) {
    return jsonError("Invalid token", 403);
  }

  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (!body.password) {
    return jsonError("password is required", 400);
  }

  // QR flow: password resolver is waiting
  if (passwordResolver) {
    passwordResolver(body.password);
    passwordResolver = null;
    return Response.json({ ok: true });
  }

  // Phone flow: call checkPassword directly
  if (!authClient) {
    return jsonError("No pending auth — call /auth/start first", 400);
  }

  try {
    const user = await authClient.checkPassword(body.password);
    await completeAuth(authClient, user);
    return Response.json({ ok: true });
  } catch (err) {
    log.error({ err }, "password check error");
    broadcastSSE({ type: "error", message: errorText(err) });
    return jsonError(errorText(err), 500);
  }
}

// ---------------------------------------------------------------------------
// Auth flows
// ---------------------------------------------------------------------------
async function startQrFlow(client: TelegramClient): Promise<void> {
  const user = await client.signInQr({
    onUrlUpdated(url: string, _expires: Date) {
      broadcastSSE({ type: "qr", url });
    },
    onQrScanned() {
      broadcastSSE({ type: "waiting" });
    },
    password() {
      broadcastSSE({ type: "password_required" });
      return waitForPassword();
    },
  });

  await completeAuth(client, user);
}

function waitForPassword(): Promise<string> {
  return new Promise<string>((resolve) => {
    passwordResolver = resolve;
  });
}

// ---------------------------------------------------------------------------
// Complete auth — save session, broadcast success, cleanup
// ---------------------------------------------------------------------------
async function completeAuth(client: TelegramClient, user: User): Promise<void> {
  const session = await client.exportSession();

  const env = loadEnv();
  env.TELEGRAM_SESSION = session;
  saveEnv(env);

  process.env.TELEGRAM_SESSION = session;

  const displayName = user.displayName ?? "Unknown";
  const username = user.username ? ` (@${user.username})` : "";

  log.info({ user: displayName + username }, "web auth completed");
  broadcastSSE({ type: "success", user: displayName + username });

  invalidateToken();
  await cleanupAuthClient();
  closeAllSSE();
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
async function cleanupAuthClient(): Promise<void> {
  if (authClient) {
    try {
      await authClient.destroy();
    } catch {
      // ignore destroy errors
    }
    authClient = null;
  }
  sentCodeInfo = null;
  authPhone = null;
  passwordResolver = null;
}

// ---------------------------------------------------------------------------
// Error utilities
// ---------------------------------------------------------------------------
function errorText(err: unknown): string {
  if (err && typeof err === "object" && "text" in err) {
    const rpcErr = err as { text: string; seconds?: number };
    if (/FLOOD_WAIT/i.test(rpcErr.text)) {
      return `Rate limited — wait ${rpcErr.seconds ?? "a few"} seconds and try again`;
    }
    if (/SEND_CODE_UNAVAILABLE/i.test(rpcErr.text)) {
      return "All code delivery methods exhausted. Wait ~24h and try again.";
    }
    return rpcErr.text;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function isRpcError(err: unknown, text: string): boolean {
  if (err && typeof err === "object" && "text" in err) {
    return (err as { text: string }).text === text;
  }
  return false;
}
