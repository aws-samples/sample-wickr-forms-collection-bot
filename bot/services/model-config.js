// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

/**
 * Central model configuration for Amazon Bedrock.
 * Single source of truth for model ID and API format.
 *
 * Override via BEDROCK_MODEL_ID env var to switch models without code changes.
 * Default: Claude 3.5 Sonnet (Anthropic). For GovCloud Llama, set:
 *   BEDROCK_MODEL_ID=meta.llama3-70b-instruct-v1:0
 *
 * The API format (request body structure, response parsing) differs between
 * providers. This module abstracts that so callers just pass system + user text
 * and get back the response text.
 */

const DEFAULT_MODEL_ID = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

function getModelId() {
  return process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;
}

function getProvider() {
  const id = getModelId();
  if (id.includes('anthropic.')) return 'anthropic';
  if (id.includes('meta.')) return 'meta';
  if (id.includes('amazon.')) return 'amazon';
  return 'unknown';
}

/**
 * Build the Bedrock InvokeModel request body for the configured provider.
 * @param {string} systemPrompt - System/instruction prompt
 * @param {string} userText - User message text
 * @param {object} [options]
 * @param {number} [options.maxTokens=1024]
 * @param {Array} [options.history] - Previous messages [{role, content}] for multi-turn
 * @returns {string} JSON string for InvokeModelCommand body
 */
function buildRequestBody(systemPrompt, userText, options) {
  const maxTokens = (options && options.maxTokens) || 1024;
  const history = (options && options.history) || [];
  const provider = getProvider();

  if (provider === 'anthropic') {
    const messages = [...history, { role: 'user', content: userText }];
    return JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages,
    });
  }

  if (provider === 'meta') {
    // Llama uses a single prompt string with special tokens
    let prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>`;
    for (const msg of history) {
      prompt += `<|start_header_id|>${msg.role}<|end_header_id|>\n\n${msg.content}<|eot_id|>`;
    }
    prompt += `<|start_header_id|>user<|end_header_id|>\n\n${userText}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;
    return JSON.stringify({
      prompt: prompt,
      max_gen_len: maxTokens,
      temperature: 0.1,
    });
  }

  // Fallback: try Anthropic format
  return JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userText }],
  });
}

/**
 * Extract the response text from a Bedrock InvokeModel response body.
 * @param {Buffer} responseBody - The raw response body buffer
 * @returns {string|null} The extracted text, or null if parsing fails
 */
function parseResponseText(responseBody) {
  const provider = getProvider();
  let parsed;
  try {
    parsed = JSON.parse(responseBody.toString('utf8'));
  } catch (err) {
    return null;
  }

  if (provider === 'anthropic') {
    // Anthropic: { content: [{ type: 'text', text: '...' }] }
    if (parsed.content && Array.isArray(parsed.content) && parsed.content.length > 0) {
      return parsed.content[0].text || null;
    }
    return null;
  }

  if (provider === 'meta') {
    // Llama: { generation: '...' }
    return parsed.generation || null;
  }

  // Fallback: try both formats
  if (parsed.content && Array.isArray(parsed.content)) {
    return parsed.content[0].text || null;
  }
  if (parsed.generation) {
    return parsed.generation;
  }
  return null;
}

module.exports = {
  getModelId,
  getProvider,
  buildRequestBody,
  parseResponseText,
  DEFAULT_MODEL_ID,
};
