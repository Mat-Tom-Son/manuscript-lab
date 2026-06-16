#!/usr/bin/env node

import assert from "node:assert/strict";
import { parseJsonObjectOrThrow, parseModelJsonObject } from "./lib/model-json.mjs";

testPlainJson();
testThinkBlockAndPreamble();
testFencedJson();
testLikelyRootBeatsInnerObject();
testTrailingCommaRepair();
testTruncatedArrayRepair();
testMalformedTailKeyRepair();

console.log("model-json tests passed");

function testPlainJson() {
  assert.deepEqual(parseJsonObjectOrThrow('{"summary":"ok","issues":[]}'), { summary: "ok", issues: [] });
}

function testThinkBlockAndPreamble() {
  const parsed = parseJsonObjectOrThrow(`<think>{"plan":"do not parse this"}</think>
I will return the object now.
{"summary":"usable","issues":[]}`);
  assert.equal(parsed.summary, "usable");
}

function testFencedJson() {
  const parsed = parseJsonObjectOrThrow("Here:\n```json\n{\"winner\":\"candidate_a\",\"confidence\":\"high\"}\n```");
  assert.equal(parsed.winner, "candidate_a");
}

function testLikelyRootBeatsInnerObject() {
  const parsed = parseJsonObjectOrThrow(
    `Reasoning object: {"target_quote":"too small"}\nFinal:\n{"summary":"root","issues":[{"target_quote":"right","claim":"x"}]}`,
    { likelyRootKeys: ["summary", "issues"] },
  );
  assert.equal(parsed.summary, "root");
  assert.equal(parsed.issues[0].target_quote, "right");
}

function testTrailingCommaRepair() {
  const result = parseModelJsonObject('{"summary":"ok","issues":[],}');
  assert.equal(result.ok, true);
  assert.equal(result.value.summary, "ok");
  assert.equal(result.repair, "removed trailing commas");
}

function testTruncatedArrayRepair() {
  const result = parseModelJsonObject(
    '{"pass":"style.pattern_saturation","line_flags":[{"severity":"minor","target_quote":"x","issue":"y","recommended_action":"z"}',
    { repairArrays: ["line_flags"] },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.line_flags.length, 1);
  assert.match(result.value.__parse_repair, /truncated malformed line_flags/);
}

function testMalformedTailKeyRepair() {
  const result = parseModelJsonObject(
    '{"summary":"ok","issues":[],"register_map":[{"paragraph":1,"notes":"unterminated}',
    { dropMalformedKeys: ["register_map"] },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.register_map, []);
  assert.match(result.value.__parse_repair, /dropped malformed register_map/);
}
