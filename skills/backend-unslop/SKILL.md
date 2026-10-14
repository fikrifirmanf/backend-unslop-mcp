---
name: backend-unslop
description: Enforces production-grade backend architecture, API reliability, and SQL/database hygiene (PostgreSQL, ClickHouse, Redis, async workers). Trigger whenever writing or modifying API routes, database queries, migrations, background jobs, or backend services.
---

# Backend & SQL Anti-Slop Protocol

Never output naive queries, unvalidated handlers, or blocking I/O slop.

## 1. SQL & database (HARD BANS)
- **No `SELECT *`:** always project explicit columns (PostgreSQL and ClickHouse alike).
- **No string-interpolated SQL:** use parameter bindings (`$1`, `?`) or typed query builders.
- **No N+1 in loops:** no DB, Redis, or HTTP calls inside `for` / `for...of` / `.map()`. Batch with `ANY($1)` / `IN (...)` / `JOIN`.
- **No unbounded reads:** every list query has an explicit `LIMIT` and pagination.
- **Workload separation:** keep OLTP transactions short; no analytics or external calls inside `BEGIN...COMMIT`.

## 2. API, async & errors (HARD BANS)
- **Validate every boundary:** handlers, webhooks, queue consumers, tool entrypoints validate input with strict schemas (Zod, TypeBox, Pydantic) before domain logic.
- **No blocking long requests:** work over ~2s goes to a queue/worker; stream progress via SSE/WebSocket.
- **Idempotency & timeouts:** explicit timeouts on every network/DB call; retried mutations must be idempotent.
- **No silent catch or stack leaks:** never `catch {}`; never return raw driver errors or stacks. Use structured error codes and contextual logs.

## 3. Mandatory verification loop
Before claiming a backend/database task is complete:
1. Call MCP tool `audit_backend_slop` with every modified file path.
2. For TypeScript, call `verify_typescript_compile`.
3. On `status: "FAIL"`, fix every violation and re-run until `PASS`.
