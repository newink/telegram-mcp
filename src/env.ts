import { existsSync, readFileSync, writeFileSync } from "node:fs";

function envPath(): string {
  return process.env.ENV_FILE ?? ".env";
}

export function loadEnv(): Record<string, string> {
  const path = envPath();
  const entries: Record<string, string> = {};

  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) entries[match[1]!.trim()] = match[2]?.trim() ?? "";
    }
  }

  return entries;
}

export function saveEnv(entries: Record<string, string>) {
  const lines = Object.entries(entries).map(([k, v]) => `${k}=${v}`);
  writeFileSync(envPath(), `${lines.join("\n")}\n`);
}

export function applyEnvFileToProcess() {
  for (const [key, value] of Object.entries(loadEnv())) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
