/**
 * YAML config loader for write-tool restrictions.
 *
 * Config file: bot-data/config.yml (override via TELEGRAM_MCP_CONFIG env var)
 * No config file → all write tools disabled.
 * TELEGRAM_MOCK=true → permissive config for tests.
 */

import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { log } from "./logger.ts";

// --- Schema ---

const ToolConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowed_chats: z.array(z.string()).optional(),
});

const ConfigSchema = z.object({
  tools: z.record(z.string(), ToolConfigSchema).default({}),
});

type Config = z.infer<typeof ConfigSchema>;

// --- Singleton ---

let _config: Config | null = null;

export function loadConfig(): Config {
  // Mock mode → permissive config for tests
  if (process.env.TELEGRAM_MOCK === "true") {
    const config: Config = {
      tools: {
        delete_messages: {
          enabled: true,
          allowed_chats: ["*"],
        },
      },
    };
    _config = config;
    return config;
  }

  const configPath = process.env.TELEGRAM_MCP_CONFIG ?? "bot-data/config.yml";

  if (!existsSync(configPath)) {
    log.info("no config file found — all write tools disabled");
    const config: Config = { tools: {} };
    _config = config;
    return config;
  }

  const raw = readFileSync(configPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(`Failed to parse config file at ${configPath}: ${err}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid config at ${configPath}: ${result.error.message}`);
  }

  _config = result.data;

  // Warn loudly if any tool uses wildcard outside mock mode
  for (const [toolName, toolConfig] of Object.entries(_config.tools)) {
    if (toolConfig.allowed_chats?.includes("*")) {
      log.warn(
        { tool: toolName },
        '⚠️  allowed_chats contains "*" — ALL chats are allowed for this tool. This disables the allowlist entirely. Remove "*" and list specific chats for production use.',
      );
    }
  }

  log.info({ tools: Object.keys(_config.tools) }, "config loaded");
  return _config;
}

function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** Reset singleton — for testing only. */
export function resetConfig(): void {
  _config = null;
}

/**
 * Returns true if a write tool is explicitly enabled in config.
 * Tool not mentioned or enabled: false → returns false.
 */
function isToolEnabled(toolName: string): boolean {
  return getConfig().tools[toolName]?.enabled === true;
}

/**
 * Returns true if the given chatId is in the tool's allowed_chats list.
 *
 * Rules:
 * - Tool not in config → false
 * - Tool enabled: false → false
 * - Tool enabled: true, no allowed_chats → false (deny all)
 * - Tool enabled: true, allowed_chats has "*" → true (wildcard, for tests)
 * - Tool enabled: true, allowed_chats present → check membership
 */
export function isChatAllowed(toolName: string, chatId: string | number): boolean {
  if (!isToolEnabled(toolName)) return false;

  const toolConfig = getConfig().tools[toolName];
  if (!toolConfig?.allowed_chats || toolConfig.allowed_chats.length === 0) {
    return false;
  }

  if (toolConfig.allowed_chats.includes("*")) return true;

  const normalizedInput = normalizeChatId(chatId);
  return toolConfig.allowed_chats.some((entry) => normalizeChatId(entry) === normalizedInput);
}

function normalizeChatId(id: string | number): string {
  const s = String(id).trim().toLowerCase();
  return s.startsWith("@") ? s.slice(1) : s;
}
