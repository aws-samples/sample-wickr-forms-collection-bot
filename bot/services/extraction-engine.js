// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const logger = require('./logger');
const modelConfig = require('./model-config');

const VALID_PRECEDENCE = ['URGENT', 'URGENT SURGICAL', 'PRIORITY', 'ROUTINE', 'CONVENIENCE'];
const VALID_EQUIPMENT = ['NONE', 'HOIST', 'EXTRACTION EQUIPMENT', 'VENTILATOR'];
const VALID_SECURITY = ['NO ENEMY TROOPS', 'POSSIBLE ENEMY', 'ENEMY IN AREA', 'ARMED ESCORT REQUIRED'];
const VALID_NATIONALITY = ['US MILITARY', 'US CIVILIAN', 'NON-US MILITARY', 'NON-US CIVILIAN', 'EPW'];
const VALID_NBC = ['NUCLEAR', 'BIOLOGICAL', 'CHEMICAL', 'NONE'];

const NOT_PROVIDED = '[Not provided]';

const EXTRACTION_SYSTEM_PROMPT = `You are a military medical extraction specialist. Your task is to extract 9-line MEDEVAC request information from text.

Extract the following fields from the provided text and return ONLY a valid JSON object with exactly these nine fields:
- location: Grid coordinates or location description (free text)
- callsign: Radio frequency and callsign (free text)
- precedence: Must be exactly one of: URGENT, URGENT SURGICAL, PRIORITY, ROUTINE, CONVENIENCE
- equipment: Must be exactly one of: NONE, HOIST, EXTRACTION EQUIPMENT, VENTILATOR
- patientType: Number and type of patients (e.g., "2 LITTER, 1 AMBULATORY") (free text)
- security: Must be exactly one of: NO ENEMY TROOPS, POSSIBLE ENEMY, ENEMY IN AREA, ARMED ESCORT REQUIRED
- marking: How the pickup zone is marked (free text)
- nationality: Must be exactly one of: US MILITARY, US CIVILIAN, NON-US MILITARY, NON-US CIVILIAN, EPW
- nbc: Must be exactly one of: NUCLEAR, BIOLOGICAL, CHEMICAL, NONE

Rules:
1. If a field cannot be determined from the text, set it to null.
2. For enum fields, use ONLY the exact values listed above. If you cannot determine the value, set it to null.
3. Return ONLY a raw JSON object. No markdown, no explanation, no code blocks.
4. Example response: {"location":"AB 1234 5678","callsign":"DUSTOFF 7-2, freq 33.45","precedence":"URGENT","equipment":"NONE","patientType":"2 LITTER","security":"POSSIBLE ENEMY","marking":"SMOKE GREEN","nationality":"US MILITARY","nbc":"NONE"}`;

// Client is lazily initialised on first use so that tests can inject a mock
// via _setClient() before ever calling extract(). This also avoids requiring
// the AWS SDK at module-load time (useful when running tests without npm install).
let _client = null;

function getClient() {
  if (_client) return _client;
  // Lazy require so the SDK is only loaded in production, not in tests
  const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
  _client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-gov-west-1' });
  return _client;
}

/**
 * Injects a mock client for testing. Call before extract().
 * @param {Object} mockClient - object with a send(command) method
 */
function _setClient(mockClient) {
  _client = mockClient;
}

/**
 * Normalises a raw Claude response field into either a valid enum value or null.
 * @param {string|null} value
 * @param {string[]} validValues
 * @returns {string|null}
 */
function normaliseEnum(value, validValues) {
  if (!value || typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return validValues.includes(upper) ? upper : null;
}

/**
 * Normalises a free-text field; returns null for empty/null values.
 * @param {string|null} value
 * @returns {string|null}
 */
function normaliseText(value) {
  if (!value || typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

/**
 * Builds a Nine_Line_Request from a raw Claude JSON response object.
 * All nine fields will be present; invalid/missing fields become NOT_PROVIDED.
 * @param {Object} raw
 * @returns {Object}
 */
function buildNineLine(raw) {
  const r = raw || {};
  const location    = normaliseText(r.location);
  const callsign    = normaliseText(r.callsign);
  const precedence  = normaliseEnum(r.precedence, VALID_PRECEDENCE);
  const equipment   = normaliseEnum(r.equipment, VALID_EQUIPMENT);
  const patientType = normaliseText(r.patientType);
  const security    = normaliseEnum(r.security, VALID_SECURITY);
  const marking     = normaliseText(r.marking);
  const nationality = normaliseEnum(r.nationality, VALID_NATIONALITY);
  const nbc         = normaliseEnum(r.nbc, VALID_NBC);

  return {
    location:    location    || NOT_PROVIDED,
    callsign:    callsign    || NOT_PROVIDED,
    precedence:  precedence  || NOT_PROVIDED,
    equipment:   equipment   || NOT_PROVIDED,
    patientType: patientType || NOT_PROVIDED,
    security:    security    || NOT_PROVIDED,
    marking:     marking     || NOT_PROVIDED,
    nationality: nationality || NOT_PROVIDED,
    nbc:         nbc         || NOT_PROVIDED,
  };
}

/**
 * Sends text to Amazon Bedrock (Claude) and returns a structured Nine_Line_Request
 * with all nine fields populated or marked as "[Not provided]".
 * @param {string} text - The raw user text to extract from
 * @returns {Promise<Object>} Nine_Line_Request or { error: string }
 */
async function extract(text) {
  // Lazy-load InvokeModelCommand so the SDK module is not required at load time
  const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

  const modelId = modelConfig.getModelId();
  const params = {
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: modelConfig.buildRequestBody(EXTRACTION_SYSTEM_PROMPT, text),
  };

  try {
    const response = await getClient().send(new InvokeModelCommand(params));
    const bodyBuf = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
    const contentText = modelConfig.parseResponseText(bodyBuf);

    if (!contentText) {
      logger.error('extraction', 'empty_bedrock_content', { modelId });
      return buildNineLine({});
    }

    let rawFields;
    try {
      rawFields = JSON.parse(contentText);
    } catch (parseErr) {
      logger.error('extraction', 'json_parse_error', { error: parseErr, modelId });
      return buildNineLine({});
    }

    return buildNineLine(rawFields);
  } catch (error) {
    logger.error('extraction', 'extraction_error', { error, modelId });
    return { error: 'Extraction service temporarily unavailable. Please try again.' };
  }
}

/**
 * Sends text to Amazon Bedrock using a form definition's extraction prompt
 * and returns a normalized report object via form-registry.normalizeReport().
 * @param {string} text - The raw user text to extract from
 * @param {object} formDef - Form definition with extractionPrompt and fields
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
    const fieldsExtracted = formDef.fields.filter(f => report[f.key] && report[f.key] !== '[Not provided]').length;
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

module.exports = { extract, extractForm, extractCorrection, _setClient, buildNineLine, NOT_PROVIDED };
