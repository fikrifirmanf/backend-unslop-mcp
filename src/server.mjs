#!/usr/bin/env node
import { run } from "./core.mjs";

if (process.argv[2] === "install-skills") {
  const { installSkills } = await import("./install-skills.mjs");
  await installSkills();
  process.exit(0);
}

const SILENT_CATCH = new RegExp(
  [
    // JS / TS / Java / C# / PHP / Kotlin empty or console-only catch
    "catch\\s*(\\([^)]*\\))?\\s*\\{\\s*(console\\.(log|error|warn)\\([^)]*\\);?\\s*)?\\}",
    // Python bare/silent except: pass / ...
    "except(?:\\s+[\\w.,\\s()]+)?:\\s*(?:pass|\\.\\.\\.)\\b",
    // Go empty if err != nil {}
    "if\\s+err\\s*!=\\s*nil\\s*\\{\\s*\\}",
    // Ruby empty rescue
    "\\brescue(?:\\s+[\\w:,\\s]+)?\\s*\\n\\s*end\\b",
  ].join("|")
);

const SQL_INTERP = new RegExp(
  [
    // JS/TS template literal interpolation
    "\\b(SELECT|INSERT|UPDATE|DELETE)\\b[^;`]{0,160}\\$(?:\\{|\\w+)",
    // Python f-strings or .format / %
    "\\bf[\"']\\s*(?:SELECT|INSERT|UPDATE|DELETE)\\b",
    "\\b(SELECT|INSERT|UPDATE|DELETE)\\b[^;\\n\"']{0,160}[\"']\\s*(?:\\.format\\s*\\(|%\\s*[(\\w])",
    // Go fmt.Sprintf / Rust format!
    "\\b(?:fmt\\.Sprintf|format!)\\s*\\(\\s*[\"'`]\\s*(?:SELECT|INSERT|UPDATE|DELETE)\\b",
    // Ruby #{...} or string concatenation
    "\\b(SELECT|INSERT|UPDATE|DELETE)\\b[^;\\n\"']{0,160}#\\{",
    "\\b(SELECT|INSERT|UPDATE|DELETE)\\b[^;\\n\"']{0,120}[\"']\\s*\\+\\s*[a-zA-Z_]\\w*",
  ].join("|"),
  "i"
);

const DB = "(?:db|prisma|sql|pool|client|clickhouse|knex|supabase|redis|axios|fetch|session|cursor|conn|tx|gorm|sqlx|reqwest|httpx|requests)";

const N_PLUS_ONE = new RegExp(
  [
    // JS/TS/Go/Rust/Java/C#/PHP brace loops with DB/HTTP calls
    `\\bfor\\s*(?:await\\s*)?(?:\\([^)]*\\)|[^{;\\n]+)\\{[\\s\\S]{0,300}?(?:\\bawait\\s+${DB}\\b|\\b${DB}\\.(?:query|exec|execute|get|post|fetch|find|create|update|delete|Query|Exec|Get|Post)\\b)`,
    // JS .map / .forEach async loops
    `\\.(?:map|forEach)\\s*\\(\\s*async[^{]*\\{[\\s\\S]{0,300}?\\bawait\\s+${DB}\\b`,
    // Python for-loop with DB/HTTP call
    `\\bfor\\s+[^:\\n]+\\s+in\\s+[^:\\n]+:\\s*\\n(?:[ \\t]+[^\\n]*\\n){0,6}?[ \\t]+(?:await\\s+${DB}\\b|${DB}\\.(?:execute|query|get|post|scalar|scalars|commit|add)\\b)`,
  ].join("|")
);

const STACK_LEAK = new RegExp(
  [
    // Express / Node / TS
    "\\.(json|send)\\s*\\(\\s*\\{[^}]*\\b(err|error|e)\\.(stack|message)\\b",
    // Python FastAPI / Flask / Django
    "\\btraceback\\.format_exc\\s*\\(\\)",
    "(?:JSONResponse|jsonify)\\s*\\([^)]*\\bstr\\((?:e|err|exc|error)\\)",
    // Go net/http / Gin / Fiber
    "\\bhttp\\.Error\\s*\\([^,]+,\\s*err\\.Error\\(\\)",
    "gin\\.H\\s*\\{[^}]*err\\.Error\\(\\)",
  ].join("|")
);

await run({
  name: "backend-unslop-mcp",
  version: "1.1.1",
  skill: "backend-unslop",
  description: "Polyglot Backend & SQL anti-slop rules (TypeScript/Node, Python, Go, Rust, Java/Kotlin, C#, PHP, Ruby, PostgreSQL, ClickHouse, Redis, APIs, async workers).",
  auditTool: "audit_backend_slop",
  auditDescription:
    "Deterministically scans backend and SQL files (.ts, .js, .py, .go, .rs, .java, .kt, .cs, .php, .rb, .sql) for slop: SELECT *, SQL string interpolation/concatenation, N+1 queries in loops, silent catch/except/err blocks, type escapes, stack leaks, and TODO/unimplemented placeholders.",
  rules: [
    { id: "NO_SELECT_STAR", severity: "ERROR", regex: /\bSELECT\s+\*\s+FROM\b/i, message: "Banned SELECT *. Project explicit columns." },
    { id: "NO_SQL_INTERPOLATION", severity: "ERROR", regex: SQL_INTERP, message: "String-interpolated or concatenated SQL. Use parameterized bindings ($1, ?, :name, %(name)s, @p1) or a typed query builder." },
    { id: "NO_SILENT_CATCH", severity: "ERROR", regex: SILENT_CATCH, message: "Silent or console-only error handler (catch/except/if err != nil/rescue). Log structured context or propagate the error." },
    { id: "NO_TYPE_ESCAPE", severity: "ERROR", regex: /:\s*any\b|\bas\s+any\b|@ts-ignore|@ts-expect-error|#\s*type:\s*ignore\b/, message: "Banned type escape (': any', '@ts-ignore', '# type: ignore'). Validate boundaries with strict schemas (Zod, Pydantic, validator, serde)." },
    { id: "NO_STACK_LEAK", severity: "ERROR", regex: STACK_LEAK, message: "Raw error stack/message/traceback in HTTP response. Return a sanitized structured error code." },
    { id: "NO_TODO_PLACEHOLDER", severity: "ERROR", regex: /\/\/\s*(?:TODO|FIXME)\b|#\s*(?:TODO|FIXME)\b|--\s*(?:TODO|FIXME)\b|\btodo!\s*\(|\bunimplemented!\s*\(|\braise\s+NotImplementedError\b/i, message: "Unfinished TODO/FIXME or unimplemented placeholder in backend code." },
    { id: "N_PLUS_ONE_IN_LOOP", severity: "ERROR", regex: N_PLUS_ONE, message: "Possible N+1 / I/O inside a loop. Batch with IN (...), ANY($1), bulk upsert, or JOIN." },
  ],
});
