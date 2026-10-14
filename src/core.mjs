import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
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

async function tsc(projectRoot, root) {
  const cwd = path.resolve(root, projectRoot || ".");
  if (path.relative(root, cwd).startsWith("..")) return text({ status: "FAIL", message: "projectRoot is outside the workspace." }, true);
  try {
    await execFileAsync("npx", ["--no-install", "tsc", "--noEmit", "--pretty", "false"], { cwd, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
    return text({ status: "PASS", message: "Zero TypeScript errors." });
  } catch (err) {
    return text({
      status: "FAIL",
      compilerOutput: `${err.stdout || ""}\n${err.stderr || err.message || ""}`.trim().slice(0, 20000),
      instruction: "Fix all TypeScript errors (or install typescript locally) and re-run verify_typescript_compile.",
    }, true);
  }
}

/**
 * @param {{name:string, version:string, skill:string, description:string, auditTool:string, auditDescription:string, rules:Array}} cfg
 */
export async function run(cfg) {
  const root = process.cwd();
  const skillPath = path.resolve(here, "..", "skills", cfg.skill, "SKILL.md");
  const loadSkill = () => fs.readFile(skillPath, "utf8");
  const filesSchema = {
    type: "object",
    properties: { files: { type: "array", items: { type: "string" }, description: "Workspace-relative file paths to audit" } },
    required: ["files"],
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
      { name: cfg.auditTool, description: cfg.auditDescription, inputSchema: filesSchema },
      {
        name: "verify_typescript_compile",
        description: "Runs `tsc --noEmit` in the workspace to verify zero type errors.",
        inputSchema: { type: "object", properties: { projectRoot: { type: "string", description: "Relative dir containing tsconfig.json (default '.')" } } },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    if (name === `load_${cfg.skill.replace(/-/g, "_")}_rules`) return text(await loadSkill());
    if (name === cfg.auditTool) return audit(Array.isArray(args.files) ? args.files : [], cfg.rules, root);
    if (name === "verify_typescript_compile") return tsc(args.projectRoot, root);
    throw new Error(`Unknown tool: ${name}`);
  });

  await server.connect(new StdioServerTransport());
}
