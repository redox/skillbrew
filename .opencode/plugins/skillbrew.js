import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skillsDirectory = resolve(packageRoot, "skills");

export const SkillbrewPlugin = async () => ({
  config: async (config) => {
    config.skills ??= {};
    config.skills.paths ??= [];
    if (!config.skills.paths.includes(skillsDirectory)) {
      config.skills.paths.push(skillsDirectory);
    }
  },
});
