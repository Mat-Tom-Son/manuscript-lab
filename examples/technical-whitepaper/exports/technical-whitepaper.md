# Technical Whitepaper Tutorial

A compact public fixture for Manuscript Lab.

Exported 2026-07-14 from technical-whitepaper.

## Contents

- Executive Summary


# Executive Summary

This whitepaper is a tutorial fixture. It does not describe a real customer,
private manuscript, proprietary benchmark, or deployed system. It gives a small
technical document enough structure to exercise the Manuscript Lab workflow in
public.

The sample problem is simple: a team needs a repeatable way to revise a document
without losing the reason for each change. In this fixture, the answer is a
three-step packet workflow: name the section contract, gather only the relevant
context, and verify each revision against the contract before exporting a reader
copy. The workflow is intentionally small so the file relationships stay visible
inside the repository.

A context packet is the local bundle under `state/runtime/`. It records the
target section, visible files, skipped or excluded files, and criteria generated
from the section contract. The packet does not replace judgment; it creates a
small place to write down what judgment should protect. Before export, the
document owner reviews that packet against the accepted issue and the section
contract.

An issue is a durable review finding. A review dry-run can show which sensors
would run without calling a model provider. When a real review creates findings,
the operator triages them before revising. The issue in this fixture is already
accepted so a reader can see how a decision becomes revision input without
needing a provider key.

A candidate is an alternative complete revision of the same section. The sample
candidate run includes two manual variants. One preserves the original
structure and adds an owner-review sentence. The other compresses the workflow
into a shorter operating rule. Both are public examples, not model logs.

An audit compares a before snapshot with an after file. The static audit sample
records word-count movement and line changes without calling a provider. That is
enough to show the habit: preserve what works, name what changed, and verify
that the accepted issue was actually addressed.

An export is the reader-facing copy. This fixture includes Markdown and HTML
examples under `exports/`. A live run can regenerate them with `mlab export
--formats md,html --slug technical-whitepaper --author ""`, and the export
manifest records input and output hashes so a reader can confirm that the
published files match the committed draft.

The artifacts connect in a small daily loop. Compose the context packet, write
or revise prose against the section contract, and run the static checks. Review
findings become issues, an issue decision becomes a revision instruction,
candidates explore that instruction as complete alternatives, and an audit
records what the chosen revision changed. Every step leaves a durable file
behind, so the next working session starts from recorded decisions instead of
memory. None of the steps require a model provider; the fixture demonstrates
the file protocol, and a team can add model-backed reviews later without
changing any of the artifact shapes.

Readiness is a file decision too. The `mlab gate manuscript` command reads the
same contracts, status table, claims, sources, runtime packets, and issue
ledger that the workflow writes, then records a pass or fail verdict for each
requirement. The `mlab report` command collects those verdicts into one blocker
list, and every blocker names the exact command that clears it. This fixture is
kept in the ready state on purpose: validation, static checks, the manuscript
gate, and the report all pass on the committed files, so a reader can verify
the end of the tutorial instead of taking it on faith.

The operating promise is modest: every visible claim in this sample document can
be found in `state/claims.md`, every sample source key appears in
`sources/index.md`, and every revision artifact is small enough to inspect
without private context.
