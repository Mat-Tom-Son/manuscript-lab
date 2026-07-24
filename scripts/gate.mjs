#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./lib/files.mjs";
import { citationsCheckCommand } from "./lib/evidence-spine.mjs";
import { assessDeclaredReviewRuns, scanReviewErrors } from "./lib/review-errors.mjs";
import {
  discoverProtocol,
  listDrafts,
  loadKnownCheckIds,
  loadStatusByFile,
} from "./lib/protocol.mjs";
import {
  loadReviewRegistry,
  reviewPassApplies,
  reviewPassDefinitionSha256,
  reviewRegistrySha256,
} from "./lib/review-registry.mjs";
import {
  ALLOWED_SECTION_STATUSES,
  isShortFormDraftContract,
  minimumWordsForStartedSection,
  normalizeRel,
  parseContractList,
  parseSectionContract,
  placeholderFindings,
  sectionIdForFile,
  stripCode,
  stripContract,
  wordCount,
} from "./lib/section-contract.mjs";

const RESULT_SCHEMA = "manuscript-lab.gate-result.v1";
const GATE_VERSION = 1;
const DEFAULT_PROFILE = "default";
const DEFAULT_WORDS_FLOOR_RATIO = 0.33;
const NEAR_TARGET_RATIO = 0.8;
const NOT_STARTED_STATUSES = new Set(["todo", "planned"]);
const LOCAL_LINK_PATTERN = /\[[^\]\n]+\]\(([^)\n]+)\)/g;
const PLACEHOLDER_PATTERN = /\[citation-needed(?::[^\]]*)?\]/gi;

export function runGateCli(rawArgs, env = {}) {
  const cwd = env.cwd ?? process.cwd();
  const startedAt = toIso(env.now ?? new Date());
  const options = parseArgs(rawArgs);
  const command = env.command ?? ["node", "scripts/gate.mjs", ...rawArgs].map(shellToken).join(" ");

  if (options.help) {
    return { exitCode: 0, stdout: `${helpText()}\n`, stderr: "", result: null };
  }
  options.cwd = cwd;

  if (options.unknown.length) {
    const result = errorResult({
      errors: options.unknown.map((flag) => `Unknown option: ${flag}`),
      startedAt,
      command,
    });
    return formatCliResult(result, options);
  }

  const inferred = inferGate(options.positionals);
  if (inferred.error) {
    const result = errorResult({ errors: [inferred.error], startedAt, command });
    return formatCliResult(result, options);
  }

  let discovery;
  try {
    discovery = discoverProtocol({
      cwd,
      configPath: options.config,
      workspace: options.workspace,
    });
  } catch (error) {
    const result = errorResult({
      gateId: inferred.gateId,
      scope: scopeForGate(inferred.gateId),
      target: fallbackTarget(inferred),
      errors: [`Protocol discovery failed: ${error.message}`],
      startedAt,
      command,
    });
    return formatCliResult(result, options);
  }

  if (discovery.mode === "none" || discovery.errors?.length) {
    const result = errorResult({
      gateId: inferred.gateId,
      scope: scopeForGate(inferred.gateId),
      target: fallbackTarget(inferred),
      errors: discovery.errors?.length ? discovery.errors : ["No Manuscript Lab project found."],
      warnings: discovery.warnings ?? [],
      startedAt,
      command,
    });
    return formatCliResult(result, options);
  }

  let result;
  try {
    result = evaluateGate({
      gateId: inferred.gateId,
      targetArg: inferred.targetArg,
      discovery,
      options,
      command,
      startedAt,
      now: env.now ?? new Date(),
    });
  } catch (error) {
    result = errorResult({
      gateId: inferred.gateId,
      scope: scopeForGate(inferred.gateId),
      target: fallbackTarget(inferred),
      errors: [`Gate engine failed: ${error.stack || error.message}`],
      warnings: discovery.warnings ?? [],
      startedAt,
      command,
    });
  }

  if (options.write) {
    try {
      result = writeGateResult(result, discovery);
    } catch (error) {
      result = {
        ...result,
        status: "error",
        ready: false,
        exit_code: 2,
        errors: [...result.errors, `Could not write gate artifacts: ${error.message}`],
      };
    }
  }

  return formatCliResult(result, options);
}

export function evaluateGate({ gateId, targetArg = "", discovery, options = {}, command = "", startedAt = toIso(new Date()), now = new Date() }) {
  if (gateId === "section-ready") {
    return evaluateSectionReady({
      discovery,
      targetArg,
      options,
      command,
      startedAt,
      now,
    });
  }
  if (gateId === "citation-ready") {
    return evaluateCitationReady({
      discovery,
      options,
      command,
      startedAt,
      now,
    });
  }
  if (gateId === "manuscript-ready") {
    return evaluateManuscriptReady({
      discovery,
      options,
      command,
      startedAt,
      now,
    });
  }
  if (gateId === "export-ready") {
    return evaluateExportReady({
      discovery,
      options,
      command,
      startedAt,
      now,
    });
  }
  return errorResult({
    gateId,
    scope: scopeForGate(gateId),
    errors: [`Unsupported gate: ${gateId}`],
    startedAt,
    command,
  });
}

