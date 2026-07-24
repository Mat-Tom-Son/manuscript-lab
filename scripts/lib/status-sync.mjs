import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_SECTION_STATUSES,
  normalizeRel,
  parseSectionContract,
  splitMarkdownTableCells,
  splitMarkdownTableRow,
  stripCode,
  stripContract,
} from "./section-contract.mjs";

// Section contracts are the single source of truth for section status and
// membership; state/status.md and outline.md are views of them. Rewrite the
// views to match the contracts and return the project-relative files that
// changed:
// - Status entries for listed draft files are restated from their contracts.
// - Entries whose draft file no longer exists are dropped — even `todo` rows,
//   because the current draft files decide membership, so a deleted or
//   renamed section must not linger in the views.
// - Contracted draft files a view does not list are appended to it.
// Entries pointing at existing files without a parseable contract (or with an
// unsupported status) are left alone for the checks to report, and no entries
// are invented for such files.
export function syncSectionStatusesFromContracts(projectRoot) {
  const changed = [];
  const project = projectSectionView(projectRoot);

  const statusFile = path.join(projectRoot, "state/status.md");
  if (fs.existsSync(statusFile)) {
    const original = fs.readFileSync(statusFile, "utf8");
    const synced = syncStatusTable(original, project);
    if (synced !== original) {
      fs.writeFileSync(statusFile, synced, "utf8");
      changed.push("state/status.md");
    }
  }

  const outlineFile = path.join(projectRoot, "outline.md");
  if (fs.existsSync(outlineFile)) {
    const original = fs.readFileSync(outlineFile, "utf8");
    const synced = syncOutlineStatuses(original, project);
    if (synced !== original) {
      fs.writeFileSync(outlineFile, synced, "utf8");
      changed.push("outline.md");
    }
  }

  return changed;
}

