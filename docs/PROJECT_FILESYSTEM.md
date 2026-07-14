# Project Filesystem

The harness separates reusable infrastructure from project content.

Reusable infrastructure stays in the repository root: `scripts/`, `checks/`, `reviews/`, `.pi/`, generic `docs/`, package files, and provider configuration.

Project content lives under `projects/`. When a project is active, the root mounts that project workspace with symlinks so existing tools can still use simple paths like `PROJECT.md`, `brief.md`, `draft/`, and `state/status.md`.

```text
projects/
  registry.json
  active/
    <slug>/
      project.json
      workspace-manifest.json
      workspace/
        PROJECT.md
        brief.md
        outline.md
        style.md
        taste/
        draft/
        sources/
        exports/
        docs/
          PROJECT_HANDOFF.md
          PROJECT_REVIEW_APPROACH.md
        state/
      logs/
        README.md
        index.json
        notes/
        model-calls/
        runs/
        doccheck/
  inactive/
    <slug>/
      project.json
      logs/
      snapshots/
        <timestamp>/
          workspace/
          workspace-manifest.json
```

## Mental Model

The active project workspace is canonical:

```text
projects/active/<slug>/workspace/
```

The repository root is the driving surface:

```text
PROJECT.md -> projects/active/<slug>/workspace/PROJECT.md
brief.md   -> projects/active/<slug>/workspace/brief.md
draft/     -> projects/active/<slug>/workspace/draft/
state/...  -> projects/active/<slug>/workspace/state/...
```

Editing through the root writes directly into the active project workspace. This keeps old scripts simple while giving agents and future frontends a formal place to find active and inactive projects.

## Project Supplement

`PROJECT.md` is the first project-specific supplement after the generic harness docs. Use it for compact operating notes that should travel with one project:

- what the project is
- current human taste notes
- project-specific handling instructions
- the next intended move

Do not put reusable process rules in `PROJECT.md`; put those in `AGENTS.md`, generic `docs/`, scripts, prompts, or skills.

## Commands

```bash
npm run project:list
npm run project:mount
npm run project:sync
npm run project:verify
npm run project:log -- --message "..."
npm run story:archive -- --slug <slug>
npm run story -- unload --slug <slug>
npm run project:init -- --title "New Story" --slug <slug> --sections 4 --archive-current
npm run project:restore -- --from archive/<archive> --archive-current
```

`project:mount` recreates root symlinks to the registered active workspace. Use it if an external tool or manual operation disturbed the mount points.

`project:sync` refreshes project metadata, the workspace manifest, project logs, and the root mount. Run it after meaningful project work.

`project:verify` checks that the registry, active project metadata, workspace manifest, and root symlinks agree.

`npm run done` and `npm run done:no-export` also sync and verify project state.

## Registry

The active project is recorded in:

```text
projects/registry.json
```

A frontend should start there. It can find:

- active project slug and title
- active project path
- active workspace path
- project logs path
- all known active/inactive projects

`state/workspace.json` records whether the root is mounted or intentionally unloaded.

## Logs

Project-local logs live under:

```text
projects/active/<slug>/logs/
```

Current log folders:

- `notes/`: human/agent work notes
- `doccheck/`: copied `.doccheck` run/cache artifacts when present
- `model-calls/`: exact prompt/response ledger when `MODEL_CALL_AUDIT=1`
- `runs/`: future summarized harness run records

`state/model-calls/` and `state/logs/` may exist as compatibility paths for tools, but project logs are the durable audit location.

`project:sync` and the done gate preserve existing `logs/model-calls/` artifacts. They may initialize the folder or copy a compatibility mirror into an empty project log directory, but they should not erase an existing project-local ledger or `calls/` tree.

## Inactive Projects

`npm run story -- unload` is the intentional empty-root state. It archives the current project, writes/updates `projects/inactive/<slug>/`, removes `projects/active/<slug>/`, clears mounted root project files, and writes `state/workspace.json` with `status: "unloaded"`.

Archiving, initializing, or restoring still writes legacy snapshots under `archive/` for compatibility. Use `archive/` as the old snapshot drawer. Use `projects/` as the formal project index for agents and future frontend work.

## Design Rule

Keep all reusable tools free of sample-story details. Project-specific material belongs in the mounted project workspace, especially `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, `taste/`, `draft/`, project docs, and project state.
