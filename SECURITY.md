# Security Policy

## Credentials

telegram-mcp requires Telegram API credentials (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`). These grant access to your personal Telegram account.

**Never share these values or commit them to version control.**

The `.env` file is in `.gitignore` by default — keep it that way.

## Reporting a Vulnerability

If you find a security vulnerability, please **do not open a public GitHub issue**.

Report it privately via [GitHub Security Advisories](https://github.com/newink/telegram-mcp/security/advisories/new).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

You'll receive a response within 48 hours.

## Scope

- Credential leakage or exposure
- Authentication bypass
- Unintended data access via MCP tools
- Dependency vulnerabilities with real impact

Out of scope: issues requiring physical access to a machine where credentials are already stored.
