#!/usr/bin/env node
// Case-study experiment: does the mlab loop beat a naked frontier pass on real sections?
// Arms: A=direct one-shot, B=direct+self-revise, C=mlab loop (compose packet -> 3 candidates
// -> deterministic checks -> blind selection -> check-informed revision).
// Parity: all arms and judges see the same brief/style/contract and the same
// truncated source texts. Judging: blind pairwise, 2 judges x 2 orders, families
// disjoint from generator and selector.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = "/Users/mat/Documents/dev/manuscript-lab";
const PROJECT = path.join(HERE, "project");
const RESULTS = path.join(HERE, "results");
const BIN = path.join(REPO, "bin", "manuscript-lab.mjs");

const { callChatModel } = await import(pathToFileURL(path.join(REPO, "scripts/lib/model-provider.mjs")).href);
const { parseModelJsonObject } = await import(pathToFileURL(path.join(REPO, "scripts/lib/model-json.mjs")).href);

function safeJson(raw) {
  try {
    const parsed = parseModelJsonObject(raw);
    if (parsed?.ok) return parsed.value;
  } catch {}
  try { return JSON.parse(raw); } catch { return null; }
}

function stripToHeading(text) {
  const idx = text.search(/^# /m);
  return idx > 0 ? text.slice(idx) : text;
}

const GEN_MODEL = "openrouter:z-ai/glm-5.2";
const SELECT_MODEL = "lightning:lightning-ai/gpt-oss-120b";
const JUDGE_MODELS = ["openrouter:qwen/qwen3.7-plus", "openrouter:tencent/hy3"];
const SOURCE_TRUNC = 6000;
const MAX_CALLS = 100;
const JSON_FORMAT = { type: "json_object" };

const SECTIONS = [
  { file: "draft/01-the-problem.md", id: "01-the-problem", sources: ["product-strategy", "readme"] },
  { file: "draft/02-architecture.md", id: "02-architecture", sources: ["architecture", "readme"] },
  { file: "draft/03-gates-and-evidence.md", id: "03-gates-and-evidence", sources: ["gate-engine", "evidence-spine"] },
  { file: "draft/04-agents.md", id: "04-agents", sources: ["mcp", "readme"] },
];
const SOURCE_FILES = {
  "readme": "sources/readme.md",
  "architecture": "sources/architecture.md",
  "gate-engine": "sources/gate_engine.md",
  "evidence-spine": "sources/evidence_spine.md",
  "mcp": "sources/mcp.md",
  "product-strategy": "sources/product_strategy.md",
};

let callCount = 0;
const ledger = [];
async function model(kind, args) {
  if (callCount >= MAX_CALLS) throw new Error(`Budget guard: ${MAX_CALLS} calls reached`);
  callCount += 1;
  const started = Date.now();
  const res = await callChatModel({ title: `case-study-${kind}`, ...args });
  ledger.push({
    kind, model: args.model,
    prompt_tokens: res.usage?.prompt_tokens ?? null,
    completion_tokens: res.usage?.completion_tokens ?? null,
    ms: Date.now() - started,
  });
  if (!res.content || !res.content.trim()) throw new Error(`${kind}: empty response from ${args.model}`);
  const text = res.content.trim();
  return kind.startsWith("gen") ? stripToHeading(text) : text;
}

function read(rel) { return fs.readFileSync(path.join(PROJECT, "manuscript", rel), "utf8"); }
function trunc(s, n = SOURCE_TRUNC) { return s.length > n ? `${s.slice(0, n)}\n[...truncated for the experiment...]` : s; }
function log(msg) { process.stderr.write(`[exp] ${msg}\n`); }

function contractOf(sectionText) {
  const m = sectionText.match(/<!--([\s\S]*?)-->/);
  return m ? m[1].trim() : "";
}

function sharedInputs(section) {
  const contract = contractOf(read(section.file));
  const sources = section.sources
    .map((k) => `### Source [cite:${k}] (${k})\n\n${trunc(read(SOURCE_FILES[k]))}`)
    .join("\n\n");
  return { contract, sources, brief: read("brief.md"), style: read("style.md"), outline: read("outline.md") };
}

function genSystem() {
  return "You are a precise technical writer. You write single whitepaper sections that satisfy an explicit section contract. Output ONLY the section body in markdown, starting with the # heading. No preamble, no commentary.";
}

function genPrompt(section, inp, extra = "") {
  return [
    "Write this whitepaper section.",
    `\n## Brief\n${inp.brief}`,
    `\n## Style rules\n${inp.style}`,
    `\n## Outline\n${inp.outline}`,
    `\n## Section contract\n${inp.contract}`,
    `\n## Registered sources (cite with [cite:key] markers; cite only these keys)\n${inp.sources}`,
    extra,
    "\nOutput the complete section body now.",
  ].join("\n");
}

// ---------- deterministic evaluation ----------
function freshEvalCopy(name) {
  const dir = path.join(HERE, "eval", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.cpSync(PROJECT, dir, { recursive: true });
  return dir;
}

function mlabIn(dir, args) {
  const res = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: "utf8", timeout: 120000 });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function writeBody(dir, section, body) {
  const full = path.join(dir, "manuscript", section.file);
  const original = fs.readFileSync(full, "utf8");
  const contract = original.match(/<!--[\s\S]*?-->/)[0].replace("status: todo", "status: draft");
  fs.writeFileSync(full, `${contract}\n${body.trim()}\n`);
  const statusPath = path.join(dir, "manuscript", "state", "status.md");
  fs.writeFileSync(statusPath, fs.readFileSync(statusPath, "utf8").replaceAll(`\`${section.file}\` | todo`, `\`${section.file}\` | draft`));
}

function deterministicEval(name, section, body) {
  const dir = freshEvalCopy(name);
  writeBody(dir, section, body);
  mlabIn(dir, ["compose", section.file]);
  const gate = mlabIn(dir, ["gate", section.file, "--json"]);
  const cite = mlabIn(dir, ["citations", "check", section.file, "--json"]);
  let gateJson = null, citeJson = null;
  try { gateJson = JSON.parse(gate.stdout); } catch {}
  try { citeJson = JSON.parse(cite.stdout); } catch {}
  const reqs = gateJson?.requirements ?? [];
  const req = (id) => reqs.find((r) => r.id === id)?.status ?? "absent";
  const words = Number(gateJson?.summary?.words ?? reqs.find((r) => r.id === "words.floor")?.evidence?.words ?? 0);
  const markers = body.match(/\[cite:[^\]]*\]/g) ?? [];
  const allowed = new Set(section.sources);
  const invalidKeys = markers.map((m) => m.slice(6, -1).trim()).filter((k) => !allowed.has(k) && !SOURCE_FILES[k]);
  return {
    gate_ready: gateJson?.ready === true,
    gate_status: gateJson?.status ?? `exit:${gate.status}`,
    words_floor: req("words.floor"),
    near_target: req("words.near_target"),
    citations_ok: cite.status === 0,
    cite_issues_blocking: (citeJson?.issues ?? []).filter((i) => i.severity === "blocking").length,
    marker_count: markers.length,
    invalid_source_keys: invalidKeys,
    words,
  };
}

