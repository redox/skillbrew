import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import type { Lockfile, Recipe, SkillbrewConfig } from "./types.ts";
import { assert, pathExists, resolveInside, validateSkillName, writeText } from "./util.ts";

const defaults: SkillbrewConfig = {
  version: 1,
  skills_dir: "skills",
  recipes_dir: "recipes",
  state_dir: ".skillbrew",
  lockfile: "skills.lock.yaml",
};

export interface Project {
  root: string;
  config: SkillbrewConfig;
  configPath: string;
  skillsDir: string;
  recipesDir: string;
  stateDir: string;
  lockfilePath: string;
}

export async function loadProject(root: string): Promise<Project> {
  const configPath = join(root, "skillbrew.config.yaml");
  const raw = (await pathExists(configPath)) ? parse(await readFile(configPath, "utf8")) : {};
  const config = { ...defaults, ...raw } as SkillbrewConfig;
  assert(config.version === 1, "Unsupported skillbrew.config.yaml version");
  if (config.transformer) {
    assert(config.transformer.provider === "cursor-sdk", `Unsupported transformer provider: ${String(config.transformer.provider)}`);
    assert(typeof config.transformer.model === "string" && config.transformer.model.length > 0, "transformer.model must be a non-empty Cursor model ID");
  }
  return {
    root,
    config,
    configPath,
    skillsDir: resolveInside(root, config.skills_dir),
    recipesDir: resolveInside(root, config.recipes_dir),
    stateDir: resolveInside(root, config.state_dir),
    lockfilePath: resolveInside(root, config.lockfile),
  };
}

export async function loadRecipe(project: Project, name: string): Promise<{ recipe: Recipe; path: string }> {
  validateSkillName(name);
  const path = resolveInside(project.recipesDir, `${name}.yaml`);
  assert(await pathExists(path), `Recipe not found: ${path}`);
  const recipe = parse(await readFile(path, "utf8")) as Recipe;
  assert(recipe?.name === name, `Recipe name must be ${name}`);
  assert(recipe.source?.repository && recipe.source?.path && recipe.source?.ref, `Recipe ${name} has an incomplete source`);
  if (recipe.source.name) validateSkillName(recipe.source.name);
  for (const transform of recipe.transforms ?? []) {
    assert(transform.type === "llm", `Unsupported transform type in ${name}: ${String(transform.type)}`);
    assert(Boolean(transform.prompt), `LLM transform in ${name} needs a prompt`);
  }
  return { recipe, path };
}

export async function updateRecipeRef(path: string, ref: string): Promise<void> {
  const document = parseDocument(await readFile(path, "utf8"));
  document.setIn(["source", "ref"], ref);
  await writeText(path, document.toString());
}

export async function loadLockfile(project: Project): Promise<Lockfile> {
  if (!(await pathExists(project.lockfilePath))) return { version: 1, skills: {} };
  const lockfile = parse(await readFile(project.lockfilePath, "utf8")) as Lockfile;
  assert(lockfile?.version === 1 && typeof lockfile.skills === "object", "Invalid skills lockfile");
  return lockfile;
}

export async function saveLockfile(project: Project, lockfile: Lockfile): Promise<void> {
  const ordered: Lockfile = {
    version: 1,
    skills: Object.fromEntries(Object.entries(lockfile.skills).sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeText(project.lockfilePath, stringify(ordered, { lineWidth: 0 }));
}
