import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { lintProject } from "../src/lint.ts";
import { loadProject } from "../src/project.ts";
import type { Lockfile } from "../src/types.ts";
import { ensureDir, hashTree, writeText } from "../src/util.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createFixture(): Promise<{ root: string; skill: string }> {
  const root = await mkdtemp("/tmp/skillbrew-lint-");
  temporaryDirectories.push(root);
  const skill = join(root, "skills", "demo");
  await ensureDir(join(skill, "references"));
  await ensureDir(join(root, "recipes"));
  await writeText(join(root, "skillbrew.config.yaml"), "version: 1\n");
  await writeText(join(skill, "SKILL.md"), `---
name: demo
description: Demonstrate a valid lint fixture
---

# Demo

Read [the guide](references/guide.md).
Use superpowers:demo skill when recursing.
`);
  await writeText(join(skill, "references", "guide.md"), "# Guide\n");
  await writeText(join(root, "recipes", "demo.yaml"), `name: demo
source:
  repository: https://example.invalid/skills.git
  path: skills/demo
  ref: "0123456789012345678901234567890123456789"
`);
  const lockfile: Lockfile = {
    version: 1,
    skills: {
      demo: {
        source_repository: "https://example.invalid/skills.git",
        source_path: "skills/demo",
        source_ref: "0123456789012345678901234567890123456789",
        source_tree_sha256: "upstream-hash",
        output_sha256: await hashTree(skill),
        generated_at: "2026-01-01T00:00:00.000Z",
      },
    },
  };
  await writeText(join(root, "skills.lock.yaml"), stringify(lockfile));
  return { root, skill };
}

describe("skillbrew lint", () => {
  test("accepts a consistent skill repository", async () => {
    const fixture = await createFixture();
    expect(await lintProject(await loadProject(fixture.root))).toEqual([]);
  });

  test("reports broken local references and missing skill dependencies", async () => {
    const fixture = await createFixture();
    await Bun.write(join(fixture.skill, "SKILL.md"), `---
name: demo
description: Demonstrate lint failures
---

Read [the missing guide](references/missing.md).
Use superpowers:missing-skill skill.
`);
    const issues = await lintProject(await loadProject(fixture.root));
    expect(issues.some((issue) => issue.includes("local reference does not exist: references/missing.md"))).toBe(true);
    expect(issues.some((issue) => issue.includes("references missing skill superpowers:missing-skill"))).toBe(true);
  });

  test("reports recipe, skill, and lock set mismatches", async () => {
    const fixture = await createFixture();
    await writeText(join(fixture.root, "recipes", "orphan.yaml"), `name: orphan
source:
  repository: https://example.invalid/skills.git
  path: skills/orphan
  ref: "0123456789012345678901234567890123456789"
`);
    const issues = await lintProject(await loadProject(fixture.root));
    expect(issues).toContain("orphan: recipe or lock entry has no generated skill directory");
    expect(issues).toContain("orphan: recipe or generated skill has no lock entry");
  });
});
