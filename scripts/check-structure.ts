/**
 * CI-friendly check: ensures docs/tools.md stays in sync with registered MCP tools in src/server.ts.
 * Exit 0 if in sync, exit 1 if mismatched.
 */

const serverSource = await Bun.file("src/server.ts").text();
const docsSource = await Bun.file("docs/tools.md").text();

// Extract tool names from server.tool("name", ...) calls
const codeTools = new Set<string>();
for (const match of serverSource.matchAll(/server\.tool\(\s*["']([^"']+)["']/g)) {
  codeTools.add(match[1]);
}

// Extract documented tool names from ## headings (single-word identifiers)
const docTools = new Set<string>();
for (const match of docsSource.matchAll(/^## (\S+)/gm)) {
  docTools.add(match[1]);
}

const undocumented = [...codeTools].filter((t) => !docTools.has(t));
const stale = [...docTools].filter((t) => !codeTools.has(t));

if (undocumented.length === 0 && stale.length === 0) {
  console.log(`OK: ${codeTools.size} tools in code match ${docTools.size} in docs/tools.md`);
  process.exit(0);
}

if (undocumented.length > 0) {
  console.error(`Undocumented tools (in code but not in docs/tools.md):\n  ${undocumented.join("\n  ")}`);
}
if (stale.length > 0) {
  console.error(`Stale docs (in docs/tools.md but not in code):\n  ${stale.join("\n  ")}`);
}

process.exit(1);
