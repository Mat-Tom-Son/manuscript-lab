# Getting Started

This walkthrough creates a project and runs the first checks without any model
API key. Requirements: Node.js 18 or newer. The full command reference is
`docs/COMMANDS.md`.

For the fastest public demo, run the fixtures from a repo clone first:

```bash
cd examples/technical-whitepaper
../../bin/manuscript-lab.mjs validate
../../bin/manuscript-lab.mjs report --write
```

That fixture ends green. Open `reports/latest.html` to see section readiness,
evidence state, the accepted issue, candidate winner, diff audit, and exports
in one place. Then run the same commands in `examples/broken-whitepaper` to
see the failure path: a deliberately red project whose report lists every
blocker with the `fix:` command that addresses it. Neither fixture calls
models or the network.

## 1. Create A Workspace

There is one init path. In any repo (new or existing):

```bash
npm install -D manuscript-lab
npx mlab init
```

Bare `init` defaults to `--profile whitepaper --root manuscript` and titles
the project from the directory name; pass `--profile`, `--root`, or `--title`
to customize. It writes `manuscript-lab.config.json` plus a user-owned
scaffold under `manuscript/`: section contracts in `draft/`, state
directories, taste/style docs, and source/claim registers.

If the manuscript already exists, adopt it instead:

```bash
npx mlab adopt existing-draft.md
npx mlab adopt notes/ --split file
npx mlab adopt book.md --split h2
```

`adopt` copies every markdown file into contracted `draft/NN-slug.md` sections
(one per file by default; `h1`/`h2` split a single file at headings; with no
argument it adopts the current directory) and never modifies or moves your
originals. Each imported contract starts at `status: draft` with a sized
`target_words`, a provisional purpose inferred from the first prose sentence,
the profile's default acceptance criteria, and `confirmed: false`. Expect the
first report to show blockers — short imports sit below the word floor, and
every section stays blocked on `contract.confirmed` until you review its
purpose and acceptance and flip the flag to `confirmed: true`. That is
intended protocol pressure: the report is your work list, every blocker names
its fix, and confirming each contract is the one judgment step adopt cannot
do for you.

Working inside a clone of this repo instead? The template-clone workflow
(`project:init`, root symlinks, `projects/active/`) still works and is listed
by `mlab help admin`.

## 2. Fill In The Core Files

Edit these before drafting:

- `PROJECT.md`: compact current operating notes
- `brief.md`: goal, reader, constraints, success criteria
- `outline.md`: section shape and jobs
- `style.md`: voice, terminology, format, citation rules
- `state/continuity.md`: canon, definitions, claims, timeline, invariants
- `state/open-questions.md`: decisions still missing

For fiction, also fill in the `taste/` files (voice, reader contract, genre
promise, failure modes, motifs, exemplars).

## 3. Compose Section Context

Before drafting or reviewing one section:

```bash
npx mlab compose draft/01-opening.md
```

Inspect the generated packet under `state/runtime/01-opening/`. It is the
local operating contract for the section, and the gates check that it is
fresh.

## 4. Draft In Files, And Flip The Status

Write prose in `draft/<section>.md`, not only in chat.

Section status now gates readiness directly:

- A section whose contract says `status: todo` (or `planned`) fails
  `section-ready` with a blocking `contract.status_started` requirement. Set
  `status: draft` in the contract when writing begins.
- Prose below 33% of the contract's `target_words` fails the blocking
  `words.floor` requirement (a contract `min_words` value or the config's
  `gates.section.words_floor_ratio` can override the floor). Below 80% of
  target, `words.near_target` warns.

If you add factual or canon-sensitive claims, update `sources/index.md` and
`state/claims.md`, and use `[citation-needed]` instead of inventing support.

## 5. Validate And Check

```bash
npx mlab validate
npx mlab check --static-only
```

If `check` reports missing required scaffolding (state directories, truth
files, README stubs), let it repair itself:

```bash
npx mlab check --fix
```

`--fix` creates every missing required path with minimal valid content and
rebuilds the `state/status.md` / `outline.md` section entries from the draft
contracts (covering sections you added, renamed, or deleted), prints what it
repaired, then re-runs the static checks so only real content failures remain.
Keep future sections as small contracted `status: todo` draft stubs; the
current contracted draft set defines membership.

## 6. Gate And Report

```bash
npx mlab gate draft/01-opening.md
npx mlab gate manuscript
npx mlab report --write
```

The report (terminal, `reports/latest.json`, `reports/latest.html`) lists each
failing section individually with its reasons, and every blocker carries a
`fix:` line with the exact command to run next. It also lists advisory gaps
with fixes: an active section whose applicable declared review has never
completed, or whose latest successful run predates the current section body or
review definition, no longer disappears inside a generic green result.
`report` and `gate` share one gate engine, so they cannot disagree.

## 7. Add Model Reviews Later

Everything above is deterministic. When you want model-backed reviews, copy
`.env.example` to `.env`, add provider keys (see `docs/MODEL_PROVIDERS.md`),
then:

```bash
npx mlab review draft/01-opening.md --dry-run --panel prose.clean
npx mlab review draft/01-opening.md --panel prose.clean
npx mlab review list
npx mlab review report draft/01-opening.md
npx mlab issues list --status open
```

Reviews create typed issues. Triage them before revising; for high-stakes
revisions use the candidate loop (`revise`, `compare`, `merge`) described in
`docs/COMMANDS.md`.

Successful runs—including `--mock-response` runs—satisfy declared-review
coverage. Provider and parse errors do not. Coverage and freshness are
deterministic warnings by default, so the core workflow remains usable without
provider keys. To enforce them for a named release profile, add:

```json
{
  "gates": {
    "profiles": {
      "release": {
        "reviews": {
          "declared_have_run": "block",
          "declared_fresh": "block"
        }
      }
    }
  }
}
```

Then run `npx mlab gate manuscript --profile release`. Each policy value may
be `off`, `warn`, or `block`; project-wide defaults can also live directly
under `gates.reviews`.

To add a project-specific lens, put a suite and its prompt files under the
manuscript root, then register it in `manuscript-lab.config.json`:

```json
{
  "reviews": {
    "default": ["cold.reader", "loose.thread"],
    "suite": "reviews/suite.json"
  }
}
```

The local suite uses the same `context_packs` / `passes` JSON shape as the
built-in suite. Its IDs may be used directly in section contracts. Built-in
collisions and paths outside the manuscript root are rejected; the complete
schema is in `docs/FILE_PROTOCOL.md`.

For a large triage pass, send all decisions and closures in one validated call:

```bash
npx mlab issues batch --file issue-operations.jsonl --dry-run
npx mlab issues batch --file issue-operations.jsonl
```

Batch input accepts JSON, `{"operations":[...]}`, or one JSON operation per
line. It validates the complete set before writing and skips exact retries.

## 8. Export

```bash
npx mlab export --slug my-project
```

The default export writes Markdown and HTML plus `exports/manifest.json` with
input/output hashes. EPUB and PDF are explicit opt-ins:

```bash
npx mlab export --formats md,html,epub,pdf --slug my-project
```

EPUB needs `zip`; PDF needs `python3` with the `reportlab` package. Add
`--no-contents` to skip the generated Contents page. Run `npx mlab done` as
the final release gate when you expect reader exports, or
`npx mlab done --skip-exports` for maintenance work.

## For Agents

Connect an MCP client (`claude mcp add manuscript-lab -- npx mlab mcp`, see
`docs/MCP.md`), point agents at `AGENTS.md`, or install the Codex skill from a
repo clone with `npm run codex:install-skill` (`docs/CODEX_SKILLS.md`).