function evaluateSectionReady({ discovery, targetArg, options = {}, command = "", startedAt = toIso(new Date()), now = new Date() }) {
  const resolved = resolveSectionTarget(discovery, targetArg, options);
  if (resolved.error) {
    return errorResult({
      gateId: "section-ready",
      scope: "section",
      target: { kind: "section", path: targetArg || "", id: targetArg ? safeId(targetArg) : "section", sha256: null },
      errors: [resolved.error],
      warnings: discovery.warnings ?? [],
      startedAt,
      command,
    });
  }

  const { fullPath, relPath } = resolved;
  const exists = fs.existsSync(fullPath);
  const text = exists ? fs.readFileSync(fullPath, "utf8") : "";
  const contract = parseSectionContract(text);
  const targetId = contract ? sectionIdForFile(relPath, contract) : safeId(path.basename(relPath, path.extname(relPath)));
  const target = {
    kind: "section",
    path: relPath,
    id: targetId,
    sha256: exists ? sha256File(fullPath) : null,
  };

  const stateDir = stateDirFor(discovery);
  const knownCheckIds = loadKnownCheckIds(discovery.packageRoot);
  const reviewRegistry = loadReviewRegistry(discovery);
  const knownReviewIds = reviewRegistry.knownReviewIds;
  const statusFile = path.join(discovery.manuscriptRoot, stateDir, "status.md");
  const statusByFile = loadStatusByFile(statusFile);
  const requirements = [];
  const warnings = [...(discovery.warnings ?? []), ...reviewRegistry.warnings];
  const status = contract?.get("status") ?? "";
  const targetWords = Number(contract?.get("target_words"));
  const proseWords = wordCount(stripContract(text));
  const shortForm = isShortFormDraftContract(contract);

  requirements.push(requirement({
    id: "contract.present",
    sensor: "section_contract",
    status: contract ? "pass" : "fail",
    message: contract ? "Section contract is present." : `${relPath}: missing section contract comment at the top of the file.`,
    evidence: { path: relPath, exists },
  }));

  const contractIssues = contract ? validateBasicContract(contract, relPath) : [];
  requirements.push(requirement({
    id: "contract.valid",
    sensor: "section_contract",
    status: contract ? passFail(contractIssues.length === 0) : "skip",
    message: contractIssues.length ? contractIssues.join("; ") : contract ? "Section contract fields are valid." : "Skipped because the section contract is missing.",
    evidence: { errors: contractIssues },
  }));

  const started = Boolean(contract) && !NOT_STARTED_STATUSES.has(status);
  requirements.push(requirement({
    id: "contract.status_started",
    sensor: "section_contract",
    status: contract ? passFail(started) : "skip",
    message: contract
      ? started
        ? "Section status indicates writing has started."
        : `Section status is "${status || "(blank)"}". Set status: draft in the section contract when writing begins.`
      : "Skipped because the section contract is missing.",
    evidence: { status: status || null },
  }));

  // Only an explicit `confirmed: false` (written by `mlab adopt`) fails here;
  // contracts without the field are treated as deliberately authored.
  const confirmedField = contract ? String(contract.get("confirmed") ?? "").trim().toLowerCase() : "";
  const unconfirmed = confirmedField === "false";
  requirements.push(requirement({
    id: "contract.confirmed",
    sensor: "section_contract",
    status: contract ? passFail(!unconfirmed) : "skip",
    message: contract
      ? unconfirmed
        ? `${relPath}: imported section contract is not confirmed. Review purpose and acceptance in the section header, then change confirmed: false to confirmed: true.`
        : "Section contract is confirmed."
      : "Skipped because the section contract is missing.",
    evidence: { confirmed: contract ? confirmedField || null : null },
  }));

  const checkIds = contract ? parseContractList(text, "checks") : [];
  const unknownChecks = checkIds.filter((id) => !knownCheckIds.has(id));
  requirements.push(requirement({
    id: "contract.check_ids_exist",
    sensor: "section_contract",
    status: contract ? passFail(unknownChecks.length === 0) : "skip",
    message: unknownChecks.length ? `Unknown model check IDs: ${unknownChecks.join(", ")}` : contract ? "All listed model check IDs exist." : "Skipped because the section contract is missing.",
    evidence: { checks: checkIds, unknown: unknownChecks },
  }));

  const reviewIds = contract ? parseContractList(text, "reviews") : [];
  const unknownReviews = reviewIds.filter((id) => !knownReviewIds.has(id));
  const reviewRegistryValid = reviewRegistry.errors.length === 0;
  requirements.push(requirement({
    id: "contract.review_ids_exist",
    sensor: "section_contract",
    status: contract ? passFail(reviewRegistryValid && unknownReviews.length === 0) : "skip",
    message: !reviewRegistryValid
      ? `Review registry is invalid: ${reviewRegistry.errors.join("; ")}`
      : unknownReviews.length
        ? `Unknown review pass IDs: ${unknownReviews.join(", ")}`
        : contract
          ? "All listed review pass IDs exist."
          : "Skipped because the section contract is missing.",
    evidence: { reviews: reviewIds, unknown: unknownReviews, registry_errors: reviewRegistry.errors },
  }));

  const tableStatus = statusByFile.get(relPath);
  const hasStatusFile = fs.existsSync(statusFile);
  requirements.push(requirement({
    id: "status.synced",
    sensor: "status_table",
    status: contract && hasStatusFile ? passFail(tableStatus === status) : "skip",
    message: statusSyncMessage({ contract, hasStatusFile, relPath, status, tableStatus }),
    evidence: {
      status_file: displayProjectPath(statusFile, discovery),
      contract_status: status || null,
      table_status: tableStatus || null,
    },
  }));

  const expectedWords = shortForm ? 1 : minimumWordsForStartedSection(targetWords);
  const contentPass = status === "todo" || proseWords >= expectedWords;
  requirements.push(requirement({
    id: "content.nonempty_when_active",
    sensor: "section_content",
    status: contract ? status === "todo" ? "skip" : passFail(contentPass) : "skip",
    message: contentPass
      ? status === "todo"
        ? "Skipped for todo section."
        : "Active section contains prose."
      : `${relPath}: section is marked ${status || "(blank)"} but has only ${proseWords} prose words.`,
    evidence: { status, words: proseWords, expected_minimum_words: expectedWords },
  }));

  const floor = sectionWordsFloor({ discovery, contract, targetWords });
  const wordsFloorApplies = Boolean(contract) && started && !shortForm && floor.words != null;
  requirements.push(requirement({
    id: "words.floor",
    sensor: "section_content",
    status: wordsFloorApplies ? passFail(proseWords >= floor.words) : "skip",
    message: wordsFloorSkipMessage({ contract, started, shortForm, floor })
      ?? (proseWords >= floor.words
        ? "Section word count meets the floor."
        : `${relPath}: ${proseWords} prose words is below the word floor of ${floor.words} (${floor.reason}).`),
    evidence: {
      status,
      words: proseWords,
      floor_words: floor.words,
      floor_source: floor.source,
      floor_ratio: floor.ratio,
      target_words: Number.isFinite(targetWords) ? targetWords : null,
    },
  }));

  const nearTargetWords = Number.isFinite(targetWords) && targetWords > 0 ? Math.ceil(targetWords * NEAR_TARGET_RATIO) : null;
  const nearTargetApplies = Boolean(contract) && started && !shortForm && nearTargetWords != null;
  requirements.push(requirement({
    id: "words.near_target",
    severity: "warn",
    sensor: "section_content",
    status: nearTargetApplies ? (proseWords >= nearTargetWords ? "pass" : "warn") : "skip",
    message: wordsFloorSkipMessage({ contract, started, shortForm, floor: { words: nearTargetWords } })
      ?? (proseWords >= nearTargetWords
        ? "Section word count is at or above 80% of target."
        : `${relPath}: ${proseWords} prose words is below 80% of target ${targetWords} (${nearTargetWords} words).`),
    evidence: {
      status,
      words: proseWords,
      near_target_words: nearTargetWords,
      target_words: Number.isFinite(targetWords) ? targetWords : null,
    },
  }));

  const inBand = wordCountInBand({ status, targetWords, proseWords, shortForm });
  requirements.push(requirement({
    id: "word_count.in_band",
    sensor: "section_content",
    status: contract ? inBand.status : "skip",
    message: inBand.message,
    evidence: inBand.evidence,
  }));

  const runtime = contract ? runtimePacketStatus(discovery, relPath, contract) : { status: "skipped" };
  requirements.push(requirement({
    id: "runtime.fresh",
    sensor: "runtime_packet",
    status: contract ? status === "todo" ? "skip" : passFail(runtime.status === "fresh") : "skip",
    message: runtimeMessage({ runtime, status, relPath, contract }),
    evidence: runtime,
  }));

  const staticIssues = exists ? staticDraftIssues({ discovery, relPath, text }) : [`Requested file does not exist: ${relPath}`];
  requirements.push(requirement({
    id: "doccheck.static_pass",
    sensor: "static_document_check",
    status: passFail(staticIssues.length === 0),
    message: staticIssues.length ? staticIssues.join("; ") : "Static document checks passed for target.",
    evidence: { issues: staticIssues },
  }));

  const sectionBlockers = findSectionBlockerIssues(discovery, { relPath, sectionId: targetId });
  requirements.push(requirement({
    id: "issues.no_blockers",
    sensor: "issue_ledger",
    status: sectionBlockers.error ? "error" : passFail(sectionBlockers.issues.length === 0),
    message: sectionBlockers.error
      ? sectionBlockers.error
      : sectionBlockers.issues.length
        ? `Open or deferred blocker issues target ${relPath}.`
        : "No open or deferred blocker issues target this section.",
    evidence: sectionBlockers.error ? { error: sectionBlockers.error } : { count: sectionBlockers.issues.length, issues: sectionBlockers.issues },
  }));

  const reviewState = declaredReviewState({
    discovery,
    drafts: [{
      path: relPath,
      text,
      contract,
      sectionId: targetId,
      status,
      sha256: target.sha256,
    }],
    registry: reviewRegistry,
  });
  requirements.push(...declaredReviewRequirements({
    discovery,
    options,
    registry: reviewRegistry,
    state: reviewState,
  }));

  const reviewFailures = findReviewFailuresForSection(discovery, targetId, relPath, reviewState.scanned);
  requirements.push(requirement({
    id: "reviews.latest_clean",
    severity: "warn",
    sensor: "review_errors",
    status: reviewFailures.error ? "error" : reviewFailures.failures.length ? "warn" : "pass",
    message: reviewFailures.error
      ? reviewFailures.error
      : reviewFailures.failures.length
        ? `Latest review run errors remain for ${relPath}.`
        : reviewFailures.run_count
          ? `No latest review run errors target this section (${reviewFailures.run_count} persisted run(s)).`
          : "No persisted review runs target this section; error cleanliness is vacuously satisfied.",
    evidence: reviewFailures.error
      ? { error: reviewFailures.error }
      : { count: reviewFailures.failures.length, run_count: reviewFailures.run_count, failures: reviewFailures.failures },
  }));

  return finalizeResult({
    gateId: "section-ready",
    scope: "section",
    target,
    command,
    startedAt,
    finishedAt: toIso(now),
    profile: options.profile ?? DEFAULT_PROFILE,
    requirements,
    warnings,
    inputHashes: {
      config: hashDiscoveryConfig(discovery),
      target: target.sha256,
      status: hashFileIfExists(statusFile),
      checks_suite: hashFileIfExists(path.join(discovery.packageRoot, "checks/suite.json")),
      reviews_suite: hashFileIfExists(path.join(discovery.packageRoot, "reviews/suite.json")),
      reviews_registry: reviewRegistrySha256(reviewRegistry),
      review_runs: hashReviewState(discovery),
      issue_ledger: hashFileIfExists(path.join(discovery.manuscriptRoot, stateDir, "issues/issue-ledger.json")),
      runtime_context: hashFileIfExists(path.join(discovery.manuscriptRoot, stateDir, "runtime", targetId, "context.json")),
    },
  });
}

