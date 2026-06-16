# Getting Started

This walkthrough creates a blank project and runs the first checks without any
model API key.

## 1. Choose A Project Shape

The template workflow is the broadest path today. Use it when you are working
inside a Manuscript Lab clone and want all commands available:

```bash
npm run project:init -- --title "My Project" --slug my-project --sections 4 --kind document.section
```

This creates a canonical workspace at:

```text
projects/active/my-project/workspace/
```

The root gets symlinks to the active project:

```text
PROJECT.md
brief.md
outline.md
style.md
draft/
state/
taste/
exports/
```

The default scaffold is still fiction-oriented when `--kind` is omitted. Use
`--kind document.section` for essays, technical docs, research notes,
whitepapers, or other non-fiction projects.

The install-anywhere alpha is for a separate writing repo with Manuscript Lab as
a dev dependency. From a packed local package or future registry package:

```bash
npm init -y
npm install -D /path/to/manuscript-lab-0.4.0.tgz
npx mlab init --profile whitepaper --root manuscript --title "My Whitepaper"
npx mlab validate
npx mlab claims list --json
npx mlab citations check --json
npx mlab gate draft/01-opening.md --json
```

That creates `manuscript-lab.config.json` plus a user-owned scaffold under
`manuscript/`. In the alpha, `validate`, `claims`, `citations`, and `gate` are
the config-first smoke path; compose/check/status/done remain template-first
until the next root-awareness pass.

## 2. Fill In The Core Files

Edit these before drafting:

- `PROJECT.md`: compact current operating notes
- `brief.md`: goal, reader, constraints, success criteria
- `outline.md`: section shape and jobs
- `style.md`: voice, terminology, format, citation rules
- `state/continuity.md`: canon, definitions, claims, timeline, invariants
- `state/open-questions.md`: decisions still missing

For fiction, also fill in the taste files:

- `taste/TASTE.md`
- `taste/VOICE.md`
- `taste/TARGET_READER.md`
- `taste/GENRE_PROMISE.md`
- `taste/FAILURE_MODES.md`
- `taste/MOTIFS.md`
- `taste/EXEMPLARS.md`

## 3. Compose Section Context

Before drafting or reviewing one section:

```bash
npm run compose -- draft/01-opening.md
```

Inspect:

```text
state/runtime/01-opening/intent.md
state/runtime/01-opening/context.json
state/runtime/01-opening/rule-stack.yaml
state/runtime/01-opening/criteria.json
state/runtime/01-opening/trace.json
```

This packet is the local operating contract for the section.

## 4. Draft In Files

Write prose in `draft/<section>.md`, not only in chat.

If you add factual or canon-sensitive claims, update:

- `sources/index.md`
- `state/claims.md`
- `state/continuity.md`

Use `[citation-needed]` instead of inventing support.

## 5. Validate And Check

```bash
npm run validate
npm run doctor
npm run claims -- list --unsupported
npm run citations -- check draft/01-opening.md
npm run gate -- draft/01-opening.md
npm run check -- draft/01-opening.md
npm run done:no-export
```

Use `npm run done` when you need reader exports.

## Optional: Install The Codex Skill

If you use Codex, install the Manuscript Lab skill so future sessions can enter
the repo with the right workflow:

```bash
npm run codex:install-skill -- --dry-run
npm run codex:install-skill
```

Then start a new Codex session and ask:

```text
Use $manuscript-lab to work on this project.
```

## 6. Add Model Reviews Later

Model review is optional. Without keys, you can still use static checks,
runtime packets, exports, word-usage reports, and dry-run review queues.

When ready:

```bash
cp .env.example .env
```

Add provider keys in `.env`, then run:

```bash
npm run review:run -- --dry-run --panel prose.clean draft/01-opening.md
npm run review:run -- --panel prose.clean draft/01-opening.md
npm run review:report -- draft/01-opening.md
npm run issues -- list --status open
```

Reviews create issues. Triage those issues before revising.

## 7. Export

Markdown and HTML exports require only Node:

```bash
npm run export -- --formats md,html --slug my-project --author ""
```

The default export creates Markdown, HTML, EPUB, and PDF. EPUB needs `zip`; PDF
needs `python3` and the Python `reportlab` package.

```bash
npm run export -- --slug my-project --author ""
```

Exports land in `exports/`.
