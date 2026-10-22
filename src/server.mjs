#!/usr/bin/env node
import { run, byExt } from "unslop-core";
import { rules } from "./rules.mjs";
import { verifyCompile } from "./compile.mjs";

const compileTool = (name, description) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties: {
      projectRoot: { type: "string", description: "Relative dir containing project config (tsconfig.json, go.mod, Cargo.toml, pyproject.toml; default '.')" },
      files: { type: "array", items: { type: "string" }, description: "Optional modified files; enables per-file checks (Python, PHP, Ruby)" },
    },
  },
  handler: verifyCompile,
});

await run({
  packageUrl: new URL("../package.json", import.meta.url),
  skill: "backend-unslop",
  description: "Polyglot backend & SQL anti-slop rules (TypeScript/Node, Python, Go, Rust, Java/Kotlin, C#, PHP, Ruby, PostgreSQL, ClickHouse, Redis, APIs, async workers).",
  auditTool: "audit_backend_slop",
  auditDescription:
    "Deterministically scans backend and SQL files for slop: SELECT *, SQL interpolation, N+1 queries, UPDATE/DELETE without WHERE, silent error handlers, type escapes, stack leaks, hardcoded secrets, disabled TLS, weak password hashing, insecure tokens, injection, unverified JWTs, missing timeouts, unbounded queries and TODO placeholders.",
  rules,
  accept: byExt(".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".kts", ".cs", ".php", ".rb", ".sql"),
  tools: [
    compileTool("verify_backend_compile", "Auto-detects and runs compiler/type/syntax checks: TypeScript (tsc --noEmit), Go (go vet), Rust (cargo check), Python (py_compile), PHP (php -l), Ruby (ruby -c). Missing toolchains are reported as SKIPPED."),
    compileTool("verify_typescript_compile", "Alias of verify_backend_compile, kept for backwards compatibility."),
  ],
});
