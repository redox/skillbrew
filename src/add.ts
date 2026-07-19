import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import type { Project } from "./project.ts";
import { loadLockfile } from "./project.ts";
import { checkoutSource } from "./source.ts";
import { updateSkill } from "./update.ts";
import { assert, listFiles, pathExists, resolveInside, run, validateSkillName, writeText } from "./util.ts";

export interface AddOptions {
  name?: string;
  ref?: string;
  path?: string;
  license?: string;
}

interface ResolvedSource {
  repository: string;
  path: string;
  ref: string;
  updateRef?: string;
}

interface GitHubLocation {
  repository: string;
  path?: string;
  ref?: string;
}

function isCommit(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

export function parseGitHubUrl(value: string): GitHubLocation | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) return undefined;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  assert(parts.length >= 2, "GitHub source must include an owner and repository");
  const owner = parts[0]!;
  const repositoryName = parts[1]!.replace(/\.git$/, "");
  const marker = parts[2];
  if (marker && marker !== "tree" && marker !== "blob") {
    throw new Error("GitHub source must be a repository URL or a /tree/<ref>/<path> URL");
  }
  if (!marker) return { repository: `https://github.com/${owner}/${repositoryName}.git` };
  assert(parts[3], `GitHub ${marker} URL is missing a ref`);
  let sourcePath = parts.slice(4).join("/") || ".";
  if (marker === "blob") {
    assert(sourcePath.endsWith(".md"), "GitHub blob URL must point to a Markdown file");
    if (posix.basename(sourcePath) === "SKILL.md") sourcePath = posix.dirname(sourcePath);
  }
  return {
    repository: `https://github.com/${owner}/${repositoryName}.git`,
    ref: parts[3],
    path: sourcePath,
  };
}

async function defaultBranch(repository: string): Promise<string> {
  const result = await run(["git", "ls-remote", "--symref", repository, "HEAD"], {
    cwd: process.cwd(),
  });
  const match = result.stdout.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/m);
  assert(match?.[1], `Could not determine the default branch for ${repository}; pass --ref`);
  return match[1];
}

async function resolveGitHubSource(location: GitHubLocation, options: AddOptions): Promise<ResolvedSource> {
  const targetRef = options.ref ?? location.ref ?? await defaultBranch(location.repository);
  const sourcePath = options.path ?? location.path ?? ".";
  const updateRef = isCommit(targetRef) ? await defaultBranch(location.repository) : targetRef;
  return {
    repository: location.repository,
    path: sourcePath,
    ref: targetRef,
    updateRef,
  };
}

async function resolveLocalSource(project: Project, value: string, options: AddOptions): Promise<ResolvedSource> {
  const unresolvedInput = value.startsWith("file:") ? fileURLToPath(value) : resolve(project.root, value);
  const input = await realpath(unresolvedInput).catch(() => unresolvedInput);
  const inputStat = await stat(input).catch(() => undefined);
  assert(inputStat, `Local source does not exist: ${input}`);
  const base = inputStat.isFile() ? dirname(input) : input;
  if (inputStat.isFile()) assert(basename(input) === "SKILL.md", "Local file source must point to SKILL.md");
  let skillDirectory = options.path ? resolve(base, options.path) : base;
  const skillStat = await stat(skillDirectory).catch(() => undefined);
  if (skillStat?.isFile()) {
    assert(basename(skillDirectory) === "SKILL.md", "--path must point to a skill directory or SKILL.md");
    skillDirectory = dirname(skillDirectory);
  }
  skillDirectory = await realpath(skillDirectory);

  const rootResult = await run(["git", "rev-parse", "--show-toplevel"], { cwd: skillDirectory });
  const repository = await realpath(rootResult.stdout.trim());
  const sourcePath = relative(repository, skillDirectory).split(sep).join("/") || ".";
  assert(sourcePath !== ".." && !sourcePath.startsWith("../"), "Local skill must be inside its Git repository");
  if (!options.ref) {
    const status = await run(["git", "status", "--porcelain", "--untracked-files=all", "--", sourcePath], { cwd: repository });
    assert(!status.stdout.trim(), "Local skill has uncommitted changes; commit it before adding the recipe");
  }
  const ref = options.ref ?? (await run(["git", "rev-parse", "HEAD"], { cwd: repository })).stdout.trim();
  const branch = await run(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: repository, allowFailure: true });
  const updateRef = options.ref && !isCommit(options.ref)
    ? options.ref
    : branch.exitCode === 0 ? branch.stdout.trim() : undefined;
  return {
    repository,
    path: sourcePath,
    ref,
    ...(updateRef ? { updateRef } : {}),
  };
}

