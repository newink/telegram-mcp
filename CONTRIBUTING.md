# Contributing

Thanks for your interest in contributing to telegram-mcp!

## Getting Started

```bash
git clone https://github.com/newink/telegram-mcp.git
cd telegram-mcp
bun install
```

Run in mock mode — no real Telegram account needed:

```bash
TELEGRAM_MOCK=true bun dev
bun test
```

## Before Submitting a PR

```bash
bun run typecheck   # no type errors
bun run lint        # no lint issues
bun test            # all tests pass
bun run knip        # no dead code
bun run check:structure  # docs in sync with code
```

Then run the repository-specific health checks:

```bash
bun run audit
```

## Adding a New Tool

1. Implement the tool in `src/server.ts` using `server.tool(...)`
2. Add a section to `docs/tools.md` with parameters and a curl example
3. Write a test in `src/smoke.test.ts`
4. Run `bun run check:structure` to verify docs are in sync

See [docs/tools.md](docs/tools.md) for the existing tool format.

## Code Style

- TypeScript strict mode — no `any`, no `as Type` casts
- Biome for formatting — run `bun run lint:fix` to auto-fix
- Parse at boundaries — use Zod schemas for all tool inputs
- bigint → string — always use `jsonResponse()` helper for Telegram IDs

## CI Secrets (for maintainers)

The Docker publish workflow requires these secrets in GitHub repo settings:

| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | Docker Hub username (`newink`) |
| `DOCKERHUB_TOKEN` | Docker Hub access token — create at https://hub.docker.com/settings/security |
| `GITHUB_TOKEN` | Auto-provided by GitHub Actions, no setup needed |

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add search_messages tool
fix: handle flood_wait on get_messages
docs: update tools.md with new parameters
```
