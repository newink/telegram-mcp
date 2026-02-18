# ADR-001: Bun as Runtime

**Status:** Accepted  
**Date:** 2026-02

## Context
Need a runtime for a TypeScript MCP server using MTProto.

## Decision
Use Bun instead of Node.js.

## Reasons
- Native TypeScript execution (no build step)
- `@mtcute/bun` provides first-class Bun support
- Fast startup, built-in test runner
- `Bun.serve()` for HTTP without Express overhead
