---
description: Run a read-only model review for one section
argument-hint: "<section file>"
---
Review this section without editing:

$ARGUMENTS

Read:

- `PROJECT.md`
- `brief.md`
- `outline.md`
- `style.md`
- `state/status.md`
- `state/continuity.md`
- `state/claims.md`
- `sources/index.md`
- the target section

Return concise issues only, grouped as:

## Blocking

## Source / Claims

## Structure

## Style

## Workflow / Repo

End with:

- `Approve for revision: yes/no`
- `Approve for publication: yes/no`

Do not modify files.
