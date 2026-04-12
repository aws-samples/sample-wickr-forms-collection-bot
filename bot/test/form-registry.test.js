// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// ── Bootstrap: stub AWS SDK modules before any service loads ──────────────────
const Module = require('module');
const path   = require('path');

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

// ── Load form-registry ────────────────────────────────────────────────────────
const registry = require('../services/form-registry');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');

// ── Mock form definitions ─────────────────────────────────────────────────────

const MOCK_FORM_TEXT_ONLY = {
  id: 'TESTFORM',
  name: 'Test Form',
  command: '/testform',
  detectionHint: 'A test form.',
  fields: [
    { key: 'alpha', label: 'Alpha Field', type: 'text' },
    { key: 'bravo', label: 'Bravo Field', type: 'text' },
  ],
  extractionPrompt: 'Extract test fields.',
  correctionPrompt: 'Correct test fields.',
  formatHeader: '=== TEST FORM ===',
  formatFooter: '=================',
  outputs: [],
};

const MOCK_FORM_WITH_ENUM = {
  id: 'ENUMFORM',
  name: 'Enum Form',
  command: '/enumform',
  detectionHint: 'A form with enums.',
  fields: [
    { key: 'name',     label: 'Name',     type: 'text' },
    { key: 'priority', label: 'Priority', type: 'enum', validValues: ['HIGH', 'MEDIUM', 'LOW'] },
    { key: 'status',   label: 'Status',   type: 'enum', validValues: ['ACTIVE', 'INACTIVE'] },
  ],
  extractionPrompt: 'Extract enum fields.',
  correctionPrompt: 'Correct enum fields.',
  formatHeader: '=== ENUM FORM ===',
  formatFooter: '=================',
  outputs: [],
};

const MOCK_FORM_WITH_OPTIONAL = {
  id: 'OPTFORM',
  name: 'Optional Form',
  command: '/optform',
  detectionHint: 'A form with optional fields.',
  fields: [
    { key: 'required1', label: 'Required One', type: 'text' },
    { key: 'required2', label: 'Required Two', type: 'text' },
    { key: 'optional1', label: 'Optional One', type: 'text', optional: true },
    { key: 'optional2', label: 'Optional Two', type: 'text', optional: true },
  ],
  extractionPrompt: 'Extract optional fields.',
  correctionPrompt: 'Correct optional fields.',
  formatHeader: '=== OPTIONAL FORM ===',
  formatFooter: '=====================',
  outputs: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function createTempFormsDir(formModules) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'form-registry-test-'));
  for (const [filename, content] of Object.entries(formModules)) {
    fs.writeFileSync(path.join(tmpDir, filename), content);
  }
  return tmpDir;
}

function cleanupTempDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) fs.unlinkSync(path.join(dir, f));
  fs.rmdirSync(dir);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('form-registry', () => {

  beforeEach(() => {
    registry._formsById.clear();
    registry._formsByCommand.clear();
  });

  // ── loadForms ───────────────────────────────────────────────────────────────

  describe('loadForms', () => {
    it('discovers .js files in a directory and registers valid form definitions', () => {
      const dir = createTempFormsDir({
        'alpha.js': `module.exports = ${JSON.stringify(MOCK_FORM_TEXT_ONLY)};`,
        'bravo.js': `module.exports = ${JSON.stringify(MOCK_FORM_WITH_ENUM)};`,
      });
      try {
        registry.loadForms(dir);
        assert.equal(registry._formsById.size, 2);
        assert.ok(registry.getById('TESTFORM'));
        assert.ok(registry.getById('ENUMFORM'));
      } finally {
        cleanupTempDir(dir);
      }
    });

    it('skips files without .js extension', () => {
      const dir = createTempFormsDir({
        'valid.js': `module.exports = ${JSON.stringify(MOCK_FORM_TEXT_ONLY)};`,
        'readme.txt': 'not a form',
        'data.json': '{}',
      });
      try {
        registry.loadForms(dir);
        assert.equal(registry._formsById.size, 1);
      } finally {
        cleanupTempDir(dir);
      }
    });

    it('skips invalid form definitions missing id', () => {
      const noId = { fields: [{ key: 'a', label: 'A', type: 'text' }] };
      const dir = createTempFormsDir({
        'valid.js': `module.exports = ${JSON.stringify(MOCK_FORM_TEXT_ONLY)};`,
        'invalid.js': `module.exports = ${JSON.stringify(noId)};`,
      });
      try {
        registry.loadForms(dir);
        assert.equal(registry._formsById.size, 1);
        assert.ok(registry.getById('TESTFORM'));
      } finally {
        cleanupTempDir(dir);
      }
    });

    it('skips invalid form definitions missing fields', () => {
      const noFields = { id: 'BROKEN', name: 'Broken' };
      const dir = createTempFormsDir({
        'valid.js': `module.exports = ${JSON.stringify(MOCK_FORM_TEXT_ONLY)};`,
        'broken.js': `module.exports = ${JSON.stringify(noFields)};`,
      });
      try {
        registry.loadForms(dir);
        assert.equal(registry._formsById.size, 1);
      } finally {
        cleanupTempDir(dir);
      }
    });

    it('clears previous registrations on reload', () => {
      const dir1 = createTempFormsDir({
        'a.js': `module.exports = ${JSON.stringify(MOCK_FORM_TEXT_ONLY)};`,
      });
      const dir2 = createTempFormsDir({
        'b.js': `module.exports = ${JSON.stringify(MOCK_FORM_WITH_ENUM)};`,
      });
      try {
        registry.loadForms(dir1);
        assert.equal(registry._formsById.size, 1);
        assert.ok(registry.getById('TESTFORM'));

        registry.loadForms(dir2);
        assert.equal(registry._formsById.size, 1);
        assert.equal(registry.getById('TESTFORM'), null);
        assert.ok(registry.getById('ENUMFORM'));
      } finally {
        cleanupTempDir(dir1);
        cleanupTempDir(dir2);
      }
    });

    it('indexes forms by command when command is present', () => {
      const dir = createTempFormsDir({
        'a.js': `module.exports = ${JSON.stringify(MOCK_FORM_TEXT_ONLY)};`,
      });
      try {
        registry.loadForms(dir);
        assert.ok(registry.getByCommand('/testform'));
        assert.equal(registry.getByCommand('/testform').id, 'TESTFORM');
      } finally {
        cleanupTempDir(dir);
      }
    });

    it('does not index by command when command is null', () => {
      const noCmd = Object.assign({}, MOCK_FORM_TEXT_ONLY, { id: 'NOCMD', command: null });
      const dir = createTempFormsDir({
        'a.js': `module.exports = ${JSON.stringify(noCmd)};`,
      });
      try {
        registry.loadForms(dir);
        assert.ok(registry.getById('NOCMD'));
        assert.equal(registry._formsByCommand.size, 0);
      } finally {
        cleanupTempDir(dir);
      }
    });
  });

  // ── getById / getByCommand / getAll / getAllIds ──────────────────────────────

  describe('lookup functions', () => {
    beforeEach(() => {
      registry._formsById.set('TESTFORM', MOCK_FORM_TEXT_ONLY);
      registry._formsById.set('ENUMFORM', MOCK_FORM_WITH_ENUM);
      registry._formsByCommand.set('/testform', MOCK_FORM_TEXT_ONLY);
      registry._formsByCommand.set('/enumform', MOCK_FORM_WITH_ENUM);
    });

    it('getById returns the form definition for a known id', () => {
      assert.equal(registry.getById('TESTFORM').id, 'TESTFORM');
    });

    it('getById returns null for an unknown id', () => {
      assert.equal(registry.getById('NOPE'), null);
    });

    it('getByCommand returns the form definition for a known command', () => {
      assert.equal(registry.getByCommand('/testform').id, 'TESTFORM');
    });

    it('getByCommand returns null for an unknown command', () => {
      assert.equal(registry.getByCommand('/nope'), null);
    });

    it('getAll returns all registered form definitions', () => {
      const all = registry.getAll();
      assert.equal(all.length, 2);
      const ids = all.map(f => f.id).sort();
      assert.deepEqual(ids, ['ENUMFORM', 'TESTFORM']);
    });

    it('getAllIds returns all registered form IDs', () => {
      const ids = registry.getAllIds().sort();
      assert.deepEqual(ids, ['ENUMFORM', 'TESTFORM']);
    });
  });

  // ── formatReport / parseReport round-trip ───────────────────────────────────

  describe('formatReport and parseReport', () => {
    it('formats a text-only report with header, labels, and footer', () => {
      const report = { alpha: 'Hello', bravo: 'World' };
      const formatted = registry.formatReport(MOCK_FORM_TEXT_ONLY, report);
      assert.ok(formatted.startsWith('=== TEST FORM ==='));
      assert.ok(formatted.endsWith('================='));
      assert.ok(formatted.includes('Alpha Field: Hello'));
      assert.ok(formatted.includes('Bravo Field: World'));
    });

    it('formats null fields as NOT_PROVIDED', () => {
      const report = { alpha: null, bravo: 'World' };
      const formatted = registry.formatReport(MOCK_FORM_TEXT_ONLY, report);
      assert.ok(formatted.includes('Alpha Field: [Not provided]'));
      assert.ok(formatted.includes('Bravo Field: World'));
    });

    it('round-trips a text-only report through format then parse', () => {
      const report = { alpha: 'Grid AB 1234', bravo: 'Squad Alpha' };
      const formatted = registry.formatReport(MOCK_FORM_TEXT_ONLY, report);
      const parsed = registry.parseReport(MOCK_FORM_TEXT_ONLY, formatted);
      assert.deepEqual(parsed, report);
    });

    it('round-trips null fields: null -> NOT_PROVIDED -> null', () => {
      const report = { alpha: null, bravo: null };
      const formatted = registry.formatReport(MOCK_FORM_TEXT_ONLY, report);
      const parsed = registry.parseReport(MOCK_FORM_TEXT_ONLY, formatted);
      assert.deepEqual(parsed, { alpha: null, bravo: null });
    });

    it('round-trips a report with enum fields', () => {
      const report = { name: 'Test', priority: 'HIGH', status: 'ACTIVE' };
      const formatted = registry.formatReport(MOCK_FORM_WITH_ENUM, report);
      const parsed = registry.parseReport(MOCK_FORM_WITH_ENUM, formatted);
      assert.deepEqual(parsed, report);
    });

    it('parseReport returns all-null for empty text', () => {
      const parsed = registry.parseReport(MOCK_FORM_TEXT_ONLY, '');
      assert.deepEqual(parsed, { alpha: null, bravo: null });
    });

    it('parseReport returns all-null for null text', () => {
      const parsed = registry.parseReport(MOCK_FORM_TEXT_ONLY, null);
      assert.deepEqual(parsed, { alpha: null, bravo: null });
    });
  });

  // ── Optional field handling ─────────────────────────────────────────────────

  describe('optional field handling', () => {
    it('omits optional null fields from formatted output', () => {
      const report = { required1: 'A', required2: 'B', optional1: null, optional2: null };
      const formatted = registry.formatReport(MOCK_FORM_WITH_OPTIONAL, report);
      assert.ok(formatted.includes('Required One: A'));
      assert.ok(formatted.includes('Required Two: B'));
      assert.ok(!formatted.includes('Optional One'));
      assert.ok(!formatted.includes('Optional Two'));
    });

    it('includes optional fields when they have values', () => {
      const report = { required1: 'A', required2: 'B', optional1: 'C', optional2: null };
      const formatted = registry.formatReport(MOCK_FORM_WITH_OPTIONAL, report);
      assert.ok(formatted.includes('Optional One: C'));
      assert.ok(!formatted.includes('Optional Two'));
    });

    it('parses absent optional labels as null', () => {
      const report = { required1: 'A', required2: 'B', optional1: null, optional2: null };
      const formatted = registry.formatReport(MOCK_FORM_WITH_OPTIONAL, report);
      const parsed = registry.parseReport(MOCK_FORM_WITH_OPTIONAL, formatted);
      assert.equal(parsed.optional1, null);
      assert.equal(parsed.optional2, null);
    });

    it('round-trips optional fields with values', () => {
      const report = { required1: 'A', required2: 'B', optional1: 'C', optional2: 'D' };
      const formatted = registry.formatReport(MOCK_FORM_WITH_OPTIONAL, report);
      const parsed = registry.parseReport(MOCK_FORM_WITH_OPTIONAL, formatted);
      assert.deepEqual(parsed, report);
    });

    it('round-trips mixed optional (some null, some present)', () => {
      const report = { required1: 'A', required2: 'B', optional1: 'C', optional2: null };
      const formatted = registry.formatReport(MOCK_FORM_WITH_OPTIONAL, report);
      const parsed = registry.parseReport(MOCK_FORM_WITH_OPTIONAL, formatted);
      assert.deepEqual(parsed, report);
    });
  });

  // ── normalizeReport ─────────────────────────────────────────────────────────

  describe('normalizeReport', () => {
    it('normalizes enum fields to uppercase valid values', () => {
      const raw = { name: 'Test', priority: 'high', status: 'active' };
      const normalized = registry.normalizeReport(MOCK_FORM_WITH_ENUM, raw);
      assert.equal(normalized.priority, 'HIGH');
      assert.equal(normalized.status, 'ACTIVE');
    });

    it('sets invalid enum values to NOT_PROVIDED', () => {
      const raw = { name: 'Test', priority: 'INVALID', status: 'ACTIVE' };
      const normalized = registry.normalizeReport(MOCK_FORM_WITH_ENUM, raw);
      assert.equal(normalized.priority, '[Not provided]');
      assert.equal(normalized.status, 'ACTIVE');
    });

    it('sets null/missing enum values to NOT_PROVIDED', () => {
      const raw = { name: 'Test', priority: null, status: undefined };
      const normalized = registry.normalizeReport(MOCK_FORM_WITH_ENUM, raw);
      assert.equal(normalized.priority, '[Not provided]');
      assert.equal(normalized.status, '[Not provided]');
    });

    it('trims text field values', () => {
      const raw = { alpha: '  hello  ', bravo: 'world  ' };
      const normalized = registry.normalizeReport(MOCK_FORM_TEXT_ONLY, raw);
      assert.equal(normalized.alpha, 'hello');
      assert.equal(normalized.bravo, 'world');
    });

    it('sets empty/missing text fields to NOT_PROVIDED', () => {
      const raw = { alpha: '', bravo: null };
      const normalized = registry.normalizeReport(MOCK_FORM_TEXT_ONLY, raw);
      assert.equal(normalized.alpha, '[Not provided]');
      assert.equal(normalized.bravo, '[Not provided]');
    });

    it('sets empty optional text fields to null instead of NOT_PROVIDED', () => {
      const raw = { required1: 'A', required2: 'B', optional1: '', optional2: null };
      const normalized = registry.normalizeReport(MOCK_FORM_WITH_OPTIONAL, raw);
      assert.equal(normalized.optional1, null);
      assert.equal(normalized.optional2, null);
    });

    it('handles null raw input', () => {
      const normalized = registry.normalizeReport(MOCK_FORM_TEXT_ONLY, null);
      assert.equal(normalized.alpha, '[Not provided]');
      assert.equal(normalized.bravo, '[Not provided]');
    });
  });

  // ── isValidReport ───────────────────────────────────────────────────────────

  describe('isValidReport', () => {
    it('returns true for a report with valid enum values', () => {
      const report = { name: 'Test', priority: 'HIGH', status: 'ACTIVE' };
      assert.equal(registry.isValidReport(MOCK_FORM_WITH_ENUM, report), true);
    });

    it('returns true when enum fields are null', () => {
      const report = { name: 'Test', priority: null, status: null };
      assert.equal(registry.isValidReport(MOCK_FORM_WITH_ENUM, report), true);
    });

    it('returns true when enum fields are NOT_PROVIDED', () => {
      const report = { name: 'Test', priority: '[Not provided]', status: '[Not provided]' };
      assert.equal(registry.isValidReport(MOCK_FORM_WITH_ENUM, report), true);
    });

    it('returns false for invalid enum values', () => {
      const report = { name: 'Test', priority: 'CRITICAL', status: 'ACTIVE' };
      assert.equal(registry.isValidReport(MOCK_FORM_WITH_ENUM, report), false);
    });

    it('returns false for null report', () => {
      assert.equal(registry.isValidReport(MOCK_FORM_WITH_ENUM, null), false);
    });

    it('returns false for non-object report', () => {
      assert.equal(registry.isValidReport(MOCK_FORM_WITH_ENUM, 'string'), false);
    });

    it('returns true for text-only forms regardless of field values', () => {
      const report = { alpha: 'anything', bravo: 'goes here' };
      assert.equal(registry.isValidReport(MOCK_FORM_TEXT_ONLY, report), true);
    });
  });

  // ── createReport ────────────────────────────────────────────────────────────

  describe('createReport', () => {
    it('creates a report with all fields set to null when no fields provided', () => {
      const report = registry.createReport(MOCK_FORM_TEXT_ONLY);
      assert.deepEqual(report, { alpha: null, bravo: null });
    });

    it('creates a report with provided field values', () => {
      const report = registry.createReport(MOCK_FORM_TEXT_ONLY, { alpha: 'A', bravo: 'B' });
      assert.deepEqual(report, { alpha: 'A', bravo: 'B' });
    });

    it('ignores extra fields not in the form definition', () => {
      const report = registry.createReport(MOCK_FORM_TEXT_ONLY, { alpha: 'A', bravo: 'B', extra: 'X' });
      assert.deepEqual(report, { alpha: 'A', bravo: 'B' });
    });

    it('sets missing fields to null', () => {
      const report = registry.createReport(MOCK_FORM_TEXT_ONLY, { alpha: 'A' });
      assert.deepEqual(report, { alpha: 'A', bravo: null });
    });
  });

  // ── formatBroadcast ─────────────────────────────────────────────────────────

  describe('formatBroadcast', () => {
    it('includes sender and timestamp in broadcast output', () => {
      const report = { alpha: 'Hello', bravo: 'World' };
      const broadcast = registry.formatBroadcast(MOCK_FORM_TEXT_ONLY, report, 'soldier@mil', '2025-01-15T10:30:00Z');
      assert.ok(broadcast.includes('Submitted by: soldier@mil'));
      assert.ok(broadcast.includes('Timestamp: 2025-01-15T10:30:00Z'));
      assert.ok(broadcast.includes('Alpha Field: Hello'));
      assert.ok(broadcast.startsWith('=== TEST FORM ==='));
      assert.ok(broadcast.endsWith('================='));
    });

    it('omits optional null fields from broadcast output', () => {
      const report = { required1: 'A', required2: 'B', optional1: null, optional2: null };
      const broadcast = registry.formatBroadcast(MOCK_FORM_WITH_OPTIONAL, report, 'user', '2025-01-01T00:00:00Z');
      assert.ok(!broadcast.includes('Optional One'));
      assert.ok(!broadcast.includes('Optional Two'));
    });
  });

  // ── _formatOverride / _parseOverride delegation ─────────────────────────────

  describe('override delegation', () => {
    it('delegates formatReport to _formatOverride when present', () => {
      const overrideForm = Object.assign({}, MOCK_FORM_TEXT_ONLY, {
        _formatOverride: (report) => 'CUSTOM:' + report.alpha,
      });
      const result = registry.formatReport(overrideForm, { alpha: 'test', bravo: 'x' });
      assert.equal(result, 'CUSTOM:test');
    });

    it('delegates parseReport to _parseOverride when present', () => {
      const overrideForm = Object.assign({}, MOCK_FORM_TEXT_ONLY, {
        _parseOverride: (text) => ({ alpha: text.slice(0, 3), bravo: text.slice(3) }),
      });
      const result = registry.parseReport(overrideForm, 'ABCDEF');
      assert.deepEqual(result, { alpha: 'ABC', bravo: 'DEF' });
    });

    it('delegates formatBroadcast to _formatBroadcastOverride when present', () => {
      const overrideForm = Object.assign({}, MOCK_FORM_TEXT_ONLY, {
        _formatBroadcastOverride: (report, sender, ts) => `${sender}@${ts}:${report.alpha}`,
      });
      const result = registry.formatBroadcast(overrideForm, { alpha: 'val' }, 'user', 'ts');
      assert.equal(result, 'user@ts:val');
    });

    it('uses generic format when no _formatOverride is set', () => {
      const report = { alpha: 'A', bravo: 'B' };
      const result = registry.formatReport(MOCK_FORM_TEXT_ONLY, report);
      assert.ok(result.includes('Alpha Field: A'));
    });

    it('uses generic parse when no _parseOverride is set', () => {
      const formatted = registry.formatReport(MOCK_FORM_TEXT_ONLY, { alpha: 'A', bravo: 'B' });
      const parsed = registry.parseReport(MOCK_FORM_TEXT_ONLY, formatted);
      assert.deepEqual(parsed, { alpha: 'A', bravo: 'B' });
    });
  });

  // ── Exported constants ──────────────────────────────────────────────────────

  describe('exported constants', () => {
    it('exports NOT_PROVIDED as [Not provided]', () => {
      assert.equal(registry.NOT_PROVIDED, '[Not provided]');
    });

    it('exports LABEL_SEP as ": "', () => {
      assert.equal(registry.LABEL_SEP, ': ');
    });
  });
});
