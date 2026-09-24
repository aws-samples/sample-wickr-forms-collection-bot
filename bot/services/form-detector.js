// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const logger = require('./logger');
const modelConfig = require('./model-config');

// Client is lazily initialised on first use so that tests can inject a mock
// via _setClient() before ever calling detect(). This also avoids requiring
// the AWS SDK at module-load time (useful when running tests without npm install).
let _client = null;

function getClient() {
  if (_client) return _client;
  const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
  _client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-gov-west-1' });
  return _client;
}

/**
 * Injects a mock client for testing. Call before detect().
 * @param {Object} mockClient - object with a send(command) method
 */
function _setClient(mockClient) {
  _client = mockClient;
}

/**
 * Builds the classification system prompt dynamically from registered form definitions.
 * @param {Array<{id: string, detectionHint: string}>} formDefs
 * @returns {string}
 */
function buildDetectionPrompt(formDefs) {
  const descriptions = formDefs.map(f => `- ${f.id}: ${f.detectionHint}`).join('\n');
  return `You are a military report classifier. Your task is to determine which type of military report the user is trying to submit based on their free-form text.

Available report types:
${descriptions}

Rules:
1. Read the user's text carefully and determine which ONE report type best matches.
2. Return ONLY one word: the report type ID (e.g., MEDEVAC, SALUTE, CAS).
3. If the text clearly describes a medical evacuation, casualties, wounded, or patients, return MEDEVAC.
4. If the text clearly describes enemy observation, hostile activity, or contact reports, return SALUTE.
5. If the text clearly describes an airstrike request, close air support, JTAC brief, or target coordinates for air attack, return CAS.
6. If you cannot confidently determine the report type, return UNKNOWN.
7. Do NOT return any explanation, punctuation, or extra text. Return ONLY the single word.

Examples:
- "We have 2 wounded at grid AB 1234, need urgent evac" -> MEDEVAC
- "Observed 5 enemy troops moving east with RPGs at grid XY 5678" -> SALUTE
- "Request CAS, IP Alpha, heading 270, target is T-72 at grid AB 9999" -> CAS
- "Hello, how are you?" -> UNKNOWN`;
}

/**
 * Classifies free-form text into a form type using Amazon Bedrock.
 * @param {string} text - The user's free-form text
 * @param {Array} formDefs - Array of form definition objects
 * @returns {Promise<string>} The form ID or 'UNKNOWN'
 */
async function detect(text, formDefs, options) {
  const correlationId = options && options.correlationId;
  const timer = logger.startTimer();

  // Guard: never invoke the model with empty content. Non-text events (system
  // messages, empty payloads) produce blank text; the Converse API rejects
  // blank message content with a ValidationException. Treat blank input as
  // unclassifiable.
  if (!text || text.trim() === '') {
    logger.info('detector', 'classification_complete', {
      correlationId, detectedFormType: 'UNKNOWN', durationMs: timer.elapsed()
    });
    return 'UNKNOWN';
  }

  const { ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

  const systemPrompt = buildDetectionPrompt(formDefs);
  const modelId = modelConfig.getModelId();

  logger.debug('detector', 'classification_start', {
    correlationId, modelId, inputLength: text.length
  });

  // 512 tokens leaves headroom for reasoning models (e.g. gpt-oss-120b emits a
  // reasoningContent block before the final answer). 64 was tuned for Claude.
  const input = modelConfig.buildConverseInput(systemPrompt, text, { maxTokens: 512 });

  try {
    const response = await getClient().send(new ConverseCommand(input));
    const contentText = modelConfig.parseConverseResponse(response);

    if (!contentText) {
      logger.error('detector', 'classification_error', {
        correlationId, error: new Error('Empty content from Bedrock'), modelId, durationMs: timer.elapsed()
      });
      return 'UNKNOWN';
    }

    const result = contentText.trim();

    // Verify the result is a known form ID
    const knownIds = formDefs.map(f => f.id);
    if (knownIds.includes(result)) {
      logger.info('detector', 'classification_complete', {
        correlationId, detectedFormType: result, durationMs: timer.elapsed()
      });
      return result;
    }

    logger.info('detector', 'classification_complete', {
      correlationId, detectedFormType: 'UNKNOWN', durationMs: timer.elapsed()
    });
    return 'UNKNOWN';
  } catch (error) {
    logger.error('detector', 'classification_error', {
      correlationId, error, modelId, durationMs: timer.elapsed()
    });
    return 'UNKNOWN';
  }
}

module.exports = { detect, _setClient, buildDetectionPrompt };
