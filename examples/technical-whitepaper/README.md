# Technical Whitepaper Tutorial Fixture

This is a safe, public, compact Manuscript Lab project fixture. It uses neutral
sample content and demonstrates the file concepts operators meet in a real
project: `brief.md`, `outline.md`, `style.md`, `draft/`, `sources/`, `state/`,
issue-ledger decisions, candidate runs, revision audits, and Markdown/HTML
exports.

The included candidate and audit artifacts are manual public samples. They do
not contain provider raw outputs, model-call logs, API keys, private manuscript
material, or private story fingerprints.

## Fixture Map

- `PROJECT.md`, `brief.md`, `outline.md`, `style.md`: project intent, shape,
  voice, terminology, and evidence rules.
- `draft/00-title.md`, `draft/01-opening.md`: section contracts plus compact
  draft prose.
- `sources/index.md`, `state/claims.md`: source registry and claim support.
- `state/status.md`, `state/continuity.md`, `state/open-questions.md`: cockpit
  state for section status, durable definitions, and open decisions.
- `state/issues/`: one accepted tutorial issue plus its decision record.
- `state/runtime/01-opening/`: compact example of a composed runtime packet.
- `state/candidates/01-opening/tutorial-run-001/`: manual two-candidate sample.
- `state/revision-audits/01-opening/`: before snapshot plus static audit sample.
- `exports/technical-whitepaper.md`, `exports/technical-whitepaper.html`: sample
  reader exports for the draft section.

## Try The Walkthrough

Run these from the repository root in a disposable workspace, or after archiving
the current active project. `project:init` changes the active project mount.

```bash
npm run project:init -- --title "Technical Whitepaper Tutorial" --slug technical-whitepaper --sections 1 --kind document.chapter --archive-current
cp -R examples/technical-whitepaper/. projects/active/technical-whitepaper/workspace/
npm run compose -- draft/01-opening.md
npm run check -- draft/01-opening.md
npm run review:run -- --dry-run --panel prose.clean --force draft/01-opening.md
npm run issues -- list --status all
npm run issues -- show issue_tutorial_0001
npm run revise:candidates -- draft/01-opening.md --issue issue_tutorial_0001 --n 2 --dry-run
npm run diff:audit -- --before state/revision-audits/01-opening/before.md --after draft/01-opening.md --issue issue_tutorial_0001 --static-only
npm run export -- --formats md,html --slug technical-whitepaper --author ""
```

Notes:

- The review command is a dry-run and does not call a model provider. It uses
  `--force` because the fixture keeps `kind: document.chapter` for export while
  some review passes are scoped to narrower tutorial kinds.
- The fixture uses `kind: document.chapter` because the current exporter includes
  non-todo files whose kind contains `chapter`.
- A fresh scaffold supplies generic required harness files that this compact
  fixture does not duplicate.
