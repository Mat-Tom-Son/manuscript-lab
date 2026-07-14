# Story Workspace Switching

Use this when loading, restoring, archiving, or starting a story in the active harness workspace.

## Principle

Keep harness infrastructure stable and move story state deliberately.

Reusable infrastructure includes scripts, checks, reviews, prompts, generic docs, model panels, package files, and template scaffolding. Story-specific state includes `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, `taste/`, `draft/`, `sources/`, `exports/`, `docs/PROJECT_HANDOFF.md`, `docs/PROJECT_REVIEW_APPROACH.md`, `state/truth/`, and active generated artifacts under `state/`.

Project content is canonical under `projects/active/<slug>/workspace/` when active. The repository root mounts that workspace with symlinks so tools can keep using simple paths; see `docs/PROJECT_FILESYSTEM.md`.

## Command Surface

Use `scripts/story-workspace.mjs` through npm:

```bash
npm run story -- --help
npm run story:list-archives
npm run story:archive -- --slug <story-slug>
npm run story -- unload --slug <story-slug>
npm run project:init -- --title "New Story" --slug <story-slug> --sections 4 --archive-current
npm run project:restore -- --from archive/<story-archive> --archive-current
npm run story:clear-generated -- --force
npm run story:verify
npm run project:mount
npm run project:sync
npm run project:list
```

Destructive commands fail unless they automatically archive first, or you pass `--archive-current` or `--force`.

## Archive Current Story

Before replacing the active story:

```bash
npm run story:archive -- --slug <story-slug>
```

The archive includes story files, exports, issues, reviews, runtime packets, candidate runs, truth state, project handoff notes, and project review approach notes. It does not archive `.env`, provider keys, reusable scripts, prompts, or generic skills.

It also writes a structured snapshot under `projects/inactive/<slug>/snapshots/`.

## Unload Current Story

When the user wants to put the current story away without loading a replacement yet:

```bash
npm run story -- unload --slug <story-slug>
```

This is the no-ambiguity "close the active project" command. It archives the active story, writes/updates `projects/inactive/<slug>/`, removes `projects/active/<slug>/`, clears root project mounts, and writes `state/workspace.json` with `status: "unloaded"`.

Use `npm run story -- unload` instead of plain `story:archive` when the user's intent is "put this story away." Plain archive is only a snapshot; it intentionally leaves the story active in the root workspace.

After unload, `npm run status` should say `No Active Story Loaded` and suggest either `project:init` or `project:restore`.

## Start A New Story

Create a blank active workspace and snapshot the current story first:

```bash
npm run project:init -- --title "New Story" --slug new-story --sections 4 --archive-current
```

This creates or resets:

- `PROJECT.md`
- `brief.md`
- `outline.md`
- `style.md`
- `taste/TASTE.md`, `taste/VOICE.md`, `taste/TARGET_READER.md`, `taste/GENRE_PROMISE.md`, `taste/FAILURE_MODES.md`, `taste/MOTIFS.md`, and `taste/EXEMPLARS.md`
- `sources/index.md`
- `state/status.md`
- `state/continuity.md`
- `state/claims.md`
- `state/open-questions.md`
- `state/truth/*.json`
- `state/issues/*.json`
- `docs/PROJECT_HANDOFF.md`
- `docs/PROJECT_REVIEW_APPROACH.md`
- `draft/00-title.md`
- `draft/01-opening.md` and additional section files requested by `--sections`

Then load the user's new character/story context into `PROJECT.md` and the core files before drafting.

The command also creates `projects/active/<slug>/workspace/` and mounts it into the root.

If `npm run status` says `No Active Story Loaded`, omit `--archive-current`:

```bash
npm run project:init -- --title "New Story" --slug new-story --sections 4
```

## Restore A Story

Restore from an archive and snapshot the current active state first:

```bash
npm run project:restore -- --from archive/<story-archive> --archive-current
```

Use `--core-only` if you want the archived story files without old generated reviews, runtime packets, candidate runs, and issue history.

After restore, confirm `docs/PROJECT_HANDOFF.md` and `docs/PROJECT_REVIEW_APPROACH.md` came from the restored project before running reviews or revisions. These files carry project-specific taste, protected voice, and recent human feedback; replacing them with generic defaults can make later agents over-explain, over-smooth, or judge the wrong book.

If `npm run status` says `No Active Story Loaded`, omit `--archive-current`:

```bash
npm run project:restore -- --from archive/<story-archive>
```

## Clear Generated Artifacts

When the active story stays the same but generated review/runtime state should be reset:

```bash
npm run story:clear-generated -- --force
```

Use `--truth` only when replacing the story truth state too:

```bash
npm run story:clear-generated -- --force --truth
```

## Verify

After any story switch or scaffold:

```bash
npm run story:verify
```

This runs:

```bash
npm run check -- --static-only
npm run template:audit -- --strict
npm run status
npm run done:no-export
```

The done gate also syncs and verifies `projects/active/<slug>/workspace/` and the root mount.

Compose runtime packets for active draft sections before drafting:

```bash
npm run compose -- draft/<section>.md --operation draft
```

Export when a readable copy is needed:

```bash
npm run export -- --slug <story-slug>
npm run done
```
