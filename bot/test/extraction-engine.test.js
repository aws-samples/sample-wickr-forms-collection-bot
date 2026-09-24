// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

require('./aws-sdk-stubs');

// ── Imports ───────────────────────────────────────────────────────────────────
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const extractionEngine = require('../services/extraction-engine');
const modelConfig = require('../services/model-config');

const NOT_PROVIDED = '[Not provided]';

/**
 * Wraps an arbitrary raw model text string (not necessarily clean JSON) as a
 * Converse API response. Used to simulate model output drift.
 */
function makeRawBedrockResponse(rawText) {
  return {
    output: { message: { content: [{ text: rawText }] } },
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Wraps fields as a Converse API response whose text block is a JSON string.
 */
function makeBedrockResponse(fields) {
  return makeRawBedrockResponse(JSON.stringify(fields));
}

/**
 * Creates a mock Bedrock client whose send() either resolves or rejects.
 * @param {Object|Error} responseOrError
 */
function makeMockClient(responseOrError) {
  return {
    send: mock.fn(async () => {
      if (responseOrError instanceof Error) throw responseOrError;
      return responseOrError;
    }),
  };
}

// ── Unit Tests ────────────────────────────────────────────────────────────────

describe('extraction-engine', () => {
  beforeEach(() => {
    // Each test injects its own mock client via extractionEngine._setClient()
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it('returns a complete Nine_Line_Request when Bedrock returns all nine fields', async () => {
    const fields = {
      location: 'AB 1234 5678',
      callsign: 'DUSTOFF 7-2, freq 33.45',
      precedence: 'URGENT',
      equipment: 'NONE',
      patientType: '2 LITTER, 1 AMBULATORY',
      security: 'POSSIBLE ENEMY',
      marking: 'SMOKE GREEN',
      nationality: 'US MILITARY',
      nbc: 'NONE',
    };
    extractionEngine._setClient(makeMockClient(makeBedrockResponse(fields)));

    const result = await extractionEngine.extract('Soldier down at AB 1234 5678, urgent evac needed');

    assert.equal(result.location,    'AB 1234 5678');
    assert.equal(result.callsign,    'DUSTOFF 7-2, freq 33.45');
    assert.equal(result.precedence,  'URGENT');
    assert.equal(result.equipment,   'NONE');
    assert.equal(result.patientType, '2 LITTER, 1 AMBULATORY');
    assert.equal(result.security,    'POSSIBLE ENEMY');
    assert.equal(result.marking,     'SMOKE GREEN');
    assert.equal(result.nationality, 'US MILITARY');
    assert.equal(result.nbc,         'NONE');
    assert.equal(result.error,       undefined, 'should have no error property');
  });

  // ── Partial information ───────────────────────────────────────────────────

  it('populates known fields and marks missing fields as [Not provided]', async () => {
    const fields = {
      location:    'Grid 38SMB',
      callsign:    null,
      precedence:  'PRIORITY',
      equipment:   null,
      patientType: '1 AMBULATORY',
      security:    null,
      marking:     null,
      nationality: null,
      nbc:         null,
    };
    extractionEngine._setClient(makeMockClient(makeBedrockResponse(fields)));

    const result = await extractionEngine.extract('One walking wounded at Grid 38SMB, priority');

    assert.equal(result.location,    'Grid 38SMB');
    assert.equal(result.callsign,    NOT_PROVIDED);
    assert.equal(result.precedence,  'PRIORITY');
    assert.equal(result.equipment,   NOT_PROVIDED);
    assert.equal(result.patientType, '1 AMBULATORY');
    assert.equal(result.security,    NOT_PROVIDED);
    assert.equal(result.marking,     NOT_PROVIDED);
    assert.equal(result.nationality, NOT_PROVIDED);
    assert.equal(result.nbc,         NOT_PROVIDED);
  });

  // ── No medically relevant information ────────────────────────────────────

  it('returns all nine fields as [Not provided] when no relevant information is present', async () => {
    const fields = {
      location: null, callsign: null, precedence: null, equipment: null,
      patientType: null, security: null, marking: null, nationality: null, nbc: null,
    };
    extractionEngine._setClient(makeMockClient(makeBedrockResponse(fields)));

    const result = await extractionEngine.extract('Hello there, how are you?');

    assert.equal(result.location,    NOT_PROVIDED);
    assert.equal(result.callsign,    NOT_PROVIDED);
    assert.equal(result.precedence,  NOT_PROVIDED);
    assert.equal(result.equipment,   NOT_PROVIDED);
    assert.equal(result.patientType, NOT_PROVIDED);
    assert.equal(result.security,    NOT_PROVIDED);
    assert.equal(result.marking,     NOT_PROVIDED);
    assert.equal(result.nationality, NOT_PROVIDED);
    assert.equal(result.nbc,         NOT_PROVIDED);
  });

  // ── Bedrock failure ───────────────────────────────────────────────────────

  it('returns a user-friendly error object when Bedrock throws, does not rethrow', async () => {
    extractionEngine._setClient(makeMockClient(new Error('Service unavailable')));

    const result = await extractionEngine.extract('some text');

    assert.ok(result.error, 'should have an error property');
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0, 'error message should not be empty');
    // Nine-line fields must NOT be present on error response
    assert.equal(result.location,   undefined);
    assert.equal(result.precedence, undefined);
  });

  // ── Enum validation: only standard values accepted ────────────────────────

  it('rejects invalid precedence and marks it as [Not provided]', async () => {
    extractionEngine._setClient(makeMockClient(makeBedrockResponse({
      location: 'AB 0000', callsign: null,
      precedence: 'SUPER URGENT', // invalid
      equipment: null, patientType: null, security: null,
      marking: null, nationality: null, nbc: null,
    })));
    const result = await extractionEngine.extract('test');
    assert.equal(result.precedence, NOT_PROVIDED);
  });

  it('rejects invalid equipment and marks it as [Not provided]', async () => {
    extractionEngine._setClient(makeMockClient(makeBedrockResponse({
      location: null, callsign: null, precedence: 'ROUTINE',
      equipment: 'HELICOPTER', // invalid
      patientType: null, security: null, marking: null, nationality: null, nbc: null,
    })));
    const result = await extractionEngine.extract('test');
    assert.equal(result.equipment, NOT_PROVIDED);
  });

  it('rejects invalid security and marks it as [Not provided]', async () => {
    extractionEngine._setClient(makeMockClient(makeBedrockResponse({
      location: null, callsign: null, precedence: null, equipment: null,
      patientType: null,
      security: 'UNKNOWN THREAT', // invalid
      marking: null, nationality: null, nbc: null,
    })));
    const result = await extractionEngine.extract('test');
    assert.equal(result.security, NOT_PROVIDED);
  });

  it('rejects invalid nationality and marks it as [Not provided]', async () => {
    extractionEngine._setClient(makeMockClient(makeBedrockResponse({
      location: null, callsign: null, precedence: null, equipment: null,
      patientType: null, security: null, marking: null,
      nationality: 'ALIEN', // invalid
      nbc: null,
    })));
    const result = await extractionEngine.extract('test');
    assert.equal(result.nationality, NOT_PROVIDED);
  });

  it('rejects invalid nbc and marks it as [Not provided]', async () => {
    extractionEngine._setClient(makeMockClient(makeBedrockResponse({
      location: null, callsign: null, precedence: null, equipment: null,
      patientType: null, security: null, marking: null, nationality: null,
      nbc: 'RADIOLOGICAL', // invalid
    })));
    const result = await extractionEngine.extract('test');
    assert.equal(result.nbc, NOT_PROVIDED);
  });

  // ── All valid enum values are accepted ────────────────────────────────────

  it('accepts all valid precedence values', async () => {
    for (const val of ['URGENT', 'URGENT SURGICAL', 'PRIORITY', 'ROUTINE', 'CONVENIENCE']) {
      extractionEngine._setClient(makeMockClient(makeBedrockResponse({
        location: null, callsign: null, precedence: val, equipment: null,
        patientType: null, security: null, marking: null, nationality: null, nbc: null,
      })));
      const result = await extractionEngine.extract('test');
      assert.equal(result.precedence, val, `Expected '${val}' to be accepted`);
    }
  });

  it('accepts all valid equipment values', async () => {
    for (const val of ['NONE', 'HOIST', 'EXTRACTION EQUIPMENT', 'VENTILATOR']) {
      extractionEngine._setClient(makeMockClient(makeBedrockResponse({
        location: null, callsign: null, precedence: null, equipment: val,
        patientType: null, security: null, marking: null, nationality: null, nbc: null,
      })));
      const result = await extractionEngine.extract('test');
      assert.equal(result.equipment, val, `Expected '${val}' to be accepted`);
    }
  });

  it('accepts all valid security values', async () => {
    for (const val of ['NO ENEMY TROOPS', 'POSSIBLE ENEMY', 'ENEMY IN AREA', 'ARMED ESCORT REQUIRED']) {
      extractionEngine._setClient(makeMockClient(makeBedrockResponse({
        location: null, callsign: null, precedence: null, equipment: null,
        patientType: null, security: val, marking: null, nationality: null, nbc: null,
      })));
      const result = await extractionEngine.extract('test');
      assert.equal(result.security, val, `Expected '${val}' to be accepted`);
    }
  });

  it('accepts all valid nationality values', async () => {
    for (const val of ['US MILITARY', 'US CIVILIAN', 'NON-US MILITARY', 'NON-US CIVILIAN', 'EPW']) {
      extractionEngine._setClient(makeMockClient(makeBedrockResponse({
        location: null, callsign: null, precedence: null, equipment: null,
        patientType: null, security: null, marking: null, nationality: val, nbc: null,
      })));
      const result = await extractionEngine.extract('test');
      assert.equal(result.nationality, val, `Expected '${val}' to be accepted`);
    }
  });

  it('accepts all valid nbc values', async () => {
    for (const val of ['NUCLEAR', 'BIOLOGICAL', 'CHEMICAL', 'NONE']) {
      extractionEngine._setClient(makeMockClient(makeBedrockResponse({
        location: null, callsign: null, precedence: null, equipment: null,
        patientType: null, security: null, marking: null, nationality: null, nbc: val,
      })));
      const result = await extractionEngine.extract('test');
      assert.equal(result.nbc, val, `Expected '${val}' to be accepted`);
    }
  });

  // ── Result structure ──────────────────────────────────────────────────────

  it('result always contains exactly the nine required fields', async () => {
    extractionEngine._setClient(makeMockClient(makeBedrockResponse({
      location: 'XY 9999', callsign: 'MEDEVAC-1', precedence: 'URGENT',
      equipment: 'HOIST', patientType: '3 LITTER', security: 'ENEMY IN AREA',
      marking: 'PANEL', nationality: 'US CIVILIAN', nbc: 'NONE',
    })));

    const result = await extractionEngine.extract('test');
    const expected = ['location', 'callsign', 'precedence', 'equipment', 'patientType', 'security', 'marking', 'nationality', 'nbc'];
    for (const k of expected) {
      assert.ok(Object.prototype.hasOwnProperty.call(result, k), `Missing field: ${k}`);
    }
    assert.equal(Object.keys(result).length, expected.length);
  });

  // ── Malformed JSON from Claude ────────────────────────────────────────────

  it('returns all [Not provided] when the model returns non-JSON content', async () => {
    const badResponse = makeRawBedrockResponse('Sorry, I cannot help with that.');
    extractionEngine._setClient(makeMockClient(badResponse));

    const result = await extractionEngine.extract('some text');
    assert.equal(result.location,   NOT_PROVIDED);
    assert.equal(result.precedence, NOT_PROVIDED);
    assert.equal(result.nbc,        NOT_PROVIDED);
    // Should still have all nine fields
    assert.equal(Object.keys(result).length, 9);
  });
});


// ── Tests for extractForm and extractCorrection (Task 7) ──────────────────────

const MOCK_FORM_DEF = {
  id: 'TEST_FORM',
  name: 'Test Form',
  command: '/test',
  fields: [
    { key: 'alpha', label: 'Alpha', type: 'text' },
    { key: 'bravo', label: 'Bravo', type: 'text' },
    { key: 'charlie', label: 'Charlie', type: 'text', optional: true },
  ],
  extractionPrompt: 'You are a test extraction specialist.',
  correctionPrompt: 'You are a test correction specialist.',
  formatHeader: '=== TEST ===',
  formatFooter: '=============',
  outputs: [],
};

describe('model-config.buildConverseInput', () => {
  it('builds a ConverseCommand input with system, message, and inference config', () => {
    const input = modelConfig.buildConverseInput('sys prompt', 'user text');
    assert.equal(input.modelId, modelConfig.getModelId());
    assert.deepEqual(input.system, [{ text: 'sys prompt' }]);
    assert.deepEqual(input.messages, [{ role: 'user', content: [{ text: 'user text' }] }]);
    assert.equal(input.inferenceConfig.maxTokens, 1024);
    assert.equal(input.inferenceConfig.temperature, 0.1);
  });

  it('honors maxTokens override', () => {
    const input = modelConfig.buildConverseInput('s', 'u', { maxTokens: 512 });
    assert.equal(input.inferenceConfig.maxTokens, 512);
  });

  it('prepends history as Converse-shaped messages', () => {
    const history = [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ];
    const input = modelConfig.buildConverseInput('s', 'follow-up', { history });
    assert.equal(input.messages.length, 3);
    assert.deepEqual(input.messages[0], { role: 'user', content: [{ text: 'earlier question' }] });
    assert.deepEqual(input.messages[1], { role: 'assistant', content: [{ text: 'earlier answer' }] });
    assert.deepEqual(input.messages[2], { role: 'user', content: [{ text: 'follow-up' }] });
  });

  it('uses BEDROCK_MODEL_ID env var when set', () => {
    const orig = process.env.BEDROCK_MODEL_ID;
    process.env.BEDROCK_MODEL_ID = 'us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0';
    try {
      const input = modelConfig.buildConverseInput('s', 'u');
      assert.equal(input.modelId, 'us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0');
    } finally {
      if (orig === undefined) delete process.env.BEDROCK_MODEL_ID;
      else process.env.BEDROCK_MODEL_ID = orig;
    }
  });
});

describe('model-config.parseConverseResponse', () => {
  it('extracts text from a standard Converse response', () => {
    const resp = { output: { message: { content: [{ text: 'hello' }] } } };
    assert.equal(modelConfig.parseConverseResponse(resp), 'hello');
  });

  it('skips reasoningContent blocks and returns the first text block', () => {
    const resp = {
      output: { message: { content: [
        { reasoningContent: { reasoningText: { text: 'thinking...' } } },
        { text: 'ANSWER' },
      ] } },
    };
    assert.equal(modelConfig.parseConverseResponse(resp), 'ANSWER');
  });

  it('returns null for empty text blocks', () => {
    const resp = { output: { message: { content: [{ text: '' }] } } };
    assert.equal(modelConfig.parseConverseResponse(resp), null);
  });

  it('returns null for malformed responses', () => {
    assert.equal(modelConfig.parseConverseResponse(null), null);
    assert.equal(modelConfig.parseConverseResponse({}), null);
    assert.equal(modelConfig.parseConverseResponse({ output: {} }), null);
    assert.equal(modelConfig.parseConverseResponse({ output: { message: { content: 'nope' } } }), null);
  });
});

describe('model-config.extractJson', () => {
  it('parses already-clean JSON', () => {
    assert.deepEqual(modelConfig.extractJson('{"a":1}'), { a: 1 });
  });

  it('strips a leading label prefix', () => {
    assert.deepEqual(modelConfig.extractJson('CORRECTION: {"a":1}'), { a: 1 });
  });

  it('strips a ```json code fence', () => {
    assert.deepEqual(modelConfig.extractJson('```json\n{"a":1}\n```'), { a: 1 });
  });

  it('ignores trailing prose after the object', () => {
    assert.deepEqual(modelConfig.extractJson('{"a":1}\nHope that helps!'), { a: 1 });
  });

  it('does not split on braces inside string values', () => {
    assert.deepEqual(
      modelConfig.extractJson('{"marking":"SMOKE {GREEN}"}'),
      { marking: 'SMOKE {GREEN}' }
    );
  });

  it('throws SyntaxError when no JSON is present', () => {
    assert.throws(() => modelConfig.extractJson('no json here'), SyntaxError);
  });
});

describe('extractForm', () => {
  it('returns a normalized report when Bedrock returns valid JSON', async () => {
    const fields = { alpha: 'value-a', bravo: 'value-b', charlie: 'value-c' };
    extractionEngine._setClient(makeMockClient(makeBedrockResponse(fields)));

    const result = await extractionEngine.extractForm('some input text', MOCK_FORM_DEF);

    assert.equal(result.alpha, 'value-a');
    assert.equal(result.bravo, 'value-b');
    assert.equal(result.charlie, 'value-c');
    assert.equal(result.error, undefined);
  });

  it('applies normalizeReport -- missing required fields become NOT_PROVIDED, missing optional become null', async () => {
    const fields = { alpha: 'hello', bravo: null, charlie: null };
    extractionEngine._setClient(makeMockClient(makeBedrockResponse(fields)));

    const result = await extractionEngine.extractForm('partial input', MOCK_FORM_DEF);

    assert.equal(result.alpha, 'hello');
    assert.equal(result.bravo, NOT_PROVIDED);
    assert.equal(result.charlie, null);
  });

  it('returns all fields as NOT_PROVIDED/null when Bedrock returns empty content', async () => {
    const emptyResponse = makeRawBedrockResponse('');
    extractionEngine._setClient(makeMockClient(emptyResponse));

    const result = await extractionEngine.extractForm('some text', MOCK_FORM_DEF);

    assert.equal(result.alpha, NOT_PROVIDED);
    assert.equal(result.bravo, NOT_PROVIDED);
    assert.equal(result.charlie, null);
  });

  it('returns {error: string} when Bedrock throws', async () => {
    extractionEngine._setClient(makeMockClient(new Error('Service down')));

    const result = await extractionEngine.extractForm('some text', MOCK_FORM_DEF);

    assert.ok(result.error);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  });

  // Empty content must NOT reach the model (Anthropic rejects empty user
  // content). Guard returns an empty normalized report; client throws if called.
  it('returns an empty report for blank input without invoking the model', async () => {
    extractionEngine._setClient(makeMockClient(new Error('model must not be called')));

    for (const input of ['', '   ', null, undefined]) {
      const result = await extractionEngine.extractForm(input, MOCK_FORM_DEF);
      assert.equal(result.alpha, NOT_PROVIDED);
      assert.equal(result.bravo, NOT_PROVIDED);
      assert.equal(result.error, undefined);
    }
  });
});

describe('extractCorrection', () => {
  it('returns partial object with one corrected field', async () => {
    const correction = { alpha: 'new-value-a' };
    extractionEngine._setClient(makeMockClient(makeBedrockResponse(correction)));

    const currentReport = { alpha: 'old-a', bravo: 'old-b', charlie: null };
    const result = await extractionEngine.extractCorrection('fix alpha', currentReport, MOCK_FORM_DEF);

    assert.deepEqual(result, { alpha: 'new-value-a' });
  });

  it('returns empty object when Bedrock returns empty object', async () => {
    extractionEngine._setClient(makeMockClient(makeBedrockResponse({})));

    const currentReport = { alpha: 'a', bravo: 'b', charlie: null };
    const result = await extractionEngine.extractCorrection('nothing to fix', currentReport, MOCK_FORM_DEF);

    assert.deepEqual(result, {});
  });

  it('returns {error: string} when Bedrock throws', async () => {
    extractionEngine._setClient(makeMockClient(new Error('Timeout')));

    const currentReport = { alpha: 'a', bravo: 'b', charlie: null };
    const result = await extractionEngine.extractCorrection('fix something', currentReport, MOCK_FORM_DEF);

    assert.ok(result.error);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  });

  // Empty correction text must NOT reach the model (Anthropic rejects empty
  // user content). Guard returns {} (no corrections); client throws if called.
  it('returns {} for blank correction text without invoking the model', async () => {
    extractionEngine._setClient(makeMockClient(new Error('model must not be called')));
    const currentReport = { alpha: 'a', bravo: 'b', charlie: null };

    for (const input of ['', '   ', null, undefined]) {
      const result = await extractionEngine.extractCorrection(input, currentReport, MOCK_FORM_DEF);
      assert.deepEqual(result, {});
    }
  });

  // ── Regression: non-Anthropic (Llama) output drift ────────────────────────
  // Llama on GovCloud intermittently ignores "return ONLY raw JSON" and prepends
  // a label, wraps in code fences, or appends prose. These previously threw
  // "Unexpected token 'C', CORRECTION... is not valid JSON" and silently dropped
  // the correction. extractJson() must recover the embedded object.

  it('recovers corrected fields when Llama prepends a "CORRECTION:" label', async () => {
    const raw = 'CORRECTION: {"alpha":"new-a","bravo":"new-b"}';
    extractionEngine._setClient(makeMockClient(makeRawBedrockResponse(raw)));

    const currentReport = { alpha: 'old-a', bravo: 'old-b', charlie: null };
    const result = await extractionEngine.extractCorrection('fix it', currentReport, MOCK_FORM_DEF);

    assert.deepEqual(result, { alpha: 'new-a', bravo: 'new-b' });
  });

  it('recovers corrected fields when output is wrapped in a ```json code fence', async () => {
    const raw = '```json\n{"charlie":"new-c"}\n```';
    extractionEngine._setClient(makeMockClient(makeRawBedrockResponse(raw)));

    const currentReport = { alpha: 'a', bravo: 'b', charlie: null };
    const result = await extractionEngine.extractCorrection('fix charlie', currentReport, MOCK_FORM_DEF);

    assert.deepEqual(result, { charlie: 'new-c' });
  });

  it('recovers corrected fields when the model appends trailing prose', async () => {
    const raw = 'Here are the corrected fields:\n{"alpha":"x"}\nLet me know if you need anything else.';
    extractionEngine._setClient(makeMockClient(makeRawBedrockResponse(raw)));

    const currentReport = { alpha: 'a', bravo: 'b', charlie: null };
    const result = await extractionEngine.extractCorrection('change alpha', currentReport, MOCK_FORM_DEF);

    assert.deepEqual(result, { alpha: 'x' });
  });

  it('returns {} (caught) when output contains no JSON at all', async () => {
    const raw = 'I am not able to determine any corrections from that message.';
    extractionEngine._setClient(makeMockClient(makeRawBedrockResponse(raw)));

    const currentReport = { alpha: 'a', bravo: 'b', charlie: null };
    const result = await extractionEngine.extractCorrection('???', currentReport, MOCK_FORM_DEF);

    assert.deepEqual(result, {});
  });

  it('appends CURRENT FIELDS to the user message, not the system prompt', async () => {
    const correction = { bravo: 'updated-b' };
    const mockClient = {
      send: mock.fn(async (cmd) => {
        // Verify the user message contains CURRENT FIELDS
        const input = cmd.input;
        const userText = input.messages[0].content[0].text;
        assert.ok(userText.includes('CURRENT FIELDS'));
        assert.ok(userText.includes('"alpha":"old-a"'));
        // Verify system prompt is the correction prompt, not containing CURRENT FIELDS
        assert.deepEqual(input.system, [{ text: MOCK_FORM_DEF.correctionPrompt }]);
        return makeBedrockResponse(correction);
      }),
    };
    extractionEngine._setClient(mockClient);

    const currentReport = { alpha: 'old-a', bravo: 'old-b', charlie: null };
    await extractionEngine.extractCorrection('fix bravo', currentReport, MOCK_FORM_DEF);

    assert.equal(mockClient.send.mock.calls.length, 1);
  });
});
