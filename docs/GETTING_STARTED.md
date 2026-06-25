# Getting Started

This walkthrough creates a blank project and runs the first checks without any
model API key.

For the fastest public demo, run the technical-whitepaper fixture first:

```bash
cd examples/technical-whitepaper
../../bin/manuscript-lab.mjs validate
../../bin/manuscript-lab.mjs report --write
```

Open `reports/latest.html` to see section readiness, evidence state, accepted
issues, the sample candidate winner, diff audit presence, and exports in one
place. The fixture is config-first, so those commands inspect the fixture
itself instead of the active template project.

To see the failure path, run the deliberately broken whitepaper fixture:

```bash
cd examples/broken-whitepaper
../../bin/manuscript-lab.mjs validate
../../bin/manuscript-lab.mjs check --static-only
../../bin/manuscript-lab.mjs claims list --unsupported
../../bin/manuscript-lab.mjs citations check draft/01-market.md
../../bin/manuscript-lab.mjs issues list --status open
../../bin/manuscript-lab.mjs gate manuscript --write
../../bin/manuscript-lab.mjs report --write
```

Expected shape: protocol validation passes, then local checks report
unsupported claims, citation placeholders, a missing citation target, an open
blocker issue, missing runtime packets, and not-ready gate/report output. This
fixture does not call models or the network.

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

The install-anywhere workflow is for a separate writing repo with Manuscript Lab
as a dev dependency. From the registry package:

```bash
npm init -y
npm install -D manuscript-lab
npx mlab init --profile whitepaper --root manuscript --title "My Whitepaper"
npx mlab validate
npx mlab status
npx mlab compose draft/01-opening.md
npx mlab room diagnose draft/01-opening.md
npx mlab room blue-sky draft/01-opening.md
npx mlab room decide draft/01-opening.md --run <room-run-id> --select idea-001 --reason "..."
npx mlab room break draft/01-opening.md --run <room-run-id>
npx mlab room table-read draft/01-opening.md
npx mlab room report draft/01-opening.md
npx mlab chorus plan draft/01-opening.md --from-room <room-run-id>
npx mlab chorus run draft/01-opening.md --from-room <room-run-id>
npx mlab chorus report draft/01-opening.md
npx mlab drive --goal "prepare draft/01-opening.md for review" --target draft/01-opening.md --dry-run --json
npx mlab practice propose --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json
npx mlab practice compare --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json
npx mlab practice bench --exercises core --models openrouter:z-ai/glm-5.2 --seeds 3 --json
npx mlab practice strategies --exercises core --models openrouter:z-ai/glm-5.2 --strategies default --json
npx mlab artifacts list --json
npx mlab eval practice-strategies --from state/practice-strategies/<run-id> --json
npx mlab golden-path --write --json
npx mlab check --static-only draft/01-opening.md
npx mlab claims list --json
npx mlab citations check --json
npx mlab gate draft/01-opening.md --json
npx mlab report --write
npx mlab export --formats md,html --include-todo --slug my-whitepaper
npx mlab done --export-formats md,html --include-todo-exports --json
```

That creates `manuscript-lab.config.json` plus a user-owned scaffold under
`manuscript/`. Deterministic local commands such as
`validate`, `status`, `compose`, static `check`, claims/citations/evidence,
gates, `report`, `review:report`, Markdown/HTML export, and configurable `done`
export gates are config-root aware. Typed review execution and the
candidate-loop commands also work in install-anywhere projects. Room and Chorus
commands are deterministic without API keys; pass provider-prefixed `--models`
when you want Lightning/OpenRouter-backed generation. The model driver and
practice lab write their generated evidence under the configured manuscript
`state/` directory, including `state/driver/`, `state/practice/`,
`state/practice-evals/`, `state/practice-bench/`, and
`state/practice-strategies/`. `artifacts` lists and inspects generated runs,
`eval practice-strategies` snapshots strategy evidence under `state/evals/`,
and `golden-path` writes onboarding evidence under `state/golden-path/`.
Chorus writes contact sheets by default and only
assembles prose when `--assemble` or `chorus assemble` is used. Template project
switching commands are
template-clone compatibility commands and refuse outside the template clone root
while the installed CLI matures.

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
npm run report -- --write
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
npm run review:run -- --passes scene.turn draft/01-opening.md
npm run review:report -- draft/01-opening.md
npm run issues -- list --status open
```

Reviews create issues. Triage those issues before revising.

The public wrapper aliases keep the same behavior with friendlier names:

```bash
mlab review draft/01-opening.md --dry-run --panel prose.clean
mlab review report draft/01-opening.md
mlab issues list --status open
mlab revise draft/01-opening.md --issue <issue-id> --candidates 3 --dry-run
mlab compare draft/01-opening.md --run <candidate-run-id> --dry-run
mlab merge draft/01-opening.md --run <candidate-run-id>
```

## 7. Export

Markdown and HTML exports require only Node:

```bash
npm run export -- --formats md,html --slug my-project --author ""
```

Each successful export also writes `exports/manifest.json` with input hashes,
output hashes, file sizes, formats, source commit when available, and git dirty
state. The default export creates Markdown, HTML, EPUB, and PDF. EPUB needs
`zip`; PDF needs `python3` and the Python `reportlab` package.

```bash
npm run export -- --slug my-project --author ""
```

Add `--no-contents` when the reader copy should start the chapters after the
title page without an inserted generated Contents page. Exports and their
manifest land in `exports/`.
