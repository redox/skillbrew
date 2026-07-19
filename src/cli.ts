#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { addSkill } from "./add.ts";
import { loadProject } from "./project.ts";
import { updateSkill } from "./update.ts";
import { SkillbrewError } from "./util.ts";

function usage(exitCode = 1): never {
  console.log(`skillbrew — vendor and semantically rebase Agent Skills

Usage:
  skillbrew list
  skillbrew add <source> [--name <name>] [--ref <ref>] [--path <path>] [--license <spdx>]
  skillbrew update [name] [--dry-run]

Commands:
  list      List available recipes
  add       Create a recipe from a GitHub URL or local path and import it
  update    Update one skill, or every skill when name is omitted
`);
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command) usage();
  if (command === "help" || command === "--help" || command === "-h") usage(0);
  const project = await loadProject(resolve(Bun.env.SKILLBREW_ROOT ?? process.cwd()));

  if (command === "list") {
    const recipes = (await readdir(project.recipesDir)).filter((file) => file.endsWith(".yaml")).sort();
    for (const recipe of recipes) console.log(basename(recipe, ".yaml"));
    return;
  }
  if (command === "add") {
    const values: Record<string, string> = {};
    const positionals: string[] = [];
    const valueOptions = new Set(["--name", "--ref", "--path", "--license"]);
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]!;
      if (valueOptions.has(argument)) {
        const value = args[index + 1];
        if (!value || value.startsWith("--")) throw new SkillbrewError(`${argument} requires a value`);
        if (values[argument]) throw new SkillbrewError(`${argument} may only be specified once`);
        values[argument] = value;
        index += 1;
      } else if (argument.startsWith("-")) {
        throw new SkillbrewError(`Unknown option: ${argument}`);
      } else {
        positionals.push(argument);
      }
    }
    if (positionals.length !== 1) throw new SkillbrewError("add requires exactly one GitHub URL or local path");
    await addSkill(project, positionals[0]!, {
      name: values["--name"],
      ref: values["--ref"],
      path: values["--path"],
      license: values["--license"],
    });
    return;
  }
  if (command === "update") {
    const names = args.filter((arg) => !arg.startsWith("-"));
    if (names.length > 1) throw new SkillbrewError("update accepts at most one skill name");
    const unknown = args.filter((arg) => arg.startsWith("-") && arg !== "--dry-run");
    if (unknown.length) throw new SkillbrewError(`Unknown option: ${unknown.join(", ")}`);
    const recipes = names.length > 0
      ? names
      : (await readdir(project.recipesDir)).filter((file) => file.endsWith(".yaml")).sort().map((file) => basename(file, ".yaml"));
    if (names.length === 0) console.log(`Updating ${recipes.length} skills...`);
    for (const name of recipes) await updateSkill(project, name!, { dryRun: args.includes("--dry-run") });
    return;
  }
  usage();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
});
