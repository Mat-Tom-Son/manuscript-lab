# Brief

Goal: show how Manuscript Lab reports a broken nonfiction draft before any
model or network call is needed.

Audience: new v1 CLI evaluators who want to see useful failures quickly.

Constraints:

- Keep the fixture deterministic and public.
- Do not require API keys, package publishing, npm auth, or network access.
- Use obvious placeholder claims instead of real market data.

Success criteria:

- Protocol validation passes.
- Static checks, evidence commands, and gates reveal actionable blockers.
- The demo can be run from the fixture directory with `../../bin/manuscript-lab.mjs`.