async function readMetadata(path: string): Promise<{ name: string; license?: string }> {
  const skill = await readFile(path, "utf8");
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert(frontmatter, "SKILL.md must start with YAML frontmatter");
  const metadata = parse(frontmatter[1]!) as Record<string, unknown>;
  assert(typeof metadata.name === "string", "SKILL.md frontmatter needs a name");
  validateSkillName(metadata.name);
  assert(typeof metadata.description === "string" && metadata.description.trim(), "SKILL.md frontmatter needs a description");
  return {
    name: metadata.name,
    ...(typeof metadata.license === "string" && metadata.license.trim() ? { license: metadata.license.trim() } : {}),
  };
}

interface DiscoveredSkill {
  path: string;
  metadataPath: string;
}

async function discoverSkill(directory: string): Promise<DiscoveredSkill> {
  if (await pathExists(join(directory, "SKILL.md"))) {
    return { path: ".", metadataPath: join(directory, "SKILL.md") };
  }
  const files = await listFiles(directory);
  const skills = files.filter((file) => posix.basename(file) === "SKILL.md");
  if (skills.length === 1) {
    return { path: posix.dirname(skills[0]!), metadataPath: join(directory, skills[0]!) };
  }
  if (skills.length > 1) {
    throw new Error(`Multiple skills found; pass --path to choose one:\n${skills.map((file) => `- ${file}`).join("\n")}`);
  }
  const agents = files.filter((file) => /^agents\/[^/]+\.md$/.test(file));
  if (agents.length === 1) {
    return { path: agents[0]!, metadataPath: join(directory, agents[0]!) };
  }
  if (agents.length > 1) {
    throw new Error(`Multiple Claude agents found; pass --path to choose one:\n${agents.map((file) => `- ${file}`).join("\n")}`);
  }
  throw new Error("No SKILL.md or single agents/*.md definition found at the source");
}

async function inferLicense(directory: string): Promise<string | undefined> {
  const license = (await listFiles(directory)).find((file) => /^(?:license|licence)(?:\.[a-z0-9]+)?$/i.test(file));
  if (!license) return undefined;
  const text = await readFile(join(directory, license), "utf8");
  if (/Apache License\s+Version 2\.0/i.test(text)) return "Apache-2.0";
  if (/MIT License/i.test(text)) return "MIT";
  return undefined;
}

export async function addSkill(project: Project, source: string, options: AddOptions = {}): Promise<string> {
  const github = parseGitHubUrl(source);
  if (!github && /^[a-z][a-z0-9+.-]*:\/\//i.test(source) && !source.startsWith("file:")) {
    throw new Error("Remote sources must use a github.com repository, tree, or SKILL.md URL");
  }
  const requested = github
    ? await resolveGitHubSource(github, options)
    : await resolveLocalSource(project, source, options);
  const checkout = await checkoutSource(project, requested.repository, requested.path, requested.ref);
  try {
    const discovered = await discoverSkill(checkout.directory);
    const metadata = await readMetadata(discovered.metadataPath);
    const sourcePath = discovered.path === "."
      ? requested.path
      : posix.join(requested.path === "." ? "" : requested.path, discovered.path);
    const name = options.name ?? metadata.name;
    validateSkillName(name);
    const recipePath = resolveInside(project.recipesDir, `${name}.yaml`);
    const lockfile = await loadLockfile(project);
    assert(!(await pathExists(recipePath)), `Recipe already exists: ${name}`);
    assert(!(await pathExists(join(project.skillsDir, name))), `Generated skill already exists: ${name}`);
    assert(!lockfile.skills[name], `Lock entry already exists: ${name}`);

    const license = options.license ?? metadata.license ?? await inferLicense(checkout.directory);
    const recipe = {
      name,
      source: {
        ...(name !== metadata.name ? { name: metadata.name } : {}),
        repository: requested.repository,
        path: sourcePath,
        ref: checkout.ref,
        ...(requested.updateRef ? { update_ref: requested.updateRef } : {}),
        ...(license ? { license } : {}),
      },
    };
    await writeText(recipePath, stringify(recipe, { lineWidth: 0 }));
    console.log(`Created ${relative(project.root, recipePath)}`);
    await updateSkill(project, name, { dryRun: false, usePinnedRef: true });
    return name;
  } finally {
    await checkout.cleanup();
  }
}
