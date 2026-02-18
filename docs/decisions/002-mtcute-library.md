# ADR-002: mtcute for MTProto

**Status:** Accepted  
**Date:** 2026-02

## Context
Need a TypeScript MTProto library for userbot Telegram access.

## Decision
Use `@mtcute/bun` (mtcute).

## Alternatives Considered
- **gramjs**: Popular but Node.js focused, no native Bun support
- **telethon**: Python only
- **tdlib**: C++ with bindings, heavy dependency

## Reasons
- TypeScript-native with good types
- Dedicated `@mtcute/bun` package
- Active development, modern API
- Session string import/export
