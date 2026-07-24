#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  aggregateNarrativeProfile,
  diffNarrativeTemplates,
  featureAppliesToKind,
  narrativeSignalStaleness,
  narrativeTemplateSha,
  normalizeNarrativeTemplate,
  sectionBodySha,
  verifyTemplateEvidence,
} from "./lib/narrative-schema.mjs";
import { fingerprintForModel } from "./lib/model-fingerprints.mjs";
import { validateSectionContract } from "./lib/section-contract.mjs";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-narrative-"));

try {
  testNormalization();
  testSignalFreshness();
  testKindMatching();
  testProfileAggregation();
  testTemplateDiff();
  testFingerprints();
  testContractIntentValidation();
  testPipelineEndToEnd();
  console.log("narrative-signals tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testTemplateDiff() {
  const { template: base } = normalizeNarrativeTemplate({
    resolution: { present: true, mode: "internal_understanding", agency: "protagonist_choice" },
    temporal: { order: "linear", devices: [] },
  });
  const identical = diffNarrativeTemplates(base, structuredClone(base));
  assert.equal(identical.distinct_count, 0);
  assert.match(identical.verdict, /word-level variants/);

  const { template: variant } = normalizeNarrativeTemplate({
    resolution: { present: true, mode: "external_action", agency: "external_fate" },
    temporal: { order: "nonlinear", devices: ["flashback", "time_jump"] },
    subplots: { present: true, relation: "contrasting" },
    narration: { thematic_commentary: "frequent_explicit", moral_stance: "clear" },
    setting: { mirrors_interior_state: "pervasive", sensory_density: "lush" },
  });
  const distinct = diffNarrativeTemplates(base, variant);
  assert.ok(distinct.distinct_count >= 6, `expected >=6 differing axes, got ${distinct.distinct_count}`);
  assert.match(distinct.verdict, /structurally distinct/);
}

function testSignalFreshness() {
  const text = "<!--\nid: provenance\n-->\nBody.";
  const { template } = normalizeNarrativeTemplate({ temporal: { order: "linear" } });
  const templateArtifact = {
    schema: "narrative_template_v1",
    section_sha256: sectionBodySha(text),
    prompt_sha256: "prompt-a",
    model: "test:model-a",
    template,
  };
  const signalsArtifact = {
    schema: "narrative_signals_v1",
    kind: "fiction.chapter",
    features: {},
    features_sha256: "features-a",
    template_section_sha256: templateArtifact.section_sha256,
    template_sha256: narrativeTemplateSha(templateArtifact),
  };
  const fresh = narrativeSignalStaleness({
    signalsArtifact,
    templateArtifact,
    sectionText: text,
    kind: "fiction.chapter",
    featuresSha256: "features-a",
  });
  assert.equal(fresh.stale, false);

  const changedTemplate = structuredClone(templateArtifact);
  changedTemplate.template.temporal.order = "nonlinear";
  const stale = narrativeSignalStaleness({
    signalsArtifact,
    templateArtifact: changedTemplate,
    sectionText: text,
    kind: "fiction.chapter",
    featuresSha256: "features-a",
  });
  assert.equal(stale.stale, true);
  assert.ok(stale.reasons.some((reason) => reason.includes("template artifact changed")));
}

function testFingerprints() {
  assert.equal(fingerprintForModel("anthropic/claude-sonnet-5").family, "claude");
  assert.equal(fingerprintForModel("openrouter:z-ai/glm-5.1"), null);
  assert.equal(fingerprintForModel("google/gemini-3-flash").family, "gemini");
  assert.ok(fingerprintForModel("openai/gpt-5.4").narrative_watch.length > 0);
  assert.match(fingerprintForModel("openai/gpt-5.4").length_note, /40\.2% mean absolute error/);
  assert.match(fingerprintForModel("anthropic/claude-sonnet-5").length_note, /16\.6% mean absolute error/);
}

function testContractIntentValidation() {
  const contractText = (value) => `<!--
id: v-test
status: draft
target_words: 100
purpose: test
acceptance:
  - test
narrative_resolution: ${value}
-->
Body.
`;
  const bad = validateSectionContract({ text: contractText("banana"), file: "draft/v.md" });
  assert.ok(
    bad.errors.some((error) => error.includes("unsupported narrative_resolution") && error.includes("banana")),
    `typo'd narrative intent must be a contract error, got: ${bad.errors.join(" | ")}`,
  );
  const good = validateSectionContract({ text: contractText("external_action"), file: "draft/v.md" });
  assert.equal(good.errors.some((error) => error.includes("narrative_resolution")), false);
}

function testNormalization() {
  const { template, warnings } = normalizeNarrativeTemplate({
    pov: { person: "THIRD_LIMITED", tense: "sideways" },
    temporal: { order: "nonlinear", devices: ["flashback", "hologram"] },
    resolution: { present: "yes" },
    narration: { thematic_commentary: "frequent_explicit", themes_stated_verbatim: ["Theme."] },
  });
  assert.equal(template.pov.person, "third_limited");
  assert.equal(template.pov.tense, "unclear");
  assert.deepEqual(template.temporal.devices, ["flashback"]);
  assert.equal(template.resolution.present, false, "non-boolean present must coerce to false");
  assert.ok(warnings.some((warning) => warning.includes("pov.tense")));
  assert.ok(warnings.some((warning) => warning.includes("hologram")));

  const verified = verifyTemplateEvidence(
    { ...template, evidence: { ...template.evidence, thematic_commentary: ["Theme.", "Never said."] } },
    "Theme. The rest of the section.",
  );
  assert.deepEqual(verified.template.evidence.thematic_commentary, ["Theme."]);
  assert.equal(verified.verification.dropped.length, 1);
  assert.deepEqual(verified.template.narration.themes_stated_verbatim, ["Theme."]);
}

function testKindMatching() {
  assert.equal(featureAppliesToKind({ applies_to: ["*"] }, ""), true);
  assert.equal(featureAppliesToKind({ applies_to: ["fiction.*"] }, "fiction.chapter"), true);
  assert.equal(featureAppliesToKind({ applies_to: ["fiction.*"] }, "document.section"), false);
  assert.equal(featureAppliesToKind({ applies_to: ["fiction.*"] }, ""), false);
  assert.equal(featureAppliesToKind({ applies_to: ["essay"] }, "essay"), true);
  assert.equal(featureAppliesToKind({}, "anything"), true);
}

function testProfileAggregation() {
  const featureSet = [{ id: "resolution_mode", label: "Mode of resolution", ai_lean: "internal_understanding" }];
  const entry = (id, index, value) => ({
    section_id: id,
    order_index: index,
    features: { resolution_mode: { value, not_applicable: false } },
    intent_check: [],
  });
  const profile = aggregateNarrativeProfile(
    [
      entry("s1", 0, "internal_understanding"),
      entry("s2", 1, "internal_understanding"),
      entry("s3", 2, "internal_understanding"),
      entry("s4", 3, "internal_understanding"),
      entry("s5", 4, "external_action"),
    ],
    { featureSet },
  );
  const row = profile.features.resolution_mode;
  assert.equal(row.observed, 5);
  assert.equal(row.dominant, "internal_understanding");
  assert.equal(row.dominant_share, 0.8);
  assert.equal(row.longest_run, 4);
  assert.equal(row.matches_ai_lean, true);
  assert.equal(profile.convergence_flags.length, 1);
  assert.match(profile.convergence_flags[0].reasons.join(" "), /consecutive/);

  const sparse = aggregateNarrativeProfile([entry("s1", 0, "unresolved"), entry("s2", 1, "external_action")], { featureSet });
  assert.equal(sparse.convergence_flags.length, 0, "two mixed sections must not flag convergence");

  // A section where the feature was skipped (e.g. a document between fiction
  // chapters) must break a consecutive run.
  const skippedEntry = { section_id: "doc", order_index: 1, features: {}, intent_check: [] };
  const interrupted = aggregateNarrativeProfile(
    [entry("f1", 0, "internal_understanding"), skippedEntry, entry("f2", 2, "internal_understanding"), entry("f3", 3, "internal_understanding")],
    { featureSet },
  );
  assert.equal(interrupted.features.resolution_mode.longest_run, 2, "a skipped-feature section must break the run");

  // A section with no observations at all appears as an order_index hole and
  // must break the run the same way.
  const holed = aggregateNarrativeProfile(
    [entry("f1", 0, "internal_understanding"), entry("f2", 2, "internal_understanding"), entry("f3", 3, "internal_understanding")],
    { featureSet },
  );
  assert.equal(holed.features.resolution_mode.longest_run, 2, "a missing-observation section must break the run");
}

function testPipelineEndToEnd() {
  const workspace = path.join(tmp, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const init = runMlab(
    ["init", "--profile", "whitepaper", "--root", "manuscript", "--title", "Narrative Test", "--sections", "1", "--kind", "document.section", "--json"],
    { cwd: workspace },
  );
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const manuscriptRoot = path.join(workspace, "manuscript");
  const topLevelHelp = runMlab(["--help"], { cwd: manuscriptRoot });
  assert.equal(topLevelHelp.status, 0, topLevelHelp.stderr || topLevelHelp.stdout);
  assert.match(topLevelHelp.stdout, /narrative\s+— build the advisory profile/);

  const sectionFile = path.join(manuscriptRoot, "draft", "02-lighthouse.md");
  fs.writeFileSync(
    sectionFile,
    `<!--
id: 02-lighthouse
kind: fiction.chapter
stage: draft
status: draft
target_words: 300
purpose: Mara reaches the lighthouse and forces the door before the storm lands.
acceptance:
  - The chapter turns on an external action.
narrative_resolution: external_action
narrative_commentary: none
narrative_time: linear
-->
# The Lighthouse

Mara reached the lighthouse at dusk. Her throat tightened as the first cold drops came in.

She understood, finally, that grief was not a wound to heal but a room to inhabit.

The door was swollen shut. She set her shoulder against it and drove forward. Wood cracked.
`,
  );

  const mockFile = path.join(tmp, "mock-response.json");
  fs.writeFileSync(
    mockFile,
    JSON.stringify({
      pov: { person: "third_limited", tense: "past" },
      agents: [
        {
          name: "Mara",
          role: "protagonist",
          introduced_via: "in_action",
          emotion_expression: ["embodied_metaphor"],
          trajectory: "arrives -> forces door",
        },
      ],
      events: [{ summary: "Mara forces the door", link: "caused_by_prior", turn: true }],
      causal_chain: { continuity: "single_unbroken", loose_ends: [] },
      subplots: { present: false, relation: "none" },
      temporal: { order: "linear", devices: [], span: "one evening" },
      revelation: { withheld: [], questions_planted: [], revealed: [] },
      resolution: { present: true, mode: "internal_understanding", agency: "protagonist_choice" },
      setting: {
        locations: ["lighthouse"],
        mirrors_interior_state: "pervasive",
        sensory_emphasis: ["visual", "olfactory"],
        sensory_density: "lush",
      },
      narration: {
        thematic_commentary: "occasional_explicit",
        themes_stated_verbatim: ["She understood, finally, that grief was not a wound to heal but a room to inhabit."],
        addresses_reader: false,
        moral_stance: "clear",
      },
      dialogue: { proportion: "none", functions: [] },
      intertext: { references: [] },
      evidence: {
        emotion_embodied: ["Her throat tightened as the first cold drops came in.", "Fabricated quote that is not in the section."],
        setting_mirror: [],
        thematic_commentary: [],
        philosophical_dialogue: [],
        recontextualization: [],
      },
    }),
  );

  const extract = runMlab(["narrative", "extract", "draft/02-lighthouse.md", "--mock-response", mockFile, "--json"], {
    cwd: manuscriptRoot,
  });
  assert.equal(extract.status, 0, extract.stderr || extract.stdout);
  const extractResult = JSON.parse(extract.stdout);
  assert.equal(extractResult[0].cached, false);
  assert.equal(extractResult[0].evidence_dropped, 1, "fabricated evidence quote must be dropped");

  const templateArtifact = JSON.parse(
    fs.readFileSync(path.join(manuscriptRoot, "state", "observations", "02-lighthouse-template.json"), "utf8"),
  );
  assert.equal(templateArtifact.schema, "narrative_template_v1");
  assert.ok(templateArtifact.section_sha256);
  assert.equal(templateArtifact.evidence_verification.dropped.length, 1);
  assert.deepEqual(templateArtifact.template.evidence.emotion_embodied, [
    "Her throat tightened as the first cold drops came in.",
  ]);

  const cachedRun = runMlab(["narrative", "extract", "draft/02-lighthouse.md", "--mock-response", mockFile, "--json"], {
    cwd: manuscriptRoot,
  });
  assert.equal(cachedRun.status, 0, cachedRun.stderr || cachedRun.stdout);
  assert.equal(JSON.parse(cachedRun.stdout)[0].cached, true, "unchanged section must hit the template cache");

  const features = runMlab(["narrative", "features", "draft/02-lighthouse.md", "--json"], { cwd: manuscriptRoot });
  assert.equal(features.status, 0, features.stderr || features.stdout);
  const featuresResult = JSON.parse(features.stdout)[0];
  assert.equal(featuresResult.features.resolution_mode.value, "internal_understanding");
  assert.equal(featuresResult.features.olfactory_emphasis.value, "yes");
  assert.equal(featuresResult.features.thematic_explicitness.value, "stated_once");
  assert.equal(featuresResult.stale_template, false);
  assert.equal(featuresResult.template_section_sha256, templateArtifact.section_sha256);
  assert.ok(featuresResult.template_sha256);
  assert.ok(featuresResult.features_sha256);
  const drift = featuresResult.intent_check.filter((item) => item.match === false);
  assert.equal(drift.length, 2, "resolution + commentary intents must drift");
  const timeCheck = featuresResult.intent_check.find((item) => item.intent === "narrative_time");
  assert.equal(timeCheck.match, true);

  const strictCheck = runMlab(["narrative", "check", "draft/02-lighthouse.md", "--strict"], { cwd: manuscriptRoot });
  assert.equal(strictCheck.status, 1, "strict check must fail on drift");
  const advisoryCheck = runMlab(["narrative", "check", "draft/02-lighthouse.md"], { cwd: manuscriptRoot });
  assert.equal(advisoryCheck.status, 0, "default check is advisory");
  assert.match(advisoryCheck.stdout, /DRIFT 02-lighthouse narrative_resolution/);

  const profile = runMlab(["narrative", "profile", "--json"], { cwd: manuscriptRoot });
  assert.equal(profile.status, 0, profile.stderr || profile.stdout);
  const profileResult = JSON.parse(profile.stdout);
  assert.equal(profileResult.sections_observed, 1);
  assert.equal(profileResult.intent_drift.length, 2);
  assert.ok(fs.existsSync(path.join(manuscriptRoot, "state", "observations", "manuscript-narrative-profile.json")));

  const dryRunJson = runMlab(["narrative", "extract", "draft/02-lighthouse.md", "--dry-run", "--json"], { cwd: manuscriptRoot });
  assert.equal(dryRunJson.status, 0, dryRunJson.stderr || dryRunJson.stdout);
  const dryRunResult = JSON.parse(dryRunJson.stdout);
  assert.equal(dryRunResult[0].dry_run, true, "--dry-run --json must emit parseable JSON");
  assert.match(dryRunResult[0].prompt, /CRITICAL OUTPUT CONTRACT/);

  const compose = runMlab(["compose", "draft/02-lighthouse.md"], { cwd: manuscriptRoot });
  assert.equal(compose.status, 0, compose.stderr || compose.stdout);
  const intentDoc = fs.readFileSync(path.join(manuscriptRoot, "state", "runtime", "02-lighthouse", "intent.md"), "utf8");
  assert.match(intentDoc, /## Narrative Intent \(declared in contract\)/);
  assert.match(intentDoc, /narrative_resolution: external_action/);
  const ruleStack = fs.readFileSync(path.join(manuscriptRoot, "state", "runtime", "02-lighthouse", "rule-stack.yaml"), "utf8");
  assert.match(ruleStack, /narrative_intent:/);
  assert.match(ruleStack, /narrative_commentary: "none"/);
  const composePlain = runMlab(["compose", "draft/01-opening.md"], { cwd: manuscriptRoot });
  assert.equal(composePlain.status, 0, composePlain.stderr || composePlain.stdout);
  const plainIntentDoc = fs.readFileSync(path.join(manuscriptRoot, "state", "runtime", "01-opening", "intent.md"), "utf8");
  assert.doesNotMatch(plainIntentDoc, /Narrative Intent/, "sections without intents must compose without a narrative block");

  const reportJson = runMlab(["report", "--json"], { cwd: manuscriptRoot });
  assert.equal(reportJson.status, 0, reportJson.stderr || reportJson.stdout);
  const reportResult = JSON.parse(reportJson.stdout);
  assert.equal(reportResult.summary.narrative.sections_observed, 1);
  assert.equal(reportResult.summary.narrative.intent_drift, 2);
  assert.equal(reportResult.summary.narrative.stale_templates, 0);
  const reportText = runMlab(["report"], { cwd: manuscriptRoot });
  assert.match(reportText.stdout, /Narrative Observations \(advisory, never gate\)/);
  const reportHtml = runMlab(["report", "--html"], { cwd: manuscriptRoot });
  assert.equal(reportHtml.status, 0, reportHtml.stderr || reportHtml.stdout);
  assert.match(reportHtml.stdout, /Narrative Observations \(advisory, never gate\)/, "the HTML report must render narrative observations");
  assert.match(reportHtml.stdout, /narrative_resolution/, "the HTML report must list intent drift");

  const reviewDryRun = runMlab(
    ["review:run", "draft/02-lighthouse.md", "--passes", "narrative.default_pressure", "--force", "--dry-run"],
    { cwd: manuscriptRoot },
  );
  assert.equal(reviewDryRun.status, 0, reviewDryRun.stderr || reviewDryRun.stdout);
  assert.match(reviewDryRun.stdout, /narrative\.default_pressure/);
  assert.match(reviewDryRun.stdout, /state\/observations\/02-lighthouse-template\.json/, "the narrative.observer pack must include the template artifact");
  assert.match(reviewDryRun.stdout, /state\/observations\/manuscript-narrative-profile\.json/);

  fs.appendFileSync(sectionFile, "\nShe climbed.\n");

  // Freshness must be recomputed live: the stored signals artifact still says
  // stale_template: false at this point, but the section body has changed.
  const storedSignals = JSON.parse(
    fs.readFileSync(path.join(manuscriptRoot, "state", "observations", "02-lighthouse-narrative-signals.json"), "utf8"),
  );
  assert.equal(storedSignals.stale_template, false, "precondition: stored artifact predates the edit");
  const liveCheck = runMlab(["narrative", "check", "draft/02-lighthouse.md", "--json"], { cwd: manuscriptRoot });
  assert.equal(liveCheck.status, 0, liveCheck.stderr || liveCheck.stdout);
  assert.equal(JSON.parse(liveCheck.stdout)[0].stale_template, true, "check must recompute staleness, not trust the stored flag");
  const liveCheckText = runMlab(["narrative", "check", "draft/02-lighthouse.md"], { cwd: manuscriptRoot });
  assert.match(liveCheckText.stdout, /STALE 02-lighthouse/);
  const liveProfile = runMlab(["narrative", "profile", "--json"], { cwd: manuscriptRoot });
  assert.equal(liveProfile.status, 0, liveProfile.stderr || liveProfile.stdout);
  const liveProfileResult = JSON.parse(liveProfile.stdout);
  assert.deepEqual(liveProfileResult.stale_templates, ["02-lighthouse"], "profile must recompute staleness");
  assert.equal(liveProfileResult.sections_observed, 0, "stale observations must be excluded from profile aggregates");
  assert.equal(liveProfileResult.intent_drift.length, 0, "stale intent comparisons must be excluded from profile drift");
  const staleReport = runMlab(["report", "--json"], { cwd: manuscriptRoot });
  assert.equal(staleReport.status, 0, staleReport.stderr || staleReport.stdout);
  const staleReportResult = JSON.parse(staleReport.stdout);
  assert.equal(staleReportResult.summary.narrative.stale_templates, 1, "report must recompute staleness");
  assert.equal(staleReportResult.summary.narrative.sections_observed, 0, "report must exclude stale observations from its live summary");
  assert.equal(staleReportResult.summary.narrative.intent_drift, 0, "report must not present stale intent drift as current");

  const staleFeatures = runMlab(["narrative", "features", "draft/02-lighthouse.md", "--json"], { cwd: manuscriptRoot });
  assert.equal(staleFeatures.status, 0, staleFeatures.stderr || staleFeatures.stdout);
  assert.equal(JSON.parse(staleFeatures.stdout)[0].stale_template, true, "edited section must mark the template stale");

  // Re-extracting updates the template but does not silently refresh the
  // derived feature artifact. Until `features` runs again, checks stay stale
  // and strict mode must not fail on the old comparison.
  const refreshedExtract = runMlab(
    ["narrative", "extract", "draft/02-lighthouse.md", "--mock-response", mockFile, "--json"],
    { cwd: manuscriptRoot },
  );
  assert.equal(refreshedExtract.status, 0, refreshedExtract.stderr || refreshedExtract.stdout);
  assert.equal(JSON.parse(refreshedExtract.stdout)[0].cached, false);
  const postExtractCheck = runMlab(["narrative", "check", "draft/02-lighthouse.md", "--json"], { cwd: manuscriptRoot });
  const postExtractResult = JSON.parse(postExtractCheck.stdout)[0];
  assert.equal(postExtractResult.stale_template, true, "old signals must stay stale after the template is refreshed");
  assert.ok(postExtractResult.stale_reasons.some((reason) => reason.includes("template changed since feature derivation")));
  const staleStrict = runMlab(["narrative", "check", "draft/02-lighthouse.md", "--strict"], { cwd: manuscriptRoot });
  assert.equal(staleStrict.status, 0, "strict mode must not enforce drift from stale observations");

  const refreshedFeatures = runMlab(["narrative", "features", "draft/02-lighthouse.md", "--json"], { cwd: manuscriptRoot });
  assert.equal(refreshedFeatures.status, 0, refreshedFeatures.stderr || refreshedFeatures.stdout);
  assert.equal(JSON.parse(refreshedFeatures.stdout)[0].stale_template, false);

  // The saved profile still contains the stale snapshot from above. Report
  // must rebuild its advisory summary from current signals instead of
  // repeating the stored convergence/drift snapshot.
  const liveReportAfterRefresh = runMlab(["report", "--json"], { cwd: manuscriptRoot });
  const liveReportAfterRefreshResult = JSON.parse(liveReportAfterRefresh.stdout);
  assert.equal(liveReportAfterRefreshResult.summary.narrative.sections_observed, 1);
  assert.equal(liveReportAfterRefreshResult.summary.narrative.stale_templates, 0);
  assert.equal(liveReportAfterRefreshResult.summary.narrative.intent_drift, 2);

  const docKind = fs.readFileSync(sectionFile, "utf8").replace("kind: fiction.chapter", "kind: document.section");
  fs.writeFileSync(sectionFile, docKind);
  const kindChangedReport = runMlab(["report", "--json"], { cwd: manuscriptRoot });
  assert.equal(
    JSON.parse(kindChangedReport.stdout).summary.narrative.stale_templates,
    1,
    "changing section kind must invalidate derived observations until features reruns",
  );
  const docFeatures = runMlab(["narrative", "features", "draft/02-lighthouse.md", "--json"], { cwd: manuscriptRoot });
  assert.equal(docFeatures.status, 0, docFeatures.stderr || docFeatures.stdout);
  const docResult = JSON.parse(docFeatures.stdout)[0];
  assert.equal(docResult.features.character_introduction_mode, undefined, "fiction-only features must not fire on document kinds");
  assert.ok(docResult.features.thematic_explicitness, "universal features still apply to document kinds");
  assert.ok(docResult.skipped.some((item) => item.id === "emotion_expression_mode"));
}

function runMlab(argv, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "bin", "manuscript-lab.mjs"), ...argv], {
    cwd,
    encoding: "utf8",
  });
}