function evaluateCitationReady({ discovery, options = {}, command = "", startedAt = toIso(new Date()), now = new Date() }) {
  // Single source of truth: the same evidence-spine implementation that powers
  // `mlab citations check`. The gate only adapts its result into requirements,
  // so the two surfaces can never disagree.
  const warnings = [...(discovery.warnings ?? [])];
  let spine;
  try {
    spine = citationsCheckCommand({ cwd: options.cwd ?? discovery.manuscriptRoot, discovery });
  } catch (error) {
    return errorResult({
      gateId: "citation-ready",
      scope: "citation",
      target: { kind: "citation", id: "citations", sha256: null },
      errors: [`Citation readiness engine failed: ${error.message}`],
      warnings,
      startedAt,
      command,
    });
  }

  const issuesByRequirement = new Map();
  for (const issue of spine.issues ?? []) {
    const key = issue.requirement_id || "unspecified";
    if (!issuesByRequirement.has(key)) issuesByRequirement.set(key, []);
    issuesByRequirement.get(key).push(issue);
  }

  const requirements = (spine.requirements ?? []).map((req) => {
    const issues = issuesByRequirement.get(req.id) ?? [];
    return requirement({
      id: req.id,
      sensor: "evidence_spine",
      status: req.status === "fail" ? "fail" : req.status === "warn" ? "warn" : "pass",
      message: req.status === "pass"
        ? req.message
        : issues.map((issue) => issue.message).slice(0, 6).join("; ") || req.message,
      evidence: {
        blocking: req.blocking,
        warnings: req.warnings,
        issues: issues.slice(0, 20),
      },
    });
  });

  const claimsFile = path.join(discovery.manuscriptRoot, stateRel(discovery, "claims.md"));
  const sourcesFile = path.join(discovery.manuscriptRoot, sourcesDirFor(discovery), "index.md");
  const draftHashes = (spine.files ?? []).map((rel) => ({
    path: rel,
    sha256: hashFileIfExists(path.join(discovery.manuscriptRoot, rel)),
  }));

  return finalizeResult({
    gateId: "citation-ready",
    scope: "citation",
    target: {
      kind: "citation",
      id: "citations",
      sha256: hashJson({
        drafts: draftHashes,
        claims: hashFileIfExists(claimsFile),
        sources: hashFileIfExists(sourcesFile),
      }),
    },
    command,
    startedAt,
    finishedAt: toIso(now),
    profile: options.profile ?? DEFAULT_PROFILE,
    requirements,
    warnings,
    inputHashes: {
      config: hashDiscoveryConfig(discovery),
      claims: hashFileIfExists(claimsFile),
      sources: hashFileIfExists(sourcesFile),
      drafts: hashJson(draftHashes),
    },
  });
}

function evaluateManuscriptReady({ discovery, options = {}, command = "", startedAt = toIso(new Date()), now = new Date() }) {
  const stateDir = stateDirFor(discovery);
  const allDrafts = draftRecords(discovery);
  const activeDrafts = allDrafts.filter((draft) => draft.status !== "todo");
  const requirements = [];
  const reviewRegistry = loadReviewRegistry(discovery);
  const warnings = [...(discovery.warnings ?? []), ...reviewRegistry.warnings];

  const requiredProject = requiredProjectFiles(discovery);
  requirements.push(requirement({
    id: "project.required_files_present",
    sensor: "protocol_project",
    status: passFail(requiredProject.missing.length === 0),
    message: requiredProject.missing.length ? `Missing required project paths: ${requiredProject.missing.join(", ")}` : "Required project files are present.",
    evidence: requiredProject,
  }));

  const outline = outlineSectionsResolve(discovery);
  requirements.push(requirement({
    id: "outline.sections_resolve",
    sensor: "outline",
    status: outline.error ? "fail" : passFail(outline.missing.length === 0),
    message: outline.error
      ? outline.error
      : outline.missing.length
        ? `Outline references missing section files: ${outline.missing.join(", ")}`
        : "Outline section file references resolve.",
    evidence: outline,
  }));

  const doneDrafts = allDrafts.filter((draft) => draft.status === "done");
  requirements.push(requirement({
    id: "sections.any_started",
    sensor: "section_contract",
    status: allDrafts.length ? passFail(activeDrafts.length > 0 || doneDrafts.length > 0) : "skip",
    message: !allDrafts.length
      ? "Skipped because no draft sections were found."
      : activeDrafts.length || doneDrafts.length
        ? "At least one section has been started."
        : "No section has been started — every draft is still \"todo\".",
    evidence: {
      total_sections: allDrafts.length,
      active_sections: activeDrafts.length,
      done_sections: doneDrafts.length,
    },
  }));

  const sectionResults = activeDrafts.map((draft) => evaluateSectionReady({
    discovery,
    targetArg: draft.path,
    options,
    command: `section-ready ${draft.path}`,
    startedAt,
    now,
  }));
  const failedSections = sectionResults.filter((result) => !result.ready).map((result) => ({
    file: result.target.path,
    id: result.target.id,
    status: result.status,
    failures: result.requirements
      .filter((req) => req.severity === "block" && ["fail", "error"].includes(req.status))
      .map((req) => ({ id: req.id, message: req.message })),
  }));
  if (!activeDrafts.length) warnings.push("No active non-todo draft sections found.");
  requirements.push(requirement({
    id: "sections.ready",
    sensor: "section_ready",
    status: activeDrafts.length ? passFail(failedSections.length === 0) : "pass",
    message: !activeDrafts.length
      ? "No active non-todo draft sections found."
      : failedSections.length
        ? `Sections not ready: ${failedSections
          .map((section) => `${section.file} (${section.failures.map((failure) => failure.id).join(", ")})`)
          .join("; ")}`
        : "All active sections pass section-ready.",
    evidence: {
      active_sections: activeDrafts.map((draft) => draft.path),
      failed_sections: failedSections,
    },
  }));

  const citationResult = evaluateCitationReady({
    discovery,
    options,
    command: "citation-ready citations",
    startedAt,
    now,
  });
  requirements.push(requirement({
    id: "citations.ready",
    sensor: "citation_ready",
    status: citationResult.status === "error" ? "error" : passFail(citationResult.ready),
    message: citationResult.ready ? "Citation readiness passed." : "Citation readiness failed.",
    evidence: {
      status: citationResult.status,
      failures: citationResult.requirements.filter((req) => ["fail", "error"].includes(req.status)).map((req) => req.id),
    },
  }));

  const staleRuntime = activeDrafts
    .map((draft) => ({ draft, runtime: draft.contract ? runtimePacketStatus(discovery, draft.path, draft.contract) : { status: "missing-contract" } }))
    .filter((entry) => entry.runtime.status !== "fresh");
  requirements.push(requirement({
    id: "runtime.all_fresh",
    sensor: "runtime_packet",
    status: passFail(staleRuntime.length === 0),
    message: staleRuntime.length ? "One or more active sections have stale or missing runtime packets." : "All active section runtime packets are fresh.",
    evidence: {
      stale: staleRuntime.map((entry) => ({
        file: entry.draft.path,
        status: entry.runtime.status,
        path: entry.runtime.path,
      })),
    },
  }));

  const issueState = findProjectOpenIssues(discovery);
  requirements.push(requirement({
    id: "issues.none_open_or_deferred",
    sensor: "issue_ledger",
    status: issueState.error ? "error" : passFail(issueState.issues.length === 0),
    message: issueState.error
      ? issueState.error
      : issueState.issues.length
        ? "Open or deferred issues remain."
        : "No open or deferred issues remain.",
    evidence: issueState.error ? { error: issueState.error } : { count: issueState.issues.length, issues: issueState.issues },
  }));

  const reviewState = declaredReviewState({
    discovery,
    drafts: activeDrafts,
    registry: reviewRegistry,
  });
  requirements.push(...declaredReviewRequirements({
    discovery,
    options,
    registry: reviewRegistry,
    state: reviewState,
  }));

  const reviews = reviewState.scanned;
  requirements.push(requirement({
    id: "reviews.no_latest_errors",
    sensor: "review_errors",
    status: reviews.error ? "error" : passFail(reviews.failures.length === 0),
    message: reviews.error
      ? reviews.error
      : reviews.failures.length
        ? "Latest review run errors remain."
        : reviews.runs.length
          ? `No latest review run errors remain (${reviews.runs.length} persisted run(s)).`
          : "No persisted review runs exist; error cleanliness is vacuously satisfied.",
    evidence: reviews.error
      ? { error: reviews.error }
      : { count: reviews.failures.length, run_count: reviews.runs.length, failures: reviews.failures },
  }));

  const staticCheck = runPackageNode(discovery, "scripts/doccheck.mjs", ["--static-only"], { cwd: discovery.manuscriptRoot });
  requirements.push(commandRequirement({
    id: "doccheck.static_all_pass",
    sensor: "static_document_check",
    result: staticCheck,
    passMessage: "Static document checks passed for the manuscript.",
    failMessage: "Static document checks failed for the manuscript.",
  }));

  const templateAudit = runPackageNode(discovery, "scripts/template-audit.mjs", ["--strict"], { cwd: discovery.packageRoot });
  requirements.push(commandRequirement({
    id: "harness.templates_clean",
    sensor: "template_audit",
    result: templateAudit,
    passMessage: "Strict template audit passed.",
    failMessage: "Strict template audit failed.",
  }));

  const contextAudit = runPackageNode(discovery, "scripts/context-audit.mjs", ["--strict"], { cwd: discovery.packageRoot });
  requirements.push(commandRequirement({
    id: "harness.context_clean",
    sensor: "context_audit",
    result: contextAudit,
    passMessage: "Strict context hygiene audit passed.",
    failMessage: "Strict context hygiene audit failed.",
  }));

  const projectVerification = discovery.mode === "installed"
    ? null
    : runPackageNode(discovery, "scripts/story-workspace.mjs", ["verify-projects", "--json"], { cwd: discovery.workspaceRoot });
  requirements.push(projectVerification
    ? commandRequirement({
      id: "project.filesystem_verified",
      sensor: "project_filesystem",
      result: projectVerification,
      passMessage: "Project filesystem verifies.",
      failMessage: "Project filesystem verification failed.",
    })
    : requirement({
      id: "project.filesystem_verified",
      sensor: "project_filesystem",
      status: "skip",
      message: "Skipped in config-first installed mode.",
      evidence: { mode: discovery.mode },
    }));

  return finalizeResult({
    gateId: "manuscript-ready",
    scope: "manuscript",
    target: {
      kind: "manuscript",
      id: "manuscript",
      sha256: hashJson(activeDrafts.map((draft) => ({ path: draft.path, sha256: draft.sha256 }))),
    },
    command,
    startedAt,
    finishedAt: toIso(now),
    profile: options.profile ?? DEFAULT_PROFILE,
    requirements,
    warnings,
    inputHashes: {
      config: hashDiscoveryConfig(discovery),
      drafts: hashJson(activeDrafts.map((draft) => ({ path: draft.path, sha256: draft.sha256 }))),
      status: hashFileIfExists(path.join(discovery.manuscriptRoot, stateDir, "status.md")),
      claims: hashFileIfExists(path.join(discovery.manuscriptRoot, stateDir, "claims.md")),
      sources: hashFileIfExists(path.join(discovery.manuscriptRoot, sourcesDirFor(discovery), "index.md")),
      issue_ledger: hashFileIfExists(path.join(discovery.manuscriptRoot, stateDir, "issues/issue-ledger.json")),
      reviews_registry: reviewRegistrySha256(reviewRegistry),
      review_runs: hashReviewState(discovery),
    },
  });
}

