// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

require('./aws-sdk-stubs');

// ── Load module under test ────────────────────────────────────────────────────
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const formDetector = require('../services/form-detector');

// ── Test helpers ──────────────────────────────────────────────────────────────

const MOCK_FORM_DEFS = [
  { id: 'MEDEVAC', detectionHint: 'A 9-Line MEDEVAC request for medical evacuation. Keywords: medevac, casualty.' },
  { id: 'SALUTE', detectionHint: 'A SALUTE report for enemy observation. Keywords: salute, enemy.' },
  { id: 'CAS', detectionHint: 'A 9-Line Close Air Support brief. Keywords: CAS, airstrike.' },
];

/**
 * Creates a mock Bedrock client whose send() returns the given text in
 * the Converse API response format.
 */
function makeMockClient(responseText) {
  return {
    async send() {
      return {
        output: { message: { content: [{ text: responseText }] } },
      };
    },
  };
}

/**
 * Creates a mock Bedrock client whose send() throws an error.
 */
function makeErrorClient(message) {
  return {
    async send() { throw new Error(message || 'Bedrock unavailable'); },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('form-detector', () => {

  describe('buildDetectionPrompt', () => {
    it('includes all form IDs in the prompt', () => {
      const prompt = formDetector.buildDetectionPrompt(MOCK_FORM_DEFS);
      assert.ok(prompt.includes('MEDEVAC'), 'prompt should include MEDEVAC');
      assert.ok(prompt.includes('SALUTE'), 'prompt should include SALUTE');
      assert.ok(prompt.includes('CAS'), 'prompt should include CAS');
    });

    it('includes all detectionHints in the prompt', () => {
      const prompt = formDetector.buildDetectionPrompt(MOCK_FORM_DEFS);
      for (const def of MOCK_FORM_DEFS) {
        assert.ok(prompt.includes(def.detectionHint),
          `prompt should include detectionHint for ${def.id}`);
      }
    });
  });

  describe('detect', () => {
    beforeEach(() => {
      formDetector._setClient(null);
    });

    it('returns MEDEVAC when Bedrock responds with MEDEVAC', async () => {
      formDetector._setClient(makeMockClient('MEDEVAC'));
      const result = await formDetector.detect('2 wounded need evac', MOCK_FORM_DEFS);
      assert.equal(result, 'MEDEVAC');
    });

    // Empty content must NOT reach the model: the Anthropic Messages API rejects
    // empty user content with a ValidationException. The guard short-circuits to
    // UNKNOWN. Client throws if invoked, proving the model was never called.
    it('returns UNKNOWN for empty/blank input without invoking the model', async () => {
      formDetector._setClient(makeErrorClient('model must not be called for empty input'));
      assert.equal(await formDetector.detect('', MOCK_FORM_DEFS), 'UNKNOWN');
      assert.equal(await formDetector.detect('   ', MOCK_FORM_DEFS), 'UNKNOWN');
      assert.equal(await formDetector.detect(null, MOCK_FORM_DEFS), 'UNKNOWN');
      assert.equal(await formDetector.detect(undefined, MOCK_FORM_DEFS), 'UNKNOWN');
    });

    it('returns SALUTE when Bedrock responds with SALUTE', async () => {
      formDetector._setClient(makeMockClient('SALUTE'));
      const result = await formDetector.detect('enemy troops observed', MOCK_FORM_DEFS);
      assert.equal(result, 'SALUTE');
    });

    it('returns CAS when Bedrock responds with CAS', async () => {
      formDetector._setClient(makeMockClient('CAS'));
      const result = await formDetector.detect('request close air support', MOCK_FORM_DEFS);
      assert.equal(result, 'CAS');
    });

    it('returns UNKNOWN when Bedrock responds with UNKNOWN', async () => {
      formDetector._setClient(makeMockClient('UNKNOWN'));
      const result = await formDetector.detect('hello how are you', MOCK_FORM_DEFS);
      assert.equal(result, 'UNKNOWN');
    });

    it('trims whitespace from Bedrock response', async () => {
      formDetector._setClient(makeMockClient('  MEDEVAC  \n'));
      const result = await formDetector.detect('wounded soldiers', MOCK_FORM_DEFS);
      assert.equal(result, 'MEDEVAC');
    });

    it('returns UNKNOWN when Bedrock returns unrecognized text', async () => {
      formDetector._setClient(makeMockClient('HELLO'));
      const result = await formDetector.detect('random text', MOCK_FORM_DEFS);
      assert.equal(result, 'UNKNOWN');
    });

    it('returns UNKNOWN when Bedrock client throws an error', async () => {
      formDetector._setClient(makeErrorClient('Service unavailable'));
      const result = await formDetector.detect('some text', MOCK_FORM_DEFS);
      assert.equal(result, 'UNKNOWN');
    });
  });
});
