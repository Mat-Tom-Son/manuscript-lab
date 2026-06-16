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
export const BLOCKING_CLAIM_STATUSES = new Set(["", "unsupported", "needs-review", "disputed"]);

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
    unsupported: Boolean(options.unsupported),
    context,
  });

  const blockerCount = claims.filter((claim) => claim.blocking).length;
  return {
    ok: blockerCount === 0,
    command: "claims list",
    claims_file: displayProjectPath(context, claimsFile(context)),
    source_index: displayProjectPath(context, sources.file),
    filters: {
      unsupported: Boolean(options.unsupported),
      section: options.section ?? null,
      statuses: normalizeStatusFilters(options.statuses),
    },
    count: claims.length,
    blocker_count: blockerCount,
    claims: claims.map(publicClaim),
  };
}

export function citationsCheckCommand(options = {}) {
  const context = options.context ?? getEvidenceContext(options);
  const sources = loadSources(context);
  const allClaims = loadClaims(context, { sources });
  const targetInfo = resolveTargetInfo(context, options.target);
  const claims = filterClaimsForTarget(allClaims, targetInfo);
  const scan = scanCitationMarkers(targetInfo.files, { sources, claims: allClaims });
  const claimIssues = claimBlockerIssues(claims, context);
  const issues = [...claimIssues, ...scan.issues];
  const blockingIssueCount = issues.filter((issue) => issue.severity === "blocking").length;

  return {
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
    },
    markers: scan.markers,
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
  const claimIssues = claimBlockerIssues(claims, context);
  const issues = [...claimIssues, ...scan.issues];

  return {
    ok: issues.every((issue) => issue.severity !== "blocking"),
    command: "evidence report",
    target: targetInfo.label,
    files: targetInfo.files.map((file) => file.rel),
    claims: {
      total: claims.length,
      blocker_count: claims.filter((claim) => claim.blocking).length,
      by_status: countBy(claims, (claim) => claim.status || "missing"),
      by_risk: countBy(claims, (claim) => claim.risk || "unspecified"),
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
      cited: Array.from(new Set(scan.markers.filter((marker) => marker.resolved_type === "source").map((marker) => marker.id))).sort(),
      missing_keys: Array.from(new Set(claims.flatMap((claim) => claim.unknown_source_keys))).sort(),
    },
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
  const rows = parseMarkdownTable(text).map((row, index) => {
    const key = stripCode(firstPresent(row, ["key", "id", "source"]));
    const status = stripCode(firstPresent(row, ["status", "review_status"])).toLowerCase();
    const location = stripCode(firstPresent(row, ["location", "path", "url", "file"]));
    return {
      index,
      key,
      type: stripCode(row.type ?? ""),
      title: stripCode(row.title ?? ""),
      location,
      status,
      citation: stripCode(row.citation ?? ""),
      has_citation_column: Object.prototype.hasOwnProperty.call(row, "citation"),
      notes: stripCode(row.notes ?? ""),
      row,
    };
  });

  const keys = new Set(rows.map((row) => row.key).filter(Boolean));
  for (const match of text.matchAll(/^##\s+(.+)$/gm)) keys.add(match[1].trim());
  for (const match of text.matchAll(/^-\s+([A-Za-z0-9_.:-]+):/gm)) keys.add(match[1].trim());

  const rowsByKey = new Map(rows.filter((row) => row.key).map((row) => [row.key, row]));
  return { file, text, rows, rowsByKey, keys };
}

export function filterClaims(claims, { context, section, statuses, unsupported = false } = {}) {
  const normalizedStatuses = normalizeStatusFilters(statuses);
  const sectionMatches = makeSectionMatcher(section, context);
  return claims.filter((claim) => {
    if (unsupported && !claim.blocking) return false;
    if (normalizedStatuses.length && !normalizedStatuses.includes(claim.status || "missing")) return false;
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
      markers.push(marker);
      issues.push({
        kind: "citation_needed",
        severity: "blocking",
        message: claimId ? `Citation needed for claim "${claimId}".` : "Citation needed marker is unresolved.",
        file: file.rel,
        line: position.line,
        column: position.column,
        claim_id: claimId || null,
      });
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
        const source = sources.rowsByKey.get(id);
        marker.state = "resolved-source";
        marker.resolved_type = "source";
        markers.push(marker);
        issues.push(...sourceCitationIssues(source, marker));
        continue;
      }

      const claim = claimsById.get(id);
      if (claim) {
        marker.resolved_type = "claim";
        marker.state = claim.status === "supported" && !claim.blocking ? "resolved-claim" : "unresolved";
        markers.push(marker);
        if (marker.state !== "resolved-claim") {
          issues.push({
            kind: "unsupported_claim_cite",
            severity: "blocking",
            message: `Citation "${id}" resolves to a claim that is not fully supported.`,
            file: file.rel,
            line: marker.line,
            column: marker.column,
            claim_id: id,
          });
        }
        continue;
      }

      marker.state = "unresolved";
      markers.push(marker);
      issues.push({
        kind: "unresolved_cite",
        severity: "blocking",
        message: `Citation "${id}" does not resolve to a registered source or supported claim.`,
        file: file.rel,
        line: marker.line,
        column: marker.column,
        cite_id: id,
      });
    }
  }

  return { markers, issues };
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
  const lines = [`Claims (${result.count}, blockers ${result.blocker_count})`];
  for (const claim of result.claims) {
    const source = claim.source_keys.length ? claim.source_keys.join(", ") : "none";
    const marker = claim.blocking ? "BLOCK" : "OK";
    lines.push(`- ${marker} ${claim.status || "missing"} ${claim.section || "n/a"}: ${claim.claim || claim.id} [source: ${source}]`);
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
    `Evidence report: ${result.target}`,
    `Claims: ${result.claims.total} (${result.claims.blocker_count} blockers)`,
    `Citations: ${result.citations.total_markers} markers`,
    `Sources: ${result.sources.total_registered} registered`,
  ];
  if (result.issues.length) lines.push(`Issues: ${result.issues.length}`);
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
  const source = firstPresent(row, ["source", "sources", "evidence", "support"]);
  const sourceKeys = splitSourceKeys(source);
  const unknownSourceKeys = sourceKeys.filter((key) => !sources.keys.has(key));
  const blockerReasons = [];

  if (!status) blockerReasons.push("missing-status");
  if (status && !COMPATIBLE_CLAIM_STATUSES.has(status)) blockerReasons.push(`unsupported-status:${status}`);
  if (BLOCKING_CLAIM_STATUSES.has(status)) blockerReasons.push(status || "missing-status");
  if (status === "supported" && sourceKeys.length === 0) blockerReasons.push("missing-source-key");
  for (const key of unknownSourceKeys) blockerReasons.push(`unregistered-source:${key}`);

  return {
    index,
    id: explicitId || `claim-${index + 1}`,
    explicit_id: Boolean(explicitId),
    claim,
    section,
    source: stripCode(String(source ?? "")),
    source_keys: sourceKeys,
    unknown_source_keys: unknownSourceKeys,
    status,
    risk: stripCode(row.risk ?? "").toLowerCase(),
    notes: stripCode(row.notes ?? ""),
    blocking: blockerReasons.length > 0,
    blocker_reasons: Array.from(new Set(blockerReasons)),
    row,
  };
}

function publicClaim(claim) {
  return {
    id: claim.id,
    claim: claim.claim,
    section: claim.section,
    source: claim.source,
    source_keys: claim.source_keys,
    unknown_source_keys: claim.unknown_source_keys,
    status: claim.status,
    risk: claim.risk,
    notes: claim.notes,
    blocking: claim.blocking,
    blocker_reasons: claim.blocker_reasons,
  };
}

function claimBlockerIssues(claims, context) {
  return claims
    .filter((claim) => claim.blocking)
    .map((claim) => ({
      kind: "claim_blocker",
      severity: "blocking",
      message: `Claim "${claim.claim || claim.id}" is blocked: ${claim.blocker_reasons.join(", ")}.`,
      file: displayProjectPath(context, claimsFile(context)),
      claim_id: claim.id,
      section: claim.section || null,
      status: claim.status || "missing",
    }));
}

function sourceCitationIssues(source, marker) {
  if (!source) return [];
  const issues = [];
  if (source.status === "rejected" || source.status === "unavailable") {
    issues.push({
      kind: "unusable_source",
      severity: "blocking",
      message: `Citation "${marker.id}" resolves to a ${source.status} source.`,
      file: marker.file,
      line: marker.line,
      column: marker.column,
      source: marker.id,
    });
  }
  if (source.status === "needs-review") {
    issues.push({
      kind: "source_needs_review",
      severity: "warning",
      message: `Citation "${marker.id}" resolves to a source marked needs-review.`,
      file: marker.file,
      line: marker.line,
      column: marker.column,
      source: marker.id,
    });
  }
  if (source.has_citation_column && !source.citation) {
    issues.push({
      kind: "missing_bibliography",
      severity: "blocking",
      message: `Citation "${marker.id}" resolves to a source missing bibliography metadata.`,
      file: marker.file,
      line: marker.line,
      column: marker.column,
      source: marker.id,
    });
  }
  return issues;
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
    text = `${prefix}| Key | Type | Path | Notes |\n|---|---|---|---|\n`;
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