function evaluateExportReady({ discovery, options = {}, command = "", startedAt = toIso(new Date()), now = new Date() }) {
  const exportsDir = exportsDirFor(discovery);
  const exportRoot = path.join(discovery.manuscriptRoot, exportsDir);
  const manifestFile = path.join(exportRoot, "manifest.json");
  const manifest = readExportManifest(manifestFile, discovery);
  const formats = requiredExportFormats(options);
  const manifestOutputs = Array.isArray(manifest.data?.outputs) ? manifest.data.outputs : [];
  const discoveredOutputs = listExportOutputs(discovery, exportRoot);
  const outputsByFormat = new Map();
  for (const output of [...discoveredOutputs, ...manifestOutputs.map((output) => normalizeManifestOutput(output, discovery))]) {
    if (!output.format || outputsByFormat.has(output.format)) continue;
    outputsByFormat.set(output.format, output);
  }
  const missingFormats = formats.filter((format) => !outputsByFormat.has(format));
  const requiredOutputs = formats.map((format) => outputsByFormat.get(format)).filter(Boolean);
  const missingFiles = [];
  const emptyFiles = [];
  for (const output of requiredOutputs) {
    const full = path.resolve(discovery.manuscriptRoot, output.file);
    if (isOutside(full, discovery.manuscriptRoot)) {
      missingFiles.push({ format: output.format, file: output.file, reason: "path escapes project root" });
      continue;
    }
    if (!fs.existsSync(full)) {
      missingFiles.push({ format: output.format, file: output.file, reason: "file does not exist" });
      continue;
    }
    const size = fs.statSync(full).size;
    if (size <= 0) emptyFiles.push({ format: output.format, file: output.file, size });
  }

  const freshness = manifest.data ? exportFreshness(discovery, manifest.data, requiredOutputs) : { status: "missing-manifest", stale_inputs: [], old_outputs: [] };
  const hiddenOverride = exportOverrideVisibility(manifest.data);
  const manuscriptResult = evaluateManuscriptReady({
    discovery,
    options,
    command: "manuscript-ready manuscript",
    startedAt,
    now,
  });
  const requirements = [];
  const warnings = [...(discovery.warnings ?? [])];

  requirements.push(requirement({
    id: "manuscript.ready",
    sensor: "manuscript_ready",
    status: manuscriptResult.status === "error" ? "error" : passFail(manuscriptResult.ready),
    message: manuscriptResult.ready ? "Manuscript readiness passed." : "Manuscript readiness failed.",
    evidence: {
      status: manuscriptResult.status,
      failures: manuscriptResult.requirements.filter((req) => ["fail", "error"].includes(req.status)).map((req) => req.id),
    },
  }));

  requirements.push(requirement({
    id: "export.manifest_present",
    sensor: "export_manifest",
    status: manifest.error ? "error" : passFail(Boolean(manifest.data)),
    message: manifest.error
      ? manifest.error
      : manifest.data
        ? "Export manifest is present and parseable."
        : `Export manifest is missing: ${normalizeRel(path.posix.join(exportsDir, "manifest.json"))}`,
    evidence: {
      path: normalizeRel(path.posix.join(exportsDir, "manifest.json")),
      exists: fs.existsSync(manifestFile),
      schema_version: manifest.data?.schema_version ?? "",
      export_id: manifest.data?.export_id ?? "",
    },
  }));

  requirements.push(requirement({
    id: "export.command_passed",
    sensor: "export_manifest",
    status: manifest.data ? passFail(manifestOutputs.length > 0) : "skip",
    message: manifest.data
      ? manifestOutputs.length
        ? "Export manifest records a completed export command."
        : "Export manifest contains no outputs."
      : "Skipped because the export manifest is missing or unreadable.",
    evidence: {
      output_count: manifestOutputs.length,
      created_at: manifest.data?.created_at ?? "",
      export_id: manifest.data?.export_id ?? "",
    },
  }));

  requirements.push(requirement({
    id: "export.formats_present",
    sensor: "export_files",
    status: passFail(missingFormats.length === 0),
    message: missingFormats.length
      ? `Missing required export formats: ${missingFormats.join(", ")}`
      : "All required export formats are present.",
    evidence: {
      required_formats: formats,
      present_formats: [...outputsByFormat.keys()].sort(),
      missing_formats: missingFormats,
      outputs: requiredOutputs.map(publicExportOutput),
    },
  }));

  requirements.push(requirement({
    id: "export.files_nonempty",
    sensor: "export_files",
    status: passFail(missingFiles.length === 0 && emptyFiles.length === 0 && requiredOutputs.length === formats.length),
    message: missingFiles.length || emptyFiles.length
      ? "One or more required export files are missing or empty."
      : "Required export files exist and are nonempty.",
    evidence: {
      missing_files: missingFiles,
      empty_files: emptyFiles,
      outputs: requiredOutputs.map(publicExportOutput),
    },
  }));

  requirements.push(requirement({
    id: "export.generated_after_inputs",
    sensor: "export_manifest",
    status: manifest.data ? passFail(freshness.status === "fresh") : "skip",
    message: manifest.data
      ? freshness.status === "fresh"
        ? "Exports match manifest input hashes or are newer than source inputs."
        : "Exports are stale relative to current source inputs."
      : "Skipped because the export manifest is missing or unreadable.",
    evidence: freshness,
  }));

  requirements.push(requirement({
    id: "export.no_dirty_override",
    sensor: "export_manifest",
    status: manifest.data ? passFail(!hiddenOverride.hidden) : "skip",
    message: manifest.data
      ? hiddenOverride.hidden
        ? "Export manifest records an override without visible override details."
        : "Export manifest has no hidden gate override."
      : "Skipped because the export manifest is missing or unreadable.",
    evidence: hiddenOverride,
  }));

  return finalizeResult({
    gateId: "export-ready",
    scope: "export",
    target: {
      kind: "export",
      id: "manuscript",
      path: exportsDir,
      sha256: hashJson({
        manifest: hashFileIfExists(manifestFile),
        outputs: requiredOutputs.map((output) => ({ format: output.format, file: output.file, sha256: hashFileIfExists(path.join(discovery.manuscriptRoot, output.file)) })),
      }),
    },
    command,
    startedAt,
    finishedAt: toIso(now),
    profile: options.profile ?? DEFAULT_PROFILE,
    requirements,
    warnings,
    inputHashes: {
      config: hashDiscoveryConfig(discovery),
      manifest: hashFileIfExists(manifestFile),
      manuscript_gate: hashJson({
        status: manuscriptResult.status,
        target: manuscriptResult.target?.sha256 ?? null,
        failures: manuscriptResult.requirements.filter((req) => ["fail", "error"].includes(req.status)).map((req) => req.id),
      }),
      exports: hashJson(requiredOutputs.map((output) => ({ format: output.format, file: output.file, sha256: hashFileIfExists(path.join(discovery.manuscriptRoot, output.file)) }))),
    },
  });
}

