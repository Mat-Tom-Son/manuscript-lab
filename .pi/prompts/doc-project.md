---
description: Inspect, mount, sync, or log the active project filesystem
argument-hint: "[mount|sync|verify|list|log --message ...]"
---
Work with the formal project filesystem.

Arguments:

$ARGUMENTS

Steps:

1. Read `docs/PROJECT_FILESYSTEM.md` if the structure is unclear.
2. If no argument is provided, run `npm run project:list` and `npm run project:verify`.
3. If the first argument is `mount`, run `npm run project:mount`.
4. If the first argument is `sync`, run `npm run project:sync`.
5. If the first argument is `verify`, run `npm run project:verify`.
6. If the first argument is `list`, run `npm run project:list`.
7. If the first argument is `log`, run `npm run project:log -- $ARGUMENTS`.
8. If a command refuses because a workspace transition is active, run `npm run story -- transition-status --json`, inspect/verify project state, then clear a stale marker with `npm run story -- transition-clear --force` only after the state is understood.
9. Do not edit manuscript prose in this prompt.
