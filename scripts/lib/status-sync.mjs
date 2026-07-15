import fs from "node:fs";
import path from "node:path";
import { ALLOWED_SECTION_STATUSES, normalizeRel, parseSectionContract, stripCode } from "./section-contract.mjs";

// Section contracts are the single source of truth for section status;
// state/status.md and outline.md are views of it. Rewrite the views' status
// entries to match the contracts and return the project-relative files that
// changed. Entries pointing at files without a parseable contract (or with an
// unsupported status) are left alone for the checks to report.
export function syncSectionStatusesFromContracts(projectRoot) {
  const changed = [];
  const contractStatus = contractStatusReader(projectRoot);

  const statusFile = path.join(projectRoot, "state/status.md");
  if (fs.existsSync(statusFile)) {
    const original = fs.readFileSync(statusFile, "utf8");
    const synced = syncStatusTable(original, contractStatus);
    if (synced !== original) {
      fs.writeFileSync(statusFile, synced, "utf8");
      changed.push("state/status.md");
    }
  }

  const outlineFile = path.join(projectRoot, "outline.md");
  if (fs.existsSync(outlineFile)) {
    const original = fs.readFileSync(outlineFile, "utf8");
    const synced = syncOutlineStatuses(original, contractStatus);
    if (synced !== original) {
      fs.writeFileSync(outlineFile, synced, "utf8");
      changed.push("outline.md");
    }
  }

  return changed;
}

function contractStatusReader(projectRoot) {
  const cache = new Map();
  return (relPath) => {
    const rel = normalizeRel(String(relPath ?? "").trim());
    if (!rel.startsWith("draft/")) return null;
    if (cache.has(rel)) return cache.get(rel);
    let status = null;
    const file = path.join(projectRoot, rel);
    if (fs.existsSync(file)) {
      const contract = parseSectionContract(fs.readFileSync(file, "utf8"));
      const value = contract?.get("status");
      if (value && ALLOWED_SECTION_STATUSES.has(value)) status = value;
    }
    cache.set(rel, status);
    return status;
  };
}

// Rewrites only the Status cell of rows whose File cell resolves to a draft
// contract, preserving every other byte of the table (including alignment
// whitespace on untouched cells and the presence/absence of edge pipes).
export function syncStatusTable(text, contractStatus) {
  const lines = String(text ?? "").split("\n");
  const headerIndex = lines.findIndex((line, index) => {
    const next = lines[index + 1] ?? "";
    return line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
  });
  if (headerIndex === -1) return text;

  const headers = splitTrimmedCells(lines[headerIndex]).map(normalizeHeader);
  const fileColumn = headers.indexOf("file");
  const statusColumn = headers.indexOf("status");
  if (fileColumn === -1 || statusColumn === -1) return text;

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("|") || !line.trim()) break;

    const hasLeadingPipe = /^\s*\|/.test(line);
    const hasTrailingPipe = /\|\s*$/.test(line);
    const inner = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
    const cells = inner.split("|");

    const filePath = stripCode(cells[fileColumn] ?? "").trim();
    if (!filePath) continue;
    const status = contractStatus(filePath);
    if (!status || status === (cells[statusColumn] ?? "").trim().toLowerCase()) continue;

    cells[statusColumn] = ` ${status} `;
    lines[index] = `${hasLeadingPipe ? "|" : ""}${cells.join("|")}${hasTrailingPipe ? "|" : ""}`;
  }
  return lines.join("\n");
}

// Rewrites the Status: line of every "### <section>" block that names a draft
// file with a parseable contract.
export function syncOutlineStatuses(text, contractStatus) {
  return String(text ?? "")
    .split(/(?=^###\s)/m)
    .map((block) => {
      if (!block.startsWith("###")) return block;
      const fileMatch = block.match(/^File:\s*`?([^`\n]+)`?\s*$/m);
      if (!fileMatch) return block;
      const status = contractStatus(fileMatch[1]);
      if (!status) return block;
      return block.replace(/^(Status:\s*)[A-Za-z-]+/m, `$1${status}`);
    })
    .join("");
}

function splitTrimmedCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
