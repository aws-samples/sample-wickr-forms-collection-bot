// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// -- Bootstrap: stub AWS SDK modules before any service loads ------------------
const Module = require('module');

const AWS_BEDROCK_KEY = '__aws_bedrock_runtime_stub_detector__';

const _originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@aws-sdk/client-bedrock-runtime') return AWS_BEDROCK_KEY;
  return _originalResolve.call(this, request, parent, isMain, options);
};

require.cache[AWS_BEDROCK_KEY] = {
  id: AWS_BEDROCK_KEY, filename: AWS_BEDROCK_KEY, loaded: true,
  exports: {
    BedrockRuntimeClient: class { constructor() {} async send() { throw new Error('stub'); } },
    InvokeModelCommand: class { constructor(p) { this.params = p; } },
  },
  parent: null, children: [], paths: [],
};

// -- Load module under test ----------------------------------------------------
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const formDetector = require('../services/form-detector');

// -- Test helpers --------------------------------------------------------------

const MOCK_FORM_DEFS = [
  { id: 'INCIDENT', detectionHint: 'A workplace incident report. Keywords: incident, spill, injury, accident.' },
  { id: 'SHIFT_HANDOFF', detectionHint: 'A shift handoff report for patient status. Keywords: handoff, shift change, vitals.' },
  { id: 'DELIVERY_LOG', detectionHint: 'A delivery log entry. Keywords: delivery, shipment, package, received.' },
];

/**
 * Creates a mock Bedrock client whose send() returns the given text in
 * the standard Anthropic response format.
 */
function makeMockClient(responseText) {
  return {
    async send() {
      const body = JSON.stringify({
        content: [{ text: responseText }],
      });
      return { body: Buffer.from(body, 'utf8') };
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

// -- Tests ---------------------------------------------------------------------

describe('form-detector', () => {

  describe('buildDetectionPrompt', () => {
    it('includes all form IDs in the prompt', () => {
      const prompt = formDetector.buildDetectionPrompt(MOCK_FORM_DEFS);
      assert.ok(prompt.includes('INCIDENT'), 'prompt should include INCIDENT');
      assert.ok(prompt.includes('SHIFT_HANDOFF'), 'prompt should include SHIFT_HANDOFF');
      assert.ok(prompt.includes('DELIVERY_LOG'), 'prompt should include DELIVERY_LOG');
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

    it('returns INCIDENT when Bedrock responds with INCIDENT', async () => {
      formDetector._setClient(makeMockClient('INCIDENT'));
      const result = await formDetector.detect('chemical spill in loading dock', MOCK_FORM_DEFS);
      assert.equal(result, 'INCIDENT');
    });

    it('returns SHIFT_HANDOFF when Bedrock responds with SHIFT_HANDOFF', async () => {
      formDetector._setClient(makeMockClient('SHIFT_HANDOFF'));
      const result = await formDetector.detect('handoff for Bed 12A', MOCK_FORM_DEFS);
      assert.equal(result, 'SHIFT_HANDOFF');
    });

    it('returns DELIVERY_LOG when Bedrock responds with DELIVERY_LOG', async () => {
      formDetector._setClient(makeMockClient('DELIVERY_LOG'));
      const result = await formDetector.detect('FedEx package received at dock', MOCK_FORM_DEFS);
      assert.equal(result, 'DELIVERY_LOG');
    });

    it('returns UNKNOWN when Bedrock responds with UNKNOWN', async () => {
      formDetector._setClient(makeMockClient('UNKNOWN'));
      const result = await formDetector.detect('hello how are you', MOCK_FORM_DEFS);
      assert.equal(result, 'UNKNOWN');
    });

    it('trims whitespace from Bedrock response', async () => {
      formDetector._setClient(makeMockClient('  INCIDENT  \n'));
      const result = await formDetector.detect('accident in building A', MOCK_FORM_DEFS);
      assert.equal(result, 'INCIDENT');
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
