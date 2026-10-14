import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_SRC = path.resolve(here, "..", "skills");

const TARGETS = {
  "claude-code": path.join(os.homedir(), ".claude", "skills"),
  codex: path.join(os.homedir(), ".codex", "skills"),
  antigravity: path.join(os.homedir(), ".gemini", "antigravity", "skills"),
};

export async function installSkills() {
  const names = await fs.readdir(SKILLS_SRC);
  for (const [client, dir] of Object.entries(TARGETS)) {
    for (const name of names) {
      const dest = path.join(dir, name);
      await fs.mkdir(dest, { recursive: true });
      await fs.cp(path.join(SKILLS_SRC, name), dest, { recursive: true });
      console.log(`[${client}] skill installed -> ${dest}`);
    }
  }
  console.log("Claude Desktop: upload the skill folder via Settings > Capabilities > Skills (zip), or use the MCP prompt/tool instead.");
}
