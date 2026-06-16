---
description: Audit a before/after revision for tradeoff quality
argument-hint: "--before <file> --after <file> [--issue <issue_id>]"
---
Audit a revision diff.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run diff:audit -- $ARGUMENTS`.
2. Read the generated artifact under `state/revision-audits/`.
3. Summarize whether the revision fixed the target issue, preserved voice, lost any high-value lines, introduced hotspots, or needs human review.
4. Do not revise the manuscript in this prompt unless explicitly asked.