// ---------- arms ----------
async function armA(section, inp) {
  return model("gen-A", { model: GEN_MODEL, temperature: 0.7, maxTokens: 3000, system: genSystem(), content: genPrompt(section, inp) });
}

async function armB(section, inp, draftA) {
  return model("gen-B", {
    model: GEN_MODEL, temperature: 0.4, maxTokens: 3000,
    system: genSystem(),
    content: `${genPrompt(section, inp)}\n\n## Your previous draft\n${draftA}\n\nReview your previous draft against the contract acceptance criteria, the style rules, and the sources. Fix inaccuracies, unsupported claims, missing citations, and style violations. Output the complete revised section body.`,
  });
}

async function armC(section, inp) {
  const workDir = freshEvalCopy(`armC-${section.id}`);
  mlabIn(workDir, ["compose", section.file]);
  const packetDir = path.join(workDir, "manuscript", "state", "runtime", section.id);
  const packet = ["intent.md", "rule-stack.yaml", "criteria.json"]
    .filter((f) => fs.existsSync(path.join(packetDir, f)))
    .map((f) => `### packet/${f}\n${trunc(fs.readFileSync(path.join(packetDir, f), "utf8"), 4000)}`)
    .join("\n\n");

  const candidates = [];
  for (let i = 0; i < 3; i++) {
    const text = await model(`gen-C${i + 1}`, {
      model: GEN_MODEL, temperature: 0.9, seed: 41 + i, maxTokens: 3000,
      system: genSystem(),
      content: `${genPrompt(section, inp, `\n## Compiled runtime packet (the harness's working brief for this section)\n${packet}`)}\nThis is candidate ${i + 1} of 3 - take a distinct angle while honoring the contract.`,
    });
    candidates.push({ id: `cand-${i + 1}`, text, det: deterministicEval(`c-${section.id}-cand${i + 1}`, section, text) });
  }

  const passing = candidates.filter((c) => c.det.gate_ready && c.det.citations_ok);
  const pool = passing.length ? passing : candidates;
  let winner = pool[0];
  if (pool.length > 1) {
    const sel = await model("select", {
      model: SELECT_MODEL, temperature: 0, maxTokens: 600, responseFormat: JSON_FORMAT,
      system: "You are a blind selection judge for contract compliance. Return exactly one JSON object like {\"winner\": \"cand-2\", \"reason\": \"...\"}.",
      content: JSON.stringify({
        contract: inp.contract,
        instruction: "Pick the candidate that best satisfies the contract acceptance criteria. Judge compliance and accuracy, not flourish.",
        candidates: pool.map((c) => ({ id: c.id, text: c.text })),
      }),
    });
    const parsed = safeJson(sel);
    if (parsed) winner = pool.find((c) => c.id === parsed.winner) ?? winner;
  }

  const findings = [];
  if (!winner.det.gate_ready) findings.push(`section gate not ready: ${winner.det.gate_status}`);
  if (winner.det.words_floor === "fail") findings.push(`words ${winner.det.words} below floor`);
  if (winner.det.near_target === "warn") findings.push(`words ${winner.det.words} below 80% of target`);
  if (winner.det.cite_issues_blocking > 0) findings.push(`${winner.det.cite_issues_blocking} blocking citation issue(s)`);
  if (winner.det.invalid_source_keys.length) findings.push(`unregistered source keys: ${winner.det.invalid_source_keys.join(", ")}`);

  if (!findings.length) return { text: winner.text, candidates, revised: false };

  const revised = await model("gen-C-rev", {
    model: GEN_MODEL, temperature: 0.4, maxTokens: 3000,
    system: genSystem(),
    content: `${genPrompt(section, inp)}\n\n## Draft to revise\n${winner.text}\n\n## Harness check findings (fix ALL of these)\n- ${findings.join("\n- ")}\n\nOutput the complete revised section body.`,
  });
  return { text: revised, candidates, revised: true, findings };
}

