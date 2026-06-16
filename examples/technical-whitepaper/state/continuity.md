# Continuity

## Definitions

- Context packet: the generated operating bundle under `state/runtime/`.
- Issue: a durable review finding tracked under `state/issues/`.
- Candidate: a complete alternative section revision under `state/candidates/`.
- Audit: a before/after revision check under `state/revision-audits/`.
- Export: reader-facing output under `exports/`.

## Invariants

- The fixture is public, neutral, and synthetic.
- The sample document must not refer to private stories, clients, unpublished
  manuscripts, model-call logs, or API keys.
- The candidate and audit examples are manual public samples.
