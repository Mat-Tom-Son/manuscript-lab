---
name: story-workspace
description: Load, restore, archive, or start a story in the active Manuscript Lab workspace while preserving reusable harness infrastructure. Use when switching active stories, archiving one project, unarchiving another, or preparing a blank story workspace.
---

# Story Workspace

Use this skill when the active project/story changes.

## Rule

Preserve harness infrastructure. Move story state deliberately.

Story-specific files usually include `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, `taste/`, `draft/`, `sources/`, `exports/`, `docs/PROJECT_HANDOFF.md`, `docs/PROJECT_REVIEW_APPROACH.md`, `state/truth`, and active generated state under `state/runtime`, `state/reviews`, `state/issues`, `state/revision-*`, `state/candidates`, `state/style`, and `state/taste`.

The active project workspace is canonical under `projects/active/<slug>/workspace/`. The root mounts that workspace with symlinks so tools can keep using `draft/`, `brief.md`, and `state/`; read `docs/PROJECT_FILESYSTEM.md`.

Reusable harness files usually include scripts, generic docs, checks, reviews, prompts, skills, package files, templates, and model-provider configuration.

## Workflow

1. Run `npm run status` and `npm run check -- --static-only` when a story is active.
2. Use `npm run story -- unload --slug <story-slug>` when the user wants to put away, close, unload, or deactivate the current story without loading the next one yet.
3. Use `npm run story:archive -- --slug <story-slug>` only when the user wants a snapshot while keeping the story active.
4. For a blank new story while another story is active, use `npm run project:init -- --title "Title" --slug <slug> --sections <n> --archive-current`.
5. For an archived story while another story is active, use `npm run project:restore -- --from archive/<story-archive> --archive-current`.
6. If `npm run status` says `No Active Story Loaded`, omit `--archive-current` from init/restore.
7. Load the user's new context into `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, `taste/`, `state/continuity.md`, `state/truth/*.json`, and `docs/PROJECT_HANDOFF.md`.
8. Compose runtime packets for active sections.
9. Run `npm run story:verify`.
10. Run `npm run project:sync`; use `npm run project:mount` first if root symlinks are missing or disturbed.
11. Run `npm run done:no-export` for workspace setup, or `npm run done` after exporting reader copies.

For exact commands, read `docs/STORY_WORKSPACE_SWITCHING.md`.

## Guardrails

- Never copy `.env` into archives.
- Do not put model choices in `.env`; use panels, suites, flags, or project docs.
- Do not leave stale runtime packets or stale `state/truth` files from the previous story.
- Do not leave stale `projects/active/<slug>/workspace/` metadata, broken root mounts, or missing project logs.
- Do not let sample-story facts leak into reusable docs, scripts, prompts, or generic skills.
- Preserve `taste/` and `docs/PROJECT_REVIEW_APPROACH.md` with the story during archive and restore; they contain project-specific taste, protected voice, and human feedback that reviewers need.
- Destructive story commands should use `--archive-current` unless the workspace is already unloaded, or the user explicitly wants disposable state and `--force`.
- Do not claim the workspace is ready until the final gate passes or the blocker is reported.