// ---------- judging ----------
async function judgePair(section, inp, textOne, textTwo, judgeModel) {
  const out = await model("judge", {
    model: judgeModel, temperature: 0, maxTokens: 700, responseFormat: JSON_FORMAT,
    system: "You are a blind editorial judge for a technical whitepaper section. Return exactly one JSON object like {\"winner\": 1, \"reason\": \"...\"} where winner is 1, 2, or 0 for a tie. Judge which text better satisfies the contract: acceptance criteria, factual accuracy against the sources, citation discipline, and prose quality per the style rules. Do not reward length.",
    content: JSON.stringify({
      brief_constraints: inp.brief, style_rules: inp.style, section_contract: inp.contract,
      sources: section.sources.map((k) => ({ key: k, text: trunc(read(SOURCE_FILES[k]), 4000) })),
      text_1: textOne, text_2: textTwo,
    }),
  });
  const v = safeJson(out);
  if (!v) return { winner: 0, reason: "unparseable verdict" };
  const w = Number(v.winner);
  return { winner: [0, 1, 2].includes(w) ? w : 0, reason: String(v.reason ?? "").slice(0, 400) };
}

async function judgeMatchup(section, inp, label, a, b) {
  const votes = [];
  for (const judgeModel of JUDGE_MODELS) {
    for (const order of ["fwd", "rev"]) {
      let verdict = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
        try {
          verdict = order === "fwd" ? await judgePair(section, inp, a, b, judgeModel) : await judgePair(section, inp, b, a, judgeModel);
        } catch (err) { lastErr = err; }
      }
      if (verdict) {
        const leftWinner = order === "fwd" ? 1 : 2;
        const rightWinner = order === "fwd" ? 2 : 1;
        votes.push({ judge: judgeModel, order, vote: verdict.winner === leftWinner ? "left" : verdict.winner === rightWinner ? "right" : "tie", reason: verdict.reason });
      } else {
        votes.push({ judge: judgeModel, order, vote: "error", reason: `judge error: ${String(lastErr?.message).slice(0, 160)}` });
      }
    }
  }
  const left = votes.filter((v) => v.vote === "left").length;
  const right = votes.filter((v) => v.vote === "right").length;
  const errors = votes.filter((v) => v.vote === "error").length;
  return { matchup: label, left_wins: left, right_wins: right, ties: votes.length - left - right - errors, errors, votes };
}

