import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { Recipe } from "./types.ts";
import { assert, hashFile, listFiles, pathExists } from "./util.ts";

function matches(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(path));
}

export async function validateOutput(
  directory: string,
  recipe: Recipe,
  upstreamDirectory?: string,
): Promise<void> {
  const required = recipe.validation?.require ?? ["SKILL.md"];
  for (const file of required) assert(await pathExists(join(directory, file)), `Required file is missing: ${file}`);

  const skillPath = join(directory, "SKILL.md");
  const skill = await readFile(skillPath, "utf8");
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert(frontmatter, "SKILL.md must start with YAML frontmatter");
  const metadata = parse(frontmatter[1]!) as Record<string, unknown>;
  assert(metadata?.name === recipe.name, `SKILL.md frontmatter name must remain ${recipe.name}`);
  assert(typeof metadata.description === "string" && metadata.description.trim().length > 0, "SKILL.md needs a description");

  const estimatedTokens = Math.ceil(skill.length / 4);
  if (recipe.validation?.max_skill_tokens) {
    assert(estimatedTokens <= recipe.validation.max_skill_tokens, `SKILL.md is about ${estimatedTokens} tokens; limit is ${recipe.validation.max_skill_tokens}`);
  }

  if (!upstreamDirectory) return;
  const outputFiles = await listFiles(directory);
  const upstreamFiles = await listFiles(upstreamDirectory);
  const changedFiles: string[] = [];
  for (const file of new Set([...outputFiles, ...upstreamFiles])) {
    if (!outputFiles.includes(file) || !upstreamFiles.includes(file)) {
      changedFiles.push(file);
      continue;
    }
    const outputPath = join(directory, file);
    const upstreamPath = join(upstreamDirectory, file);
    if (
      await hashFile(outputPath) !== await hashFile(upstreamPath)
      || ((await stat(outputPath)).mode & 0o777) !== ((await stat(upstreamPath)).mode & 0o777)
    ) changedFiles.push(file);
  }
  for (const transform of recipe.transforms ?? []) {
    if (transform.allowed_paths) {
      for (const file of changedFiles) assert(matches(file, transform.allowed_paths), `Transform changed outside allowed_paths: ${file}`);
    }
    if (transform.forbidden_paths) {
      for (const file of changedFiles) assert(!matches(file, transform.forbidden_paths), `Transform changed forbidden path: ${file}`);
    }
  }
}
