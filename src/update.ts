import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TransformerRunner } from "./cursor-transformer.ts";
import type { Project } from "./project.ts";
import { loadLockfile, loadRecipe, saveLockfile, updateRecipeRef } from "./project.ts";
import { applySkillRename } from "./rename.ts";
import { checkoutSource, updateTarget } from "./source.ts";
import { applyTransforms } from "./transformer.ts";
import type { LockEntry, Recipe } from "./types.ts";
import { assert, copyTree, hashText, hashTree, pathExists, replaceTree, run, validateSkillName } from "./util.ts";
import { validateOutput } from "./validation.ts";

export interface UpdateOptions {
  dryRun: boolean;
  usePinnedRef?: boolean;
  transformerRunner?: TransformerRunner;
}

function promptMatchesLock(recipe: Recipe, entry: LockEntry): boolean {
  const currentPrompt = recipe.transforms?.[0]?.prompt;
  if (Boolean(currentPrompt) !== Boolean(entry.prompt_sha256)) return false;
  return !currentPrompt || hashText(currentPrompt) === entry.prompt_sha256;
}

function transformerId(project: Project): string {
  return project.config.transformer?.id ?? `cursor-sdk/${project.config.transformer?.model}`;
}

function metadataMatchesLock(
  project: Project,
  recipe: Recipe,
  entry: LockEntry,
  sourceRef: string,
  sourceTreeHash: string,
): boolean {
  const sourceName = recipe.source.name ?? recipe.name;
  const hasTransform = Boolean(recipe.transforms?.length);
  return entry.source_repository === recipe.source.repository
    && entry.source_path === recipe.source.path
    && entry.source_ref === sourceRef
    && entry.source_tree_sha256 === sourceTreeHash
    && (entry.source_name ?? recipe.name) === sourceName
    && entry.license === recipe.source.license
    && promptMatchesLock(recipe, entry)
    && (!hasTransform || entry.transformer === transformerId(project));
}

async function showDiff(project: Project, before: string, after: string): Promise<void> {
  const result = await run(["git", "diff", "--no-index", "--", before, after], {
    cwd: project.root,
    allowFailure: true,
  });
  if (result.exitCode > 1) throw new Error(result.stderr);
  console.log(result.stdout || "No content changes.");
}

export async function updateSkill(project: Project, name: string, options: UpdateOptions): Promise<void> {
  validateSkillName(name);
  const { recipe, path: recipePath } = await loadRecipe(project, name);
  const lockfile = await loadLockfile(project);
  const oldLock = lockfile.skills[name];
  const sourceName = recipe.source.name ?? recipe.name;
  if (oldLock && sourceName !== (oldLock.source_name ?? recipe.name)) {
    throw new Error(`${name}'s source name differs from its lock; rebuild it as a new local skill name`);
  }

  const output = join(project.skillsDir, name);
  const currentOutputExists = await pathExists(output);
  if (oldLock && !currentOutputExists) throw new Error(`${name} is locked but its output is missing`);
  if (oldLock && currentOutputExists && await hashTree(output) !== oldLock.output_sha256) {
    throw new Error(`${name} differs from its lock; restore the generated output before updating`);
  }
  if (currentOutputExists) await validateOutput(output, recipe);

  const upstream = await checkoutSource(
    project,
    recipe.source.repository,
    recipe.source.path,
    options.usePinnedRef ? recipe.source.ref : updateTarget(recipe.source),
  );
  let previousUpstream: Awaited<ReturnType<typeof checkoutSource>> | undefined;
  const buildRoot = await mkdtemp(join(project.stateDir, "work", `build-${name}-`));
  try {
    const sourceTreeHash = await hashTree(upstream.directory);
    if (oldLock && currentOutputExists && metadataMatchesLock(project, recipe, oldLock, upstream.ref, sourceTreeHash)) {
      console.log(`✓ ${name} is up to date`);
      return;
    }

    const workspace = join(buildRoot, "workspace");
    const contextDirectory = join(workspace, ".skillbrew-context");
    await copyTree(upstream.directory, workspace);
    await applySkillRename(workspace, sourceName, recipe.name);
    const validationBaseline = join(buildRoot, "validation-baseline");
    await copyTree(workspace, validationBaseline);
    const transform = recipe.transforms?.[0];
    const hasTransform = Boolean(transform);
    const mode = hasTransform
      ? (transform?.mode !== "rewrite" && oldLock && currentOutputExists ? "semantic-rebase" : "rewrite")
      : "copy";
    if (mode === "semantic-rebase") {
      previousUpstream = await checkoutSource(project, oldLock!.source_repository, oldLock!.source_path, oldLock!.source_ref);
      assert(await hashTree(previousUpstream.directory) === oldLock!.source_tree_sha256, "Previous upstream no longer matches the locked source hash");
      await applySkillRename(previousUpstream.directory, sourceName, recipe.name);
    }
    const transformed = hasTransform
      ? await applyTransforms(project, recipe, {
          name,
          mode: mode as "rewrite" | "semantic-rebase",
          workspace,
          contextDirectory,
          newUpstream: validationBaseline,
          previousUpstream: previousUpstream?.directory,
          previousOutput: currentOutputExists ? output : undefined,
        }, options.transformerRunner)
      : {};

    await validateOutput(workspace, recipe, validationBaseline);
    const outputHash = await hashTree(workspace);
    const entry: LockEntry = {
      source_repository: recipe.source.repository,
      source_path: recipe.source.path,
      source_ref: upstream.ref,
      source_tree_sha256: sourceTreeHash,
      ...(sourceName !== recipe.name ? { source_name: sourceName } : {}),
      ...(recipe.source.license ? { license: recipe.source.license } : {}),
      ...(transformed.promptContent ? { prompt_sha256: hashText(transformed.promptContent) } : {}),
      ...(hasTransform ? { transformer: transformerId(project) } : {}),
      ...(oldLock?.output_sha256 ? { previous_output_sha256: oldLock.output_sha256 } : {}),
      output_sha256: outputHash,
      generated_at: new Date().toISOString(),
    };

    console.log(`\n${name}: ${recipe.source.ref.slice(0, 12)} -> ${upstream.ref.slice(0, 12)} (${mode})`);
    await showDiff(project, currentOutputExists ? output : upstream.directory, workspace);
    if (options.dryRun) {
      console.log("Dry run complete; no files were changed.");
      return;
    }

    await replaceTree(workspace, output);
    lockfile.skills[name] = entry;
    await saveLockfile(project, lockfile);
    await updateRecipeRef(recipePath, upstream.ref);
    await validateOutput(output, recipe);
    assert(await hashTree(output) === entry.output_sha256, `${name} changed while being updated`);
    console.log(`Updated ${name} at ${upstream.ref}.`);
  } finally {
    await upstream.cleanup();
    await previousUpstream?.cleanup();
    await rm(buildRoot, { recursive: true, force: true });
  }
}
