import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const text = (obj, isError = false) => ({
  content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
  isError,
});

async function audit(files, rules, root) {
  const findings = [];
  for (const rel of files) {
    const full = path.resolve(root, rel);
    if (path.relative(root, full).startsWith("..")) {
      findings.push({ file: rel, line: 0, rule: "OUTSIDE_WORKSPACE", severity: "ERROR", message: "Path is outside the workspace." });
      continue;
    }
    const source = await fs.readFile(full, "utf8").catch(() => null);
    if (source === null) {
      findings.push({ file: rel, line: 0, rule: "FILE_MISSING", severity: "ERROR", message: "File could not be read." });
      continue;
    }
    for (const rule of rules) {
      const re = new RegExp(rule.regex.source, rule.regex.flags.includes("g") ? rule.regex.flags : rule.regex.flags + "g");
      for (const m of source.matchAll(re)) {
        findings.push({
          file: rel,
          line: source.slice(0, m.index).split("\n").length,
          rule: rule.id,
          severity: rule.severity,
          message: rule.message,
          snippet: m[0].replace(/\s+/g, " ").slice(0, 110),
        });
      }
    }
  }
  const failed = findings.some((f) => f.severity === "ERROR");
  return text(
    {
      status: failed ? "FAIL" : "PASS",
      totalViolations: findings.length,
      findings,
      instruction: failed
        ? "Refactor every ERROR finding and re-run the audit before completing the task."
        : "All anti-slop checks passed.",
    },
    failed
  );
}

async function runCheck(cmd, args, cwd) {
  try {
    await execFileAsync(cmd, args, { cwd, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
    return { ok: true, cmd: `${cmd} ${args.join(" ")}` };
  } catch (err) {
    return {
      ok: false,
      cmd: `${cmd} ${args.join(" ")}`,
      output: `${err.stdout || ""}\n${err.stderr || err.message || ""}`.trim().slice(0, 20000),
    };
  }
}

async function verifyCompile(projectRoot, root, files = []) {
  const cwd = path.resolve(root, projectRoot || ".");
  if (path.relative(root, cwd).startsWith("..")) {
    return text({ status: "FAIL", message: "projectRoot is outside the workspace." }, true);
  }

  const checks = [];
  const hasFile = (name) => existsSync(path.join(cwd, name));
  const exts = new Set(files.map((f) => path.extname(f).toLowerCase()));

  if (hasFile("tsconfig.json") || exts.has(".ts") || exts.has(".tsx")) {
    checks.push({ lang: "typescript", ...(await runCheck("npx", ["--no-install", "tsc", "--noEmit", "--pretty", "false"], cwd)) });
  }
  if (hasFile("go.mod") || exts.has(".go")) {
    checks.push({ lang: "go", ...(await runCheck("go", ["vet", "./..."], cwd)) });
  }
  if (hasFile("Cargo.toml") || exts.has(".rs")) {
    checks.push({ lang: "rust", ...(await runCheck("cargo", ["check", "--quiet"], cwd)) });
  }
  if (hasFile("pyproject.toml") || hasFile("requirements.txt") || exts.has(".py")) {
    const pyFiles = files.filter((f) => f.endsWith(".py")).map((f) => path.resolve(root, f));
    const targetArgs = pyFiles.length > 0 ? ["-m", "py_compile", ...pyFiles] : ["-m", "compileall", "-q", "."];
    checks.push({ lang: "python", ...(await runCheck("python3", targetArgs, cwd)) });
  }

  if (checks.length === 0) {
    return text({ status: "PASS", message: "No compiler config detected in projectRoot; skipped compile check." });
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    return text(
      {
        status: "FAIL",
        failedChecks: failed,
        instruction: "Fix all compiler/typecheck errors and re-run verification.",
      },
      true
    );
  }

  return text({
    status: "PASS",
    verified: checks.map((c) => ({ lang: c.lang, cmd: c.cmd })),
    message: "Zero compiler/syntax errors across detected backend languages.",
  });
}

/**
 * @param {{name:string, version:string, skill:string, description:string, auditTool:string, auditDescription:string, rules:Array}} cfg
 */
export async function run(cfg) {
  const root = process.cwd();
  const skillPath = path.resolve(here, "..", "skills", cfg.skill, "SKILL.md");
  const loadSkill = () => fs.readFile(skillPath, "utf8");
  const extra = cfg.extraTools || [];
  const filesSchema = {
    type: "object",
    properties: { files: { type: "array", items: { type: "string" }, description: "Workspace-relative file paths to audit" } },
    required: ["files"],
  };
  const compileSchema = {
    type: "object",
    properties: {
      projectRoot: { type: "string", description: "Relative dir containing project config (tsconfig.json, go.mod, Cargo.toml, pyproject.toml; default '.')" },
      files: { type: "array", items: { type: "string" }, description: "Optional modified file paths to target syntax/type checks" },
    },
  };

  const server = new Server({ name: cfg.name, version: cfg.version }, { capabilities: { tools: {}, prompts: {} } });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: cfg.skill, description: cfg.description }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name !== cfg.skill) throw new Error(`Unknown prompt: ${req.params.name}`);
    return { messages: [{ role: "user", content: { type: "text", text: await loadSkill() } }] };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: `load_${cfg.skill.replace(/-/g, "_")}_rules`, description: `Returns the full ${cfg.skill} ruleset. Call before writing code if the ${cfg.skill} skill is not already loaded.`, inputSchema: { type: "object", properties: {} } },
      ...extra.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      { name: cfg.auditTool, description: cfg.auditDescription, inputSchema: filesSchema },
      {
        name: "verify_backend_compile",
        description: "Verifies backend compilation/syntax across TypeScript (tsc --noEmit), Go (go vet), Rust (cargo check), and Python (py_compile/compileall).",
        inputSchema: compileSchema,
      },
      {
        name: "verify_typescript_compile",
        description: "Runs `tsc --noEmit` (or auto-detected backend compiler check if not a TS project) in the workspace to verify zero compile/type errors.",
        inputSchema: compileSchema,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    if (name === `load_${cfg.skill.replace(/-/g, "_")}_rules`) return text(await loadSkill());
    if (name === cfg.auditTool) return audit(Array.isArray(args.files) ? args.files : [], cfg.rules, root);
    const t = extra.find((x) => x.name === name);
    if (t) return text(...(await t.handler(args, root)));
    if (name === "verify_backend_compile" || name === "verify_typescript_compile") {
      return verifyCompile(args.projectRoot, root, Array.isArray(args.files) ? args.files : []);
    }
    throw new Error(`Unknown tool: ${name}`);
  });

  await server.connect(new StdioServerTransport());
}
