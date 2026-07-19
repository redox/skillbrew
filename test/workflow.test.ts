import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { TransformerRunner } from "../src/cursor-transformer.ts";
import { loadProject } from "../src/project.ts";
import { updateSkill } from "../src/update.ts";
import type { Lockfile, Recipe } from "../src/types.ts";
import { ensureDir, hashTree, pathExists, run, writeText } from "../src/util.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function commit(repository: string, message: string): Promise<string> {
  await run(["git", "add", "."], { cwd: repository });
  await run(["git", "-c", "user.name=Skillbrew Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", message], { cwd: repository });
  return (await run(["git", "rev-parse", "HEAD"], { cwd: repository })).stdout.trim();
}

async function createProject(root: string): Promise<string> {
  const projectRoot = join(root, "project");
  await ensureDir(join(projectRoot, "recipes"));
  await ensureDir(join(projectRoot, "skills"));
  await writeText(join(projectRoot, "skillbrew.config.yaml"), `
version: 1
skills_dir: skills
recipes_dir: recipes
state_dir: .skillbrew
lockfile: skills.lock.yaml
transformer:
  provider: cursor-sdk
  id: test-transformer
  model: composer-2.5
`);
  return projectRoot;
}

describe("skillbrew workflow", () => {
  test("rewrites, semantically rebases, locks, and skips a current skill", async () => {
    const root = await mkdtemp("/tmp/skillbrew-test-");
    temporaryDirectories.push(root);
    const upstream = join(root, "upstream");
    const projectRoot = await createProject(root);
    await ensureDir(upstream);
    await run(["git", "init", "--quiet", "--initial-branch=main"], { cwd: upstream });
    await writeText(join(upstream, "SKILL.md"), "---\nname: demo\ndescription: Original demo\n---\n\n# Demo\n\nUpstream v1.\n");
    const firstRef = await commit(upstream, "first");

    const modes: string[] = [];
    const transformerRunner: TransformerRunner = async (request) => {
      modes.push(request.mode);
      const path = join(request.workspace, "SKILL.md");
      const original = await readFile(path, "utf8");
      await Bun.write(path, `${original}\nLocally adapted in ${request.mode}.\n`);
      return { output: "" };
    };
    const recipePath = join(projectRoot, "recipes", "demo.yaml");
    await writeText(recipePath, `
name: demo
source:
  repository: ${JSON.stringify(upstream)}
  path: .
  ref: ${firstRef}
  update_ref: main
transforms:
  - type: llm
    prompt: |
      Preserve the local adaptation.
    allowed_paths: [SKILL.md]
validation:
  require: [SKILL.md]
  max_skill_tokens: 500
`);
    await writeText(join(projectRoot, "skills.lock.yaml"), "version: 1\nskills: {}\n");
    const project = await loadProject(projectRoot);

    await updateSkill(project, "demo", { dryRun: false, transformerRunner });
    expect(await readFile(join(project.skillsDir, "demo", "SKILL.md"), "utf8")).toContain("rewrite");
    expect(await pathExists(join(project.stateDir, "candidates"))).toBe(false);
    const firstOutputHash = await hashTree(join(project.skillsDir, "demo"));

    await writeText(join(upstream, "SKILL.md"), "---\nname: demo\ndescription: Improved upstream demo\n---\n\n# Demo\n\nUpstream v2.\n");
    const secondRef = await commit(upstream, "second");
    await updateSkill(project, "demo", { dryRun: false, transformerRunner });
    const updated = await readFile(join(project.skillsDir, "demo", "SKILL.md"), "utf8");
    expect(updated).toContain("Upstream v2");
    expect(updated).toContain("semantic-rebase");

    const callsBeforeNoop = modes.length;
    await updateSkill(project, "demo", { dryRun: false, transformerRunner });
    expect(modes.length).toBe(callsBeforeNoop);

    const recipe = parse(await readFile(recipePath, "utf8")) as Recipe;
    expect(recipe.source.ref).toBe(secondRef);
    const lock = parse(await readFile(project.lockfilePath, "utf8")) as Lockfile;
    expect(lock.skills.demo?.source_ref).toBe(secondRef);
    expect(lock.skills.demo?.previous_output_sha256).toBe(firstOutputHash);
    expect(lock.skills.demo?.transformer).toBe("test-transformer");
    expect(lock.skills.demo?.prompt_sha256).toBeDefined();
    expect(modes).toEqual(["rewrite", "semantic-rebase"]);
  });

  test("dry runs preview without writing output, lock data, or candidates", async () => {
    const root = await mkdtemp("/tmp/skillbrew-dry-run-");
    temporaryDirectories.push(root);
    const upstream = join(root, "upstream");
    const projectRoot = await createProject(root);
    await ensureDir(upstream);
    await run(["git", "init", "--quiet"], { cwd: upstream });
    await writeText(join(upstream, "SKILL.md"), "---\nname: plain\ndescription: Plain skill\n---\n\nPlain.\n");
    const ref = await commit(upstream, "plain");
    await writeText(join(projectRoot, "recipes", "plain.yaml"), `name: plain\nsource:\n  repository: ${JSON.stringify(upstream)}\n  path: .\n  ref: ${ref}\n`);
    const project = await loadProject(projectRoot);
    await updateSkill(project, "plain", { dryRun: true });
    expect(await pathExists(join(project.skillsDir, "plain"))).toBe(false);
    expect(await pathExists(project.lockfilePath)).toBe(false);
    expect(await pathExists(join(project.stateDir, "candidates"))).toBe(false);
  });

  test("imports an upstream skill under a different local name", async () => {
    const root = await mkdtemp("/tmp/skillbrew-rename-");
    temporaryDirectories.push(root);
    const upstream = join(root, "upstream");
    const projectRoot = await createProject(root);
    await ensureDir(upstream);
    await run(["git", "init", "--quiet"], { cwd: upstream });
    await writeText(join(upstream, "SKILL.md"), "---\nname: upstream-name\ndescription: Renamable skill\n---\n\nBody stays unchanged.\n");
    const ref = await commit(upstream, "renamable");
    await writeText(join(projectRoot, "recipes", "local-name.yaml"), `
name: local-name
source:
  name: upstream-name
  repository: ${JSON.stringify(upstream)}
  path: .
  ref: ${ref}
`);
    const project = await loadProject(projectRoot);
    await updateSkill(project, "local-name", { dryRun: false });

    const output = await readFile(join(project.skillsDir, "local-name", "SKILL.md"), "utf8");
    expect(output).toContain("name: local-name");
    expect(output).toContain("Body stays unchanged.");
    const lock = parse(await readFile(project.lockfilePath, "utf8")) as Lockfile;
    expect(lock.skills["local-name"]?.source_name).toBe("upstream-name");
  });

  test("bare update processes every recipe", async () => {
    const root = await mkdtemp("/tmp/skillbrew-update-all-");
    temporaryDirectories.push(root);
    const upstream = join(root, "upstream");
    const projectRoot = await createProject(root);
    await ensureDir(join(upstream, "skills", "one"));
    await ensureDir(join(upstream, "skills", "two"));
    await run(["git", "init", "--quiet"], { cwd: upstream });
    await writeText(join(upstream, "skills", "one", "SKILL.md"), "---\nname: one\ndescription: First skill\n---\n\nOne.\n");
    await writeText(join(upstream, "skills", "two", "SKILL.md"), "---\nname: two\ndescription: Second skill\n---\n\nTwo.\n");
    const ref = await commit(upstream, "two skills");
    for (const name of ["one", "two"]) {
      await writeText(join(projectRoot, "recipes", `${name}.yaml`), `name: ${name}\nsource:\n  repository: ${JSON.stringify(upstream)}\n  path: skills/${name}\n  ref: ${ref}\n`);
    }

    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    await run(["bun", cli, "update"], { cwd: projectRoot, env: { SKILLBREW_ROOT: projectRoot } });
    expect(await pathExists(join(projectRoot, "skills", "one", "SKILL.md"))).toBe(true);
    expect(await pathExists(join(projectRoot, "skills", "two", "SKILL.md"))).toBe(true);
    const lock = parse(await readFile(join(projectRoot, "skills.lock.yaml"), "utf8")) as Lockfile;
    expect(Object.keys(lock.skills).sort()).toEqual(["one", "two"]);
  });
});
