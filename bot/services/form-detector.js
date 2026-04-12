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
  const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

  const systemPrompt = buildDetectionPrompt(formDefs);
  const modelId = modelConfig.getModelId();

  logger.info('detector', 'classification_start', {
    correlationId, modelId, inputLength: text.length,
    inputPreview: text.substring(0, 100)
  });

  const params = {
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: modelConfig.buildRequestBody(systemPrompt, text, { maxTokens: 64 }),
  };

  try {
    const response = await getClient().send(new InvokeModelCommand(params));
    // SDK v3 returns Uint8Array; parseResponseText expects Buffer for .toString('utf8')
    const bodyBuf = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
    const contentText = modelConfig.parseResponseText(bodyBuf);

    if (!contentText) {
      logger.error('detector', 'classification_error', {
        correlationId, error: new Error('Empty content from Bedrock'), modelId, durationMs: timer.elapsed()
      });
      return 'UNKNOWN';
    }

    const result = contentText.trim();

    // Log raw model response for debugging
    logger.info('detector', 'raw_classification_response', {
      correlationId, rawResponse: result.substring(0, 200), modelId
    });

    // Claude Sonnet 4+ may return the ID with extra text. Extract the first word
    // and also search the full response for known form IDs.
    const firstWord = result.split(/[\s,.:;]+/)[0].toUpperCase();

    // Verify the result is a known form ID
    const knownIds = formDefs.map(f => f.id);

    // Try exact match on trimmed result first
    if (knownIds.includes(result)) {
      logger.info('detector', 'classification_complete', {
        correlationId, detectedFormType: result, durationMs: timer.elapsed()
      });
      return result;
    }

    // Try first word (handles "MEDEVAC - this is a medical..." responses)
    if (knownIds.includes(firstWord)) {
      logger.info('detector', 'classification_complete', {
        correlationId, detectedFormType: firstWord, durationMs: timer.elapsed()
      });
      return firstWord;
    }

    // Search the full response for any known ID
    for (const id of knownIds) {
      if (result.toUpperCase().includes(id)) {
        logger.info('detector', 'classification_complete', {
          correlationId, detectedFormType: id, durationMs: timer.elapsed()
        });
        return id;
      }
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
