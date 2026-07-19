export interface SkillbrewConfig {
  version: 1;
  skills_dir: string;
  recipes_dir: string;
  state_dir: string;
  lockfile: string;
  transformer?: {
    provider: "cursor-sdk";
    id?: string;
    model: string;
    timeout_ms?: number;
  };
}

export interface Recipe {
  name: string;
  source: {
    name?: string;
    repository: string;
    path: string;
    ref: string;
    update_ref?: string;
    license?: string;
  };
  transforms?: Array<{
    type: "llm";
    prompt: string;
    mode?: "rewrite" | "semantic-rebase";
    allowed_paths?: string[];
    forbidden_paths?: string[];
  }>;
  validation?: {
    require?: string[];
    max_skill_tokens?: number;
  };
}

export interface LockEntry {
  source_repository: string;
  source_path: string;
  source_ref: string;
  source_tree_sha256: string;
  source_name?: string;
  license?: string;
  prompt_sha256?: string;
  transformer?: string;
  previous_output_sha256?: string;
  output_sha256: string;
  generated_at: string;
}

export interface Lockfile {
  version: 1;
  skills: Record<string, LockEntry>;
}