function finalizeResult({ gateId, scope, target, command, startedAt, finishedAt, profile, requirements, warnings = [], errors = [], inputHashes = {} }) {
  const hasRequirementError = requirements.some((req) => req.status === "error");
  const hasBlockFailure = requirements.some((req) => req.severity === "block" && req.status === "fail");
  const hasWarnings = warnings.length > 0 || requirements.some((req) => req.status === "warn");
  const status = errors.length || hasRequirementError ? "error" : hasBlockFailure ? "fail" : hasWarnings ? "pass_with_warnings" : "pass";
  const exitCode = status === "error" ? 2 : status === "fail" ? 1 : 0;

  return {
    schema_version: RESULT_SCHEMA,
    run_id: runId({ gateId, targetId: target.id, startedAt }),
    gate_id: gateId,
    gate_version: GATE_VERSION,
    profile: profile || DEFAULT_PROFILE,
    scope,
    target,
    command,
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    ready: exitCode === 0,
    exit_code: exitCode,
    summary: {
      passed: requirements.filter((req) => req.status === "pass").length,
      failed: requirements.filter((req) => req.status === "fail").length,
      warnings: requirements.filter((req) => req.status === "warn").length,
      skipped: requirements.filter((req) => req.status === "skip").length,
      overridden: requirements.filter((req) => req.status === "overridden").length,
    },
    requirements,
    overrides: [],
    input_hashes: inputHashes,
    warnings,
    errors,
  };
}

function errorResult({ gateId = "unknown", scope = "unknown", target = null, errors = [], warnings = [], startedAt = toIso(new Date()), command = "" }) {
  const finishedAt = toIso(new Date());
  return {
    schema_version: RESULT_SCHEMA,
    run_id: runId({ gateId, targetId: target?.id ?? "unknown", startedAt }),
    gate_id: gateId,
    gate_version: GATE_VERSION,
    profile: DEFAULT_PROFILE,
    scope,
    target: target ?? { kind: "unknown", id: "unknown", sha256: null },
    command,
    started_at: startedAt,
    finished_at: finishedAt,
    status: "error",
    ready: false,
    exit_code: 2,
    summary: { passed: 0, failed: 0, warnings: 0, skipped: 0, overridden: 0 },
    requirements: [],
    overrides: [],
    input_hashes: {},
    warnings,
    errors,
  };
}

function writeGateResult(result, discovery) {
  const stateDir = stateDirFor(discovery);
  const targetId = safePathSegment(result.target.id ?? "target");
  const runRel = normalizeRel(path.posix.join(stateDir, "gates/runs", `${result.run_id}.json`));
  const latestRel = normalizeRel(path.posix.join(stateDir, "gates/latest", result.scope, targetId, `${result.gate_id}.json`));
  const withArtifacts = {
    ...result,
    artifacts: {
      run: runRel,
      latest: latestRel,
    },
  };
  writeJsonAtomic(path.join(discovery.manuscriptRoot, runRel), withArtifacts);
  writeJsonAtomic(path.join(discovery.manuscriptRoot, latestRel), withArtifacts);
  return withArtifacts;
}

function formatCliResult(result, options) {
  if (options.json) {
    return { exitCode: result.exit_code, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "", result };
  }

  const lines = [];
  const errLines = [];
  const marker = result.ready ? "PASS" : result.status === "error" ? "ERROR" : "FAIL";
  const gateLabel = result.gate_id && result.gate_id !== "unknown" ? ` ${result.gate_id}` : "";
  const targetLabel = result.target.path ?? result.target.id ?? "";
  const header = `${marker}${gateLabel}${targetLabel && targetLabel !== "unknown" ? ` ${targetLabel}` : ""}`;
  if (result.ready) lines.push(header);
  else errLines.push(header);

  for (const req of result.requirements.filter((item) => ["fail", "warn", "error"].includes(item.status))) {
    const line = `- ${req.id}: ${req.message}`;
    if (req.status === "warn" && result.ready) lines.push(line);
    else errLines.push(line);
  }
  for (const error of result.errors) errLines.push(`- ${error}`);
  for (const warning of result.warnings) lines.push(`- warning: ${warning}`);

  return {
    exitCode: result.exit_code,
    stdout: lines.length ? `${lines.join("\n")}\n` : "",
    stderr: errLines.length ? `${errLines.join("\n")}\n` : "",
    result,
  };
}

function requirement({ id, severity = "block", sensor, status, message, evidence = {} }) {
  return {
    id,
    severity,
    status,
    deterministic: true,
    sensor,
    message,
    evidence,
  };
}

function commandRequirement({ id, sensor, result, passMessage, failMessage }) {
  const failed = result.error || result.status !== 0;
  return requirement({
    id,
    sensor,
    status: result.error ? "error" : passFail(!failed),
    message: failed ? failMessage : passMessage,
    evidence: commandEvidence(result),
  });
}

function requiredExportFormats(options = {}) {
  const raw = options.formats || "md,html";
  const formats = String(raw)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set(["md", "html", "epub", "pdf"]);
  return [...new Set(formats.filter((format) => allowed.has(format)))];
}

function runPackageNode(discovery, scriptRel, args = [], { cwd = discovery.manuscriptRoot } = {}) {
  const script = path.join(discovery.packageRoot, scriptRel);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? (result.error ? 2 : 1),
    signal: result.signal ?? null,
    error: result.error?.message ?? "",
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function commandEvidence(result) {
  return {
    exit_code: result.status,
    signal: result.signal,
    error: result.error,
    stdout: summarizeOutput(result.stdout),
    stderr: summarizeOutput(result.stderr),
  };
}

function summarizeOutput(value) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function readExportManifest(file, discovery) {
  if (!fs.existsSync(file)) return { data: null, error: "" };
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data?.schema_version !== "manuscript-lab.export-manifest.v1") {
      return { data, error: `Unexpected export manifest schema: ${data?.schema_version ?? "(missing)"}` };
    }
    return { data, error: "" };
  } catch (error) {
    return { data: null, error: `Could not parse ${displayProjectPath(file, discovery)}: ${error.message}` };
  }
}

function listExportOutputs(discovery, exportRoot) {
  if (!fs.existsSync(exportRoot)) return [];
  const allowed = new Set(["md", "html", "epub", "pdf"]);
  return fs
    .readdirSync(exportRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const format = path.extname(entry.name).slice(1).toLowerCase();
      if (!allowed.has(format)) return null;
      const file = path.join(exportRoot, entry.name);
      return {
        format,
        file: displayProjectPath(file, discovery),
        size: fs.statSync(file).size,
        sha256: sha256File(file),
      };
    })
    .filter(Boolean);
}

function normalizeManifestOutput(output, discovery) {
  const rawFile = String(output?.file ?? "");
  const full = path.isAbsolute(rawFile) ? path.resolve(rawFile) : path.resolve(discovery.manuscriptRoot, rawFile);
  const file = path.isAbsolute(rawFile) && isOutside(full, discovery.manuscriptRoot)
    ? normalizeRel(rawFile)
    : displayProjectPath(full, discovery);
  return {
    format: String(output?.format ?? path.extname(file).slice(1)).toLowerCase(),
    file,
    size: Number(output?.size ?? 0),
    sha256: output?.sha256 ?? null,
  };
}

function publicExportOutput(output) {
  return {
    format: output.format,
    file: output.file,
    size: output.size ?? null,
    sha256: output.sha256 ?? null,
  };
}

function exportFreshness(discovery, manifest, outputs) {
  const inputHashes = manifest.input_hashes && typeof manifest.input_hashes === "object" ? manifest.input_hashes : {};
  const staleInputs = [];
  const inputMtimes = [];

  for (const [rel, expectedHash] of Object.entries(inputHashes)) {
    const full = path.resolve(discovery.manuscriptRoot, rel);
    if (isOutside(full, discovery.manuscriptRoot)) {
      staleInputs.push({ file: rel, reason: "path escapes project root" });
      continue;
    }
    if (!fs.existsSync(full)) {
      staleInputs.push({ file: rel, reason: "input file is missing" });
      continue;
    }
    inputMtimes.push(fs.statSync(full).mtimeMs);
    if (sha256File(full) !== expectedHash) staleInputs.push({ file: rel, reason: "hash mismatch" });
  }

  const newestInput = inputMtimes.length ? Math.max(...inputMtimes) : 0;
  const oldOutputs = newestInput
    ? outputs.flatMap((output) => {
      const full = path.resolve(discovery.manuscriptRoot, output.file);
      if (isOutside(full, discovery.manuscriptRoot) || !fs.existsSync(full)) return [];
      return fs.statSync(full).mtimeMs >= newestInput ? [] : [{ format: output.format, file: output.file }];
    })
    : [];

  const hashFresh = Object.keys(inputHashes).length > 0 && staleInputs.length === 0;
  const mtimeFresh = newestInput > 0 && oldOutputs.length === 0 && outputs.length > 0;
  return {
    status: hashFresh || mtimeFresh ? "fresh" : "stale",
    input_hashes_checked: Object.keys(inputHashes).length,
    stale_inputs: staleInputs,
    old_outputs: oldOutputs,
    newest_input_mtime: newestInput || null,
  };
}

