# backend-unslop-mcp

> Stop AI-generated APIs and SQL from shipping as naive slop: polyglot skill + MCP verifier for TypeScript/JS, Python, Go, Rust, Java/Kotlin, C#, PHP, Ruby, PostgreSQL, ClickHouse, Redis and async workers.

[![npm](https://img.shields.io/npm/v/backend-unslop-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/backend-unslop-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)

An **agent skill** plus an **MCP server** in one package. The skill tells your coding agent what slop to avoid; the MCP tools then *deterministically verify* the result, so the agent can't just claim it's done.

Works with **Claude Code**, **Claude Desktop**, **Codex** and **Antigravity**.

## What it catches

| Rule | Severity | Catches |
| --- | --- | --- |
| `NO_SELECT_STAR` | ERROR | Banned SELECT *. Project explicit columns. |
| `NO_SQL_INTERPOLATION` | ERROR | String-interpolated or concatenated SQL. Use parameterized bindings ($1, ?, :name, %(name)s, @p1) or a typed query builder. |
| `N_PLUS_ONE_IN_LOOP` | ERROR | DB/HTTP call inside a loop (N+1). Batch with IN (...), ANY($1), bulk upsert, JOIN or a dataloader. |
| `NO_SILENT_CATCH` | ERROR | Silent or print-only error handler (catch/except/if err != nil/rescue). Log structured context and propagate or map the error. |
| `NO_TYPE_ESCAPE` | ERROR | Type escape (': any', 'as any', 'as unknown as'). Validate the boundary with a schema (Zod, TypeBox, Valibot) and use the inferred type. |
| `NO_CHECKER_SUPPRESSION` | ERROR | Type-checker/linter suppression. Fix the underlying type or lint error. |
| `NO_STACK_LEAK` | ERROR | Raw error stack/message/traceback returned to the client. Return a sanitized error code and log the details server-side. |
| `NO_TODO_PLACEHOLDER` | ERROR | Unfinished TODO/FIXME or not-implemented placeholder in backend code. |
| `WRITE_WITHOUT_WHERE` | ERROR | UPDATE/DELETE without a WHERE clause rewrites or wipes the whole table. Add a WHERE (or use TRUNCATE deliberately). |
| `HARDCODED_SECRET` | ERROR | Hardcoded credential. Load it from the environment or a secret manager and rotate the leaked value. |
| `TLS_VERIFICATION_DISABLED` | ERROR | TLS certificate verification disabled. Fix the CA bundle instead of trusting any certificate. |
| `WEAK_PASSWORD_HASH` | ERROR | Passwords hashed with a fast digest. Use argon2id, scrypt or bcrypt. |
| `INSECURE_RANDOM_TOKEN` | ERROR | Security token from a non-cryptographic RNG. Use crypto.randomBytes/randomUUID, secrets.token_urlsafe, or crypto/rand. |
| `CODE_OR_SHELL_INJECTION` | ERROR | eval / dynamic code or shell command built from input. Pass arguments as an array (execFile, subprocess.run([...]), exec.Command(bin, args...)). |
| `JWT_UNVERIFIED` | ERROR | JWT decoded without signature verification. Use jwt.verify / jwt.decode with key and an explicit algorithms allowlist. |
| `CORS_WILDCARD` | WARN | CORS allows every origin. List the allowed origins explicitly, especially with credentials. |
| `NO_REQUEST_TIMEOUT` | WARN | Outbound HTTP call without a timeout can hang a worker forever. Pass timeout=. |
| `FETCH_WITHOUT_TIMEOUT` | WARN | fetch() without an AbortSignal never times out. Pass `signal: AbortSignal.timeout(ms)`. |
| `GO_DEFAULT_HTTP_CLIENT` | WARN | Go's default http client has no timeout. Use &http.Client{Timeout: ...} or a context deadline. |
| `UNBOUNDED_QUERY` | WARN | Unbounded read: no LIMIT/take. Paginate with a cursor or an explicit limit. |
| `GO_IGNORED_ERROR` | WARN | Error return discarded with `_`. Handle or wrap it. |
| `RUST_UNWRAP` | WARN | .unwrap() panics the request/worker on error. Propagate with `?` and a typed error. |
| `PY_BARE_EXCEPT` | WARN | Bare `except:` also catches KeyboardInterrupt/SystemExit. Catch specific exceptions. |

The skill additionally requires strict schema validation at every boundary (Zod, Pydantic, `validator`, `serde`, `@Valid`, FluentValidation), explicit `LIMIT`s and pagination, idempotent retries, and offloading work over ~2s to a queue.

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
npx -y backend-unslop-mcp install-skills        # clients that are installed
npx -y backend-unslop-mcp install-skills --all  # every location
```

| Client | Location |
| --- | --- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Antigravity | `~/.gemini/config/skills/` (and `~/.gemini/antigravity/skills/` if present) |

Claude Desktop has no skills folder, so it receives the rules through the MCP prompt and the `load_*_rules` tool.

## MCP surface

| Kind | Name | Purpose |
| --- | --- | --- |
| Prompt | `backend-unslop` | The full skill text, for GUI clients |
| Tool | `load_backend_unslop_rules` | Returns the full backend-unslop ruleset. Call before writing code if the backend-unslop skill is not already loaded. |
| Tool | `audit_backend_slop` | Deterministically scans backend and SQL files for slop: SELECT *, SQL interpolation, N+1 queries, UPDATE/DELETE without WHERE, silent error handlers, type escapes, stack leaks, hardcoded secrets, disabled TLS, weak password hashing, insecure tokens, injection, unverified JWTs, missing timeouts, unbounded queries and TODO placeholders. Accepts files or directories; with no files it audits the git working-tree changes. Suppress a verified false positive with a `unslop-ignore RULE_ID -- reason` comment on or above the line. |
| Tool | `verify_backend_compile` | Auto-detects and runs compiler/type/syntax checks: TypeScript (tsc --noEmit), Go (go vet), Rust (cargo check), Python (py_compile), PHP (php -l), Ruby (ruby -c). Missing toolchains are reported as SKIPPED. |
| Tool | `verify_typescript_compile` | Alias of verify_backend_compile, kept for backwards compatibility. |

File paths resolve against the server's working directory and cannot escape it. Directories honour `.gitignore` and skip `node_modules`, build output and minified files.

## CLI and CI

The same audit runs without an agent. It exits `1` on any ERROR, so it works as a pre-commit hook or CI step:

```bash
npx -y backend-unslop-mcp audit              # git working-tree changes
npx -y backend-unslop-mcp audit src app      # files or directories
npx -y backend-unslop-mcp audit src --json   # machine-readable
npx -y backend-unslop-mcp rules              # list every rule
```

## Suppressing a false positive

The checks are regex and structure based: fast, offline and predictable, but heuristic. For a verified false positive, add a comment on the line or the line above, **with a reason**:

```js
// unslop-ignore NO_SELECT_STAR -- why this is safe here
```

Suppressions without a reason are reported as `SUPPRESSION_WITHOUT_REASON` errors, and every honoured suppression is listed in the audit output so reviewers can see it.

## How it works

1. The agent loads the skill and writes code under its constraints.
2. Before finishing, the skill requires the audit and verification tools.
3. On `FAIL`, the agent fixes every finding and re-runs until `PASS`. Missing toolchains are reported as `SKIPPED`, never as passing.

## The unslop family

- [`frontend-unslop-mcp`](https://github.com/fikrifirmanf/frontend-unslop-mcp)
- [`ui-unslop-mcp`](https://github.com/fikrifirmanf/ui-unslop-mcp)
- [`mobile-unslop-mcp`](https://github.com/fikrifirmanf/mobile-unslop-mcp)
- [`copy-unslop-mcp`](https://github.com/fikrifirmanf/copy-unslop-mcp)
- [`test-unslop-mcp`](https://github.com/fikrifirmanf/test-unslop-mcp)

All share the engine in [`unslop-core`](https://github.com/fikrifirmanf/unslop-core).

## Development

```bash
git clone https://github.com/fikrifirmanf/backend-unslop-mcp
cd backend-unslop-mcp && npm install
npm test                   # every rule is checked against its good/bad examples
node src/server.mjs        # speaks MCP over stdio
```

## License

MIT © Fikri Firman Fadilah
