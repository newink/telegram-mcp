/**
 * Health-check script for agents working on this codebase.
 * Runs a sequence of checks and prints a summary.
 * Exit 0 if all clean, exit 1 if any issues found.
 */

import { Glob } from "bun";

let hasIssues = false;

function header(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

function issue(msg: string) {
  hasIssues = true;
  console.log(`  ⚠ ${msg}`);
}

function warning(msg: string) {
  console.log(`  ⚠ ${msg}`);
}

// ── 1. Dead code (knip) ────────────────────────────────────────────
header("Dead code (knip)");

const knip = Bun.spawnSync(["bun", "run", "knip"], {
  stdout: "pipe",
  stderr: "pipe",
});

const knipOut = knip.stdout.toString().trim();
const knipErr = knip.stderr.toString().trim();

if (knip.exitCode !== 0) {
  issue("knip found issues:");
  for (const line of (knipOut || knipErr).split("\n")) {
    console.log(`    ${line}`);
  }
} else {
  console.log("  OK: no dead code detected");
}

// ── 2. Open TODOs ──────────────────────────────────────────────────
const TODO_MARKER = `AIOS-${"TODO"}`;
header(`Open TODOs (${TODO_MARKER})`);

const todoGlob = new Glob("**/*.{ts,md}");
let todoCount = 0;

for await (const path of todoGlob.scan({ cwd: ".", absolute: false })) {
  if (path.includes("node_modules")) continue;
  const content = await Bun.file(path).text();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(TODO_MARKER)) {
      issue(`${path}:${i + 1}: ${lines[i]!.trim()}`);
      todoCount++;
    }
  }
}

if (todoCount === 0) {
  console.log(`  OK: no ${TODO_MARKER} markers found`);
}

// ── 3. Doc drift (check:structure) ─────────────────────────────────
header("Doc drift (check:structure)");

const structCheck = Bun.spawnSync(["bun", "run", "check:structure"], {
  stdout: "pipe",
  stderr: "pipe",
});

const structOut = structCheck.stdout.toString().trim();
const structErr = structCheck.stderr.toString().trim();

if (structCheck.exitCode !== 0) {
  issue("docs/tools.md out of sync with code:");
  for (const line of (structErr || structOut).split("\n")) {
    console.log(`    ${line}`);
  }
} else {
  console.log(`  ${structOut || "OK: docs in sync"}`);
}

// ── 4. Undocumented env vars ───────────────────────────────────────
header("Undocumented env vars");

const envExample = await Bun.file(".env.example").text();
const documentedKeys = new Set<string>();
for (const match of envExample.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=/gm)) {
  documentedKeys.add(match[1]!);
}
// Also count commented-out vars like "# TELEGRAM_MOCK=true"
for (const match of envExample.matchAll(/^#\s*([A-Z_][A-Z0-9_]*)\s*=/gm)) {
  documentedKeys.add(match[1]!);
}

const usedKeys = new Set<string>();
const tsGlob = new Glob("src/**/*.ts");

for await (const path of tsGlob.scan({ cwd: ".", absolute: false })) {
  const content = await Bun.file(path).text();
  for (const match of content.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
    usedKeys.add(match[1]!);
  }
  // Also catch Bun.env usage
  for (const match of content.matchAll(/Bun\.env\.([A-Z_][A-Z0-9_]*)/g)) {
    usedKeys.add(match[1]!);
  }
}

const undocumented = [...usedKeys].filter((k) => !documentedKeys.has(k)).sort();

if (undocumented.length > 0) {
  for (const key of undocumented) {
    issue(`${key} used in code but missing from .env.example`);
  }
} else {
  console.log("  OK: all env vars documented");
}

// ── 5. Stale docs (advisory: checkout mtimes are not deterministic) ─
header("Stale docs");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const now = Date.now();

// Find the most recent .ts modification time
let latestTsMtime = 0;
for await (const path of tsGlob.scan({ cwd: ".", absolute: false })) {
  const stat = await Bun.file(path).stat();
  if (stat && stat.mtimeMs > latestTsMtime) {
    latestTsMtime = stat.mtimeMs;
  }
}

const docsGlob = new Glob("docs/**/*.md");
let staleCount = 0;

for await (const path of docsGlob.scan({ cwd: ".", absolute: false })) {
  const stat = await Bun.file(path).stat();
  if (!stat) continue;
  const ageMs = now - stat.mtimeMs;
  if (ageMs > THIRTY_DAYS_MS && latestTsMtime - stat.mtimeMs > THIRTY_DAYS_MS) {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    warning(`${path} — last modified ${days} days ago`);
    staleCount++;
  }
}

if (staleCount === 0) {
  console.log("  OK: no stale docs detected");
}

// ── Summary ────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(64)}`);
if (hasIssues) {
  console.log("RESULT: issues found — see above");
  process.exit(1);
} else {
  console.log("RESULT: all checks passed");
  process.exit(0);
}
