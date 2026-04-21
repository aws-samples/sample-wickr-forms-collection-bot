// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const logger = require('./logger');
const modelConfig = require('./model-config');

const NOT_PROVIDED = '[Not provided]';

// Client is lazily initialised on first use so that tests can inject a mock
// via _setClient() before ever calling extractForm(). This also avoids
// requiring the AWS SDK at module-load time (useful when running tests
// without npm install).
let _client = null;

function getClient() {
  if (_client) return _client;
  // Lazy require so the SDK is only loaded in production, not in tests
  const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
  _client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return _client;
}

/**
 * Injects a mock client for testing. Call before extractForm().
 * @param {Object} mockClient - object with a send(command) method
 */
function _setClient(mockClient) {
  _client = mockClient;
}

/**
 * Sends text to Amazon Bedrock using a form definition's extraction prompt
 * and returns a normalized report object via form-registry.normalizeReport().
 * @param {string} text - The raw user text to extract from
 * @param {object} formDef - Form definition with extractionPrompt and fields
 * @param {object} [options] - Optional { correlationId }
 * @returns {Promise<object>} Normalized report or { error: string }
 */
async function extractForm(text, formDef, options) {
  const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
  const registry = require('./form-registry');
  const correlationId = options && options.correlationId;
  const timer = logger.startTimer();
  const modelId = modelConfig.getModelId();

  const params = {
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: modelConfig.buildRequestBody(formDef.extractionPrompt, text),
  };

  try {
    const response = await getClient().send(new InvokeModelCommand(params));
    const bodyBuf = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
    const contentText = modelConfig.parseResponseText(bodyBuf);

    if (!contentText) {
      logger.error('extraction', 'empty_bedrock_content', { correlationId, formType: formDef.id, modelId, durationMs: timer.elapsed() });
      return registry.normalizeReport(formDef, {});
    }

    let rawFields;
    try {
      rawFields = JSON.parse(contentText);
    } catch (parseErr) {
      logger.error('extraction', 'json_parse_error', { correlationId, formType: formDef.id, error: parseErr, modelId, durationMs: timer.elapsed() });
      return registry.normalizeReport(formDef, {});
    }

    const report = registry.normalizeReport(formDef, rawFields);
    const fieldsExtracted = formDef.fields.filter(f => report[f.key] && report[f.key] !== NOT_PROVIDED).length;
    const fieldsMissing = formDef.fields.length - fieldsExtracted;
    logger.info('extraction', 'extraction_complete', {
      correlationId, formType: formDef.id, fieldsExtracted, fieldsMissing,
      durationMs: timer.elapsed()
    });
    return report;
  } catch (error) {
    logger.error('extraction', 'extraction_error', { correlationId, formType: formDef.id, error, modelId, durationMs: timer.elapsed() });
    return { error: 'Extraction service temporarily unavailable. Please try again.' };
  }
}

/**
 * Sends correction text to Amazon Bedrock with the form definition's correction
 * prompt and the current report fields as context. Returns only corrected fields.
 * @param {string} text - The user's correction text
 * @param {object} currentReport - The current report fields
 * @param {object} formDef - Form definition with correctionPrompt
 * @param {object} [options] - Optional { correlationId }
 * @returns {Promise<object>} Partial object with corrected fields or { error: string }
 */
async function extractCorrection(text, currentReport, formDef, options) {
  const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
  const correlationId = options && options.correlationId;
  const timer = logger.startTimer();
  const modelId = modelConfig.getModelId();

  const userMessage = text + '\n\nCURRENT FIELDS:\n' + JSON.stringify(currentReport);

  const params = {
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: modelConfig.buildRequestBody(formDef.correctionPrompt, userMessage),
  };

  try {
    const response = await getClient().send(new InvokeModelCommand(params));
    const bodyBuf = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
    const contentText = modelConfig.parseResponseText(bodyBuf);

    if (!contentText) {
      logger.error('extraction', 'empty_correction_content', { correlationId, formType: formDef.id, modelId, durationMs: timer.elapsed() });
      return {};
    }

    let correctedFields;
    try {
      correctedFields = JSON.parse(contentText);
    } catch (parseErr) {
      logger.error('extraction', 'correction_parse_error', { correlationId, formType: formDef.id, error: parseErr, modelId, durationMs: timer.elapsed() });
      return {};
    }

    logger.info('extraction', 'correction_complete', {
      correlationId, formType: formDef.id, correctedFields: Object.keys(correctedFields),
      durationMs: timer.elapsed()
    });
    return correctedFields;
  } catch (error) {
    logger.error('extraction', 'correction_error', { correlationId, formType: formDef.id, error, modelId, durationMs: timer.elapsed() });
    return { error: 'Correction service temporarily unavailable. Please try again.' };
  }
}

module.exports = { extractForm, extractCorrection, _setClient, NOT_PROVIDED };
