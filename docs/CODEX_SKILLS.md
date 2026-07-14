# Codex Skills

> Status: written for the pre-2.0 surface; command names may differ. Current surface: docs/COMMANDS.md. Old names still work as aliases.

Manuscript Lab ships a Codex skill at:

```text
skills/codex/manuscript-lab/
```

Use it when you want Codex to jump into this repository or a Manuscript Lab
writing project and behave like a shipping operator: inspect state, pick the
right workflow, edit durable files, run gates, and report what shipped.

## Install Locally

From a clone of the repo:

```bash
npm run codex:validate-skill
npm run codex:install-skill -- --dry-run
npm run codex:install-skill
```

By default this symlinks the skill into:

```text
${CODEX_HOME:-~/.codex}/skills/manuscript-lab
```

Use `--copy` instead of the default symlink when you want a detached copy:

```bash
npm run codex:install-skill -- --copy
```

Start a new Codex session after installing so the skill appears in the available
skills list.

## Use It

Invoke it explicitly when opening a new Manuscript Lab task:

```text
Use $manuscript-lab to implement this feature and ship it.
```

Good task shapes:

- `Use $manuscript-lab to add a gate spec doc and push it.`
- `Use $manuscript-lab to fix the doctor command and release a patch.`
- `Use $manuscript-lab to review this draft section and record durable issues.`
- `Use $manuscript-lab to prepare the repo for npm install-anywhere work.`

## What The Skill Covers

- first-minute repo triage
- product/harness work
- writing-project work
- review and candidate revision flow
- release and shipping checks
- public-repo guardrails for ignored manuscript state

The skill intentionally points to existing repo docs instead of duplicating the
whole operator manual.
