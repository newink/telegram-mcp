# Testing

All automated tests use the mock client. Never use a real Telegram account in
tests.

## Verification

From PowerShell:

```powershell
npx --yes bun test --preload ./src/test-preload.ts
npx --yes bun run typecheck
npx --yes bun run lint
npx --yes bun run check:structure
npx --yes bun run knip
npx --yes bun run audit
```

The package script `bun test` already applies `src/test-preload.ts`.

## BDD/TDD workflow

Describe behavior with Given/When/Then:

```text
Given a public group and an inclusive date range
When get_messages returns fewer than the requested limit
Then messages are chronological and expose stable source metadata
```

For production changes:

1. add a focused test that expresses the behavior;
2. run it and observe the expected failure;
3. implement the smallest passing change;
4. run the focused test and full suite;
5. refactor only while green.

Executable tests live beside source files as `src/*.test.ts`. Skill-level
pressure scenarios and their before/after evaluations live in
`docs/superpowers/skill-tests/telegram-summary-scenarios.md`.

## Mock fixtures

`src/mock/fixtures.ts` includes:

- users, groups, and channels;
- multiple named participants with stable sender IDs and handles;
- a public `@project_alpha` group for canonical `sourceUrl` coverage;
- private sources whose `sourceUrl` must remain null;
- dated messages returned in chronological order by range reads;
- media messages for attachment handling.

`src/mock/client.ts` implements only the Telegram behavior needed by the
server. Add deterministic fixtures and mock methods before testing a new tool.

## Summary-specific coverage

Tests protect:

- inclusive date filtering and invalid range rejection;
- chronological range output;
- the maximum `get_messages` limit of 500;
- `limitReached` at the requested boundary;
- stable chat and sender identity fields;
- public canonical URLs and private null URLs;
- deny-by-default write configuration;
- mock-only server operation.

The portable skill is validated separately:

```powershell
python C:\Users\t0uchY\.codex\skills\.system\skill-creator\scripts\quick_validate.py `
  .agents/skills/telegram-summary
```
