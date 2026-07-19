import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { addSkill, parseGitHubUrl } from "../src/add.ts";
import { lintProject } from "../src/lint.ts";
import { loadProject } from "../src/project.ts";
import type { Lockfile, Recipe } from "../src/types.ts";
import { ensureDir, run, writeText } from "../src/util.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function commit(repository: string): Promise<string> {
  await run(["git", "add", "."], { cwd: repository });
  await run(["git", "-c", "user.name=Skillbrew Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "add skill"], { cwd: repository });
  return (await run(["git", "rev-parse", "HEAD"], { cwd: repository })).stdout.trim();
}

describe("skillbrew add", () => {
  test("parses GitHub tree and blob skill URLs", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo/tree/main/skills/demo")).toEqual({
      repository: "https://github.com/owner/repo.git",
      ref: "main",
      path: "skills/demo",
    });
    expect(parseGitHubUrl("https://github.com/owner/repo/blob/v1/skills/demo/SKILL.md")).toEqual({
      repository: "https://github.com/owner/repo.git",
      ref: "v1",
      path: "skills/demo",
    });
    expect(parseGitHubUrl("https://github.com/owner/repo/blob/main/plugins/demo/agents/demo.md")).toEqual({
      repository: "https://github.com/owner/repo.git",
      ref: "main",
      path: "plugins/demo/agents/demo.md",
    });
  });

  test("discovers and normalizes a single Claude agent inside a plugin", async () => {
    const root = await mkdtemp("/tmp/skillbrew-add-agent-");
    temporaryDirectories.push(root);
    const upstream = join(root, "upstream");
    const plugin = join(upstream, "plugins", "code-simplifier");
    const projectRoot = join(root, "project");
    await ensureDir(join(plugin, "agents"));
    await ensureDir(join(projectRoot, "recipes"));
    await ensureDir(join(projectRoot, "skills"));
    await run(["git", "init", "--quiet", "--initial-branch=main"], { cwd: upstream });
    await writeText(join(plugin, "agents", "code-simplifier.md"), `---
name: code-simplifier
description: Simplifies code without changing behavior
model: opus
---

# Code simplifier
`);
    await writeText(join(plugin, "LICENSE"), "Apache License\nVersion 2.0, January 2004\n");
    const ref = await commit(upstream);
    await writeText(join(projectRoot, "skillbrew.config.yaml"), "version: 1\n");
    const project = await loadProject(projectRoot);

    await addSkill(project, plugin);

    const recipe = parse(await readFile(join(project.recipesDir, "code-simplifier.yaml"), "utf8")) as Recipe;
    expect(recipe.source.path).toBe("plugins/code-simplifier/agents/code-simplifier.md");
    expect(recipe.source.ref).toBe(ref);
    expect(recipe.source.license).toBe("Apache-2.0");
    expect(await readFile(join(project.skillsDir, "code-simplifier", "SKILL.md"), "utf8")).toContain("name: code-simplifier");
    expect(await lintProject(project)).toEqual([]);
  });

  test("creates, imports, renames, and locks a recipe from a local skill", async () => {
    const root = await mkdtemp("/tmp/skillbrew-add-");
    temporaryDirectories.push(root);
    const upstream = join(root, "upstream");
    const skill = join(upstream, "skills", "upstream-name");
    const projectRoot = join(root, "project");
    await ensureDir(skill);
    await ensureDir(join(projectRoot, "recipes"));
    await ensureDir(join(projectRoot, "skills"));
    await run(["git", "init", "--quiet", "--initial-branch=main"], { cwd: upstream });
    await writeText(join(skill, "SKILL.md"), `---
name: upstream-name
description: A local skill used by the add command test
---

# Upstream skill
`);
    const ref = await commit(upstream);
    await writeText(join(projectRoot, "skillbrew.config.yaml"), "version: 1\n");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const result = await run(["bun", cli, "add", join(skill, "SKILL.md"), "--name", "local-name", "--license", "MIT"], {
      cwd: projectRoot,
      env: { SKILLBREW_ROOT: projectRoot },
    });
    expect(result.stdout).toContain("Created recipes/local-name.yaml");
    const project = await loadProject(projectRoot);
    const recipe = parse(await readFile(join(project.recipesDir, "local-name.yaml"), "utf8")) as Recipe;
    expect(recipe).toEqual({
      name: "local-name",
      source: {
        name: "upstream-name",
        repository: await realpath(upstream),
        path: "skills/upstream-name",
        ref,
        update_ref: "main",
        license: "MIT",
      },
    });
    expect(await readFile(join(project.skillsDir, "local-name", "SKILL.md"), "utf8")).toContain("name: local-name");
    const lock = parse(await readFile(project.lockfilePath, "utf8")) as Lockfile;
    expect(lock.skills["local-name"]?.source_name).toBe("upstream-name");
    expect(await lintProject(project)).toEqual([]);
  });

  test("rejects uncommitted local skill changes", async () => {
    const root = await mkdtemp("/tmp/skillbrew-add-dirty-");
    temporaryDirectories.push(root);
    const upstream = join(root, "upstream");
    const skill = join(upstream, "skill");
    const projectRoot = join(root, "project");
    await ensureDir(skill);
    await ensureDir(join(projectRoot, "recipes"));
    await ensureDir(join(projectRoot, "skills"));
    await run(["git", "init", "--quiet", "--initial-branch=main"], { cwd: upstream });
    await writeText(join(skill, "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
    await commit(upstream);
    await writeText(join(skill, "SKILL.md"), "---\nname: demo\ndescription: Changed\n---\n");
    await writeText(join(projectRoot, "skillbrew.config.yaml"), "version: 1\n");
    const project = await loadProject(projectRoot);

    await expect(addSkill(project, skill)).rejects.toThrow("uncommitted changes");
  });
});
