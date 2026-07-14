Let me review the previous draft against the contract acceptance criteria, style rules, and sources.

## Acceptance Criteria Check

1. **Describes at least three real gate requirements by name or plain-language equivalent, including one citation/evidence requirement.**
   - The draft names `contract.valid`, `runtime.fresh`, `issues.no_blockers`, and mentions `evidence.*` namespace requirements. ✅ But does it name a specific evidence requirement by ID? It mentions "Citation and evidence requirements live in the shared `evidence.*` namespace" but doesn't name a specific one like `evidence.supported` or `evidence.cited`. Let me check the sources... The gate-engine source says "citation requirements moved from `claims.*`/`sources.*` to the shared `evidence.*` namespace" but doesn't enumerate specific evidence requirement IDs in the visible portion. The evidence-spine source mentions `claims.supported` as an older name. So I should probably name a specific evidence requirement. Let me look again... The gate-engine says "The 2.0.0 release made one such rename: citation requirements moved from `claims.*`/`sources.*` to the shared `evidence.*` namespace." So the old `claims.supported` would become `evidence.supported` or similar. But the source doesn't explicitly say `evidence.supported`. I should be careful not to fabricate. I can say the evidence namespace includes requirements that check claim support status, and reference the evidence spine as the data source.

   Actually, let me re-read: "Evidence commands now emit stable issue objects with `requirement_id`, `issue_key`, `severity`, `message`, and `remediation` fields so gates and reports can consume evidence results without parsing prose." This tells us evidence commands produce issues with `requirement_id` but doesn't name specific requirement IDs in the `evidence.*` namespace.

   I think I should keep it general but make sure I'm naming three real gate requirements. I have `contract.valid`, `runtime.fresh`, `issues.no_blockers` - all from the gate-engine source's example config. And I mention the `evidence.*` namespace as containing citation/evidence requirements. I think this satisfies the criterion.

2. **Explains that report blockers carry the command that fixes them, with one concrete example.**
   - The draft says: "Report blockers carry a remediation field with the command that fixes them. For example, a failed `runtime.fresh` requirement produces a message stating the runtime packet is stale, and the remediation field carries the command `mlab run draft/04-market.md` so an agent or human can resolve it without reading the full report."
   
   Problem: The `remediation` field is documented in the evidence-spine source as being on issue objects from evidence commands, not on gate result requirements. The gate-engine source shows requirements having a `message` field but doesn't show a `remediation` field on gate requirements (though the source is truncated). The `mlab run draft/04-market.md` command is not documented in either source. The gate-engine source shows `mlab gate draft/04-market.md --profile default --write` as the command field in the result artifact.
   
   I need to fix this. The evidence-spine source says: "Evidence commands now emit stable issue objects with `requirement_id`, `issue_key`, `severity`, `message`, and `remediation` fields." So the remediation field is on issue objects from evidence commands. I should attribute this correctly and use a more accurate example.

   But what concrete command would be in the remediation field? The sources don't give a specific example. I should be careful not to fabricate a command. Let me think about what I can safely say...

   The evidence-spine mentions `node scripts/doccheck.mjs` as a check. It mentions `state/claims.md` and `sources/index.md`. It mentions `[citation-needed]` markers. The gate-engine shows `mlab gate` commands.
   
   I think I can describe the mechanism (issue objects carry a remediation field with the fix command) and give an example that's plausible based on documented CLI patterns. But I should be more careful about the specific command. 

   Actually, looking at the gate-engine source more carefully, the result artifact has a `command` field that records what was run: `"command": "mlab gate draft/04-market.md --profile default --write"`. This is the gate command, not the fix command. And requirements in the gate config have a `message` field described as "Human-readable failure summary."
   
   The evidence-spine source explicitly says issue objects have `remediation` fields. So the chain is: evidence commands produce issue objects → gates consume these issue objects → the issue objects carry `remediation` fields with fix commands.

   For the concrete example, I think I can say something like: an unresolved `[citation-needed]` marker produces an issue whose remediation field carries the command to add support for that claim. I shouldn't fabricate a specific command string that isn't in the sources. But the acceptance criteria says "with one concrete example." 

   Let me re-read the acceptance criteria: "Explains that report blockers carry the command that fixes them, with one concrete example." The "concrete example" could be describing a specific scenario (what blocker, what command type) rather than necessarily a literal command string. But it would be stronger with a literal command.

   Hmm, looking at the gate-engine source again: the result artifact command field shows `"command": "mlab gate draft/04-market.md --profile default --write"`. And there's a mention of `npm run done` as "the final operator handoff command." These are real commands from the sources.

   I think the safest approach is:
   - Attribute the remediation field to evidence-spine (issue objects carry remediation)
   - Give a concrete example using a documented command pattern
   - Not fabricate a command that doesn't appear in sources

   Actually, I just realized - the gate-engine source mentions that `npm run done` is "the final operator handoff command" and the engine should "Let `npm run done` reuse the same primitives without losing its role as the final operator handoff command." And the gate command is `mlab gate draft/04-market.md --profile default --write`.
   
   But for remediation specifically - the evidence-spine says issue objects have `remediation` fields. The acceptance criteria wants a concrete example. I think I can describe the scenario concretely without fabricating a specific command string. For instance: "An issue from an unresolved `[citation-needed]` marker carries a remediation field pointing the operator to the claim that needs a source link." But the acceptance criteria specifically says "the command that fixes them."
   
   Let me try a different approach. The gate-engine source shows the command field as `"command": "mlab gate draft/04-market.md --profile default --write"`. Perhaps the gate result's command field or a similar field on requirements tells you what to re-run. But that's the command that was run, not the fix command.

   I think I need to be honest about what the sources say and not fabricate. The evidence-spine source says issue objects have `remediation` fields. I'll describe that and give a concrete scenario example. If I can't find a literal command in the sources, I'll describe the type of command concretely.

   Wait, actually, let me re-read the evidence-spine source more carefully for any command examples...

   "node scripts/doccheck.mjs fails unresolved `[citation-needed]` markers."
   "node scripts/doccheck.mjs checks `state/claims.md` table rows..."
   
   And from gate-engine:
   "mlab gate draft/04-market.md --profile default --write"
   "npm run done"

   These are the commands I can see. For the remediation example, I think the most honest approach is to describe the mechanism and give a concrete example of the scenario without fabricating a specific command string. Or I could use a pattern like `mlab evidence ...` which is consistent with the `mlab gate ...` pattern but not explicitly documented.

   Actually, the brief says "Every factual claim about the tool must be supported by the registered sources." So I should not fabricate a command. Let me describe the remediation mechanism accurately and give a concrete example that doesn't require fabricating a specific command string.

   Hmm, but the acceptance criteria says "with one concrete example." Let me think about what counts as concrete. I think describing the specific scenario (unresolved citation-needed marker → issue → remediation field with fix command) is concrete enough, even if I don't cite a literal command string. But it would be better with one.

   Actually, let me look at this differently. The gate-engine source was truncated. It's possible that the full source includes more details about remediation. But I can only work with what I have. The evidence-spine source explicitly mentions `remediation` fields on issue objects. I'll cite that and give a concrete scenario example.

   Let me try: "Issue objects that gates consume carry a `remediation` field with the command that resolves them [cite:evidence-spine]. For example, an unresolved `[citation-needed]` marker on `claim-019` produces an issue whose remediation field points the operator to the command for linking that claim to a registered source."

   But "points the operator to the command" is vague. The acceptance criteria says "carry the command that fixes them." So the remediation field carries a command. I should say it carries a command. But I don't have a concrete command to cite.
   
   You know what, I think I'm overthinking this. The sources say issue objects have remediation fields. The acceptance criteria wants me to explain this with a concrete example. I'll describe the mechanism and give a concrete scenario. The key factual claim (that remediation fields carry fix commands) is supported by the evidence-spine source. The specific example scenario (citation-needed marker → issue → remediation command) is consistent with the documented workflow. I'll avoid fabricating a specific CLI command string.

   Actually, let me try one more time. The gate-engine shows `mlab gate` as a CLI command. The evidence-spine refers to "evidence commands." The pattern `mlab evidence` is reasonable but not documented. However, `node scripts/doccheck.mjs` IS documented. And the gate-engine mentions `npm run done`. 

   I think I can say: "For example, an unresolved `[citation-needed]` marker on claim-019 produces an issue whose remediation field carries the command to register a source link for that claim" without specifying the exact command. That's concrete (specific claim, specific marker, specific fix action) without fabricating.

   Actually wait, I just re-read the acceptance criteria more carefully: "Explains that report blockers carry the command that fixes them, with one concrete example." 

   "Report blockers" - this could refer to blockers in the gate report/result. The gate-engine source's result artifact has requirements with `message` fields. The evidence-spine source's issue objects have `remediation` fields. When a gate fails on an evidence requirement, the underlying issue's remediation field carries the fix command.

   OK, I think the best approach is:
   1. Explain that issue objects from evidence commands carry `remediation` fields with fix commands [cite:evidence-spine]
   2. Give a concrete example: unresolved `[citation-needed]` marker → issue with remediation field containing the command to add source support for that specific claim

   I'll avoid fabricating a literal command string but make the example concrete and specific.

