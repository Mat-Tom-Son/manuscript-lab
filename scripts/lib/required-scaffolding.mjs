import fs from "node:fs";
import path from "node:path";

// Single source of truth for the REQUIRED project scaffolding.
// scripts/doccheck.mjs validates against these lists and `mlab check --fix`
// creates missing entries from them; scripts/install-init.mjs writes the same
// state files at init time, so the two surfaces cannot drift.

export const TRUTH_STATE_SCHEMA_VERSION = "manuscript-lab.truth-state.v1";
export const ISSUE_DECISIONS_SCHEMA_VERSION = "manuscript-lab.issue-decisions.v1";
export const ISSUE_CLOSED_SCHEMA_VERSION = "manuscript-lab.issue-closed.v1";

export const REQUIRED_PROJECT_DIRS = Object.freeze([
  "draft",
  "sources",
  "state",
  "state/revision-audits",
  "state/reviews",
  "state/issues",
  "state/candidates",
  "state/revision-plans",
  "state/runtime",
  "state/truth",
  "state/projections",
  "state/observations",
]);

export const REQUIRED_PROJECT_FILES = Object.freeze([
  "PROJECT.md",
  "brief.md",
  "outline.md",
  "style.md",
  "state/status.md",
  "state/continuity.md",
  "state/claims.md",
  "state/open-questions.md",
  "sources/index.md",
  "state/issues/README.md",
  "state/issues/issue-ledger.json",
  "state/issues/decisions.json",
  "state/issues/closed.json",
  "state/revision-plans/README.md",
  "state/revision-audits/README.md",
  "state/reviews/README.md",
  "state/candidates/README.md",
  "state/runtime/README.md",
  "state/truth/README.md",
  "state/truth/entities.json",
  "state/truth/threads.json",
  "state/truth/claims.json",
  "state/truth/sources.json",
  "state/truth/terms.json",
  "state/truth/style.json",
  "state/truth/artifacts.json",
  "state/projections/README.md",
  "state/observations/README.md",
]);

export const REQUIRED_STATE_READMES = Object.freeze({
  "state/issues/README.md": "Issue ledger artifacts live here.\n",
  "state/revision-plans/README.md": "Revision plan artifacts live here.\n",
  "state/revision-audits/README.md": "Revision diff audit artifacts live here.\n",
  "state/reviews/README.md": "Review run artifacts live here.\n",
  "state/candidates/README.md": "Revision candidate arena artifacts live here.\n",
  "state/runtime/README.md": "Composed runtime packets live here.\n",
  "state/truth/README.md": "Structured truth state lives here.\n",
  "state/projections/README.md": "Human-readable truth projections live here.\n",
  "state/observations/README.md": "Observation artifacts live here.\n",
});

export function issueStateFileContents() {
  return {
    "state/issues/issue-ledger.json": { version: 1, next_id: 1, issues: [] },
    "state/issues/decisions.json": { schema_version: ISSUE_DECISIONS_SCHEMA_VERSION, version: 1, decisions: [] },
    "state/issues/closed.json": { schema_version: ISSUE_CLOSED_SCHEMA_VERSION, version: 1, closed: [] },
  };
}

export function truthStateFileContents() {
  return {
    "state/truth/entities.json": { schema_version: TRUTH_STATE_SCHEMA_VERSION, entities: [] },
    "state/truth/threads.json": { schema_version: TRUTH_STATE_SCHEMA_VERSION, threads: [] },
    "state/truth/claims.json": { schema_version: TRUTH_STATE_SCHEMA_VERSION, claims: [] },
    "state/truth/sources.json": { schema_version: TRUTH_STATE_SCHEMA_VERSION, sources: [] },
    "state/truth/terms.json": { schema_version: TRUTH_STATE_SCHEMA_VERSION, terms: [] },
    "state/truth/artifacts.json": { schema_version: TRUTH_STATE_SCHEMA_VERSION, artifacts: [] },
    "state/truth/style.json": {
      schema_version: TRUTH_STATE_SCHEMA_VERSION,
      style_profile: {
        summary: "",
        protected_strengths: [],
        watch_patterns: [],
        avoid: [],
        register_balance: {},
      },
    },
  };
}

const MARKDOWN_STUBS = Object.freeze({
  "PROJECT.md": "# Project Supplement\n\nKeep project-specific operating notes here; they load after the generic\nManuscript Lab instructions.\n",
  "brief.md": "# Brief\n\nName the document goal, audience, constraints, and success criteria.\n",
  "outline.md": "# Outline\n\nDescribe the document shape, then list sections with Status and File lines.\n",
  "style.md": "# Style\n\nRecord voice, formatting, terminology, and citation rules.\n",
  "state/status.md": "# Status\n\n| Section | File | Status | Notes |\n|---|---|---|---|\n",
  "state/continuity.md": "# Continuity\n\n| Decision | Applies To | Notes |\n|---|---|---|\n",
  "state/claims.md": "# Claims\n\n| Claim | Section | Source | Status | Notes |\n|---|---|---|---|---|\n",
  "state/open-questions.md": "# Open Questions\n\n| Question | Owner | Status | Notes |\n|---|---|---|---|\n",
  "sources/index.md": "# Sources Index\n\n| Key | Type | Title | Location | Status | Notes |\n|---|---|---|---|---|---|\n",
});

export function requiredScaffoldFileContent(rel) {
  if (Object.prototype.hasOwnProperty.call(REQUIRED_STATE_READMES, rel)) return REQUIRED_STATE_READMES[rel];
  if (Object.prototype.hasOwnProperty.call(MARKDOWN_STUBS, rel)) return MARKDOWN_STUBS[rel];
  const issueFiles = issueStateFileContents();
  if (Object.prototype.hasOwnProperty.call(issueFiles, rel)) return `${JSON.stringify(issueFiles[rel], null, 2)}\n`;
  const truthFiles = truthStateFileContents();
  if (Object.prototype.hasOwnProperty.call(truthFiles, rel)) return `${JSON.stringify(truthFiles[rel], null, 2)}\n`;
  return null;
}

export function listMissingRequiredScaffolding(projectRoot) {
  return {
    dirs: REQUIRED_PROJECT_DIRS.filter((rel) => !fs.existsSync(path.join(projectRoot, rel))),
    files: REQUIRED_PROJECT_FILES.filter((rel) => !fs.existsSync(path.join(projectRoot, rel))),
  };
}

export function createMissingRequiredScaffolding(projectRoot) {
  const created = [];
  const conflicts = [];
  for (const rel of REQUIRED_PROJECT_DIRS) {
    const full = path.join(projectRoot, rel);
    if (fs.existsSync(full)) {
      if (!fs.statSync(full).isDirectory()) conflicts.push(rel);
      continue;
    }
    try {
      fs.mkdirSync(full, { recursive: true });
      created.push(rel);
    } catch (error) {
      if (error.code === "EEXIST" || error.code === "ENOTDIR") {
        conflicts.push(rel);
        continue;
      }
      throw error;
    }
  }
  for (const rel of REQUIRED_PROJECT_FILES) {
    const full = path.join(projectRoot, rel);
    if (fs.existsSync(full)) continue;
    const content = requiredScaffoldFileContent(rel);
    if (content == null) continue;
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      created.push(rel);
    } catch (error) {
      if (error.code === "EEXIST" || error.code === "ENOTDIR") {
        conflicts.push(rel);
        continue;
      }
      throw error;
    }
  }
  return { created, conflicts };
}
