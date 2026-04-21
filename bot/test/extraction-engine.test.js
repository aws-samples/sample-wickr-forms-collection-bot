// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// -- Bootstrap: mock @aws-sdk/client-bedrock-runtime before any service loads --
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
        throw new Error('Use extraction-engine._setClient() to inject a mock before calling extractForm()');
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

// -- Setup: load Wickr IO mocks ------------------------------------------------
require('./setup');

// -- Imports -------------------------------------------------------------------
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const extractionEngine = require('../services/extraction-engine');

const NOT_PROVIDED = '[Not provided]';

// -- Test helpers --------------------------------------------------------------

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

// -- Form-generic test fixture -------------------------------------------------

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

// -- extractForm ---------------------------------------------------------------

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

// -- extractCorrection ---------------------------------------------------------

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