// The facts both views are rebuilt from: which project files exist, what
// status each draft contract declares, and the contracted sections currently
// under draft/ (same file filter as the doccheck draft glob).
export function projectSectionView(projectRoot) {
  return {
    exists: (rel) => fs.existsSync(path.join(projectRoot, rel)),
    status: contractStatusReader(projectRoot),
    sections: contractedDraftSections(projectRoot),
  };
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

function contractedDraftSections(projectRoot) {
  const sections = new Map();
  for (const file of walkFiles(path.join(projectRoot, "draft"))) {
    const base = path.basename(file);
    if (!base.endsWith(".md") || base.startsWith("_") || base.toLowerCase() === "readme.md") continue;
    const text = fs.readFileSync(file, "utf8");
    const contract = parseSectionContract(text);
    const status = contract?.get("status");
    if (!status || !ALLOWED_SECTION_STATUSES.has(status)) continue;
    const rel = normalizeRel(path.relative(projectRoot, file));
    sections.set(rel, {
      rel,
      status,
      label: firstHeading(text) || contract.get("id") || base.replace(/\.md$/i, ""),
      purpose: contract.get("purpose") ?? "",
    });
  }
  return sections;
}

// Rewrites the table's draft rows: restates Status cells from the contracts,
// drops rows whose draft file is gone, and appends rows for contracted draft
// files the table does not list. Untouched rows keep every byte (alignment
// whitespace and the presence/absence of edge pipes); rows that do not point
// at a draft/ path are never altered.
export function syncStatusTable(text, project) {
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

  let tableEnd = headerIndex + 2;
  while (tableEnd < lines.length && lines[tableEnd].includes("|") && lines[tableEnd].trim()) tableEnd += 1;

  const listed = new Set();
  const rows = [];
  for (let index = headerIndex + 2; index < tableEnd; index += 1) {
    const line = lines[index];
    const hasLeadingPipe = /^\s*\|/.test(line);
    const hasTrailingPipe = /\|\s*$/.test(line);
    const inner = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
    const cells = splitMarkdownTableCells(inner);

    const filePath = normalizeRel(stripCode(cells[fileColumn] ?? "").trim());
    if (!filePath.startsWith("draft/")) {
      rows.push(line);
      continue;
    }
    if (!project.exists(filePath)) continue;

    listed.add(filePath);
    const status = project.status(filePath);
    if (!status || status === (cells[statusColumn] ?? "").trim().toLowerCase()) {
      rows.push(line);
      continue;
    }
    cells[statusColumn] = ` ${status} `;
    rows.push(`${hasLeadingPipe ? "|" : ""}${cells.join("|")}${hasTrailingPipe ? "|" : ""}`);
  }

  for (const section of unlistedSections(project, listed)) {
    rows.push(statusRow(headers, section));
  }

  return [...lines.slice(0, headerIndex + 2), ...rows, ...lines.slice(tableEnd)].join("\n");
}

// Rewrites the outline's "### <section>" blocks the same way: restates the
// Status: line of every block that names a draft file with a parseable
// contract, drops blocks whose File: names a draft file that is gone, and
// appends minimal blocks for contracted draft files the outline does not
// mention. Blocks without a File: line, and blocks naming non-draft files,
// are left alone.
export function syncOutlineStatuses(text, project) {
  const referenced = new Set();
  const source = String(text ?? "");
  const blocks = outlineSectionBlocks(source);
  const edits = [];

  for (const [index, block] of blocks.entries()) {
    const file = outlineFileRef(block.text);
    if (!file || !file.startsWith("draft/")) continue;
    if (!project.exists(file)) {
      const next = blocks[index + 1];
      const endBoundaryIsSection = next?.start === block.end;
      const start = endBoundaryIsSection ? block.start : precedingOutlineSeparatorStart(source, block.start);
      edits.push({ start, end: block.end, replacement: "" });
      continue;
    }

    referenced.add(file);
    const status = project.status(file);
    if (!status) continue;
    const statusMatch = block.text.match(/^(Status:\s*)([A-Za-z-]+)/m);
    if (!statusMatch || statusMatch[2] === status) continue;
    const start = block.start + statusMatch.index;
    edits.push({
      start,
      end: start + statusMatch[0].length,
      replacement: `${statusMatch[1]}${status}`,
    });
  }

  let result = applyTextEdits(source, edits);

  const additions = unlistedSections(project, referenced);
  if (additions.length) {
    result = insertOutlineBlocks(result, additions);
  }
  return result;
}

function unlistedSections(project, listed) {
  return [...project.sections.values()]
    .filter((section) => !listed.has(section.rel))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function statusRow(headers, section) {
  const cells = headers.map((header) => {
    if (header === "file") return `\`${section.rel}\``;
    if (header === "status") return section.status;
    if (header === "section") return escapeTableCell(section.label);
    if (header === "notes" || header === "purpose") return escapeTableCell(section.purpose);
    return "";
  });
  return `| ${cells.join(" | ")} |`;
}

function outlineBlock(section) {
  const purpose = section.purpose ? `\nPurpose: ${section.purpose}\n` : "";
  return `### ${section.label}\n\nStatus: ${section.status}\nFile: \`${section.rel}\`\n${purpose}`;
}

function outlineFileRef(block) {
  const match = block.match(/^File:\s*`?([^`\n]+)`?\s*$/m);
  return match ? normalizeRel(match[1].trim()) : null;
}

// A section block ends at the next peer or higher-level heading. In
// particular, an `## Editorial Notes` heading after the final section is not
// part of that section and must survive membership reconciliation.
function outlineSectionBlocks(text) {
  const headings = [...String(text ?? "").matchAll(/^(#{1,3})[ \t]+.*(?:\n|$)/gm)].map((match) => ({
    start: match.index,
    level: match[1].length,
  }));
  const blocks = [];
  for (const [index, heading] of headings.entries()) {
    if (heading.level !== 3) continue;
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= 3);
    const end = next?.start ?? text.length;
    blocks.push({ start: heading.start, end, text: text.slice(heading.start, end) });
  }
  return blocks;
}

function precedingOutlineSeparatorStart(text, blockStart) {
  const prefix = text.slice(0, blockStart);
  const match = prefix.match(/\n---[ \t]*\n(?:[ \t]*\n)*$/);
  return match ? blockStart - match[0].length : blockStart;
}

function applyTextEdits(text, rawEdits) {
  if (!rawEdits.length) return text;
  const edits = mergeDeletionEdits(rawEdits).sort((a, b) => b.start - a.start);
  let result = text;
  for (const edit of edits) {
    result = `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`;
  }
  return result;
}

function mergeDeletionEdits(edits) {
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const edit of ordered) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.replacement === "" &&
      edit.replacement === "" &&
      edit.start <= previous.end
    ) {
      previous.end = Math.max(previous.end, edit.end);
      continue;
    }
    merged.push({ ...edit });
  }
  return merged;
}

function insertOutlineBlocks(text, sections) {
  const sectionHeading = [...String(text ?? "").matchAll(/^##[ \t]+Sections[ \t]*$/gim)][0];
  let insertAt = text.length;
  if (sectionHeading) {
    const afterHeading = sectionHeading.index + sectionHeading[0].length;
    const nextPeer = text.slice(afterHeading).match(/^#{1,2}[ \t]+.*$/m);
    insertAt = nextPeer ? afterHeading + nextPeer.index : text.length;
  }

  const before = text.slice(0, insertAt).replace(/[ \t\n]*$/, "");
  const after = text.slice(insertAt).replace(/^[ \t\n]*/, "");
  const usesSeparators = /\n---[ \t]*\n/.test(before);
  const joiner = usesSeparators ? "\n\n---\n\n" : "\n\n";
  const additions = sections.map(outlineBlock).map((block) => block.trimEnd()).join(joiner);
  const prefix = before ? `${before}${joiner}` : "";
  const suffix = after ? `\n\n${after}` : "\n";
  return `${prefix}${additions}${suffix}`;
}

function firstHeading(text) {
  const match = stripContract(text).match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : "";
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

function escapeTableCell(value) {
  let result = "";
  let backslashes = 0;
  for (const character of String(value ?? "").replace(/\n/g, " ")) {
    if (character === "|" && backslashes % 2 === 0) result += "\\";
    result += character;
    if (character === "\\") backslashes += 1;
    else backslashes = 0;
  }
  return result;
}

function splitTrimmedCells(line) {
  return splitMarkdownTableRow(line);
}

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