function exportOverrideVisibility(manifest) {
  const overrideVisible = Boolean(manifest?.gate_override || manifest?.override || (Array.isArray(manifest?.overrides) && manifest.overrides.length));
  const overrideClaimed = manifest?.gate_enforced === "overridden" || manifest?.gate_overridden === true || manifest?.overridden === true;
  return {
    gate_enforced: manifest?.gate_enforced ?? null,
    source_dirty: manifest?.source_dirty ?? null,
    override_claimed: Boolean(overrideClaimed),
    override_visible: overrideVisible,
    hidden: Boolean(overrideClaimed && !overrideVisible),
  };
}

function inferGate(positionals) {
  const [first, second] = positionals;
  if (!first) return { gateId: "manuscript-ready", targetArg: "manuscript" };

  if (first === "section" || first === "section-ready") {
    if (!second) return { error: `${first} requires a draft path.` };
    return { gateId: "section-ready", targetArg: second };
  }

  if (first === "citation" || first === "citations" || first === "citation-ready") {
    return { gateId: "citation-ready", targetArg: second || "citations" };
  }

  if (first === "manuscript" || first === "manuscript-ready") {
    return { gateId: "manuscript-ready", targetArg: "manuscript" };
  }

  if (first === "export" || first === "exports" || first === "export-ready") {
    return { gateId: "export-ready", targetArg: "exports" };
  }

  if (/\.md$/i.test(first) || normalizeRel(first).startsWith("draft/")) {
    return { gateId: "section-ready", targetArg: first };
  }

  return { error: `Unsupported gate target: ${first}` };
}

function parseArgs(args) {
  const parsed = {
    positionals: [],
    json: false,
    write: false,
    help: false,
    profile: DEFAULT_PROFILE,
    config: "",
    workspace: "",
    formats: "md,html",
    staticOnly: false,
    allowOverrides: false,
    noOverrides: false,
    ci: false,
    unknown: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--write") parsed.write = true;
    else if (arg === "--static-only") parsed.staticOnly = true;
    else if (arg === "--allow-overrides") parsed.allowOverrides = true;
    else if (arg === "--no-overrides") parsed.noOverrides = true;
    else if (arg === "--ci") parsed.ci = true;
    else if (["--profile", "--config", "--workspace", "--formats", "--format", "--export-formats"].includes(arg)) {
      const value = args[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        parsed.unknown.push(`${arg} requires a value`);
      } else {
        parsed[formatOptionKey(arg)] = value;
        index += 1;
      }
    } else if (arg.startsWith("--profile=")) parsed.profile = arg.slice("--profile=".length);
    else if (arg.startsWith("--config=")) parsed.config = arg.slice("--config=".length);
    else if (arg.startsWith("--workspace=")) parsed.workspace = arg.slice("--workspace=".length);
    else if (arg.startsWith("--formats=")) parsed.formats = arg.slice("--formats=".length);
    else if (arg.startsWith("--format=")) parsed.formats = arg.slice("--format=".length);
    else if (arg.startsWith("--export-formats=")) parsed.formats = arg.slice("--export-formats=".length);
    else if (arg.startsWith("--")) parsed.unknown.push(arg);
    else parsed.positionals.push(arg);
  }

  const invalidFormats = invalidExportFormats(parsed.formats);
  if (invalidFormats.length) parsed.unknown.push(`Unsupported export format: ${invalidFormats.join(", ")}`);
  if (!requiredExportFormats(parsed).length) parsed.unknown.push("--formats requires at least one format");
  if (parsed.ci) {
    parsed.json = true;
    parsed.staticOnly = true;
    parsed.noOverrides = true;
    if (parsed.profile === DEFAULT_PROFILE) parsed.profile = "ci";
  }

  return parsed;
}

function formatOptionKey(arg) {
  if (arg === "--format" || arg === "--formats" || arg === "--export-formats") return "formats";
  return arg.slice(2);
}

