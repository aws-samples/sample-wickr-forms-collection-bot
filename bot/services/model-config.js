// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

/**
 * Central model configuration for Amazon Bedrock -- Converse API.
 *
 * The Bedrock Converse API is provider-agnostic: same request/response shape
 * for Anthropic Claude, Amazon Nova, Meta Llama, OpenAI gpt-oss, and NVIDIA
 * Nemotron. Override the default via BEDROCK_MODEL_ID env var to switch models
 * without code changes. IAM: Converse authorizes via bedrock:InvokeModel, so
 * existing task-role policies keep working -- only the model ARN in the
 * Resource scope must cover the configured model.
 *
 * Default: Claude Sonnet 4.5 via the GovCloud cross-region inference profile, verified
 * working with Converse in us-gov-west-1 as of 2026-07-27. GovCloud requires newer
 * Anthropic models to be invoked through an inference profile, hence the "us-gov."
 * prefix rather than a bare model ID. In commercial AWS the equivalent prefix is "us.".
 *
 * To switch models, set BEDROCK_MODEL_ID -- no code change or rebuild needed. Any
 * Converse-capable model works (Nova, Llama, gpt-oss, Nemotron), subject to account
 * model access in the target region.
 */

const DEFAULT_MODEL_ID = 'us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0';

function getModelId() {
  return process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;
}

/**
 * Build the args object for ConverseCommand.
 * @param {string} systemPrompt - System/instruction prompt
 * @param {string} userText - User message text
 * @param {object} [options]
 * @param {number} [options.maxTokens=1024]
 * @param {Array}  [options.history] - Previous messages [{role, content}] for multi-turn
 * @returns {object} ConverseCommand input
 */
function buildConverseInput(systemPrompt, userText, options) {
  const maxTokens = (options && options.maxTokens) || 1024;
  const history = (options && options.history) || [];
  const messages = [
    ...history.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
    { role: 'user', content: [{ text: userText }] },
  ];
  return {
    modelId: getModelId(),
    system: [{ text: systemPrompt }],
    messages,
    // Low temperature for deterministic classification/extraction. (The old
    // InvokeModel path used 0.1 for Llama and provider default for Claude;
    // Converse lets us set it uniformly.)
    inferenceConfig: { maxTokens, temperature: 0.1 },
  };
}

/**
 * Extract response text from a Converse response:
 * { output: { message: { content: [ {reasoningContent: ...}, {text: '...'} ] } } }
 *
 * Reasoning models (openai.gpt-oss-*, Claude with extended thinking) prepend a
 * reasoningContent block before the final text block, so scan for the first
 * block that carries a non-empty string text field -- content[0] may be
 * reasoning, not the answer.
 *
 * @param {object} response - The ConverseCommand response object
 * @returns {string|null} The extracted text, or null if parsing fails
 */
function parseConverseResponse(response) {
  const content =
    response &&
    response.output &&
    response.output.message &&
    response.output.message.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block && typeof block.text === 'string' && block.text.length > 0) {
      return block.text;
    }
  }
  return null;
}

/**
 * Finds the first balanced JSON object/array substring in a string, correctly
 * ignoring braces that appear inside string literals. Returns the substring or
 * null if no balanced structure is found.
 * @param {string} s
 * @returns {string|null}
 */
function sliceBalanced(s) {
  const start = s.search(/[{[]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parses a JSON object/array out of raw model output. Unlike a bare
 * JSON.parse(), this tolerates the formatting drift common to non-Anthropic
 * models (e.g. Llama on GovCloud), which despite "return ONLY raw JSON"
 * instructions may prepend a label ("CORRECTION: {...}"), wrap output in
 * ```json code fences, or append trailing prose.
 *
 * Strategy: try a direct parse first (Anthropic / well-behaved output), then
 * strip markdown fences, then extract the outermost balanced object/array.
 * Throws SyntaxError if no valid JSON can be recovered, so existing callers'
 * try/catch fallbacks continue to fire for genuinely unparseable content.
 *
 * @param {string} text - Raw text returned by the model
 * @returns {Object|Array} Parsed JSON value
 */
function extractJson(text) {
  if (text == null) throw new SyntaxError('No content to parse');
  const s = String(text).trim();

  // 1. Fast path: already-clean JSON (Claude obeys "raw JSON only").
  try {
    return JSON.parse(s);
  } catch (_) {
    /* fall through to recovery */
  }

  // 2. Strip a markdown code fence if present: ```json ... ``` or ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch (_) {
      /* fall through */
    }
  }

  // 3. Extract the outermost balanced {object} / [array], ignoring any label
  //    prefix (e.g. "CORRECTION:") or trailing prose the model tacked on.
  const candidate = sliceBalanced(s);
  if (candidate !== null) {
    return JSON.parse(candidate);
  }

  // Nothing usable -- re-parse to throw a SyntaxError for the caller to catch.
  return JSON.parse(s);
}

module.exports = {
  getModelId,
  buildConverseInput,
  parseConverseResponse,
  extractJson,
  DEFAULT_MODEL_ID,
};
