#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const skillDir = path.join(root, "skills", "codex", "manuscript-lab");
const errors = [];

checkSkill();
checkOpenAiMetadata();
checkReferences();

if (errors.length) {
  console.error("Codex skill validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Codex skill is valid.");

function checkSkill() {
  const file = path.join(skillDir, "SKILL.md");
  const text = read(file);
  if (!text) return;
  const frontmatter = parseFrontmatter(text, file);
  if (!frontmatter) return;
  const keys = Object.keys(frontmatter);
  for (const key of keys) {
    if (!["name", "description"].includes(key)) {
      errors.push(`SKILL.md frontmatter should only include name and description, found ${key}.`);
    }
  }
  if (frontmatter.name !== "manuscript-lab") {
    errors.push("SKILL.md name must be manuscript-lab.");
  }
  if (!frontmatter.description || frontmatter.description.includes("TODO") || frontmatter.description.length < 80) {
    errors.push("SKILL.md description must be complete and trigger-oriented.");
  }
  if (text.includes("[TODO")) {
    errors.push("SKILL.md still contains TODO placeholders.");
  }
}

function checkOpenAiMetadata() {
  const file = path.join(skillDir, "agents", "openai.yaml");
  const text = read(file);
  if (!text) return;
  for (const required of [
    'display_name: "Manuscript Lab"',
    'short_description: "Ship work in Manuscript Lab"',
    'default_prompt: "Use $manuscript-lab',
  ]) {
    if (!text.includes(required)) errors.push(`agents/openai.yaml missing ${required}`);
  }
}

function checkReferences() {
  for (const file of [
    "references/task-routes.md",
    "references/shipping-checklist.md",
  ]) {
    const full = path.join(skillDir, file);
    if (!fs.existsSync(full)) errors.push(`Missing ${file}.`);
  }
}

function parseFrontmatter(text, file) {
  if (!text.startsWith("---\n")) {
    errors.push(`${path.relative(root, file)} must start with YAML frontmatter.`);
    return null;
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    errors.push(`${path.relative(root, file)} frontmatter is not closed.`);
    return null;
  }
  const raw = text.slice(4, end).trim();
  const data = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      errors.push(`Unsupported frontmatter line in ${path.relative(root, file)}: ${line}`);
      continue;
    }
    data[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return data;
}

function read(file) {
  if (!fs.existsSync(file)) {
    errors.push(`Missing ${path.relative(root, file)}.`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}
