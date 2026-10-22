import { existsSync } from "node:fs";
import path from "node:path";
import { runCheck, projectDir, typescriptCheck, summarizeChecks, inside } from "unslop-core";

export async function verifyCompile(args, root) {
  const cwd = projectDir(root, args.projectRoot);
  if (!cwd) return { status: "FAIL", message: "projectRoot is outside the workspace.", _failed: true };

  const files = (Array.isArray(args.files) ? args.files : []).map((f) => path.resolve(root, f)).filter((f) => inside(root, f) && existsSync(f));
  const has = (name) => existsSync(path.join(cwd, name));
  const ofExt = (...exts) => files.filter((f) => exts.includes(path.extname(f).toLowerCase()));
  const checks = [];

  if (has("tsconfig.json") || ofExt(".ts", ".mts", ".cts", ".tsx").length) checks.push(await typescriptCheck(cwd, root));
  if (has("go.mod") || ofExt(".go").length) checks.push({ lang: "go", ...(await runCheck("go", ["vet", "./..."], cwd)) });
  if (has("Cargo.toml") || ofExt(".rs").length) checks.push({ lang: "rust", ...(await runCheck("cargo", ["check", "--quiet"], cwd, { timeout: 600_000 })) });

  const py = ofExt(".py");
  if (py.length) checks.push({ lang: "python", ...(await runCheck("python3", ["-m", "py_compile", ...py], cwd)) });
  else if (has("pyproject.toml") || has("requirements.txt")) {
    checks.push({ lang: "python", ...(await runCheck("python3", ["-m", "compileall", "-q", "-x", "(^|/)(\\.venv|venv|node_modules|\\.git|build|dist)(/|$)", "."], cwd)) });
  }
  for (const f of ofExt(".php")) checks.push({ lang: "php", ...(await runCheck("php", ["-l", f], cwd)) });
  for (const f of ofExt(".rb")) checks.push({ lang: "ruby", ...(await runCheck("ruby", ["-c", f], cwd)) });

  return summarizeChecks(checks, { none: "No compiler config detected in projectRoot and no checkable files given; nothing verified." });
}