function invalidExportFormats(raw) {
  const allowed = new Set(["md", "html", "epub", "pdf"]);
  return String(raw ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((format) => !allowed.has(format));
}

function resolveSectionTarget(discovery, targetArg, options = {}) {
  if (!targetArg) return { error: "section-ready requires a draft path." };
  const projectCandidate = path.resolve(discovery.manuscriptRoot, targetArg);
  const cwdCandidate = path.resolve(options.cwd ?? discovery.manuscriptRoot, targetArg);
  const fullPath = !fs.existsSync(projectCandidate) && !isOutside(cwdCandidate, discovery.manuscriptRoot)
    ? cwdCandidate
    : projectCandidate;
  if (isOutside(fullPath, discovery.manuscriptRoot)) {
    return { error: `Target path must stay inside the manuscript root: ${targetArg}` };
  }
  return {
    fullPath,
    relPath: normalizeRel(path.relative(discovery.manuscriptRoot, fullPath)),
  };
}

function validateBasicContract(contract, relPath) {
  const issues = [];
  for (const field of ["id", "status", "target_words", "purpose", "acceptance"]) {
    if (!contract.has(field)) issues.push(`${relPath}: section contract missing ${field}`);
  }

  const status = contract.get("status");
  if (status && !ALLOWED_SECTION_STATUSES.has(status)) {
    issues.push(`${relPath}: unsupported section status "${status}"`);
  }

  const targetWords = Number(contract.get("target_words"));
  if (contract.has("target_words") && (!Number.isFinite(targetWords) || targetWords <= 0)) {
    issues.push(`${relPath}: target_words must be a positive number`);
  }
  return issues;
}

function sectionWordsFloor({ discovery, contract, targetWords }) {
  // A blank (or non-numeric) min_words value falls through to the ratio floor;
  // only an explicit numeric value such as `min_words: 0` overrides it.
  const minWordsText = contract?.has("min_words") ? String(contract.get("min_words")).trim() : "";
  const minWordsRaw = minWordsText ? Number(minWordsText) : NaN;
  if (Number.isFinite(minWordsRaw) && minWordsRaw >= 0) {
    const words = Math.ceil(minWordsRaw);
    return { words, source: "contract.min_words", ratio: null, reason: `contract min_words ${words}` };
  }
  if (!Number.isFinite(targetWords) || targetWords <= 0) {
    return { words: null, source: null, ratio: null, reason: "" };
  }
  const configured = Number(discovery.config?.gates?.section?.words_floor_ratio);
  const configuredValid = Number.isFinite(configured) && configured > 0 && configured <= 1;
  const ratio = configuredValid ? configured : DEFAULT_WORDS_FLOOR_RATIO;
  return {
    words: Math.ceil(targetWords * ratio),
    source: configuredValid ? "config.gates.section.words_floor_ratio" : "default_ratio",
    ratio,
    reason: `${Math.round(ratio * 100)}% of target ${targetWords}`,
  };
}

function wordsFloorSkipMessage({ contract, started, shortForm, floor }) {
  if (!contract) return "Skipped because the section contract is missing.";
  if (!started) return "Skipped for not-started section.";
  if (shortForm) return "Skipped for short-form section.";
  if (floor.words == null) return "Skipped because target_words is not a positive number.";
  return null;
}

function wordCountInBand({ status, targetWords, proseWords, shortForm }) {
  if (status !== "done") {
    return {
      status: "skip",
      message: "Skipped because section status is not done.",
      evidence: { status, words: proseWords, target_words: Number.isFinite(targetWords) ? targetWords : null },
    };
  }
  if (shortForm) {
    return {
      status: passFail(proseWords > 0),
      message: proseWords > 0 ? "Done short-form section has prose." : "Done short-form section has no prose.",
      evidence: { status, words: proseWords, target_words: Number.isFinite(targetWords) ? targetWords : null },
    };
  }
  const low = Math.floor(targetWords * 0.6);
  const high = Math.ceil(targetWords * 1.5);
  return {
    status: passFail(proseWords >= low && proseWords <= high),
    message: proseWords >= low && proseWords <= high
      ? "Done section word count is within the target band."
      : `Done section has ${proseWords} words, outside target band ${low}-${high}.`,
    evidence: { status, words: proseWords, target_words: targetWords, low, high },
  };
}

function runtimePacketStatus(discovery, relPath, contract) {
  const sectionId = sectionIdForFile(relPath, contract);
  const stateDir = stateDirFor(discovery);
  const dirRel = normalizeRel(path.posix.join(stateDir, "runtime", sectionId));
  const dir = path.join(discovery.manuscriptRoot, dirRel);
  const contextFile = path.join(dir, "context.json");
  const requiredFiles = ["intent.md", "context.json", "rule-stack.yaml", "criteria.json", "trace.json"];

  if (!fs.existsSync(contextFile)) {
    return {
      section_id: sectionId,
      status: "missing",
      path: dirRel,
      context: normalizeRel(path.posix.join(dirRel, "context.json")),
      generated_at: null,
      visible_files: null,
      stale_inputs: [],
      output_missing: [normalizeRel(path.posix.join(dirRel, "context.json"))],
    };
  }

  let context;
  try {
    context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  } catch (error) {
    return {
      section_id: sectionId,
      status: "invalid",
      path: dirRel,
      context: normalizeRel(path.posix.join(dirRel, "context.json")),
      error: error.message,
      generated_at: null,
      visible_files: null,
      stale_inputs: [],
      output_missing: [],
    };
  }

  const staleInputs = [];
  for (const [input, expectedHash] of Object.entries(context.input_hashes ?? {})) {
    const full = path.resolve(discovery.manuscriptRoot, input);
    if (isOutside(full, discovery.manuscriptRoot)) {
      staleInputs.push(`${input} (escapes project root)`);
      continue;
    }
    if (!fs.existsSync(full)) {
      staleInputs.push(`${input} (missing)`);
      continue;
    }
    if (sha256File(full) !== expectedHash) staleInputs.push(input);
  }

  if (context.section && normalizeRel(context.section) !== relPath) {
    staleInputs.push(`section mismatch: ${context.section}`);
  }

  const outputMissing = requiredFiles
    .map((name) => normalizeRel(path.posix.join(dirRel, name)))
    .filter((runtimeFile) => !fs.existsSync(path.join(discovery.manuscriptRoot, runtimeFile)));

  return {
    section_id: sectionId,
    status: outputMissing.length ? "invalid" : staleInputs.length ? "stale" : "fresh",
    path: dirRel,
    context: normalizeRel(path.posix.join(dirRel, "context.json")),
    generated_at: context.generated_at ?? null,
    visible_files: Array.isArray(context.visible_files) ? context.visible_files.length : null,
    stale_inputs: staleInputs,
    output_missing: outputMissing,
  };
}

function runtimeMessage({ runtime, status, relPath, contract }) {
  if (!contract) return "Skipped because the section contract is missing.";
  if (status === "todo") return "Skipped for todo section.";
  if (runtime.status === "fresh") return "Runtime packet is fresh.";
  return `Runtime packet is ${runtime.status} for ${relPath}.`;
}

function statusSyncMessage({ contract, hasStatusFile, relPath, status, tableStatus }) {
  if (!contract) return "Skipped because the section contract is missing.";
  if (!hasStatusFile) return "Skipped because state/status.md is missing.";
  if (tableStatus === status) return "Section contract status matches state/status.md.";
  if (!tableStatus) return `${relPath} is not listed in state/status.md.`;
  return `${relPath} contract status "${status}" does not match state/status.md "${tableStatus}".`;
}

function staticDraftIssues({ discovery, relPath, text }) {
  const issues = [];
  if (text.trim().length === 0) issues.push(`${relPath}: empty draft file`);
  issues.push(...placeholderFindings(text).map((finding) => `${relPath}: ${finding}`));
  if (PLACEHOLDER_PATTERN.test(text)) issues.push(`${relPath}: contains [citation-needed]`);
  PLACEHOLDER_PATTERN.lastIndex = 0;
  if (text.includes('"""')) issues.push(`${relPath}: contains triple double quotes; use normal quotes`);
  if (/\n#{4,}\s/.test(`\n${text}`)) issues.push(`${relPath}: heading depth is too deep; prefer ### or shallower`);
  issues.push(...brokenLocalLinks({ discovery, relPath, text }));
  return issues;
}

function brokenLocalLinks({ discovery, relPath, text }) {
  const issues = [];
  const sourceDir = path.dirname(path.join(discovery.manuscriptRoot, relPath));
  for (const match of text.matchAll(LOCAL_LINK_PATTERN)) {
    const raw = match[1].trim().replace(/^<|>$/g, "").split("#")[0];
    if (!raw || /^(https?:|mailto:|tel:)/i.test(raw)) continue;
    const decoded = decodeURIComponent(raw);
    const full = path.resolve(sourceDir, decoded);
    if (isOutside(full, discovery.manuscriptRoot)) {
      issues.push(`${relPath}: local link escapes project root: ${raw}`);
    } else if (!fs.existsSync(full)) {
      issues.push(`${relPath}: broken local link: ${raw}`);
    }
  }
  return issues;
}

function draftRecords(discovery) {
  return listDrafts(discovery).map((draft) => {
    const text = fs.existsSync(draft.fullPath) ? fs.readFileSync(draft.fullPath, "utf8") : "";
    const contract = parseSectionContract(text);
    return {
      ...draft,
      text,
      contract,
      sectionId: contract ? sectionIdForFile(draft.path, contract) : safeId(path.basename(draft.path, path.extname(draft.path))),
      status: contract?.get("status") ?? "draft",
      sha256: fs.existsSync(draft.fullPath) ? sha256File(draft.fullPath) : null,
    };
  });
}

function requiredProjectFiles(discovery) {
  const required = ["brief.md", "outline.md", "style.md", stateRel(discovery, "status.md"), "draft"];
  const missing = required.filter((rel) => !fs.existsSync(path.join(discovery.manuscriptRoot, rel)));
  return { required, missing };
}

function outlineSectionsResolve(discovery) {
  const outlineFile = path.join(discovery.manuscriptRoot, "outline.md");
  if (!fs.existsSync(outlineFile)) return { error: "outline.md is missing.", references: [], missing: [] };
  const text = fs.readFileSync(outlineFile, "utf8");
  const references = [...text.matchAll(/^File:\s*`?([^`\n]+)`?/gim)]
    .map((match) => normalizeRel(stripCode(match[1]).trim()))
    .filter(Boolean);
  const missing = references.filter((rel) => rel.startsWith("draft/") && !fs.existsSync(path.join(discovery.manuscriptRoot, rel)));
  return { references, missing };
}

function findSectionBlockerIssues(discovery, target) {
  const loaded = loadIssueLedger(discovery);
  if (loaded.error) return { error: loaded.error, issues: [] };
  const issues = loaded.issues.filter((issue) => {
    if (!isOpenOrDeferredIssue(issue)) return false;
    if (!isBlockerSeverity(issue.severity)) return false;
    return issueTargetsSection(issue, target);
  });
  return { issues: issues.map(issueEvidence) };
}

function findProjectOpenIssues(discovery) {
  const loaded = loadIssueLedger(discovery);
  if (loaded.error) return { error: loaded.error, issues: [] };
  const issues = loaded.issues.filter(isOpenOrDeferredIssue).map(issueEvidence);
  return { issues };
}

function loadIssueLedger(discovery) {
  const file = path.join(discovery.manuscriptRoot, stateRel(discovery, "issues/issue-ledger.json"));
  if (!fs.existsSync(file)) return { issues: [], error: "" };
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return { issues: Array.isArray(data.issues) ? data.issues : [], error: "" };
  } catch (error) {
    return { issues: [], error: `Could not read issue ledger: ${error.message}` };
  }
}

function findReviewFailuresForSection(discovery, sectionId, relPath, scannedState = null) {
  const scanned = scannedState ?? scanProjectReviewErrors(discovery);
  if (scanned.error) return scanned;
  const targetsSection = (record) =>
    record.section === sectionId || record.target_file === relPath || record.file.includes(sectionId) || record.file.includes(relPath);
  return {
    failures: scanned.failures.filter(targetsSection),
    run_count: scanned.runs.filter(targetsSection).length,
  };
}

function scanProjectReviewErrors(discovery) {
  try {
    return scanReviewErrors(stateRel(discovery, "reviews"), { cwd: discovery.manuscriptRoot });
  } catch (error) {
    return { failures: [], runs: [], error: `Could not scan review errors: ${error.message}` };
  }
}

function declaredReviewState({ discovery, drafts, registry }) {
  const scanned = scanProjectReviewErrors(discovery);
  const expectations = registry.errors.length ? [] : declaredReviewExpectations(drafts, registry);
  return {
    scanned,
    expectations,
    assessment: assessDeclaredReviewRuns(expectations, scanned.runs ?? []),
  };
}

function declaredReviewExpectations(drafts, registry) {
  return drafts.flatMap((draft) => {
    if (!draft.contract || draft.status === "todo") return [];
    const kind = draft.contract.get("kind") || "fiction.chapter";
    const stage = draft.contract.get("stage") || draft.status || "draft";
    return parseContractList(draft.text, "reviews").flatMap((id) => {
      const pass = registry.passById.get(id);
      if (!pass || !reviewPassApplies(pass, kind, stage)) return [];
      return [{
        section: draft.sectionId,
        file: draft.path,
        pass: id,
        kind,
        stage,
        sha256: draft.sha256,
        body_sha256: sha256Text(stripContract(draft.text)),
        definition_sha256: reviewPassDefinitionSha256(registry, id),
      }];
    });
  });
}

function declaredReviewRequirements({ discovery, options, registry, state }) {
  const coverageMode = reviewGateMode(discovery, options.profile, "declared_have_run");
  const freshnessMode = reviewGateMode(discovery, options.profile, "declared_fresh");
  const registryInvalid = registry.errors.length > 0;
  const scanError = state.scanned.error ?? "";
  const assessment = state.assessment;

  const coverage = requirement({
    id: "reviews.declared_have_run",
    severity: reviewGateSeverity(coverageMode),
    sensor: "review_coverage",
    status: reviewCoverageStatus({ mode: coverageMode, registryInvalid, scanError, assessment }),
    message: reviewCoverageMessage({ mode: coverageMode, registry, scanError, assessment }),
    evidence: {
      policy: coverageMode,
      expected_count: assessment.expected,
      missing_count: assessment.missing.length,
      missing: assessment.missing,
      registry_errors: registry.errors,
      ...(scanError ? { error: scanError } : {}),
    },
  });

  const freshness = requirement({
    id: "reviews.declared_fresh",
    severity: reviewGateSeverity(freshnessMode),
    sensor: "review_freshness",
    status: reviewFreshnessStatus({ mode: freshnessMode, registryInvalid, scanError, assessment }),
    message: reviewFreshnessMessage({ mode: freshnessMode, registry, scanError, assessment }),
    evidence: {
      policy: freshnessMode,
      expected_count: assessment.expected,
      fresh_count: assessment.fresh.length,
      stale_count: assessment.stale.length,
      unknown_count: assessment.unknown.length,
      not_run_count: assessment.missing.length,
      fresh: assessment.fresh,
      stale: assessment.stale,
      unknown: assessment.unknown,
      not_run: assessment.missing,
      registry_errors: registry.errors,
      ...(scanError ? { error: scanError } : {}),
    },
  });

  return [coverage, freshness];
}

function reviewCoverageStatus({ mode, registryInvalid, scanError, assessment }) {
  if (mode === "off" || registryInvalid || assessment.expected === 0) return "skip";
  if (scanError) return "error";
  if (!assessment.missing.length) return "pass";
  return mode === "block" ? "fail" : "warn";
}

function reviewFreshnessStatus({ mode, registryInvalid, scanError, assessment }) {
  if (mode === "off" || registryInvalid || assessment.expected === 0) return "skip";
  if (scanError) return "error";
  if (assessment.stale.length || assessment.unknown.length) return mode === "block" ? "fail" : "warn";
  if (assessment.missing.length) return "skip";
  return "pass";
}

function reviewCoverageMessage({ mode, registry, scanError, assessment }) {
  if (mode === "off") return "Declared-review coverage is disabled by gate policy.";
  if (registry.errors.length) return "Skipped because the review registry is invalid.";
  if (scanError) return scanError;
  if (!assessment.expected) return "No applicable declared review passes target active sections.";
  if (!assessment.missing.length) return `Every applicable declared review pass has a successful persisted run (${assessment.expected}/${assessment.expected}).`;
  return `Missing successful declared review runs: ${formatReviewEntries(assessment.missing)}.`;
}

function reviewFreshnessMessage({ mode, registry, scanError, assessment }) {
  if (mode === "off") return "Declared-review freshness is disabled by gate policy.";
  if (registry.errors.length) return "Skipped because the review registry is invalid.";
  if (scanError) return scanError;
  if (!assessment.expected) return "No applicable declared review passes target active sections.";
  if (assessment.stale.length || assessment.unknown.length) {
    const parts = [];
    if (assessment.stale.length) parts.push(`stale: ${formatReviewEntries(assessment.stale, { includeReason: true })}`);
    if (assessment.unknown.length) parts.push(`unknown: ${formatReviewEntries(assessment.unknown, { includeReason: true })}`);
    return `Declared review freshness needs attention — ${parts.join("; ")}.`;
  }
  if (assessment.missing.length) {
    return "Skipped until the missing declared review runs have completed successfully.";
  }
  return `Every applicable declared review pass is fresh (${assessment.fresh.length}/${assessment.expected}).`;
}

function formatReviewEntries(entries, { includeReason = false } = {}) {
  return entries
    .slice(0, 8)
    .map((entry) => `${entry.file} → ${entry.pass}${includeReason && entry.reason ? ` (${entry.reason})` : ""}`)
    .concat(entries.length > 8 ? [`…and ${entries.length - 8} more`] : [])
    .join(", ");
}

function reviewGateMode(discovery, profile, requirementId) {
  const gates = discovery.config?.gates;
  const base = gates?.reviews?.[requirementId];
  const selectedProfile = profile || DEFAULT_PROFILE;
  const profileValue = gates?.profiles?.[selectedProfile]?.reviews?.[requirementId];
  const value = profileValue ?? base ?? "warn";
  return ["off", "warn", "block"].includes(value) ? value : "warn";
}

function reviewGateSeverity(mode) {
  return mode === "block" ? "block" : "warn";
}

function issueEvidence(issue) {
  return {
    id: issue.id ?? "",
    status: issue.status ?? "",
    severity: issue.severity ?? "",
    category: issue.category ?? "",
    target: issue.target ?? null,
    claim: issue.claim ?? issue.title ?? "",
  };
}

function isOpenOrDeferredIssue(issue) {
  return issue.status === "open" || issue.status === "deferred" || issue.decision?.decision === "defer";
}

function isBlockerSeverity(severity) {
  return ["blocker", "blocking", "critical"].includes(String(severity ?? "").toLowerCase());
}

function issueTargetsSection(issue, target) {
  const file = normalizeRel(issue.target?.file ?? "");
  const sectionId = String(issue.target?.section_id ?? issue.target?.section ?? "");
  return file === target.relPath || sectionId === target.sectionId;
}

function stateDirFor(discovery) {
  return normalizeRel(discovery.config?.stateDir ?? "state");
}

function sourcesDirFor(discovery) {
  return normalizeRel(discovery.config?.sourcesDir ?? "sources");
}

function exportsDirFor(discovery) {
  return normalizeRel(discovery.config?.exportsDir ?? "exports");
}

function stateRel(discovery, rel) {
  return normalizeRel(path.posix.join(stateDirFor(discovery), rel));
}

function displayProjectPath(file, discovery) {
  return normalizeRel(path.relative(discovery.manuscriptRoot, file));
}

function hashDiscoveryConfig(discovery) {
  if (discovery.configPath) return hashFileIfExists(discovery.configPath);
  return hashJson(discovery.config ?? {});
}

function hashFileIfExists(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile() ? sha256File(file) : null;
}

function hashReviewState(discovery) {
  const root = path.join(discovery.manuscriptRoot, stateRel(discovery, "reviews"));
  if (!fs.existsSync(root)) return hashJson([]);
  const files = walkFiles(root)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      path: normalizeRel(path.relative(root, file)),
      sha256: sha256File(file),
    }));
  return hashJson(files);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function walkFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walkFiles(full) : [full];
    })
    .sort();
}

function passFail(value) {
  return value ? "pass" : "fail";
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function runId({ gateId, targetId, startedAt }) {
  const stamp = startedAt.replace(/\.\d{3}Z$/, "Z").replace(/[:.]/g, "-");
  return `gate-${stamp}-${safeId(gateId)}-${safeId(targetId)}`;
}

function safeId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "target";
}

function safePathSegment(value) {
  return safeId(value).replace(/[/:]/g, "-");
}

function isOutside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

function scopeForGate(gateId) {
  if (gateId === "section-ready") return "section";
  if (gateId === "citation-ready") return "citation";
  if (gateId === "manuscript-ready") return "manuscript";
  if (gateId === "export-ready") return "export";
  return "unknown";
}

function fallbackTarget(inferred) {
  if (inferred.gateId === "section-ready") {
    return { kind: "section", path: inferred.targetArg ?? "", id: safeId(inferred.targetArg || "section"), sha256: null };
  }
  if (inferred.gateId === "citation-ready") return { kind: "citation", id: "citations", sha256: null };
  if (inferred.gateId === "manuscript-ready") return { kind: "manuscript", id: "manuscript", sha256: null };
  if (inferred.gateId === "export-ready") return { kind: "export", id: "manuscript", path: "exports", sha256: null };
  return { kind: "unknown", id: "unknown", sha256: null };
}

function shellToken(value) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

function helpText() {
  return `gate - deterministic Manuscript Lab readiness gates

Usage:
  mlab gate [--json] [--write]                  (defaults to the manuscript gate)
  mlab gate draft/<section>.md [--json] [--write]
  mlab gate section-ready draft/<section>.md [--json] [--write]
  mlab gate citation [--json] [--write]
  mlab gate citations [--json] [--write]
  mlab gate manuscript [--json] [--write]
  mlab gate export [--formats md,html] [--json] [--write]

Options:
  --json              Print the full gate result JSON.
  --write             Persist result artifacts under state/gates/.
  --profile <name>    Select gate policy overrides (including declared-review strictness).
  --config <path>     Discover a config-first project from this config path.
  --workspace <path>  Discover a project from this workspace.
  --formats <list>    Required export formats for export-ready. Default: md,html (epub/pdf are opt-in).
  --static-only       Accepted for CI/profile compatibility; gates are deterministic by default.
  --ci                Shorthand for --json --static-only --profile ci --no-overrides.
  --help              Show this help.`;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const outcome = runGateCli(process.argv.slice(2), {
    cwd: process.cwd(),
    command: process.argv.map(shellToken).join(" "),
  });
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  process.exit(outcome.exitCode);
}
