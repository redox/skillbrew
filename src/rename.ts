import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { assert, writeText } from "./util.ts";

export async function applySkillRename(directory: string, sourceName: string, targetName: string): Promise<void> {
  if (sourceName === targetName) return;
  const skillPath = join(directory, "SKILL.md");
  const content = await readFile(skillPath, "utf8");
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert(frontmatter, "Cannot rename a skill without YAML frontmatter");
  const metadata = parse(frontmatter[1]!) as Record<string, unknown>;
  assert(metadata?.name === sourceName, `Expected upstream skill name ${sourceName}, found ${String(metadata?.name)}`);

  const nameLines = frontmatter[1]!.match(/^name:[^\r\n]*$/gm) ?? [];
  assert(nameLines.length === 1, "Expected exactly one top-level name field in SKILL.md frontmatter");
  const renamedFrontmatter = frontmatter[0].replace(/^name:[^\r\n]*$/m, `name: ${targetName}`);
  await writeText(skillPath, renamedFrontmatter + content.slice(frontmatter[0].length));
}
