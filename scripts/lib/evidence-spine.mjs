import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { discoverProtocol, displayPath, listDrafts } from "./protocol.mjs";
import {
  normalizeRel,
  parseMarkdownTable,
  parseSectionContract,
  safeId,
  sectionIdForFile,
  splitSourceKeys,
  stripCode,
} from "./section-contract.mjs";

export const COMPATIBLE_CLAIM_STATUSES = new Set(["supported", "unsupported", "needs-review", "not-needed"]);
export const V1_CLAIM_STATUSES = new Set(["discovered", "needs-review", "unsupported", "supported", "disputed", "not-needed", "withdrawn"]);
export const UNRESOLVED_CLAIM_STATUSES = new Set(["discovered", "needs-review", "unsupported"]);
export const BLOCKING_CLAIM_RISKS = new Set(["", "high", "critical"]);
export const CLAIM_RISKS = new Set(["low", "medium", "high", "critical"]);
export const SOURCE_STATUSES = new Set(["candidate", "usable", "needs-review", "rejected", "unavailable"]);
export const BLOCKING_SOURCE_STATUSES = new Set(["rejected", "unavailable"]);
const CLAIM_REQUIREMENT_IDS = [
  "evidence.claims.no_blocking_claims",
  "evidence.claims.risk_classified",
  "evidence.claims.support_precise",
  "evidence.claims.not_needed_explained",
  "evidence.claims.compatible_markdown_status",
];

export class EvidenceSpineError extends Error {
  constructor(message, { exitCode = 1 } = {}) {
    super(message);
    this.name = "EvidenceSpineError";
    this.exitCode = exitCode;
  }
}

export function getEvidenceContext(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const discovery = options.discovery ?? discoverProtocol({ cwd });
  if (!discovery.config || discovery.mode === "none") {
    throw new EvidenceSpineError((discovery.errors ?? []).join("\n") || "No Manuscript Lab project found.", { exitCode: 2 });
  }

  return {
    cwd,
    discovery,
    root: discovery.manuscriptRoot,
    stateDir: discovery.config.stateDir ?? "state",
    sourcesDir: discovery.config.sourcesDir ?? "sources",
  };
}

export function listClaimsCommand(options = {}) {
  const context = options.context ?? getEvidenceContext(options);
  const sources = loadSources(context);
  const claims = filterClaims(loadClaims(context, { sources }), {
    section: options.section,
    statuses: options.statuses,
    risks: options.risks,
    kinds: options.kinds,
    unsupported: Boolean(options.unsupported),
    context,
  });

  const blockerCount = claims.filter((claim) => claim.blocking).length;
  const issues = claimEvidenceIssues(claims, context);
  return {
    schema_version: "manuscript-lab.evidence-spine.v1",
    ok: blockerCount === 0,
    command: "claims list",
    claims_file: displayProjectPath(context, claimsFile(context)),
    source_index: displayProjectPath(context, sources.file),
    filters: {
      unsupported: Boolean(options.unsupported),
      section: options.section ?? null,
      statuses: normalizeStatusFilters(options.statuses),
      risks: normalizeListFilters(options.risks),
      kinds: normalizeListFilters(options.kinds),
    },
    count: claims.length,
    blocker_count: blockerCount,
    warning_count: issues.filter((issue) => issue.severity === "warning").length,
    issue_counts: issueCounts(issues),
    requirements: summarizeRequirements(issues, CLAIM_REQUIREMENT_IDS),
    claims: claims.map(publicClaim),
    issues,
  };
}

export function citationsCheckCommand(options = {}) {
  const context = options.context ?? getEvidenceContext(options);
  const sources = loadSources(context);
  const allClaims = loadClaims(context, { sources });
  const targetInfo = resolveTargetInfo(context, options.target);
  const claims = filterClaimsForTarget(allClaims, targetInfo);
  const scan = scanCitationMarkers(targetInfo.files, { sources, claims: allClaims });
  const claimIssues = claimEvidenceIssues(claims, context);
  const sourceIssues = sourceIssuesForTarget(context, sources, { claims, markers: scan.markers, targetInfo });
  const issues = sortIssues([...claimIssues, ...scan.issues, ...sourceIssues]);
  const blockingIssueCount = issues.filter((issue) => issue.severity === "blocking").length;

  return {
    schema_version: "manuscript-lab.evidence-spine.v1",
    ok: blockingIssueCount === 0,
    command: "citations check",
    target: targetInfo.label,
    files: targetInfo.files.map((file) => file.rel),
    counts: {
      files: targetInfo.files.length,
      markers: scan.markers.length,
      citation_needed: scan.markers.filter((marker) => marker.kind === "citation-needed").length,
      cite_markers: scan.markers.filter((marker) => marker.kind === "cite").length,
      resolved: scan.markers.filter((marker) => marker.state?.startsWith("resolved")).length,
      unresolved: scan.markers.filter((marker) => marker.state === "unresolved").length,
      issues: issues.length,
      blocking_issues: blockingIssueCount,
      warning_issues: issues.filter((issue) => issue.severity === "warning").length,
    },
    markers: scan.markers,
    issue_counts: issueCounts(issues),
    requirements: summarizeRequirements(issues, [
      "evidence.citations.no_placeholders",
      "evidence.citations.resolve_markers",
      ...CLAIM_REQUIREMENT_IDS,
      "evidence.sources.cited_usable",
      "evidence.sources.bibliography_present",
      "evidence.sources.manifest_valid",
    ]),
    issues,
  };
}

