import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function loadEnv(): Record<string, string> {
  const envPath = ".env";
  const entries: Record<string, string> = {};

  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) entries[match[1]!.trim()] = match[2]?.trim() ?? "";
    }
  }

  return entries;
}

export function saveEnv(entries: Record<string, string>) {
  const lines = Object.entries(entries).map(([k, v]) => `${k}=${v}`);
  writeFileSync(".env", `${lines.join("\n")}\n`);
}
