#!/usr/bin/env node

import assert from "node:assert/strict";
import { normalizeChatCompletionResponse } from "./lib/model-provider.mjs";

testContentJsonBeatsReasoning();
testToolArgumentsBeatContent();
testStructuredDoesNotUseReasoningAsContent();
testArrayContent();
testReasoningDetails();
testDeltaContent();
testDeltaToolArguments();

console.log("model-provider response tests passed");

function testContentJsonBeatsReasoning() {
  const normalized = normalizeChatCompletionResponse(
    {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: '{"ok":true}',
            reasoning_content: "I thought for a while.",
          },
        },
      ],
    },
    { structured: true },
  );
  assert.equal(normalized.content, '{"ok":true}');
  assert.equal(normalized.reasoning, "I thought for a while.");
}

function testToolArgumentsBeatContent() {
  const normalized = normalizeChatCompletionResponse(
    {
      choices: [
        {
          message: {
            content: "This should not be used.",
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "submit_structured_response",
                  arguments: '{"pass":"narrative.taste","issues":[]}',
                },
              },
            ],
          },
        },
      ],
    },
    { structured: true },
  );
  assert.equal(normalized.content, '{"pass":"narrative.taste","issues":[]}');
  assert.equal(normalized.tool_calls.length, 1);
}

function testStructuredDoesNotUseReasoningAsContent() {
  const normalized = normalizeChatCompletionResponse(
    {
      choices: [
        {
          finish_reason: "length",
          message: {
            reasoning_content: "Let me analyze forever.",
          },
        },
      ],
    },
    { structured: true },
  );
  assert.equal(normalized.content, "");
  assert.equal(normalized.reasoning, "Let me analyze forever.");
  assert.equal(normalized.finish_reason, "length");
}

function testArrayContent() {
  const normalized = normalizeChatCompletionResponse(
    {
      choices: [
        {
          message: {
            content: [{ type: "text", text: '{"ok":' }, { type: "text", text: "true}" }],
          },
        },
      ],
    },
    { structured: true },
  );
  assert.equal(normalized.content, '{"ok":true}');
}

function testReasoningDetails() {
  const normalized = normalizeChatCompletionResponse(
    {
      choices: [
        {
          message: {
            content: '{"ok":true}',
            reasoning_details: [{ type: "summary", text: "reasoned" }],
          },
        },
      ],
    },
    { structured: true },
  );
  assert.match(normalized.reasoning, /reasoned/);
}

function testDeltaContent() {
  const normalized = normalizeChatCompletionResponse(
    {
      choices: [
        {
          finish_reason: "stop",
          delta: {
            content: '{"ok":true,"source":"delta"}',
          },
        },
      ],
    },
    { structured: true },
  );
  assert.equal(normalized.content, '{"ok":true,"source":"delta"}');
  assert.equal(normalized.finish_reason, "stop");
}

function testDeltaToolArguments() {
  const normalized = normalizeChatCompletionResponse(
    {
      choices: [
        {
          delta: {
            content: "Ignore this.",
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "submit_structured_response",
                  arguments: '{"issues":[{"severity":"minor"}]}',
                },
              },
            ],
          },
        },
      ],
    },
    { structured: true },
  );
  assert.equal(normalized.content, '{"issues":[{"severity":"minor"}]}');
  assert.equal(normalized.tool_calls.length, 1);
}
