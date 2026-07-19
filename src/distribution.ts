import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "./util.ts";

type JsonObject = Record<string, unknown>;

async function readJson(root: string, relativePath: string, issues: string[]): Promise<JsonObject | undefined> {
  const absolute = join(root, relativePath);
  if (!(await pathExists(absolute))) {
    issues.push(`${relativePath}: missing distribution file`);
    return undefined;
  }
  try {
    const value = JSON.parse(await readFile(absolute, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
    return value as JsonObject;
  } catch (error) {
    issues.push(`${relativePath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function checkManifest(
  manifest: JsonObject | undefined,
  relativePath: string,
  expectedName: string,
  expectedVersion: string,
  issues: string[],
  options: { skillsPath?: boolean } = {},
): void {
  if (!manifest) return;
  if (manifest.name !== expectedName) issues.push(`${relativePath}: name must be ${expectedName}`);
  if (manifest.version !== expectedVersion) issues.push(`${relativePath}: version must match package.json (${expectedVersion})`);
  if (options.skillsPath && manifest.skills !== "./skills/") issues.push(`${relativePath}: skills must point to ./skills/`);
}

export async function lintDistribution(root: string): Promise<string[]> {
  const issues: string[] = [];
  const packageJson = await readJson(root, "package.json", issues);
  if (!packageJson) return issues;
  const packageName = typeof packageJson.name === "string" ? packageJson.name : "";
  const pluginName = packageName.split("/").at(-1) ?? "";
  const version = typeof packageJson.version === "string" ? packageJson.version : "";
  if (!pluginName) issues.push("package.json: name must be a non-empty package name");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) issues.push("package.json: version must be semver");

  const claude = await readJson(root, ".claude-plugin/plugin.json", issues);
  const codex = await readJson(root, ".codex-plugin/plugin.json", issues);
  const cursor = await readJson(root, ".cursor-plugin/plugin.json", issues);
  const kimi = await readJson(root, ".kimi-plugin/plugin.json", issues);
  checkManifest(claude, ".claude-plugin/plugin.json", pluginName, version, issues);
  checkManifest(codex, ".codex-plugin/plugin.json", pluginName, version, issues, { skillsPath: true });
  checkManifest(cursor, ".cursor-plugin/plugin.json", pluginName, version, issues, { skillsPath: true });
  checkManifest(kimi, ".kimi-plugin/plugin.json", pluginName, version, issues, { skillsPath: true });

  const claudeMarketplace = await readJson(root, ".claude-plugin/marketplace.json", issues);
  const claudeEntry = Array.isArray(claudeMarketplace?.plugins) ? object(claudeMarketplace.plugins[0]) : undefined;
  if (claudeEntry?.name !== pluginName || claudeEntry?.version !== version || claudeEntry?.source !== "./") {
    issues.push(".claude-plugin/marketplace.json: first plugin must expose this repository and package version");
  }

  const agentMarketplace = await readJson(root, ".agents/plugins/marketplace.json", issues);
  const agentEntry = Array.isArray(agentMarketplace?.plugins) ? object(agentMarketplace.plugins[0]) : undefined;
  const agentSource = object(agentEntry?.source);
  if (agentEntry?.name !== pluginName || agentSource?.source !== "url" || agentSource?.url !== "./") {
    issues.push(".agents/plugins/marketplace.json: first plugin must expose this repository");
  }

  const main = typeof packageJson.main === "string" ? packageJson.main : "";
  if (!main || !(await pathExists(join(root, main)))) issues.push("package.json: main must point to the OpenCode adapter");
  const pi = object(packageJson.pi);
  if (!Array.isArray(pi?.skills) || !pi.skills.includes("./skills")) issues.push("package.json: pi.skills must include ./skills");
  if (!(await pathExists(join(root, "skills")))) issues.push("skills/: generated skill directory is missing");

  return [...new Set(issues)].sort();
}