export function evidenceReportCommand(options = {}) {
  const context = options.context ?? getEvidenceContext(options);
  const sources = loadSources(context);
  const allClaims = loadClaims(context, { sources });
  const targetInfo = resolveTargetInfo(context, options.target);
  const claims = filterClaimsForTarget(allClaims, targetInfo);
  const scan = scanCitationMarkers(targetInfo.files, { sources, claims: allClaims });
  const claimIssues = claimEvidenceIssues(claims, context);
  const sourceIssues = sourceIssuesForTarget(context, sources, { claims, markers: scan.markers, targetInfo });
  const issues = sortIssues([...claimIssues, ...scan.issues, ...sourceIssues]);

  return {
    schema_version: "manuscript-lab.evidence-spine.v1",
    ok: issues.every((issue) => issue.severity !== "blocking"),
    command: "evidence report",
    target: targetInfo.label,
    files: targetInfo.files.map((file) => file.rel),
    claims: {
      total: claims.length,
      blocker_count: claims.filter((claim) => claim.blocking).length,
      warning_count: claimIssues.filter((issue) => issue.severity === "warning").length,
      by_status: countBy(claims, (claim) => claim.status || "missing"),
      by_risk: countBy(claims, (claim) => claim.risk || "unspecified"),
      by_kind: countBy(claims, (claim) => claim.kind || "unspecified"),
      by_source: countSources(claims),
    },
    citations: {
      total_markers: scan.markers.length,
      by_state: countBy(scan.markers, (marker) => marker.state || marker.kind),
      by_kind: countBy(scan.markers, (marker) => marker.kind),
    },
    sources: {
      total_registered: sources.keys.size,
      table_rows: sources.rows.length,
      by_status: countBy(Array.from(sources.recordsByKey.values()), (source) => source.status || "unspecified"),
      cited: Array.from(new Set(scan.markers.filter((marker) => marker.resolved_type === "source").map((marker) => marker.id))).sort(),
      missing_keys: Array.from(new Set(claims.flatMap((claim) => claim.unknown_source_keys))).sort(),
      issues: sourceIssues,
    },
    issue_counts: issueCounts(issues),
    requirements: summarizeRequirements(issues, [
      ...CLAIM_REQUIREMENT_IDS,
      "evidence.citations.no_placeholders",
      "evidence.citations.resolve_markers",
      "evidence.sources.cited_usable",
      "evidence.sources.bibliography_present",
      "evidence.sources.manifest_valid",
    ]),
    issues,
  };
}

export function addSourceCommand(options = {}) {
  const context = options.context ?? getEvidenceContext(options);
  const input = options.path;
  if (!input) throw new EvidenceSpineError("sources add requires a local file path.", { exitCode: 2 });
  if (/^https?:\/\//i.test(input)) {
    throw new EvidenceSpineError("sources add only supports local files in this deterministic slice.", { exitCode: 2 });
  }

  const fullPath = resolveExistingInput(context, input);
  const stat = fs.statSync(fullPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new EvidenceSpineError(`Source file not found: ${input}`, { exitCode: 1 });
  const relativeToProject = path.relative(context.root, fullPath);
  if (relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)) {
    throw new EvidenceSpineError("sources add requires the local file to live inside the manuscript root for portable v0.3 records.", {
      exitCode: 2,
    });
  }

  const checksum = sha256File(fullPath);
  const location = projectRelativePath(context, fullPath);
  const source = {
    key: safeId(path.basename(fullPath, path.extname(fullPath))),
    type: inferSourceType(fullPath),
    title: titleFromFile(fullPath),
    location,
    accessed: formatDate(options.now ?? new Date()),
    status: "candidate",
    checksum,
  };

  const upsert = upsertSourceIndex(context, source);
  return {
    ok: true,
    command: "sources add",
    action: upsert.action,
    key: upsert.key,
    path: location,
    checksum,
    source_index: displayProjectPath(context, upsert.file),
  };
}

export function loadClaims(context, { sources = loadSources(context) } = {}) {
  const file = claimsFile(context);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return parseMarkdownTable(text).map((row, index) => normalizeClaim(row, index, sources));
}

