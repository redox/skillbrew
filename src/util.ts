import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export class SkillbrewError extends Error {}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SkillbrewError(message);
}

export function resolveInside(root: string, value: string): string {
  const base = resolve(root);
  const target = resolve(base, value);
  assert(target === base || target.startsWith(`${base}${sep}`), `Path escapes project root: ${value}`);
  return target;
}

export function validateSkillName(name: string): void {
  assert(/^[a-z0-9][a-z0-9-]*$/.test(name), `Invalid skill name: ${name}`);
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
}

export async function copyTree(source: string, destination: string): Promise<void> {
  const sourceStat = await stat(source);
  assert(sourceStat.isDirectory(), `Expected a directory: ${source}`);
  await ensureDir(destination);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    assert(!entry.isSymbolicLink(), `Symbolic links are not allowed: ${from}`);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) {
      await copyFile(from, to);
      await chmod(to, (await stat(from)).mode & 0o777);
    }
  }
}

export async function replaceTree(source: string, destination: string): Promise<void> {
  const temporary = `${destination}.skillbrew-${crypto.randomUUID()}`;
  await rm(temporary, { recursive: true, force: true });
  await copyTree(source, temporary);
  await rm(destination, { recursive: true, force: true });
  await rename(temporary, destination);
}

export async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      assert(!entry.isSymbolicLink(), `Symbolic links are not allowed: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) result.push(relative(root, path).split(sep).join("/"));
    }
  }
  await walk(root);
  return result.sort();
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

export function hashText(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const file of await listFiles(root)) {
    hash.update(file);
    hash.update("\0");
    hash.update(String((await stat(join(root, file))).mode & 0o777));
    hash.update("\0");
    hash.update(await readFile(join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function run(
  command: string[],
  options: { cwd: string; stdin?: string; env?: Record<string, string>; timeoutMs?: number; allowFailure?: boolean },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  assert(command.length > 0, "Cannot run an empty command");
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...Bun.env, GIT_CONFIG_GLOBAL: "/dev/null", ...options.env },
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs) timer = setTimeout(() => process.kill(), options.timeoutMs);
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (timer) clearTimeout(timer);
  if (exitCode !== 0 && !options.allowFailure) {
    throw new SkillbrewError(`Command failed (${command.join(" ")}):\n${stderr || stdout}`);
  }
  return { exitCode, stdout, stderr };
}
