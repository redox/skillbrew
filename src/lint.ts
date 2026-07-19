import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { loadLockfile, loadProject, loadRecipe, type Project } from "./project.ts";
import type { LockEntry, Recipe } from "./types.ts";
import { hashText, hashTree, listFiles, pathExists } from "./util.ts";
import { validateOutput } from "./validation.ts";

interface LoadedRecipe {
  recipe: Recipe;
  path: string;
}

function inside(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== "..");
}

function stripFencedCode(markdown: string): string {
  let fenced = false;
  return markdown.split(/\r?\n/).map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : line;
  }).join("\n");
}

function lockMatchesRecipe(recipe: Recipe, entry: LockEntry): string[] {
  const issues: string[] = [];
  const sourceName = recipe.source.name ?? recipe.name;
  const prompt = recipe.transforms?.[0]?.prompt;
  if (entry.source_repository !== recipe.source.repository) issues.push("lock source_repository differs from recipe");
  if (entry.source_path !== recipe.source.path) issues.push("lock source_path differs from recipe");
  if (entry.source_ref !== recipe.source.ref) issues.push("lock source_ref differs from recipe ref");
  if ((entry.source_name ?? recipe.name) !== sourceName) issues.push("lock source_name differs from recipe");
  if (entry.license !== recipe.source.license) issues.push("lock license differs from recipe");
  if (Boolean(prompt) !== Boolean(entry.prompt_sha256)) issues.push("lock prompt hash presence differs from recipe");
  if (prompt && entry.prompt_sha256 && hashText(prompt) !== entry.prompt_sha256) issues.push("lock prompt hash is stale");
  if (prompt && !entry.transformer) issues.push("transformed skill has no transformer recorded in lock");
  return issues;
}

async function lintReferences(
  project: Project,
  skillName: string,
  skillNames: Set<string>,
): Promise<string[]> {
  const issues: string[] = [];
  const skillRoot = join(project.skillsDir, skillName);
  for (const file of (await listFiles(skillRoot)).filter((path) => path.endsWith(".md"))) {
    const absolute = join(skillRoot, file);
    const markdown = await readFile(absolute, "utf8");
    const source = stripFencedCode(markdown);

    const localTargets = new Set<string>();
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1]!.trim().replace(/^<|>$/g, "");
      target = target.replace(/\s+["'][^"']*["']$/, "");
      if (!target || target.startsWith("#") || target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      localTargets.add(target.split(/[?#]/, 1)[0]!);
    }
    for (const match of source.matchAll(/`((?:\.\.?\/)[^`\s]+)`/g)) localTargets.add(match[1]!);
    for (const target of localTargets) {
      const resolved = resolve(dirname(absolute), decodeURIComponent(target));
      if (!inside(project.skillsDir, resolved)) {
        issues.push(`${skillName}/${file}: local reference escapes skills/: ${target}`);
      } else if (!(await pathExists(resolved))) {
        issues.push(`${skillName}/${file}: local reference does not exist: ${target}`);
      }
    }

    const bundledTargets = new Set<string>();
    for (const match of source.matchAll(/\b((?:scripts|references|assets)\/[A-Za-z0-9._/-]+)/g)) {
      bundledTargets.add(match[1]!.replace(/[.,;:]+$/, ""));
    }
    for (const target of bundledTargets) {
      if (!(await pathExists(join(skillRoot, target)))) {
        issues.push(`${skillName}/${file}: bundled reference does not exist: ${target}`);
      }
    }

    for (const line of source.split("\n")) {
      for (const match of line.matchAll(/\b([a-z][a-z0-9-]+):([a-z][a-z0-9-]+)\b/g)) {
        const namespace = match[1]!;
        const dependency = match[2]!;
        if (namespace !== "superpowers" && !/\bskill\b/i.test(line)) continue;
        if (!skillNames.has(dependency)) {
          issues.push(`${skillName}/${file}: references missing skill ${namespace}:${dependency}`);
        }
      }
      for (const match of line.matchAll(/(?<!:)\b([a-z][a-z0-9-]*-[a-z0-9-]+)\s+skill\b/gi)) {
        const dependency = match[1]!.toLowerCase();
        if (!skillNames.has(dependency)) issues.push(`${skillName}/${file}: references missing skill ${dependency}`);
      }
      for (const match of line.matchAll(/\binvoke\s+(?:the\s+)?([a-z][a-z0-9-]*-[a-z0-9-]+)\b/gi)) {
        const dependency = match[1]!.toLowerCase();
        if (!skillNames.has(dependency)) issues.push(`${skillName}/${file}: invokes missing skill ${dependency}`);
      }
    }
  }
  return [...new Set(issues)];
}

export async function lintProject(project: Project): Promise<string[]> {
  const issues: string[] = [];
  const recipeFiles = (await readdir(project.recipesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name)
    .sort();
  const recipeNames = recipeFiles.map((file) => basename(file, ".yaml"));
  const skillNames = (await readdir(project.skillsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const lockfile = await loadLockfile(project);
  const lockNames = Object.keys(lockfile.skills).sort();
  const allNames = new Set([...recipeNames, ...skillNames, ...lockNames]);
  const skillNameSet = new Set(skillNames);
  const recipes = new Map<string, LoadedRecipe>();

  for (const name of recipeNames) {
    try {
      recipes.set(name, await loadRecipe(project, name));
    } catch (error) {
      issues.push(`${name}: invalid recipe: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const name of [...allNames].sort()) {
    if (!recipeNames.includes(name)) issues.push(`${name}: generated skill or lock entry has no recipe`);
    if (!skillNames.includes(name)) issues.push(`${name}: recipe or lock entry has no generated skill directory`);
    if (!lockNames.includes(name)) issues.push(`${name}: recipe or generated skill has no lock entry`);
  }

  for (const name of skillNames) {
    const loaded = recipes.get(name);
    const entry = lockfile.skills[name];
    const directory = join(project.skillsDir, name);
    if (!loaded || !entry) continue;
    try {
      await validateOutput(directory, loaded.recipe);
    } catch (error) {
      issues.push(`${name}: invalid generated skill: ${error instanceof Error ? error.message : String(error)}`);
    }
    const actualHash = await hashTree(directory);
    if (actualHash !== entry.output_sha256) issues.push(`${name}: generated output hash differs from lock`);
    for (const issue of lockMatchesRecipe(loaded.recipe, entry)) issues.push(`${name}: ${issue}`);
    issues.push(...await lintReferences(project, name, skillNameSet));
  }

  return [...new Set(issues)].sort();
}

if (import.meta.main) {
  const project = await loadProject(resolve(Bun.env.SKILLBREW_ROOT ?? process.cwd()));
  const issues = await lintProject(project);
  if (issues.length > 0) {
    console.error(`Skillbrew lint found ${issues.length} issue${issues.length === 1 ? "" : "s"}:`);
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  const count = (await readdir(project.skillsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
  console.log(`✓ ${count} skills are well formed and internally consistent`);
}
