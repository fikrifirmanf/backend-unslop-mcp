# backend-unslop-mcp

> Stop AI-generated APIs and SQL from shipping as naive slop: polyglot skill + MCP verifier for TypeScript/JS, Python, Go, Rust, Java/Kotlin, C#, PHP, Ruby, PostgreSQL, ClickHouse, Redis and async workers.

[![npm](https://img.shields.io/npm/v/backend-unslop-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/backend-unslop-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)

An **agent skill** plus an **MCP server** in one package. The skill tells your coding agent what backend & SQL slop to avoid across languages; the MCP tools then *deterministically verify* the result, so the agent can't just claim it's done.

Works with **Claude Code**, **Claude Desktop**, **Codex** and **Antigravity**.

## What it catches

| Rule | Severity | Catches |
| --- | --- | --- |
| `NO_SELECT_STAR` | ERROR | `SELECT * FROM` |
| `NO_SQL_INTERPOLATION` | ERROR | SQL string interpolation/concatenation (`${...}`, Python f-strings/`.format()`/`%`, Go `fmt.Sprintf`, Rust `format!`, Ruby `#{...}`, `+`) |
| `N_PLUS_ONE_IN_LOOP` | ERROR | DB, Redis or HTTP calls inside loops (`for`, `.map(async …)`, Python `for ... in`, Go `for`, Rust `for`) |
| `NO_SILENT_CATCH` | ERROR | Empty or console-only `catch`, Python `except: pass`, Go empty `if err != nil {}`, Ruby empty `rescue` |
| `NO_STACK_LEAK` | ERROR | Raw `err.stack` / `err.message`, `traceback.format_exc()`, `str(e)`, or `err.Error()` returned in HTTP responses |
| `NO_TYPE_ESCAPE` | ERROR | `: any`, `as any`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore` |
| `NO_TODO_PLACEHOLDER` | ERROR | Unfinished `TODO` / `FIXME`, `NotImplementedError`, `todo!()`, `unimplemented!()` left in handlers |

The skill additionally requires strict schema validation at every boundary (Zod, Pydantic, `validator`, `serde`, `@Valid`, FluentValidation), explicit `LIMIT`s and pagination, timeouts and idempotent retries, and offloading work over ~2s to a queue.

Rules marked **ERROR** make the audit return `status: "FAIL"`; **WARN** is reported but does not fail.

## Quick start

### 1. Add the MCP server

```bash
# Claude Code
claude mcp add backend-unslop -s user -- npx -y backend-unslop-mcp

# Codex
codex mcp add backend-unslop -- npx -y backend-unslop-mcp
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`) and **Antigravity** (`~/.gemini/config/mcp_config.json`):

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
| Antigravity | `~/.gemini/config/skills/` |

Claude Desktop has no skills folder, so it receives the rules through the MCP prompt and the `load_*_rules` tool described below. Or install straight from this repo's `skills/` directory.

## MCP surface

| Kind | Name | Purpose |
| --- | --- | --- |
| Prompt | `backend-unslop` | The full skill text, for GUI clients |
| Tool | `load_backend_unslop_rules` | Returns the skill text (for clients without prompt support) |
| Tool | `audit_backend_slop` | Scans `files: string[]` (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.cs`, `.php`, `.rb`, `.sql`) and returns `PASS`/`FAIL` with file, line, rule and snippet |
| Tool | `verify_backend_compile` | Auto-detects and verifies backend compilation/syntax across TypeScript (`tsc --noEmit`), Go (`go vet`), Rust (`cargo check`), and Python (`py_compile`) |
| Tool | `verify_typescript_compile` | Alias for `verify_backend_compile` for backwards compatibility |

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
2. Before finishing, the skill requires a call to `audit_backend_slop` and `verify_backend_compile`.
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
