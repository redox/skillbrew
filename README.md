# Skillbrew

Curate, adapt, and update a personal collection of [Agent Skills](https://agentskills.io/) from across GitHub.

Skillbrew vendors each skill as ordinary files, records its exact upstream revision, and optionally applies a semantic patch with the Cursor Agent SDK. Updates preserve local intent while incorporating upstream improvements, producing a normal Git diff for review.

## Install

### Any agent harness

The recommended installer is the open-source [`skills`](https://github.com/vercel-labs/skills) CLI. It detects installed harnesses and places Skillbrew's generated skills in their native skill directories:

```sh
npx skills add redox/skillbrew
```

Install every Skillbrew skill globally in every supported harness without prompts:

```sh
npx skills add redox/skillbrew --skill '*' --agent '*' --global --yes
```

Target particular harnesses or install only one skill:

```sh
npx skills add redox/skillbrew --agent cursor --agent codex --agent claude-code
npx skills add redox/skillbrew --skill writing-plans
```

The installer supports Cursor, Codex, Claude Code, OpenCode, Pi, Antigravity, Kimi, GitHub Copilot, and many other Agent Skills-compatible tools. These are external installation commands; they consume Skillbrew's generated output and do not require Bun.

### Native plugin systems

Skillbrew also ships native manifests for harnesses that install plugins directly from Git repositories.

Claude Code:

```text
/plugin marketplace add redox/skillbrew
/plugin install skillbrew@skillbrew
```

Antigravity:

```sh
agy plugin install https://github.com/redox/skillbrew
```

Factory Droid:

```sh
droid plugin marketplace add https://github.com/redox/skillbrew
droid plugin install skillbrew@skillbrew
```

Kimi Code:

```text
/plugins install https://github.com/redox/skillbrew
```

Pi:

```sh
pi install git:github.com/redox/skillbrew
```

For OpenCode, add the Git-backed package to `opencode.json`; see [the OpenCode instructions](.opencode/INSTALL.md).

## Develop the collection

You only need Bun when adding, updating, or validating the collection itself. Install the development dependencies, then use the Skillbrew CLI through the project scripts:

```sh
bun install
bun run start list
```

Skillbrew commands in this repository always begin with `bun run start`:

```text
bun run start list
bun run start add <source>
bun run start update [name]
```

## Updating skills

Update one skill:

```sh
bun run start update writing-plans
```

Update the entire collection:

```sh
bun run start update
```

Preview an update without writing files:

```sh
bun run start update writing-plans --dry-run
```

An update resolves the recipe's `update_ref`, validates the generated skill, writes the new output and provenance data, and advances the pinned `ref`. Skills that are already current are skipped without invoking a model.

Review updates with Git. Commit the generated diff to keep it, or restore it to reject it.

## Adding a skill

Add a skill from a GitHub directory URL:

```sh
bun run start add https://github.com/owner/repository/tree/main/skills/example
```

Or add a committed skill from a local Git repository:

```sh
bun run start add ../another-repository/skills/example
```

`add` reads the upstream frontmatter, resolves the exact Git commit, creates a minimal recipe, imports the skill, and writes its lock entry. A plugin or repository URL also works when it contains exactly one nested `SKILL.md` or one Claude `agents/*.md` definition; Skillbrew discovers and normalizes it automatically.

Available options:

```text
--name <name>       Install under a different local name
--license <spdx>    Record the upstream license
--ref <ref>         Override the branch, tag, or commit
--path <path>       Override the skill path inside the repository
```

`--ref` and `--path` are useful for repository URLs or branch names that cannot be inferred unambiguously from a GitHub URL:

```sh
bun run start add https://github.com/owner/repository \
  --ref feature/agent-skills \
  --path skills/example
```

Local skills must be committed before they are added. This ensures the generated recipe can be rebuilt from its pinned revision.

## Semantic patches

A recipe is a complete build definition for one skill:

```yaml
name: diagnosing-bugs

source:
  repository: https://github.com/example/skills.git
  path: skills/diagnosing-bugs
  ref: 71e0a6b1c7f00000000000000000000000000000
  update_ref: main
  license: MIT

transforms:
  - type: llm
    mode: semantic-rebase
    prompt: |
      Adapt this skill to our engineering environment.

      - Prefer GitHub Issues over Linear.
      - Assume a Rails, Rust, Kubernetes, and DuckDB stack.
      - Preserve upstream wording where it already fits.
      - Never invent commands or internal infrastructure.
    allowed_paths:
      - SKILL.md
      - references/**
    forbidden_paths:
      - scripts/**

validation:
  require:
    - SKILL.md
  max_skill_tokens: 5000
```

Edit the generated recipe to add a semantic patch, then run `update <name>`. For manual recipe authoring, copy `examples/recipe.yaml` to `recipes/<name>.yaml`.

### Renaming an imported skill

Use the recipe's top-level `name` for the local name and `source.name` for the upstream frontmatter name:

```yaml
name: babysit-ci

source:
  name: loop-on-ci
  repository: https://github.com/cursor/plugins.git
  path: cursor-team-kit/skills/loop-on-ci
  ref: 3fe2823ce17c1656c222d4b7c59d3f82fbf20143
  update_ref: main
```

Skillbrew rewrites the copied `SKILL.md` name deterministically before applying any semantic patch.

## How semantic rebasing works

For an existing transformed skill, Skillbrew gives the model four inputs:

- the previously pinned upstream skill;
- the current generated skill;
- the new upstream skill;
- the recipe's semantic patch.

The model ports the existing adaptation onto the new upstream version while preserving unrelated upstream improvements. First-time imports use rewrite mode because there is no previous generated version to rebase.

Generated content is constrained by each recipe's `allowed_paths`, `forbidden_paths`, required files, frontmatter, name, and token budget. Source, prompt, and output hashes are recorded in `skills.lock.yaml`.

## Cursor setup

Semantic patches run through the [Cursor Agent SDK](https://cursor.com/changelog/sdk-release) with [Composer 2.5](https://cursor.com/changelog/composer-2-5).

Create a Cursor API key from the integrations dashboard and set it in your environment:

```sh
export CURSOR_API_KEY="crsr_..."
```

For local development, `.env.local` is also loaded automatically:

```dotenv
CURSOR_API_KEY=crsr_...
```

The transformer runs inside an isolated workspace with Cursor's sandbox enabled and ambient Cursor settings disabled. Configure the model and timeout in `skillbrew.config.yaml`:

```yaml
transformer:
  provider: cursor-sdk
  id: cursor-sdk-1.0.23/composer-2.5
  model: composer-2.5
  timeout_ms: 600000
```

## Repository layout

```text
.
├── recipes/               # Upstream sources and inline semantic patches
├── skills/                # Generated, installable Agent Skills
├── .claude-plugin/        # Claude-compatible plugin and marketplace manifests
├── .codex-plugin/         # Codex plugin manifest
├── .cursor-plugin/        # Cursor plugin manifest
├── .kimi-plugin/          # Kimi plugin manifest
├── .opencode/             # OpenCode package adapter
├── .agents/plugins/       # Agent plugin marketplace metadata
├── LICENSES/              # Licenses for vendored upstream content
├── skills.lock.yaml       # Source, prompt, transformer, and output provenance
├── skillbrew.config.yaml  # Project and Cursor configuration
├── src/                   # Skillbrew CLI and build pipeline
└── test/                  # Workflow and linter tests
```

## Quality checks

```sh
bun run check
bun run lint
bun test
```

The linter verifies:

- recipe, generated skill, and lockfile consistency;
- Agent Skill frontmatter and declared validation limits;
- generated output and semantic-patch hashes;
- local Markdown links and bundled resource paths;
- references to other bundled skills.

GitHub Actions runs the frozen install, typecheck, linter, and tests on every push and pull request.

## Provenance and licenses

Every generated skill is pinned to an exact upstream commit in its recipe and lock entry. License texts for vendored upstream content live in `LICENSES/`.
