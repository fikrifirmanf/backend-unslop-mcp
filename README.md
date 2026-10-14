# backend-unslop-mcp

> Stop AI-generated APIs and SQL from shipping as naive slop: skill + MCP verifier for PostgreSQL, ClickHouse, Redis and workers.

[![npm](https://img.shields.io/npm/v/backend-unslop-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/backend-unslop-mcp)
[![license](https://img.shields.io/npm/l/backend-unslop-mcp)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)

An **agent skill** plus an **MCP server** in one package. The skill tells your coding agent what Backend slop to avoid; the MCP tools then *deterministically verify* the result, so the agent can't just claim it's done.

Works with **Claude Code**, **Claude Desktop**, **Codex** and **Antigravity**.

## What it catches

| Rule | Severity | Catches |
| --- | --- | --- |
| `NO_SELECT_STAR` | ERROR | `SELECT * FROM` |
| `NO_SQL_INTERPOLATION` | ERROR | `${...}` interpolated into SQL (injection risk) |
| `N_PLUS_ONE_IN_LOOP` | ERROR | DB, Redis or HTTP calls awaited inside `for` / `.map(async …)` |
| `NO_SILENT_CATCH` | ERROR | empty or `console.log`-only `catch` blocks |
| `NO_STACK_LEAK` | ERROR | `err.stack` / `err.message` returned in an HTTP response |
| `NO_TYPE_ESCAPE` | ERROR | `: any`, `as any`, `@ts-ignore` |
| `NO_TODO_PLACEHOLDER` | ERROR | unfinished `TODO` left in handlers |

The skill additionally requires input validation at every boundary, explicit `LIMIT`s, timeouts and idempotent retries, and offloading work over ~2s to a queue.

Rules marked **ERROR** make the audit return `status: "FAIL"`; **WARN** is reported but does not fail.

## Quick start

### 1. Add the MCP server

```bash
# Claude Code
claude mcp add backend-unslop -s user -- npx -y backend-unslop-mcp

# Codex
codex mcp add backend-unslop -- npx -y backend-unslop-mcp
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`) and **Antigravity** (`~/.gemini/antigravity/mcp_config.json`):

```json
{
  "mcpServers": {
    "backend-unslop": {
      "command": "npx",
      "args": ["-y", "backend-unslop-mcp"]
    }
  }
}
```

Restart the app afterwards.

### 2. Install the bundled skill

```bash
npx -y backend-unslop-mcp install-skills
```

Copies `backend-unslop` into:

| Client | Location |
| --- | --- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Antigravity | `~/.gemini/antigravity/skills/` |

Claude Desktop has no skills folder, so it receives the rules through the MCP prompt and the `load_*_rules` tool described below. Or install straight from this repo's `skills/` directory.

## MCP surface

| Kind | Name | Purpose |
| --- | --- | --- |
| Prompt | `backend-unslop` | The full skill text, for GUI clients |
| Tool | `load_backend_unslop_rules` | Returns the skill text (for clients without prompt support) |
| Tool | `audit_backend_slop` | Scans `files: string[]` and returns `PASS`/`FAIL` with file, line, rule and snippet |
| Tool | `verify_typescript_compile` | Runs `tsc --noEmit` (needs `typescript` in the workspace) |

Audit output:

```json
{
  "status": "FAIL",
  "totalViolations": 1,
  "findings": [
    { "file": "src/a.ts", "line": 12, "rule": "NO_TYPE_ESCAPE", "severity": "ERROR", "message": "…", "snippet": "…" }
  ],
  "instruction": "Refactor every ERROR finding and re-run the audit before completing the task."
}
```

File paths are resolved against the server's working directory and cannot escape it.

## How it works

1. The agent loads the skill and writes code under its constraints.
2. Before finishing, the skill requires a call to `audit_backend_slop` and `verify_typescript_compile`.
3. On `FAIL`, the agent fixes every finding and re-runs until `PASS`.

The checks are regex based: fast, offline and predictable, but heuristic. Expect the occasional false positive and treat them as a safety net, not a substitute for review.

## Pairs well with

- [`frontend-unslop-mcp`](https://github.com/fikrifirmanf/frontend-unslop-mcp): the same idea for React, Next.js and Tailwind.

## Development

```bash
git clone https://github.com/fikrifirmanf/backend-unslop-mcp
cd backend-unslop-mcp && npm install
node src/server.mjs        # speaks MCP over stdio
```

## License

MIT © Fikri Firman Fadilah
