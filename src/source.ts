import { chmod, copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Project } from "./project.ts";
import { assert, copyTree, ensureDir, resolveInside, run } from "./util.ts";

export interface Checkout {
  directory: string;
  ref: string;
  cleanup(): Promise<void>;
}

export async function checkoutSource(
  project: Project,
  repository: string,
  sourcePath: string,
  ref: string,
): Promise<Checkout> {
  const workRoot = join(project.stateDir, "work");
  await ensureDir(workRoot);
  const temporary = await mkdtemp(join(workRoot, "source-"));
  const repositoryDir = join(temporary, "repository");
  const outputDir = join(temporary, "skill");
  await ensureDir(repositoryDir);
  try {
    await run(["git", "init", "--quiet"], { cwd: repositoryDir });
    await run(["git", "fetch", "--quiet", "--depth=1", repository, ref], { cwd: repositoryDir });
    const resolved = (await run(["git", "rev-parse", "FETCH_HEAD"], { cwd: repositoryDir })).stdout.trim();
    await run(["git", "checkout", "--quiet", "--detach", "FETCH_HEAD"], { cwd: repositoryDir });
    const selected = resolveInside(repositoryDir, sourcePath);
    const selectedStat = await stat(selected);
    if (selectedStat.isDirectory()) {
      await copyTree(selected, outputDir);
    } else {
      assert(selectedStat.isFile() && basename(selected).endsWith(".md"), `Expected a skill directory or Markdown file: ${sourcePath}`);
      await ensureDir(outputDir);
      const destination = join(outputDir, "SKILL.md");
      await copyFile(selected, destination);
      await chmod(destination, selectedStat.mode & 0o777);
    }
    return {
      directory: outputDir,
      ref: resolved,
      cleanup: () => rm(temporary, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function updateTarget(source: { ref: string; update_ref?: string }): string {
  return source.update_ref ?? source.ref;
}
