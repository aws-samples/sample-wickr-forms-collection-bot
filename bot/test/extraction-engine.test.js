// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// ── Bootstrap: mock @aws-sdk/client-bedrock-runtime before any service loads ──
// This must appear before require('./setup') and before any require of
// extraction-engine.js so that Node's module system never tries to resolve
// the real AWS SDK package (which may not be installed in the test environment).
const Module = require('module');
const _originalResolve = Module._resolveFilename;
const BEDROCK_STUB_KEY = '__aws_bedrock_runtime_stub__';

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@aws-sdk/client-bedrock-runtime') {
    return BEDROCK_STUB_KEY;
  }
  return _originalResolve.call(this, request, parent, isMain, options);
};

// Register the stub module in Node's require cache
require.cache[BEDROCK_STUB_KEY] = {
  id: BEDROCK_STUB_KEY,
  filename: BEDROCK_STUB_KEY,
  loaded: true,
  exports: {
    BedrockRuntimeClient: class BedrockRuntimeClient {
      constructor() {}
      async send() {
        throw new Error('Use extraction-engine._setClient() to inject a mock before calling extract()');
      }
    },
    InvokeModelCommand: class InvokeModelCommand {
      constructor(params) { this.params = params; }
    },
  },
  parent: null,
  children: [],
  paths: [],
};

// ── Setup: load Wickr IO mocks ─────────────────────────────────────────────────
require('./setup');

// ── Imports ───────────────────────────────────────────────────────────────────
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const extractionEngine = require('../services/extraction-engine');

const NOT_PROVIDED = '[Not provided]';

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Wraps fields as a Bedrock response body (Buffer containing Claude JSON).
 */
function makeBedrockResponse(fields) {
  return {
    body: Buffer.from(
      JSON.stringify({
        content: [{ text: JSON.stringify(fields) }],
      })
    ),
  };
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

  it('returns all [Not provided] when Claude returns non-JSON content', async () => {
    const badResponse = {
      body: Buffer.from(
        JSON.stringify({ content: [{ text: 'Sorry, I cannot help with that.' }] })
      ),
    };
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
    const emptyResponse = {
      body: Buffer.from(JSON.stringify({ content: [{ text: '' }] })),
    };
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

  it('appends CURRENT FIELDS to the user message, not the system prompt', async () => {
    const correction = { bravo: 'updated-b' };
    const mockClient = {
      send: mock.fn(async (cmd) => {
        // Verify the user message contains CURRENT FIELDS
        const body = JSON.parse(cmd.params.body);
        assert.ok(body.messages[0].content.includes('CURRENT FIELDS'));
        assert.ok(body.messages[0].content.includes('"alpha":"old-a"'));
        // Verify system prompt is the correction prompt, not containing CURRENT FIELDS
        assert.equal(body.system, MOCK_FORM_DEF.correctionPrompt);
        return makeBedrockResponse(correction);
      }),
    };
    extractionEngine._setClient(mockClient);

    const currentReport = { alpha: 'old-a', bravo: 'old-b', charlie: null };
    await extractionEngine.extractCorrection('fix bravo', currentReport, MOCK_FORM_DEF);

    assert.equal(mockClient.send.mock.calls.length, 1);
  });
});
