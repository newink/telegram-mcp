# ADR-003: Streamable HTTP Transport

**Status:** Accepted  
**Date:** 2026-02

## Context
MCP SDK supports multiple transports: stdio, SSE, Streamable HTTP.

## Decision
Use Streamable HTTP (`WebStandardStreamableHTTPServerTransport`).

## Reasons
- Works over network (not just local stdio)
- Supports multiple concurrent sessions
- Compatible with mcporter and remote MCP clients
- JSON response mode for simple request/response tools
- SSE streaming available when needed
