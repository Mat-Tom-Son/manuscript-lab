# Task Routes

Use this reference when deciding how to operate in Manuscript Lab.

## Product Feature Or Bug

Signals:

- user asks to add/fix a command, script, check, review, prompt, package, or
  workflow
- files are under `scripts/`, `checks/`, `reviews/`, `templates/`, `bin/`,
  `.pi/`, `skills/`, or generic `docs/`

Route:

1. Read the current implementation and nearby tests.
2. Prefer existing patterns and no new dependencies.
3. Edit only the relevant modules.
4. Add or update focused tests when behavior changes.
5. Update docs and `CHANGELOG.md` when the public surface changes.
6. Run targeted test, then standard public-repo gates.

## Documentation Or Positioning

Signals:

- user asks to document research, clarify strategy, improve onboarding, explain
  packaging, or polish open-source readiness

Route:

1. Preserve public truth: do not describe future commands as shipped.
2. Link from `README.md` when the doc should be discoverable.
3. Update `README.md`, `CHANGELOG.md`, or `docs/INSTALL_WORKFLOW.md` when
   packaging or release posture changes.
4. Update `CHANGELOG.md` in the current release section or under `Unreleased`.
5. Run `npm run template:audit -- --strict` and
   `npm run context:audit -- --strict`.

## Codex Skill Or Agent Adapter

Signals:

- user asks for Codex skills, agent adapters, slash commands, or instructions
  that let another agent operate the repo

Route:

1. Keep the skill lean; move detailed procedures to `references/`.
2. Make the frontmatter description broad enough to trigger on real tasks.
3. Include `agents/openai.yaml`.
4. Validate with:

```bash
npm run codex:validate-skill
npm run codex:install-skill -- --dry-run
```

5. Run standard public-repo gates if package contents or docs changed.

## Writing Project

Signals:

- user asks to draft, revise, review, export, or finish a manuscript section
- files are ignored active project files such as `PROJECT.md`, `draft/`,
  `state/`, `taste/`, `sources/`, or `exports/`

Route:

1. Run `npm run status`.
2. Read project context files.
3. Compose runtime packet for the target draft section.
4. Edit durable draft/state files.
5. Run `npm run check -- draft/<section>.md`.
6. Run `npm run project:sync`.
7. Run `npm run done` or `npm run done:no-export`.

## Public Release

Signals:

- user says release, publish, tag, push live, close milestone, or ship version

Route:

1. Read `references/shipping-checklist.md`.
2. Verify working tree and changelog.
3. Run all gates.
4. Run the disposable fresh-project smoke test from `docs/CI.md` when package,
   CLI init, project workspace, or install-anywhere behavior changed. Do not run
   it in a dirty active writing workspace.
5. Commit and push.
6. Tag and create GitHub release only when requested or clearly implied.
7. Confirm issue/milestone state.
