// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// ── Bootstrap: stub AWS SDK modules before any service loads ──────────────────
const Module = require('module');

const _originalResolve = Module._resolveFilename;

const AWS_BEDROCK_KEY    = '__aws_bedrock_runtime_stub__';
const AWS_S3_KEY         = '__aws_s3_stub__';
const AWS_TRANSCRIBE_KEY = '__aws_transcribe_stub__';

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@aws-sdk/client-bedrock-runtime') return AWS_BEDROCK_KEY;
  if (request === '@aws-sdk/client-s3')              return AWS_S3_KEY;
  if (request === '@aws-sdk/client-transcribe')      return AWS_TRANSCRIBE_KEY;
  return _originalResolve.call(this, request, parent, isMain, options);
};

function makeAWSStub(name, exports) {
  return {
    id: name, filename: name, loaded: true,
    exports,
    parent: null, children: [], paths: [],
  };
}

require.cache[AWS_BEDROCK_KEY] = makeAWSStub(AWS_BEDROCK_KEY, {
  BedrockRuntimeClient: class { constructor() {} async send() { throw new Error('stub'); } },
  InvokeModelCommand:   class { constructor(p) { this.params = p; } },
});
require.cache[AWS_S3_KEY] = makeAWSStub(AWS_S3_KEY, {
  S3Client:            class { constructor() {} async send() {} },
  PutObjectCommand:    class { constructor(p) { this.params = p; } },
  DeleteObjectCommand: class { constructor(p) { this.params = p; } },
});
require.cache[AWS_TRANSCRIBE_KEY] = makeAWSStub(AWS_TRANSCRIBE_KEY, {
  TranscribeClient:                class { constructor() {} async send() {} },
  StartTranscriptionJobCommand:    class { constructor(p) { this.params = p; } },
  GetTranscriptionJobCommand:      class { constructor(p) { this.params = p; } },
});

// ── Load real modules (no AWS SDK dependencies in nineline-model or form-registry) ──
const ninelineModel = require('../services/nineline-model');
const medevacDef    = require('../forms/medevac');
const registry      = require('../services/form-registry');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE_NINE_LINE = {
  location:    'AB 1234 5678',
  callsign:    'DUSTOFF 7-2, freq 33.45',
  precedence:  'URGENT',
  equipment:   'HOIST',
  patientType: '2 LITTER, 1 AMBULATORY',
  security:    'POSSIBLE ENEMY',
  marking:     'SMOKE GREEN',
  nationality: 'US MILITARY',
  nbc:         'NONE',
};

const SAMPLE_WITH_NULLS = {
  location:    null,
  callsign:    null,
  precedence:  null,
  equipment:   null,
  patientType: null,
  security:    null,
  marking:     null,
  nationality: null,
  nbc:         null,
};

const SAMPLE_SENDER    = 'soldier@mil';
const SAMPLE_TIMESTAMP = '2025-01-15T10:30:00.000Z';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Backward compatibility: MEDEVAC form definition vs nineline-model', () => {

  // ── _formatOverride ─────────────────────────────────────────────────────────

  describe('_formatOverride matches ninelineModel.format', () => {
    it('produces identical output for a fully populated Nine_Line_Request', () => {
      const fromOverride = medevacDef._formatOverride(SAMPLE_NINE_LINE);
      const fromModel    = ninelineModel.format(SAMPLE_NINE_LINE);
      assert.equal(fromOverride, fromModel);
    });

    it('produces identical output for a Nine_Line_Request with all null fields', () => {
      const fromOverride = medevacDef._formatOverride(SAMPLE_WITH_NULLS);
      const fromModel    = ninelineModel.format(SAMPLE_WITH_NULLS);
      assert.equal(fromOverride, fromModel);
    });
  });

  // ── _parseOverride ──────────────────────────────────────────────────────────

  describe('_parseOverride matches ninelineModel.parse', () => {
    it('produces identical output for formatted text from a full report', () => {
      const text         = ninelineModel.format(SAMPLE_NINE_LINE);
      const fromOverride = medevacDef._parseOverride(text);
      const fromModel    = ninelineModel.parse(text);
      assert.deepEqual(fromOverride, fromModel);
    });

    it('produces identical output for formatted text with null fields', () => {
      const text         = ninelineModel.format(SAMPLE_WITH_NULLS);
      const fromOverride = medevacDef._parseOverride(text);
      const fromModel    = ninelineModel.parse(text);
      assert.deepEqual(fromOverride, fromModel);
    });
  });

  // ── _formatBroadcastOverride ────────────────────────────────────────────────

  describe('_formatBroadcastOverride matches ninelineModel.formatBroadcast', () => {
    it('produces identical output for a full report with sender and timestamp', () => {
      const fromOverride = medevacDef._formatBroadcastOverride(SAMPLE_NINE_LINE, SAMPLE_SENDER, SAMPLE_TIMESTAMP);
      const fromModel    = ninelineModel.formatBroadcast(SAMPLE_NINE_LINE, SAMPLE_SENDER, SAMPLE_TIMESTAMP);
      assert.equal(fromOverride, fromModel);
    });

    it('produces identical output for a null-field report with sender and timestamp', () => {
      const fromOverride = medevacDef._formatBroadcastOverride(SAMPLE_WITH_NULLS, SAMPLE_SENDER, SAMPLE_TIMESTAMP);
      const fromModel    = ninelineModel.formatBroadcast(SAMPLE_WITH_NULLS, SAMPLE_SENDER, SAMPLE_TIMESTAMP);
      assert.equal(fromOverride, fromModel);
    });
  });

  // ── Registry delegation ─────────────────────────────────────────────────────

  describe('registry.formatReport delegates to _formatOverride for MEDEVAC', () => {
    it('matches ninelineModel.format for a full report', () => {
      const fromRegistry = registry.formatReport(medevacDef, SAMPLE_NINE_LINE);
      const fromModel    = ninelineModel.format(SAMPLE_NINE_LINE);
      assert.equal(fromRegistry, fromModel);
    });
  });

  describe('registry.parseReport delegates to _parseOverride for MEDEVAC', () => {
    it('matches ninelineModel.parse for formatted text', () => {
      const text         = ninelineModel.format(SAMPLE_NINE_LINE);
      const fromRegistry = registry.parseReport(medevacDef, text);
      const fromModel    = ninelineModel.parse(text);
      assert.deepEqual(fromRegistry, fromModel);
    });
  });
});