3. **Cites [cite:gate-engine] and [cite:evidence-spine] at the claims they support.**
   Let me check each citation in the draft:
   - "It turns existing checks... into named, repeatable decisions with machine-readable evidence [cite:gate-engine]" ✅
   - "Manuscript Lab ships four: `section-ready`, `manuscript-ready`, `citation-ready`, and `export-ready` [cite:gate-engine]" ✅
   - "These three are deterministic sensors... [cite:gate-engine]" - the source says "Prefer deterministic checks before optional model-backed checks" and sensors "should wrap existing deterministic scripts and files" ✅
   - "The 2.0 release moved them from the older `claims.*` and `sources.*` namespaces... [cite:gate-engine]" ✅ (source says this)
   - "The evidence spine supplies the data these requirements observe. It connects draft claims to registered sources through support links... [cite:evidence-spine]" ✅
   - "A claim marked `supported` must name a source key present in `sources/index.md`... [cite:evidence-spine]" ✅ (source says this)
   - "Drafts use `[citation-needed]` markers for unsupported factual claims, and the static checker fails on unresolved markers [cite:evidence-spine]" ✅ (source says this)
   - "Gates treat unresolved `high` and `critical` risk claims as blockers [cite:evidence-spine]" ✅ (source says "Gates should treat unresolved `high` and `critical` claims as blockers")
   - "Profiles... A profile changes included requirements and severities without changing the gate ID [cite:gate-engine]" ✅
   - "the result artifact records the command that was run, the target hashes, each requirement outcome, and the final readiness verdict [cite:gate-engine]" ✅
   - "Report blockers carry a remediation field with the command that fixes them." - This should be cited to [cite:evidence-spine], not [cite:gate-engine]. ❌ Missing citation here!
   - "Overrides are allowed but not hidden... [cite:gate-engine]" ✅

   So I need to fix the citation for the remediation claim.

4. **claims.supported** - Need to verify all claims are supported by sources.

5. **style.violations** - Check style rules:
   - "No bullet lists in body prose except