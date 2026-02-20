# ADR-004: Pino Logger

**Status:** Accepted
**Date:** 2026-02

## Context
All logging used `console.log`/`console.error`, producing unstructured plaintext with no level filtering. This makes production debugging and log aggregation difficult.

## Decision
Replace console calls with [pino](https://github.com/pinojs/pino), a fast JSON logger.

## Reasons
- Structured JSON output — machine-parseable, works with log aggregators
- Level filtering via `LOG_LEVEL` env var (trace/debug/info/warn/error/fatal)
- Minimal overhead — pino is one of the fastest Node.js loggers
- Simple API — drop-in replacement for console with `log.info()`, `log.error()`, etc.
- Context objects — attach structured data (port, session ID, error) to log entries

## Alternatives Considered
- **console.log** (status quo) — no structure, no levels, no filtering
- **winston** — heavier, slower, more config surface than needed
- **bunyan** — unmaintained, pino is its spiritual successor