export function loadSources(context) {
  const file = sourceIndexFile(context);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const rawRows = parseMarkdownTable(text);
  const rows = rawRows.map((row, index) => normalizeSource(row, index));
  const keys = new Set(rows.map((row) => row.key).filter(Boolean));
  const keyCounts = new Map();
  const issues = [];

  for (const row of rows) {
    const key = row.key;
    if (!key) {
      if (sourceRowHasContent(row.row)) {
        issues.push(sourceIssue({
          kind: "source_missing_key",
          severity: "blocking",
          requirement_id: "evidence.sources.manifest_valid",
          message: `Source row ${row.index + 1} is missing a key.`,
          row: row.index + 1,
        }));
      }
      continue;
    }

    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    if (!/^[A-Za-z0-9_.:-]+$/.test(key)) {
      row.issues.push(sourceIssue({
        kind: "source_key_not_portable",
        severity: "blocking",
        requirement_id: "evidence.sources.manifest_valid",
        message: `Source key "${key}" is not portable. Use letters, numbers, underscore, dot, colon, or dash.`,
        source: key,
      }));
    }
    if (row.status && !SOURCE_STATUSES.has(row.status)) {
      row.issues.push(sourceIssue({
        kind: "source_status_unknown",
        severity: "warning",
        requirement_id: "evidence.sources.manifest_valid",
        message: `Source "${key}" has unknown status "${row.status}".`,
        source: key,
      }));
    }
    if (!row.status && row.has_status_column) {
      row.issues.push(sourceIssue({
        kind: "source_status_missing",
        severity: "warning",
        requirement_id: "evidence.sources.manifest_valid",
        message: `Source "${key}" has an empty status.`,
        source: key,
      }));
    }
    if (!row.location) {
      row.issues.push(sourceIssue({
        kind: "source_location_missing",
        severity: "warning",
        requirement_id: "evidence.sources.manifest_valid",
        message: `Source "${key}" is missing a location, path, URL, or file field.`,
        source: key,
      }));
    }
    issues.push(...row.issues);
  }

  for (const row of rows) {
    if (!row.key || keyCounts.get(row.key) <= 1) continue;
    row.duplicate = true;
    const issue = sourceIssue({
      kind: "source_key_duplicate",
      severity: "blocking",
      requirement_id: "evidence.sources.manifest_valid",
      message: `Source key "${row.key}" appears more than once in sources/index.md.`,
      source: row.key,
    });
    row.issues.push(issue);
    issues.push(issue);
  }

  const recordsByKey = new Map();
  for (const row of rows) {
    if (row.key && !recordsByKey.has(row.key)) recordsByKey.set(row.key, row);
  }

  for (const match of text.matchAll(/^##\s+(.+)$/gm)) {
    const key = match[1].trim();
    if (!key) continue;
    keys.add(key);
    if (!recordsByKey.has(key)) recordsByKey.set(key, legacySourceRecord(key, "heading"));
  }
  for (const match of text.matchAll(/^-\s+([A-Za-z0-9_.:-]+):\s*(.*)$/gm)) {
    const key = match[1].trim();
    if (!key) continue;
    keys.add(key);
    if (!recordsByKey.has(key)) recordsByKey.set(key, legacySourceRecord(key, "list", match[2].trim()));
  }

  const rowsByKey = recordsByKey;
  return { file, text, rows, rowsByKey, recordsByKey, keys, issues: sortIssues(issues) };
}

export function filterClaims(claims, { context, section, statuses, risks, kinds, unsupported = false } = {}) {
  const normalizedStatuses = normalizeStatusFilters(statuses);
  const normalizedRisks = normalizeListFilters(risks);
  const normalizedKinds = normalizeListFilters(kinds);
  const sectionMatches = makeSectionMatcher(section, context);
  return claims.filter((claim) => {
    if (unsupported && !claim.blocking && !UNRESOLVED_CLAIM_STATUSES.has(claim.status)) return false;
    if (normalizedStatuses.length && !normalizedStatuses.includes(claim.status || "missing")) return false;
    if (normalizedRisks.length && !normalizedRisks.includes(claim.risk || "unspecified")) return false;
    if (normalizedKinds.length && !normalizedKinds.includes(claim.kind || "unspecified")) return false;
    if (!sectionMatches(claim)) return false;
    return true;
  });
}

export function scanCitationMarkers(files, { sources, claims }) {
  const markers = [];
  const issues = [];
  const claimsById = new Map(claims.filter((claim) => claim.explicit_id).map((claim) => [claim.id, claim]));

  for (const file of files) {
    const text = fs.readFileSync(file.fullPath, "utf8");
    for (const match of text.matchAll(/\[citation-needed(?::([^\]\s]+))?\]/g)) {
      const position = lineColumn(text, match.index ?? 0);
      const claimId = match[1] ?? "";
      const marker = {
        kind: "citation-needed",
        state: claimId ? "citation-needed-claim" : "citation-needed",
        marker: match[0],
        claim_id: claimId || null,
        file: file.rel,
        ...position,
      };
      if (claimId) {
        const claim = claimsById.get(claimId);
        marker.resolved_type = claim ? "claim" : null;
        marker.resolution = claim ? claimResolution(claim) : null;
      }
      markers.push(marker);
      issues.push(evidenceIssue({
        kind: "citation_needed",
        severity: "blocking",
        requirement_id: "evidence.citations.no_placeholders",
        message: citationNeededMessage(claimId, claimsById.get(claimId)),
        file: file.rel,
        line: position.line,
        column: position.column,
        claim_id: claimId || null,
        risk: claimsById.get(claimId)?.risk || null,
        status: claimsById.get(claimId)?.status || null,
        remediation: "Resolve the placeholder with [cite:<claim-or-source>] after real support exists, or revise/remove the claim.",
      }));
    }

    for (const match of text.matchAll(/\[cite:([A-Za-z0-9_.:-]+)\]/g)) {
      const id = match[1];
      const position = lineColumn(text, match.index ?? 0);
      const marker = {
        kind: "cite",
        id,
        marker: match[0],
        file: file.rel,
        ...position,
      };

      if (sources.keys.has(id)) {
        const source = sources.recordsByKey.get(id);
        marker.state = "resolved-source";
        marker.resolved_type = "source";
        marker.resolution = sourceResolution(source, id);
        markers.push(marker);
        issues.push(...sourceCitationIssues(source, marker));
        continue;
      }

      const claim = claimsById.get(id);
      if (claim) {
        marker.resolved_type = "claim";
        marker.state = claim.status === "supported" && !claim.blocking ? "resolved-claim" : "unresolved";
        marker.resolution = claimResolution(claim);
        markers.push(marker);
        if (marker.state !== "resolved-claim") {
          issues.push(evidenceIssue({
            kind: "unsupported_claim_cite",
            severity: "blocking",
            requirement_id: "evidence.citations.resolve_markers",
            message: `Citation "${id}" resolves to claim "${claim.claim || id}", but that claim is not release-ready (${claim.issue_summary}).`,
            file: file.rel,
            line: marker.line,
            column: marker.column,
            claim_id: id,
            status: claim.status || "missing",
            risk: claim.risk || "unspecified",
            remediation: "Add adequate registered support, mark the claim not-needed with a note, or cite a registered source directly.",
          }));
        } else {
          for (const sourceKey of claim.source_keys) {
            issues.push(...sourceCitationIssues(sources.recordsByKey.get(sourceKey), marker, { sourceKey, viaClaim: claim.id }));
          }
        }
        continue;
      }

      marker.state = "unresolved";
      markers.push(marker);
      issues.push(evidenceIssue({
        kind: "unresolved_cite",
        severity: "blocking",
        requirement_id: "evidence.citations.resolve_markers",
        message: `Citation "${id}" does not resolve to a registered source key or claim ID.`,
        file: file.rel,
        line: marker.line,
        column: marker.column,
        cite_id: id,
        remediation: "Register the source in sources/index.md, cite an existing supported claim ID, or replace the marker with [citation-needed].",
      }));
    }
  }

  return { markers, issues: sortIssues(issues) };
}

export function resolveTargetInfo(context, target) {
  const files = target ? resolveTargetFiles(context, target) : listDrafts(context.discovery).map((draft) => describeDraftFile(context, draft.fullPath));
  const label = target ? normalizeRel(String(target)) : "all drafts";
  const sectionKeys = new Set();
  for (const file of files) {
    for (const key of sectionKeysForValue(file.rel)) sectionKeys.add(key);
    for (const key of sectionKeysForValue(file.sectionId)) sectionKeys.add(key);
  }
  return { label, files, sectionKeys, scoped: Boolean(target) };
}