// ---------- main ----------
fs.mkdirSync(path.join(RESULTS, "drafts"), { recursive: true });
fs.rmSync(path.join(RESULTS, "experiment.json"), { force: true });
function savedDraft(section, arm) {
  const p = path.join(RESULTS, "drafts", `${section.id}.${arm}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}
const results = { sections: [], config: { GEN_MODEL, SELECT_MODEL, JUDGE_MODELS, SOURCE_TRUNC } };

for (const section of SECTIONS) {
  log(`=== ${section.id} ===`);
  const inp = sharedInputs(section);

  let a = savedDraft(section, "A");
  if (a) { log("arm A: reusing saved draft"); } else { log("arm A (direct one-shot)"); a = await armA(section, inp); }
  let b = savedDraft(section, "B");
  if (b) { log("arm B: reusing saved draft"); } else { log("arm B (direct + self-revise)"); b = await armB(section, inp, a); }
  const savedC = savedDraft(section, "C");
  let c;
  if (savedC) { log("arm C: reusing saved draft"); c = { text: savedC, candidates: [], revised: null, reused: true }; }
  else { log("arm C (mlab loop)"); c = await armC(section, inp); }

  for (const [arm, text] of [["A", a], ["B", b], ["C", c.text]]) {
    fs.writeFileSync(path.join(RESULTS, "drafts", `${section.id}.${arm}.md`), text);
  }

  log("deterministic eval");
  const det = {
    A: deterministicEval(`${section.id}-A`, section, a),
    B: deterministicEval(`${section.id}-B`, section, b),
    C: deterministicEval(`${section.id}-C`, section, c.text),
  };

  log("blind judging");
  const judged = [
    await judgeMatchup(section, inp, "C-vs-A", c.text, a),
    await judgeMatchup(section, inp, "C-vs-B", c.text, b),
    await judgeMatchup(section, inp, "A-vs-B", a, b),
  ];

  results.sections.push({ id: section.id, deterministic: det, matchups: judged, armC_meta: { revised: c.revised, findings: c.findings ?? [], candidates: c.candidates.map((x) => ({ id: x.id, det: x.det })) } });
  fs.writeFileSync(path.join(RESULTS, "experiment.json"), JSON.stringify({ ...results, ledger, calls: callCount }, null, 2));
}

fs.writeFileSync(path.join(RESULTS, "experiment.json"), JSON.stringify({ ...results, ledger, calls: callCount }, null, 2));
const allVotes = results.sections.flatMap((s) => s.matchups.flatMap((m) => m.votes));
const errorVotes = allVotes.filter((v) => v.vote === "error").length;
log(`done: ${callCount} model calls, ${errorVotes}/${allVotes.length} error votes`);
if (errorVotes > allVotes.length * 0.2) {
  log("FAILURE ALARM: >20% of judge votes errored — aggregates are not trustworthy");
  process.exit(1);
}
console.log(JSON.stringify({ done: true, calls: callCount, error_votes: errorVotes, total_votes: allVotes.length }, null, 2));
