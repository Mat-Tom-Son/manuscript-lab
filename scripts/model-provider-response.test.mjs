#!/usr/bin/env node

import assert from "node:assert/strict";
import { callChatModel, normalizeChatCompletionResponse, redactSensitiveText } from "./lib/model-provider.mjs";

testContentJsonBeatsReasoning();
testToolArgumentsBeatContent();
testStructuredDoesNotUseReasoningAsContent();
testArrayContent();
testReasoningDetails();
testDeltaContent();
testDeltaToolArguments();
testRedactsCommonSecretFormats();
await testUnsafeAuditDirRejected();

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

function testRedactsCommonSecretFormats() {
  const text = [
    `OPENROUTER_API_KEY=${"sk-or-v1-"}abc_DEF-1234567890`,
    `OPENAI=${"sk-proj-"}abcdefghijklmnopqrstuvwxyz1234567890`,
    `ANTHROPIC=${"sk-ant-"}api03-abcdefghijklmnopqrstuvwxyz1234567890`,
    `generic ${"sk-"}abcdefghijklmnopqrstuvwxyz1234567890`,
    `google ${"AI"}zaabcdefghijklmnopqrstuvwxyz1234567890ABCD`,
    `github ${"ghp_"}abcdefghijklmnopqrstuvwxyz123456`,
    `huggingface ${"hf_"}abcdefghijklmnopqrstuvwxyz123456`,
    `slack ${"xoxb-"}1234567890-abcdefghijklmnopqrst`,
    "Authorization: Bearer plain-secret",
    "api_key: plain-secret",
  ].join("\n");
  const redacted = redactSensitiveText(text);
  assert(!redacted.includes(`${"sk-or-v1-"}abc`), redacted);
  assert(!redacted.includes(`${"sk-proj-"}abc`), redacted);
  assert(!redacted.includes(`${"sk-ant-"}api03`), redacted);
  assert(!redacted.includes(`${"sk-"}abcdefghijklmnopqrstuvwxyz`), redacted);
  assert(!redacted.includes(`${"AI"}za`), redacted);
  assert(!redacted.includes("ghp_"), redacted);
  assert(!redacted.includes("hf_"), redacted);
  assert(!redacted.includes("xoxb-"), redacted);
  assert(!redacted.includes("plain-secret"), redacted);
}

async function testUnsafeAuditDirRejected() {
  const previous = {
    MODEL_CALL_AUDIT: process.env.MODEL_CALL_AUDIT,
    MODEL_CALL_AUDIT_DIR: process.env.MODEL_CALL_AUDIT_DIR,
    MODEL_CALL_AUDIT_ALLOW_UNSAFE_DIR: process.env.MODEL_CALL_AUDIT_ALLOW_UNSAFE_DIR,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };
  try {
    process.env.MODEL_CALL_AUDIT = "1";
    process.env.MODEL_CALL_AUDIT_DIR = "docs/model-call-audit-test";
    delete process.env.MODEL_CALL_AUDIT_ALLOW_UNSAFE_DIR;
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(
      () => callChatModel({
        model: "openrouter:example/model",
        messages: [{ role: "user", content: "hello" }],
      }),
      /MODEL_CALL_AUDIT_DIR must be under an ignored\/private path/,
    );
  } finally {
    restoreEnv(previous);
  }
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