export function renderClaimsText(result) {
  if (!result.claims.length) return "No matching claims.\n";
  const lines = [`Claims (${result.count}, blockers ${result.blocker_count}, warnings ${result.warning_count})`];
  for (const claim of result.claims) {
    const source = claim.source_keys.length ? claim.source_keys.join(", ") : "none";
    const marker = claim.blocking ? "BLOCK" : claim.needs_attention ? "WARN" : "OK";
    const risk = claim.risk || "unspecified";
    const kind = claim.kind || "unspecified";
    lines.push(`- ${marker} ${claim.status || "missing"} risk=${risk} kind=${kind} ${claim.section || "n/a"}: ${claim.claim || claim.id} [source: ${source}]`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderCitationsText(result) {
  const lines = [`Citation check: ${result.ok ? "PASS" : "FAIL"} (${result.counts.blocking_issues} blocking issues)`];
  for (const issue of result.issues) {
    lines.push(`- ${issue.severity.toUpperCase()} ${issue.file ?? "state/claims.md"}${issue.line ? `:${issue.line}` : ""}: ${issue.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderEvidenceReportText(result) {
  const lines = [
    `Evidence report: ${result.ok ? "PASS" : "FAIL"} ${result.target}`,
    `Claims: ${result.claims.total} (${result.claims.blocker_count} blockers)`,
    `Citations: ${result.citations.total_markers} markers`,
    `Sources: ${result.sources.total_registered} registered`,
  ];
  if (result.issues.length) lines.push(`Issues: ${result.issues.length} (${result.issue_counts.by_severity.blocking ?? 0} blocking, ${result.issue_counts.by_severity.warning ?? 0} warning)`);
  return `${lines.join("\n")}\n`;
}

export function renderSourceAddText(result) {
  return `${capitalize(result.action)} source ${result.key} -> ${result.path} (sha256:${result.checksum.slice(0, 12)})\n`;
}

function normalizeClaim(row, index, sources) {
  const explicitId = stripCode(firstPresent(row, ["id", "claim_id", "key"]));
  const claim = stripCode(firstPresent(row, ["claim", "statement", "text"]));
  const section = normalizeRel(stripCode(firstPresent(row, ["section", "file", "draft"])));
  const status = stripCode(row.status ?? "").toLowerCase();
  const risk = normalizeRisk(firstPresent(row, ["risk", "risk_level"]));
  const kind = stripCode(firstPresent(row, ["kind", "claim_kind", "type"])).toLowerCase();
  const locator = stripCode(firstPresent(row, ["locator", "claim_locator", "where"]));
  const source = firstPresent(row, ["source", "sources", "evidence", "support"]);
  const sourceKeys = splitSourceKeys(source);
  const unknownSourceKeys = sourceKeys.filter((key) => !sources.keys.has(key));
  const supportLocator = stripCode(firstPresent(row, ["source_locator", "evidence_locator", "support_locator", "page", "pages", "timestamp"]));
  const relation = normalizeRelation(firstPresent(row, ["relation", "support_relation"]));
  const strength = normalizeStrength(firstPresent(row, ["strength", "support_strength"]));
  const citationText = stripCode(firstPresent(row, ["citation", "citation_status", "marker"]));
  const citation = normalizeClaimCitation(citationText);
  const notes = stripCode(row.notes ?? "");
  const issues = [];

  if (!status) {
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_missing_status",
      reason: "missing-status",
      severity: "blocking",
      requirement_id: "evidence.claims.no_blocking_claims",
      message: `Claim "${claim || explicitId || `claim-${index + 1}`}" is missing a status.`,
      remediation: "Set status to supported, unsupported, needs-review, or not-needed in state/claims.md.",
    }));
  } else if (!V1_CLAIM_STATUSES.has(status)) {
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_status_unknown",
      reason: `unsupported-status:${status}`,
      severity: "blocking",
      requirement_id: "evidence.claims.no_blocking_claims",
      message: `Claim "${claim || explicitId || `claim-${index + 1}`}" has unsupported status "${status}".`,
      status,
      remediation: "Use a supported evidence status or move experimental state to future structured records.",
    }));
  } else if (!COMPATIBLE_CLAIM_STATUSES.has(status)) {
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_status_not_markdown_compatible",
      reason: `non-compatible-status:${status}`,
      severity: status === "disputed" ? "blocking" : "warning",
      requirement_id: status === "disputed" ? "evidence.claims.no_blocking_claims" : "evidence.claims.compatible_markdown_status",
      message: `Claim "${claim || explicitId || `claim-${index + 1}`}" uses v1 status "${status}" in the Markdown register; doccheck compatibility still expects supported, unsupported, needs-review, or not-needed.`,
      status,
      remediation: "Keep current Markdown registers compatible until structured v1 records are introduced.",
    }));
  }

  if (risk && !CLAIM_RISKS.has(risk)) {
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_risk_unknown",
      reason: `unknown-risk:${risk}`,
      severity: "warning",
      requirement_id: "evidence.claims.risk_classified",
      message: `Claim "${claim || explicitId || `claim-${index + 1}`}" has unknown risk "${risk}".`,
      status: status || "missing",
      risk,
      remediation: "Use low, medium, high, or critical so evidence gates can classify the claim.",
    }));
  }

  if (UNRESOLVED_CLAIM_STATUSES.has(status)) {
    const severity = unresolvedClaimSeverity(risk);
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_unresolved",
      reason: status,
      severity,
      requirement_id: "evidence.claims.no_blocking_claims",
      message: unresolvedClaimMessage({ claim, id: explicitId || `claim-${index + 1}`, status, risk, severity }),
      status,
      risk: risk || "unspecified",
      remediation: "Add support from a registered source, mark not-needed with a note, or revise/remove the claim.",
    }));
  }

  if (status === "disputed") {
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_disputed",
      reason: "disputed",
      severity: "blocking",
      requirement_id: "evidence.claims.no_blocking_claims",
      message: `Claim "${claim || explicitId || `claim-${index + 1}`}" is disputed and cannot be release-ready.`,
      status,
      risk: risk || "unspecified",
      remediation: "Revise the prose to match the available support or resolve the source conflict.",
    }));
  }

  if (status === "supported" && sourceKeys.length === 0) {
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_supported_missing_source",
      reason: "missing-source-key",
      severity: "blocking",
      requirement_id: "evidence.claims.no_blocking_claims",
      message: `Supported claim "${claim || explicitId || `claim-${index + 1}`}" is missing a source key.`,
      status,
      risk: risk || "unspecified",
      remediation: "Add at least one registered source key or change the status.",
    }));
  }

  for (const key of unknownSourceKeys) {
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_source_unregistered",
      reason: `unregistered-source:${key}`,
      severity: "blocking",
      requirement_id: "evidence.claims.no_blocking_claims",
      message: `Claim "${claim || explicitId || `claim-${index + 1}`}" references unregistered source "${key}".`,
      status,
      risk: risk || "unspecified",
      source: key,
      remediation: "Register the source in sources/index.md or remove the source key from the claim.",
    }));
  }

  if (status === "supported") {
    for (const key of sourceKeys.filter((sourceKey) => sources.keys.has(sourceKey))) {
      const sourceRecord = sources.recordsByKey.get(key);
      if (BLOCKING_SOURCE_STATUSES.has(sourceRecord?.status)) {
        issues.push(claimIssue({
          claimId: explicitId || `claim-${index + 1}`,
          claim,
          kind: "claim_source_unusable",
          reason: `source-${sourceRecord.status}:${key}`,
          severity: "blocking",
          requirement_id: "evidence.claims.no_blocking_claims",
          message: `Claim "${claim || explicitId || `claim-${index + 1}`}" is supported by source "${key}", but that source is ${sourceRecord.status}.`,
          status,
          risk: risk || "unspecified",
          source: key,
          remediation: "Replace the source, update the source status after review, or revise the claim.",
        }));
      } else if (["candidate", "needs-review"].includes(sourceRecord?.status)) {
        issues.push(claimIssue({
          claimId: explicitId || `claim-${index + 1}`,
          claim,
          kind: "claim_source_needs_review",
          reason: `source-${sourceRecord.status}:${key}`,
          severity: "warning",
          requirement_id: "evidence.sources.cited_usable",
          message: `Claim "${claim || explicitId || `claim-${index + 1}`}" uses source "${key}" while the source is ${sourceRecord.status}.`,
          status,
          risk: risk || "unspecified",
          source: key,
          remediation: "Review the source and mark it usable when appropriate.",
        }));
      }
    }
    if (sourceKeys.length && !supportLocator && !notes) {
      issues.push(claimIssue({
        claimId: explicitId || `claim-${index + 1}`,
        claim,
        kind: "claim_support_locator_missing",
        reason: "missing-support-locator",
        severity: "warning",
        requirement_id: "evidence.claims.support_precise",
        message: `Supported claim "${claim || explicitId || `claim-${index + 1}`}" has source keys but no support locator or note.`,
        status,
        risk: risk || "unspecified",
        remediation: "Add a page, section, timestamp, table, or note specific enough for another reader to inspect.",
      }));
    }
  }

  if (status === "not-needed" && !notes) {
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_not_needed_missing_note",
      reason: "not-needed-missing-note",
      severity: "warning",
      requirement_id: "evidence.claims.not_needed_explained",
      message: `Claim "${claim || explicitId || `claim-${index + 1}`}" is marked not-needed without a note.`,
      status,
      risk: risk || "unspecified",
      remediation: "Add a short note explaining why external support is unnecessary.",
    }));
  }

  if (citation.status === "missing" && status !== "withdrawn") {
    issues.push(claimIssue({
      claimId: explicitId || `claim-${index + 1}`,
      claim,
      kind: "claim_citation_missing",
      reason: "missing-citation",
      severity: unresolvedClaimSeverity(risk),
      requirement_id: "evidence.citations.no_placeholders",
      message: `Claim "${claim || explicitId || `claim-${index + 1}`}" records a missing citation marker.`,
      status,
      risk: risk || "unspecified",
      remediation: "Resolve the citation marker in the draft once support is available.",
    }));
  }

  const support = sourceKeys.map((key) => {
    const sourceRecord = sources.recordsByKey.get(key);
    return {
      source: key,
      locator: supportLocator,
      relation,
      strength,
      source_status: sourceRecord?.status || (sources.keys.has(key) ? "registered" : "unregistered"),
    };
  });

  const blockerReasons = issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.reason).filter(Boolean);
  const warningReasons = issues.filter((issue) => issue.severity === "warning").map((issue) => issue.reason).filter(Boolean);
  const severity = blockerReasons.length ? "blocking" : warningReasons.length ? "warning" : "ok";

  return {
    schema_version: 1,
    index,
    id: explicitId || `claim-${index + 1}`,
    explicit_id: Boolean(explicitId),
    claim,
    section,
    locator,
    kind,
    source: stripCode(String(source ?? "")),
    source_keys: sourceKeys,
    unknown_source_keys: unknownSourceKeys,
    support,
    status,
    risk,
    citation,
    notes,
    severity,
    blocking: blockerReasons.length > 0,
    needs_attention: issues.length > 0,
    blocker_reasons: Array.from(new Set(blockerReasons)),
    warning_reasons: Array.from(new Set(warningReasons)),
    issue_summary: [...new Set([...blockerReasons, ...warningReasons])].join(", ") || "ok",
    issues: sortIssues(issues),
    row,
  };
}

function publicClaim(claim) {
  return {
    schema_version: claim.schema_version,
    id: claim.id,
    claim: claim.claim,
    section: claim.section,
    locator: claim.locator,
    kind: claim.kind,
    source: claim.source,
    source_keys: claim.source_keys,
    unknown_source_keys: claim.unknown_source_keys,
    support: claim.support,
    status: claim.status,
    risk: claim.risk,
    citation: claim.citation,
    notes: claim.notes,
    severity: claim.severity,
    blocking: claim.blocking,
    needs_attention: claim.needs_attention,
    blocker_reasons: claim.blocker_reasons,
    warning_reasons: claim.warning_reasons,
    issue_summary: claim.issue_summary,
  };
}

function claimEvidenceIssues(claims, context) {
  return sortIssues(
    claims.flatMap((claim) => {
      const issues = claim.issues.map((issue) => ({
        ...issue,
        file: displayProjectPath(context, claimsFile(context)),
        claim_id: claim.id,
        section: claim.section || null,
        status: claim.status || "missing",
        risk: claim.risk || "unspecified",
      }));
      if (claim.blocking) {
        issues.push(evidenceIssue({
          kind: "claim_blocker",
          severity: "blocking",
          requirement_id: "evidence.claims.no_blocking_claims",
          message: `Claim "${claim.claim || claim.id}" is blocked: ${claim.issue_summary}.`,
          file: displayProjectPath(context, claimsFile(context)),
          claim_id: claim.id,
          section: claim.section || null,
          status: claim.status || "missing",
          risk: claim.risk || "unspecified",
          remediation: "Resolve the underlying claim support issue before release.",
        }));
      }
      return issues;
    }),
  );
}

function sourceCitationIssues(source, marker, { sourceKey = marker.id, viaClaim = "" } = {}) {
  if (!source) return [];
  const issues = [];
  const issueBase = {
    file: marker.file,
    line: marker.line,
    column: marker.column,
    source: sourceKey,
    claim_id: viaClaim || null,
  };
  if (source.duplicate) {
    issues.push(evidenceIssue({
      ...issueBase,
      kind: "source_key_duplicate",
      severity: "blocking",
      requirement_id: "evidence.sources.manifest_valid",
      message: `Citation "${marker.id}" resolves to duplicate source key "${sourceKey}".`,
      remediation: "Make source keys unique in sources/index.md.",
    }));
  }
  if (source.legacy) {
    issues.push(evidenceIssue({
      ...issueBase,
      kind: "source_legacy_metadata",
      severity: "warning",
      requirement_id: "evidence.sources.manifest_valid",
      message: `Citation "${marker.id}" resolves to legacy source key "${sourceKey}" without table metadata.`,
      remediation: "Add a source table row with type, location, status, and bibliography metadata when publication citations are required.",
    }));
  }
  if (source.status === "rejected" || source.status === "unavailable") {
    issues.push(evidenceIssue({
      ...issueBase,
      kind: "unusable_source",
      severity: "blocking",
      requirement_id: "evidence.sources.cited_usable",
      message: `Citation "${marker.id}" resolves to source "${sourceKey}", but that source is ${source.status}.`,
      source_status: source.status,
      remediation: "Use a usable source, update the source status after review, or remove the citation.",
    }));
  }
  if (source.status === "candidate" || source.status === "needs-review") {
    issues.push(evidenceIssue({
      ...issueBase,
      kind: source.status === "candidate" ? "source_candidate" : "source_needs_review",
      severity: "warning",
      requirement_id: "evidence.sources.cited_usable",
      message: `Citation "${marker.id}" resolves to source "${sourceKey}", which is marked ${source.status}.`,
      source_status: source.status,
      remediation: "Review the source and mark it usable when appropriate.",
    }));
  }
  if (source.has_bibliography_column && !source.bibliography) {
    issues.push(evidenceIssue({
      ...issueBase,
      kind: "missing_bibliography",
      severity: "blocking",
      requirement_id: "evidence.sources.bibliography_present",
      message: `Citation "${marker.id}" resolves to source "${sourceKey}", but that source is missing bibliography metadata.`,
      remediation: "Fill the Citation or Bibliography field in sources/index.md.",
    }));
  }
  return sortIssues(issues);
}

function normalizeSource(row, index) {
  const key = stripCode(firstPresent(row, ["key", "id", "source"]));
  const status = stripCode(firstPresent(row, ["status", "review_status"])).toLowerCase();
  const location = stripCode(firstPresent(row, ["location", "path", "url", "file"]));
  const bibliography = stripCode(firstPresent(row, ["bibliography", "citation", "reference"]));
  const hasBibliographyColumn = ["bibliography", "citation", "reference"].some((field) => Object.prototype.hasOwnProperty.call(row, field));
  const hasStatusColumn = ["status", "review_status"].some((field) => Object.prototype.hasOwnProperty.call(row, field));
  return {
    schema_version: 1,
    index,
    key,
    type: stripCode(firstPresent(row, ["type", "kind"])),
    title: stripCode(firstPresent(row, ["title", "name"])),
    authors: stripCode(firstPresent(row, ["authors", "author"])),
    publisher: stripCode(row.publisher ?? ""),
    date: stripCode(firstPresent(row, ["date", "published", "publication_date"])),
    url: stripCode(row.url ?? ""),
    path: stripCode(firstPresent(row, ["path", "file"])),
    location,
    accessed_at: stripCode(firstPresent(row, ["accessed_at", "accessed", "access_date"])),
    status,
    bibliography,
    citation: bibliography,
    has_bibliography_column: hasBibliographyColumn,
    has_citation_column: hasBibliographyColumn,
    has_status_column: hasStatusColumn,
    checksum: stripCode(firstPresent(row, ["checksum", "sha256"])),
    rights: stripCode(firstPresent(row, ["rights", "license"])),
    reliability_notes: stripCode(firstPresent(row, ["reliability_notes", "reliability", "quality"])),
    notes: stripCode(row.notes ?? ""),
    duplicate: false,
    legacy: false,
    origin: "table",
    issues: [],
    row,
  };
}

function legacySourceRecord(key, origin, notes = "") {
  return {
    schema_version: 1,
    index: -1,
    key,
    type: "",
    title: "",
    authors: "",
    publisher: "",
    date: "",
    url: "",
    path: "",
    location: "",
    accessed_at: "",
    status: "",
    bibliography: "",
    citation: "",
    has_bibliography_column: false,
    has_citation_column: false,
    has_status_column: false,
    checksum: "",
    rights: "",
    reliability_notes: "",
    notes,
    duplicate: false,
    legacy: true,
    origin,
    issues: [],
    row: {},
  };
}

function sourceRowHasContent(row) {
  return Object.values(row ?? {}).some((value) => stripCode(String(value ?? "")));
}

function sourceIssuesForTarget(context, sources, { claims = [], markers = [], targetInfo = null } = {}) {
  const relevantKeys = new Set();
  for (const claim of claims) {
    for (const key of claim.source_keys) relevantKeys.add(key);
  }
  for (const marker of markers) {
    if (marker.resolved_type === "source" && marker.id) relevantKeys.add(marker.id);
    if (marker.resolved_type === "claim") {
      for (const key of marker.resolution?.source_keys ?? []) relevantKeys.add(key);
    }
  }

  const includeAll = !targetInfo?.scoped;
  const issues = [];
  for (const issue of sources.issues ?? []) {
    if (!includeAll && issue.source && !relevantKeys.has(issue.source)) continue;
    issues.push({
      ...issue,
      file: displayProjectPath(context, sources.file),
    });
  }
  return sortIssues(issues);
}

function claimResolution(claim) {
  return {
    type: "claim",
    id: claim.id,
    status: claim.status || "missing",
    risk: claim.risk || "unspecified",
    kind: claim.kind || "unspecified",
    section: claim.section || "",
    source_keys: claim.source_keys,
    blocking: claim.blocking,
    needs_attention: claim.needs_attention,
    issue_summary: claim.issue_summary,
  };
}

function sourceResolution(source, id) {
  return {
    type: "source",
    id,
    status: source?.status || "unspecified",
    title: source?.title || "",
    type_label: source?.type || "",
    location: source?.location || "",
    bibliography: source?.bibliography || "",
    legacy: Boolean(source?.legacy),
    duplicate: Boolean(source?.duplicate),
  };
}

function citationNeededMessage(claimId, claim) {
  if (!claimId) return "Citation-needed marker is unresolved.";
  if (!claim) return `Citation-needed marker references unknown claim "${claimId}".`;
  return `Citation needed for claim "${claimId}" (${claim.status || "missing"}, risk ${claim.risk || "unspecified"}).`;
}

function normalizeRisk(value) {
  const risk = stripCode(String(value ?? "")).toLowerCase();
  return CLAIM_RISKS.has(risk) ? risk : risk;
}

function unresolvedClaimSeverity(risk) {
  if (!risk || !CLAIM_RISKS.has(risk)) return "blocking";
  return BLOCKING_CLAIM_RISKS.has(risk) ? "blocking" : "warning";
}

function unresolvedClaimMessage({ claim, id, status, risk, severity }) {
  const riskText = risk || "unspecified";
  const lead = severity === "blocking" ? "blocks release" : "needs evidence review";
  return `Claim "${claim || id}" is ${status} with ${riskText} risk and ${lead}.`;
}

function normalizeRelation(value) {
  const relation = stripCode(String(value ?? "")).toLowerCase();
  return ["supports", "partially-supports", "contradicts", "background"].includes(relation) ? relation : "supports";
}

function normalizeStrength(value) {
  const strength = stripCode(String(value ?? "")).toLowerCase();
  return ["strong", "moderate", "weak"].includes(strength) ? strength : "";
}

function normalizeClaimCitation(value) {
  const raw = String(value ?? "").trim();
  const lowered = raw.toLowerCase();
  let state = raw ? "recorded" : "";
  if (/\[citation-needed(?::[^\]]+)?\]/i.test(raw) || ["missing", "needed", "required", "citation-needed"].includes(lowered)) {
    state = "missing";
  } else if (/\[cite:[^\]]+\]/i.test(raw) || ["resolved", "cited", "present"].includes(lowered)) {
    state = "resolved";
  }
  return {
    required: state !== "" || raw !== "",
    state,
    status: state,
    marker: raw,
  };
}

function claimIssue({
  claimId,
  claim,
  kind,
  reason,
  severity,
  requirement_id,
  message,
  status = null,
  risk = null,
  source = null,
  remediation = "",
}) {
  return evidenceIssue({
    kind,
    severity,
    requirement_id,
    message,
    claim_id: claimId,
    claim: claim || "",
    reason,
    status,
    risk,
    source,
    remediation,
  });
}

function sourceIssue({ kind, severity, requirement_id, message, source = null, row = null, remediation = "" }) {
  return evidenceIssue({ kind, severity, requirement_id, message, source, row, remediation });
}

function evidenceIssue(issue) {
  const normalized = {
    kind: issue.kind,
    severity: issue.severity,
    requirement_id: issue.requirement_id,
    message: issue.message,
    remediation: issue.remediation || "",
    ...Object.fromEntries(Object.entries(issue).filter(([key, value]) => !["kind", "severity", "requirement_id", "message", "remediation"].includes(key) && value != null && value !== "")),
  };
  normalized.issue_key = issueKey(normalized);
  return normalized;
}

function issueKey(issue) {
  return safeId([
    issue.requirement_id,
    issue.kind,
    issue.claim_id,
    issue.source,
    issue.cite_id,
    issue.file,
    issue.line,
    issue.row,
  ].filter(Boolean).join(":"));
}

function issueCounts(issues) {
  return {
    total: issues.length,
    by_severity: countBy(issues, (issue) => issue.severity || "unspecified"),
    by_kind: countBy(issues, (issue) => issue.kind || "unspecified"),
    by_requirement: countBy(issues, (issue) => issue.requirement_id || "unspecified"),
  };
}

function summarizeRequirements(issues, ids) {
  return ids.map((id) => {
    const matching = issues.filter((issue) => issue.requirement_id === id);
    const blocking = matching.filter((issue) => issue.severity === "blocking");
    const warnings = matching.filter((issue) => issue.severity === "warning");
    return {
      id,
      status: blocking.length ? "fail" : warnings.length ? "warn" : "pass",
      blocking: blocking.length,
      warnings: warnings.length,
      issue_keys: matching.map((issue) => issue.issue_key).sort(),
      message: requirementMessage(id, { blocking: blocking.length, warnings: warnings.length }),
    };
  });
}

function requirementMessage(id, { blocking, warnings }) {
  if (blocking) return `${id} has ${blocking} blocking issue(s).`;
  if (warnings) return `${id} has ${warnings} warning issue(s).`;
  return `${id} passed.`;
}

function sortIssues(issues) {
  const unique = [];
  const seen = new Set();
  for (const issue of issues) {
    const key = issue.issue_key || JSON.stringify(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique.sort((left, right) => {
    const severityOrder = severityRank(left.severity) - severityRank(right.severity);
    if (severityOrder) return severityOrder;
    return String(left.issue_key ?? "").localeCompare(String(right.issue_key ?? ""));
  });
}

function severityRank(severity) {
  if (severity === "blocking") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function filterClaimsForTarget(claims, targetInfo) {
  if (!targetInfo?.scoped || !targetInfo.sectionKeys?.size) return claims;
  return claims.filter((claim) => claimMatchesSectionKeys(claim, targetInfo.sectionKeys));
}

function makeSectionMatcher(section, context) {
  if (!section) return () => true;
  const keys = new Set(sectionKeysForValue(section));
  if (context) {
    const resolved = resolveMaybeInput(context, section);
    if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const descriptor = describeDraftFile(context, resolved);
      for (const key of sectionKeysForValue(descriptor.rel)) keys.add(key);
      for (const key of sectionKeysForValue(descriptor.sectionId)) keys.add(key);
    }
  }
  return (claim) => claimMatchesSectionKeys(claim, keys);
}

function claimMatchesSectionKeys(claim, keys) {
  if (!keys.size) return true;
  const claimKeys = sectionKeysForValue(claim.section);
  return claimKeys.some((key) => keys.has(key));
}

function sectionKeysForValue(value) {
  const raw = stripCode(String(value ?? "")).trim();
  if (!raw) return [];
  const normalized = normalizeRel(raw);
  const withoutExtension = normalized.replace(/\.[A-Za-z0-9]+$/, "");
  const base = path.posix.basename(withoutExtension);
  return Array.from(
    new Set([
      raw.toLowerCase(),
      normalized.toLowerCase(),
      withoutExtension.toLowerCase(),
      base.toLowerCase(),
      safeId(raw),
      safeId(normalized),
      safeId(withoutExtension),
      safeId(base),
    ].filter(Boolean)),
  );
}

function resolveTargetFiles(context, target) {
  const full = resolveExistingInput(context, target);
  const stat = fs.statSync(full);
  if (stat.isDirectory()) return walkMarkdown(full).map((file) => describeDraftFile(context, file));
  if (stat.isFile()) return [describeDraftFile(context, full)];
  throw new EvidenceSpineError(`Target is not a file or directory: ${target}`, { exitCode: 1 });
}

function describeDraftFile(context, fullPath) {
  const rel = projectRelativePath(context, fullPath);
  const text = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
  const contract = parseSectionContract(text);
  return {
    rel,
    fullPath,
    sectionId: sectionIdForFile(rel, contract),
    status: contract?.get("status") ?? "",
  };
}

function resolveExistingInput(context, input) {
  const resolved = resolveMaybeInput(context, input);
  if (!resolved || !fs.existsSync(resolved)) throw new EvidenceSpineError(`Path not found: ${input}`, { exitCode: 1 });
  return resolved;
}

function resolveMaybeInput(context, input) {
  if (!input) return null;
  if (path.isAbsolute(input)) return path.resolve(input);
  const projectCandidate = path.resolve(context.root, input);
  if (fs.existsSync(projectCandidate)) return projectCandidate;
  const cwdCandidate = path.resolve(context.cwd, input);
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;
  return projectCandidate;
}

function walkMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(full));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (entry.name.startsWith("_") || entry.name.toLowerCase() === "readme.md") continue;
    out.push(full);
  }
  return out;
}

function upsertSourceIndex(context, source) {
  const file = sourceIndexFile(context);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!findMarkdownTable(text)) {
    const prefix = text.trim() ? `${text.trimEnd()}\n\n` : "# Source Index\n\n";
    text = `${prefix}| Key | Type | Title | Location | Accessed | Status | Citation | Notes |\n|---|---|---|---|---|---|---|---|\n`;
  }

  const table = findMarkdownTable(text);
  const rows = table.rows.map((row) => ({ cells: [...row.cells] }));
  const existingKeys = new Set(rows.map((row) => stripCode(getRawCell(table, row, ["key", "id"]))).filter(Boolean));
  let matchedIndex = rows.findIndex((row) => rowMatchesSource(table, row, source));
  let matched = matchedIndex === -1 ? null : rows[matchedIndex];
  let key = matched ? stripCode(getRawCell(table, matched, ["key", "id"])) || source.key : source.key;
  if (!matched && existingKeys.has(key)) key = uniqueKey(key, existingKeys);

  if (!matched) {
    matched = { cells: table.headers.map(() => "") };
    rows.push(matched);
    matchedIndex = rows.length - 1;
  }

  const action = matchedIndex < table.rows.length ? "updated" : "added";
  setKnownSourceCells(table, matched, { ...source, key });
  const rendered = renderMarkdownTable(table.headers, rows.map((row) => row.cells));
  const lines = text.split("\n");
  const next = [...lines.slice(0, table.start), ...rendered.split("\n"), ...lines.slice(table.end)];
  fs.writeFileSync(file, `${next.join("\n").replace(/\n*$/, "")}\n`, "utf8");
  return { file, key, action };
}

function rowMatchesSource(table, row, source) {
  const key = stripCode(getRawCell(table, row, ["key", "id"]));
  const location = normalizeRel(stripCode(getRawCell(table, row, ["location", "path", "url", "file"])));
  const checksum = stripCode(getRawCell(table, row, ["checksum", "sha256"]));
  const notes = getRawCell(table, row, ["notes"]);
  if (location && location === source.location) return true;
  if (checksum && checksum === source.checksum) return true;
  if (notes.includes(source.checksum)) return true;
  if (key && key === source.key && (!location || location === source.location)) return true;
  return false;
}

function setKnownSourceCells(table, row, source) {
  setRawCell(table, row, ["key", "id"], codeCell(source.key));
  setRawCell(table, row, ["type"], currentOr(row, table, ["type"], source.type));
  setRawCell(table, row, ["title"], currentOr(row, table, ["title"], source.title));
  setRawCell(table, row, ["path"], codeCell(source.location));
  setRawCell(table, row, ["location"], codeCell(source.location));
  setRawCell(table, row, ["accessed", "access_date"], currentOr(row, table, ["accessed", "access_date"], source.accessed));
  setRawCell(table, row, ["status"], currentOr(row, table, ["status"], source.status));
  setRawCell(table, row, ["checksum", "sha256"], source.checksum);

  const notesIndex = headerIndex(table, ["notes"]);
  if (notesIndex !== -1) row.cells[notesIndex] = ensureChecksumNote(row.cells[notesIndex] ?? "", source.checksum);
}

function currentOr(row, table, names, fallback) {
  const current = getRawCell(table, row, names);
  return current ? current : fallback;
}

function findMarkdownTable(text) {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|") || !isTableSeparator(lines[index + 1])) continue;
    let end = index + 2;
    while (end < lines.length && lines[end].includes("|") && lines[end].trim()) end += 1;
    const headers = splitTableRow(lines[index]);
    const rows = [];
    for (let rowIndex = index + 2; rowIndex < end; rowIndex += 1) rows.push({ cells: splitTableRow(lines[rowIndex]) });
    return { start: index, end, headers, rows };
  }
  return null;
}

function renderMarkdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((cells) => `| ${headers.map((_, index) => escapeTableCell(cells[index] ?? "")).join(" | ")} |`),
  ].join("\n");
}

function getRawCell(table, row, names) {
  const index = headerIndex(table, names);
  return index === -1 ? "" : row.cells[index] ?? "";
}

function setRawCell(table, row, names, value) {
  const index = headerIndex(table, names);
  if (index !== -1) row.cells[index] = value;
}

function headerIndex(table, names) {
  const normalized = new Set(names.map(normalizeHeaderName));
  return table.headers.findIndex((header) => normalized.has(normalizeHeaderName(header)));
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function normalizeHeaderName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function codeCell(value) {
  return `\`${String(value).replace(/`/g, "")}\``;
}

function escapeTableCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function ensureChecksumNote(value, checksum) {
  const text = String(value ?? "").trim();
  if (!text) return `sha256:${checksum}`;
  if (/sha256:[a-f0-9]{64}/i.test(text)) return text.replace(/sha256:[a-f0-9]{64}/i, `sha256:${checksum}`);
  return `${text}; sha256:${checksum}`;
}

function firstPresent(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function normalizeStatusFilters(statuses) {
  return [statuses ?? []]
    .flat()
    .flatMap((status) => String(status).split(","))
    .map((status) => status.trim().toLowerCase())
    .map((status) => (status === "missing-status" ? "missing" : status))
    .filter(Boolean);
}

function normalizeListFilters(values) {
  return [values ?? []]
    .flat()
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || "unspecified";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return sortObject(counts);
}

function countSources(claims) {
  const counts = {};
  for (const claim of claims) {
    for (const key of claim.source_keys) counts[key] = (counts[key] ?? 0) + 1;
  }
  return sortObject(counts);
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}

function uniqueKey(base, existingKeys) {
  for (let index = 2; ; index += 1) {
    const key = `${base}-${index}`;
    if (!existingKeys.has(key)) return key;
  }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function inferSourceType(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if ([".md", ".markdown", ".txt"].includes(extension)) return "notes";
  if ([".csv", ".tsv", ".json", ".xlsx"].includes(extension)) return "dataset";
  if ([".mp3", ".mp4", ".mov", ".wav"].includes(extension)) return "media";
  return "file";
}

function titleFromFile(file) {
  const base = path.basename(file, path.extname(file)).replace(/[-_]+/g, " ").trim();
  return base ? base.replace(/\b\w/g, (char) => char.toUpperCase()) : path.basename(file);
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function lineColumn(text, index) {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  return { line, column: index - lastBreak };
}

function claimsFile(context) {
  return path.join(context.root, context.stateDir, "claims.md");
}

function sourceIndexFile(context) {
  return path.join(context.root, context.sourcesDir, "index.md");
}

function projectRelativePath(context, file) {
  const relative = path.relative(context.root, file);
  return normalizeRel(relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file);
}

function displayProjectPath(context, file) {
  return displayPath(file, context.root);
}

function capitalize(value) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
