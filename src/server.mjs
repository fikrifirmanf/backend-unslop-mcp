#!/usr/bin/env node
import { run } from "./core.mjs";

if (process.argv[2] === "install-skills") {
  const { installSkills } = await import("./install-skills.mjs");
  await installSkills();
  process.exit(0);
}

const SILENT_CATCH = /catch\s*(\([^)]*\))?\s*\{\s*(console\.(log|error|warn)\([^)]*\);?\s*)?\}/;
const DB = "(?:db|prisma|sql|pool|client|clickhouse|knex|supabase|redis|axios|fetch)";

await run({
  name: "backend-unslop-mcp",
  version: "1.0.0",
  skill: "backend-unslop",
  description: "Backend & SQL anti-slop rules (PostgreSQL, ClickHouse, Redis, APIs, async workers).",
  auditTool: "audit_backend_slop",
  auditDescription:
    "Deterministically scans backend/SQL files (.ts, .js, .sql) for slop: SELECT *, SQL string interpolation, N+1 queries in loops, silent catch, stack leaks, unbounded reads.",
  rules: [
    { id: "NO_SELECT_STAR", severity: "ERROR", regex: /\bSELECT\s+\*\s+FROM\b/i, message: "Banned SELECT *. Project explicit columns." },
    { id: "NO_SQL_INTERPOLATION", severity: "ERROR", regex: /\b(SELECT|INSERT|UPDATE|DELETE)\b[^;`]{0,160}\$\{/i, message: "String-interpolated SQL. Use parameterized bindings ($1, ?)." },
    { id: "NO_SILENT_CATCH", severity: "ERROR", regex: SILENT_CATCH, message: "Silent or console-only catch. Log structured context or rethrow." },
    { id: "NO_TYPE_ESCAPE", severity: "ERROR", regex: /:\s*any\b|\bas\s+any\b|@ts-ignore/, message: "Banned ': any' / '@ts-ignore'. Validate boundaries with Zod or similar." },
    { id: "NO_STACK_LEAK", severity: "ERROR", regex: /\.(json|send)\s*\(\s*\{[^}]*\b(err|error|e)\.(stack|message)\b/, message: "Raw error stack/message in HTTP response. Return a sanitized error code." },
    { id: "NO_TODO_PLACEHOLDER", severity: "ERROR", regex: /\/\/\s*TODO\b|#\s*TODO\b/i, message: "Unfinished TODO placeholder in backend code." },
    { id: "N_PLUS_ONE_IN_LOOP", severity: "ERROR", regex: new RegExp(`\\bfor\\s*(?:await\\s*)?\\([^)]*\\)\\s*\\{[\\s\\S]{0,300}?\\bawait\\s+${DB}\\b|\\.(?:map|forEach)\\s*\\(\\s*async[^{]*\\{[\\s\\S]{0,300}?\\bawait\\s+${DB}\\b`), message: "Possible N+1 / I/O inside a loop. Batch with IN (...), ANY($1) or JOIN." },
  ],
});
