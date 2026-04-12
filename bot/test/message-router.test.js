// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// -- Bootstrap: stub AWS SDK modules before any service loads -----------------
const Module = require('module');
const path   = require('path');

const _originalResolve = Module._resolveFilename;

const AWS_BEDROCK_KEY   = '__aws_bedrock_runtime_stub__';
const AWS_S3_KEY        = '__aws_s3_stub__';
const AWS_TRANSCRIBE_KEY = '__aws_transcribe_stub__';

// Intercept requires for AWS SDK packages
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@aws-sdk/client-bedrock-runtime') return AWS_BEDROCK_KEY;
  if (request === '@aws-sdk/client-s3')              return AWS_S3_KEY;
  if (request === '@aws-sdk/client-transcribe')      return AWS_TRANSCRIBE_KEY;
  return _originalResolve.call(this, request, parent, isMain, options);
};

// Register AWS SDK stub modules in require cache
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

// -- Mutable stub state containers ----------------------------------------------
let _extractStub       = null;
let _extractFormStub   = null;
let _extractCorrectionStub = null;
let _transcribeStub    = null;
let _detectStub        = null;
let _deliverStub       = null;
let _formCommandsHandleStub = null;

// -- Mock form definitions for registry stub ------------------------------------
const MOCK_MEDEVAC_DEF = {
  id: 'MEDEVAC', name: '9-Line MEDEVAC Request', command: '/9line',
  detectionHint: 'MEDEVAC hint',
  fields: [
    { key: 'location',    label: 'Line 1 (Location)',            type: 'text' },
    { key: 'callsign',    label: 'Line 2 (Callsign)',            type: 'text' },
    { key: 'precedence',  label: 'Line 3 (Precedence)',          type: 'enum', validValues: ['URGENT', 'ROUTINE'] },
    { key: 'equipment',   label: 'Line 4 (Equipment)',           type: 'enum', validValues: ['NONE', 'HOIST'] },
    { key: 'patientType', label: 'Line 5 (# Patients by Type)',  type: 'text' },
    { key: 'security',    label: 'Line 6 (Security)',            type: 'enum', validValues: ['NO ENEMY TROOPS', 'POSSIBLE ENEMY'] },
    { key: 'marking',     label: 'Line 7 (Marking)',             type: 'text' },
    { key: 'nationality', label: 'Line 8 (Nationality)',         type: 'enum', validValues: ['US MILITARY', 'US CIVILIAN'] },
    { key: 'nbc',         label: 'Line 9 (NBC)',                 type: 'enum', validValues: ['NONE', 'NUCLEAR'] },
  ],
  formatHeader: '=== 9-LINE MEDEVAC REQUEST ===',
  formatFooter: '==============================',
  outputs: [{ type: 'wickr-room', kvKey: 'MEDIC_ROOM_VGROUPID', envVar: 'MEDIC_ROOM_VGROUPID' }],
  _formatOverride: null, _parseOverride: null, _formatBroadcastOverride: null,
};

const MOCK_SALUTE_DEF = {
  id: 'SALUTE', name: 'SALUTE Report', command: '/salute',
  detectionHint: 'SALUTE hint',
  fields: [
    { key: 'size',      label: 'S - Size',      type: 'text' },
    { key: 'activity',  label: 'A - Activity',  type: 'text' },
    { key: 'location',  label: 'L - Location',  type: 'text' },
    { key: 'unit',      label: 'U - Unit',      type: 'text' },
    { key: 'time',      label: 'T - Time',      type: 'text' },
    { key: 'equipment', label: 'E - Equipment', type: 'text' },
  ],
  formatHeader: '=== SALUTE REPORT ===',
  formatFooter: '=====================',
  outputs: [
    { type: 'wickr-room', kvKey: 'SALUTE_ROOM_VGROUPID', envVar: 'SALUTE_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'salute-reports/' },
  ],
};

const MOCK_CAS_DEF = {
  id: 'CAS', name: '9-Line CAS Brief', command: '/cas',
  detectionHint: 'CAS hint',
  fields: [
    { key: 'jtac', label: 'JTAC', type: 'text' },
    { key: 'targetLocation', label: 'Line 6 (Target Location)', type: 'text' },
  ],
  formatHeader: '=== 9-LINE CAS BRIEF ===',
  formatFooter: '========================',
  outputs: [
    { type: 'wickr-room', kvKey: 'CAS_ROOM_VGROUPID', envVar: 'CAS_ROOM_VGROUPID' },
    { type: 'webhook', kvKey: 'CAS_WEBHOOK_URL', envVar: 'CAS_WEBHOOK_URL' },
  ],
};

// -- Register service stubs into require cache BEFORE loading message-router ----

// extraction-engine stub
const EXTRACTION_MODULE_PATH = path.resolve(__dirname, '../services/extraction-engine.js');
require.cache[EXTRACTION_MODULE_PATH] = {
  id: EXTRACTION_MODULE_PATH, filename: EXTRACTION_MODULE_PATH, loaded: true,
  exports: {
    extract: async (...args) => {
      if (typeof _extractStub === 'function') return _extractStub(...args);
      throw new Error('_extractStub not set');
    },
    extractForm: async (...args) => {
      if (typeof _extractFormStub === 'function') return _extractFormStub(...args);
      throw new Error('_extractFormStub not set');
    },
    extractCorrection: async (...args) => {
      if (typeof _extractCorrectionStub === 'function') return _extractCorrectionStub(...args);
      throw new Error('_extractCorrectionStub not set');
    },
    _setClient: () => {},
  },
  parent: null, children: [], paths: [],
};

// transcription-service stub
const TRANSCRIPTION_MODULE_PATH = path.resolve(__dirname, '../services/transcription-service.js');
require.cache[TRANSCRIPTION_MODULE_PATH] = {
  id: TRANSCRIPTION_MODULE_PATH, filename: TRANSCRIPTION_MODULE_PATH, loaded: true,
  exports: {
    transcribe: async (...args) => {
      if (typeof _transcribeStub === 'function') return _transcribeStub(...args);
      throw new Error('_transcribeStub not set');
    },
  },
  parent: null, children: [], paths: [],
};

// form-detector stub
const FORM_DETECTOR_MODULE_PATH = path.resolve(__dirname, '../services/form-detector.js');
require.cache[FORM_DETECTOR_MODULE_PATH] = {
  id: FORM_DETECTOR_MODULE_PATH, filename: FORM_DETECTOR_MODULE_PATH, loaded: true,
  exports: {
    detect: async (...args) => {
      if (typeof _detectStub === 'function') return _detectStub(...args);
      return 'UNKNOWN';
    },
    _setClient: () => {},
    buildDetectionPrompt: () => '',
  },
  parent: null, children: [], paths: [],
};

// form-registry stub
const FORM_REGISTRY_MODULE_PATH = path.resolve(__dirname, '../services/form-registry.js');
const _registryForms = new Map();
require.cache[FORM_REGISTRY_MODULE_PATH] = {
  id: FORM_REGISTRY_MODULE_PATH, filename: FORM_REGISTRY_MODULE_PATH, loaded: true,
  exports: {
    loadForms: () => {},
    getById: (id) => _registryForms.get(id) || null,
    getByCommand: (cmd) => {
      for (const f of _registryForms.values()) {
        if (f.command === cmd) return f;
      }
      return null;
    },
    getAll: () => Array.from(_registryForms.values()),
    getAllIds: () => Array.from(_registryForms.keys()),
    formatReport: (formDef, report) => {
      const lines = [formDef.formatHeader];
      for (const field of formDef.fields) {
        if (field.optional && (report[field.key] == null)) continue;
        const value = report[field.key] != null ? report[field.key] : '[Not provided]';
        lines.push(field.label + ': ' + value);
      }
      lines.push(formDef.formatFooter);
      return lines.join('\n');
    },
    formatBroadcast: (formDef, report, sender, timestamp) => {
      const parts = [formDef.formatHeader, 'Submitted by: ' + sender, 'Timestamp: ' + timestamp, ''];
      for (const field of formDef.fields) {
        if (field.optional && (report[field.key] == null)) continue;
        const value = report[field.key] != null ? report[field.key] : '[Not provided]';
        parts.push(field.label + ': ' + value);
      }
      parts.push(formDef.formatFooter);
      return parts.join('\n');
    },
    normalizeReport: (formDef, raw) => raw,
    NOT_PROVIDED: '[Not provided]',
    LABEL_SEP: ': ',
    _formsById: _registryForms,
    _formsByCommand: new Map(),
  },
  parent: null, children: [], paths: [],
};

// delivery-service stub
const DELIVERY_SERVICE_MODULE_PATH = path.resolve(__dirname, '../services/delivery-service.js');
require.cache[DELIVERY_SERVICE_MODULE_PATH] = {
  id: DELIVERY_SERVICE_MODULE_PATH, filename: DELIVERY_SERVICE_MODULE_PATH, loaded: true,
  exports: {
    deliver: async (...args) => {
      if (typeof _deliverStub === 'function') return _deliverStub(...args);
      return { successes: [], failures: [] };
    },
    loadOutputConfigs: async () => {},
    saveConfig: async () => {},
    getConfig: () => null,
    _setS3Client: () => {},
    _reset: () => {},
  },
  parent: null, children: [], paths: [],
};

// form-commands stub
const FORM_COMMANDS_MODULE_PATH = path.resolve(__dirname, '../services/form-commands.js');
require.cache[FORM_COMMANDS_MODULE_PATH] = {
  id: FORM_COMMANDS_MODULE_PATH, filename: FORM_COMMANDS_MODULE_PATH, loaded: true,
  exports: {
    handle: async (...args) => {
      if (typeof _formCommandsHandleStub === 'function') return _formCommandsHandleStub(...args);
    },
  },
  parent: null, children: [], paths: [],
};

// -- Load message-router AFTER all stubs are in the require cache ---------------
const messageRouter = require('../services/message-router');

// -- Node built-in test runner --------------------------------------------------
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// -- Test fixtures ---------------------------------------------------------------

const SAMPLE_NINE_LINE = {
  location:    'AB 1234 5678',
  callsign:    'DUSTOFF 7-2, freq 33.45',
  precedence:  'URGENT',
  equipment:   'NONE',
  patientType: '2 LITTER, 1 AMBULATORY',
  security:    'POSSIBLE ENEMY',
  marking:     'SMOKE GREEN',
  nationality: 'US MILITARY',
  nbc:         'NONE',
};

/** Build a minimal parsed Wickr text message. */
function makeParsed(overrides) {
  return Object.assign({
    userEmail: 'soldier@example.com',
    vgroupid:  'Sroom-sender',
    msgtype:   'message',
    message:   'Soldier down at grid AB 1234, urgent evac needed',
  }, overrides || {});
}

/** Build a parsed Wickr file message (voice memo). */
function makeFileParsed(overrides) {
  return Object.assign({
    userEmail:   'soldier@example.com',
    vgroupid:    'Sroom-sender',
    msgtype:     'file',
    isFile:      true,
    isVoiceMemo: true,
    filePath:    '/tmp/voice.mp3',
    filename:    'voice.mp3',
    contentType: 'audio/mpeg',
    message:     '',
  }, overrides || {});
}

/** Create a sendReply spy. */
function makeSendReply() {
  const calls = [];
  const fn = async (vgroupid, text) => { calls.push({ vgroupid, text }); };
  fn.calls = calls;
  return fn;
}

// -- Helpers --------------------------------------------------------------------

function resetStubs() {
  _extractStub      = null;
  _extractFormStub  = null;
  _extractCorrectionStub = null;
  _transcribeStub   = null;
  _detectStub       = null;
  _deliverStub      = null;
  _formCommandsHandleStub = null;
}

function clearAllPending() {
  messageRouter._pendingConfirmations.clear();
}

function setupRegistry() {
  _registryForms.clear();
  _registryForms.set('MEDEVAC', MOCK_MEDEVAC_DEF);
  _registryForms.set('SALUTE', MOCK_SALUTE_DEF);
  _registryForms.set('CAS', MOCK_CAS_DEF);
}

// -- Tests ----------------------------------------------------------------------

describe('message-router', () => {

  beforeEach(() => {
    resetStubs();
    clearAllPending();
    setupRegistry();
    delete process.env.BOT_USERNAME;
  });

  afterEach(() => {
    clearAllPending();
    delete process.env.BOT_USERNAME;
  });

  // -- Module exports -----------------------------------------------------------

  describe('module exports', () => {
    it('exports route, handleNonCommand, getPending, setPending, clearPending', () => {
      assert.equal(typeof messageRouter.route,           'function');
      assert.equal(typeof messageRouter.handleNonCommand,'function');
      assert.equal(typeof messageRouter.getPending,      'function');
      assert.equal(typeof messageRouter.setPending,      'function');
      assert.equal(typeof messageRouter.clearPending,    'function');
    });

    it('pending store starts empty', () => {
      assert.equal(messageRouter.getPending('nobody'), null);
    });
  });

  // -- Pending confirmation store API -------------------------------------------

  describe('getPending / setPending / clearPending', () => {
    it('getPending returns null for unknown user', () => {
      assert.equal(messageRouter.getPending('user-xyz'), null);
    });

    it('setPending stores a report with formType for a user', () => {
      messageRouter.setPending('user-abc', 'MEDEVAC', SAMPLE_NINE_LINE);
      assert.deepEqual(messageRouter.getPending('user-abc'), { formType: 'MEDEVAC', report: SAMPLE_NINE_LINE });
    });

    it('clearPending removes the stored report', () => {
      messageRouter.setPending('user-abc', 'MEDEVAC', SAMPLE_NINE_LINE);
      messageRouter.clearPending('user-abc');
      assert.equal(messageRouter.getPending('user-abc'), null);
    });

    it('setPending overwrites a previous value', () => {
      const first  = Object.assign({}, SAMPLE_NINE_LINE, { location: 'FIRST' });
      const second = Object.assign({}, SAMPLE_NINE_LINE, { location: 'SECOND' });
      messageRouter.setPending('user-abc', 'MEDEVAC', first);
      messageRouter.setPending('user-abc', 'MEDEVAC', second);
      assert.deepEqual(messageRouter.getPending('user-abc'), { formType: 'MEDEVAC', report: second });
    });

    it('different users have independent pending states', () => {
      messageRouter.setPending('user-a', 'MEDEVAC', SAMPLE_NINE_LINE);
      assert.equal(messageRouter.getPending('user-b'), null);
    });
  });

  // -- Self-message filtering ---------------------------------------------------

  describe('self-message filtering', () => {
    it('discards messages where sender equals BOT_USERNAME', async () => {
      process.env.BOT_USERNAME = 'bot@example.com';
      let formCommandsCalled = false;
      _formCommandsHandleStub = async () => { formCommandsCalled = true; };
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ userEmail: 'bot@example.com', message: 'Hello' }),
        reply
      );

      assert.equal(reply.calls.length, 0,    'should send no reply for own message');
      assert.equal(formCommandsCalled,  false, 'should not route own message');
    });

    it('does not discard messages from other users when BOT_USERNAME is set', async () => {
      process.env.BOT_USERNAME = 'bot@example.com';
      let detectCalled = false;
      _detectStub = async () => { detectCalled = true; return 'MEDEVAC'; };
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'Trooper down' }),
        reply
      );

      assert.equal(detectCalled, true, 'non-bot user message should be processed');
    });

    it('processes all messages when BOT_USERNAME is not set', async () => {
      delete process.env.BOT_USERNAME;
      let detectCalled = false;
      _detectStub = async () => { detectCalled = true; return 'MEDEVAC'; };
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ userEmail: 'anyone@example.com', message: 'Trooper down' }),
        reply
      );

      assert.equal(detectCalled, true);
    });
  });

  // -- Command routing ----------------------------------------------------------

  describe('/9line command routing', () => {
    it('routes /9line help to form-commands handler via registry', async () => {
      let receivedFormDef = null;
      let receivedArgs = null;
      _formCommandsHandleStub = async (formDef, parsed, args) => {
        receivedFormDef = formDef;
        receivedArgs = args;
      };

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: '/9line help' }),
        reply
      );

      assert.equal(receivedFormDef.id, 'MEDEVAC');
      assert.equal(receivedArgs, 'help');
    });

    it('routes /9line set-room to form-commands handler', async () => {
      let receivedFormDef = null;
      let receivedArgs = null;
      _formCommandsHandleStub = async (formDef, parsed, args) => {
        receivedFormDef = formDef;
        receivedArgs = args;
      };

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: '/9line set-room' }),
        reply
      );

      assert.equal(receivedFormDef.id, 'MEDEVAC');
      assert.equal(receivedArgs, 'set-room');
    });

    it('routes /9line status to form-commands handler', async () => {
      let receivedFormDef = null;
      _formCommandsHandleStub = async (formDef) => { receivedFormDef = formDef; };

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: '/9line status' }),
        reply
      );

      assert.equal(receivedFormDef.id, 'MEDEVAC');
    });

    it('does NOT call extraction engine for /9line commands', async () => {
      _formCommandsHandleStub = async () => {};
      let detectCalled = false;
      _detectStub = async () => { detectCalled = true; return 'MEDEVAC'; };

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: '/9line help' }),
        reply
      );

      assert.equal(detectCalled, false);
    });
  });

  // -- Registry-based command routing (NEW) -------------------------------------

  describe('/salute and /cas command routing', () => {
    it('routes /salute help to form-commands handler', async () => {
      let receivedFormDef = null;
      let receivedArgs = null;
      _formCommandsHandleStub = async (formDef, parsed, args) => {
        receivedFormDef = formDef;
        receivedArgs = args;
      };

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: '/salute help' }),
        reply
      );

      assert.equal(receivedFormDef.id, 'SALUTE');
      assert.equal(receivedArgs, 'help');
    });

    it('routes /cas status to form-commands handler', async () => {
      let receivedFormDef = null;
      let receivedArgs = null;
      _formCommandsHandleStub = async (formDef, parsed, args) => {
        receivedFormDef = formDef;
        receivedArgs = args;
      };

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: '/cas status' }),
        reply
      );

      assert.equal(receivedFormDef.id, 'CAS');
      assert.equal(receivedArgs, 'status');
    });

    it('does NOT call form-detector for /salute commands', async () => {
      _formCommandsHandleStub = async () => {};
      let detectCalled = false;
      _detectStub = async () => { detectCalled = true; return 'SALUTE'; };

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: '/salute help' }),
        reply
      );

      assert.equal(detectCalled, false);
    });
  });

  // -- File message routing -----------------------------------------------------

  describe('file message routing', () => {
    it('routes voice memo (isVoiceMemo=true) to transcription pipeline', async () => {
      let transcribeCalled = false;
      _transcribeStub = async () => { transcribeCalled = true; return 'transcribed text'; };
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeFileParsed({ isVoiceMemo: true }),
        reply
      );

      assert.equal(transcribeCalled, true);
    });

    it('sends an acknowledgment before transcribing', async () => {
      _transcribeStub = async () => 'transcribed text';
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeFileParsed({ isVoiceMemo: true }),
        reply
      );

      assert.ok(
        reply.calls.some(c => c.text.toLowerCase().includes('transcrib')),
        'should send an acknowledgment mentioning transcription'
      );
    });

    it('routes audio/mpeg content type to transcription', async () => {
      let transcribeCalled = false;
      _transcribeStub = async () => { transcribeCalled = true; return 'text'; };
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeFileParsed({ isVoiceMemo: false, contentType: 'audio/mpeg' }),
        reply
      );

      assert.equal(transcribeCalled, true);
    });

    it('ignores non-audio file messages silently', async () => {
      let transcribeCalled = false;
      _transcribeStub = async () => { transcribeCalled = true; return 'text'; };

      const reply = makeSendReply();
      await messageRouter.route(
        makeFileParsed({
          isVoiceMemo: false,
          contentType: 'image/jpeg',
          isFile:      true,
          msgtype:     'file',
        }),
        reply
      );

      assert.equal(transcribeCalled,   false, 'should not transcribe non-audio files');
      assert.equal(reply.calls.length, 0,     'should send no reply for non-audio file');
    });

    it('notifies user and suggests text when transcription fails', async () => {
      _transcribeStub = async () => { throw new Error('Transcription job failed'); };

      const reply = makeSendReply();
      await messageRouter.route(
        makeFileParsed({ isVoiceMemo: true }),
        reply
      );

      const texts = reply.calls.map(c => c.text.toLowerCase());
      assert.ok(
        texts.some(t => t.includes('failed') || t.includes('try again') || t.includes('text message')),
        'should notify user about transcription failure'
      );
    });

    it('handles missing file path gracefully', async () => {
      const reply = makeSendReply();
      await messageRouter.route(
        makeFileParsed({ isVoiceMemo: true, filePath: '', file: '' }),
        reply
      );

      assert.equal(reply.calls.length, 1);
      const txt = reply.calls[0].text.toLowerCase();
      assert.ok(
        txt.includes('missing') || txt.includes('path') || txt.includes('process'),
        'should mention file path issue'
      );
    });
  });

  // -- Form detection flow (NEW) ------------------------------------------------

  describe('form detection flow', () => {
    it('calls detect() then extractForm() for non-command text with no pending', async () => {
      let detectText = null;
      let extractText = null;
      _detectStub = async (text) => { detectText = text; return 'MEDEVAC'; };
      _extractFormStub = async (text, formDef) => { extractText = text; return SAMPLE_NINE_LINE; };

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: 'Soldier down at grid AB 1234' }),
        reply
      );

      assert.equal(detectText, 'Soldier down at grid AB 1234');
      assert.equal(extractText, 'Soldier down at grid AB 1234');
    });

    it('formats the extraction result and presents a confirmation card', async () => {
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: 'MEDEVAC needed' }),
        reply
      );

      assert.ok(reply.calls.length >= 1, 'should send at least one reply');
      const cardText = reply.calls[0].text;
      assert.ok(cardText.includes('Line 1 (Location)'),   'should include Line 1 label');
      assert.ok(cardText.includes('AB 1234 5678'),         'should include location value');
      assert.ok(cardText.toUpperCase().includes('YES'),    'should prompt user to type YES');
    });

    it('stores the report in pending-confirmation state after extraction', async () => {
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ userEmail: 'test-user@example.com', message: 'MEDEVAC needed' }),
        reply
      );

      const pending = messageRouter.getPending('test-user@example.com');
      assert.ok(pending !== null, 'should have pending state after extraction');
      assert.deepEqual(pending, { formType: 'MEDEVAC', report: SAMPLE_NINE_LINE });
    });

    it('sends a user-friendly error when extractForm returns an error object', async () => {
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => ({ error: 'Extraction service temporarily unavailable.' });

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: 'some text' }),
        reply
      );

      assert.equal(reply.calls.length, 1);
      const txt = reply.calls[0].text.toLowerCase();
      assert.ok(
        txt.includes('could not') || txt.includes('unavailable') || txt.includes('extract'),
        'should forward the error message to user'
      );
    });

    it('does NOT store pending state when extraction returns an error', async () => {
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => ({ error: 'Service down' });

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ userEmail: 'err-user@example.com', message: 'some text' }),
        reply
      );

      assert.equal(messageRouter.getPending('err-user@example.com'), null);
    });
  });

  // -- UNKNOWN detection (NEW) --------------------------------------------------

  describe('UNKNOWN detection', () => {
    it('replies with clarification message when detect returns UNKNOWN', async () => {
      _detectStub = async () => 'UNKNOWN';

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: 'Hello, how are you?' }),
        reply
      );

      assert.ok(reply.calls.length >= 1);
      const txt = reply.calls[0].text.toLowerCase();
      assert.ok(
        txt.includes('could not determine') || txt.includes('clarify'),
        'should ask user to clarify'
      );
    });

    it('does NOT store pending when detection is UNKNOWN', async () => {
      _detectStub = async () => 'UNKNOWN';

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ userEmail: 'unk-user@example.com', message: 'Hello' }),
        reply
      );

      assert.equal(messageRouter.getPending('unk-user@example.com'), null);
    });

    it('lists available form types in clarification message', async () => {
      _detectStub = async () => 'UNKNOWN';

      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: 'Hello' }),
        reply
      );

      const txt = reply.calls[0].text;
      assert.ok(txt.includes('MEDEVAC'), 'should list MEDEVAC');
      assert.ok(txt.includes('SALUTE'), 'should list SALUTE');
      assert.ok(txt.includes('CAS'), 'should list CAS');
    });
  });

  // -- Confirmation flow -- YES with delivery (NEW) -----------------------------

  describe('confirmation flow -- YES with delivery', () => {
    it('calls deliver() on YES and reports successes', async () => {
      let deliverCalled = false;
      _deliverStub = async (formDef, report, sender) => {
        deliverCalled = true;
        return { successes: ['Wickr room'], failures: [] };
      };

      const reply = makeSendReply();
      messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'YES' }),
        reply
      );

      assert.equal(deliverCalled, true);
      assert.ok(
        reply.calls.some(c => c.text.includes('delivered') && c.text.includes('Wickr room')),
        'should report successful delivery'
      );
    });

    it('clears the pending state after YES confirmation', async () => {
      _deliverStub = async () => ({ successes: ['Wickr room'], failures: [] });
      const reply = makeSendReply();

      messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'YES' }),
        reply
      );

      assert.equal(messageRouter.getPending('soldier@example.com'), null);
    });

    it('accepts YES in any case (yes, Yes, YES)', async () => {
      for (const variant of ['yes', 'Yes', 'YES']) {
        clearAllPending();
        _deliverStub = async () => ({ successes: ['Wickr room'], failures: [] });
        const reply = makeSendReply();

        messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
        await messageRouter.route(
          makeParsed({ userEmail: 'soldier@example.com', message: variant }),
          reply
        );

        assert.ok(
          reply.calls.some(c => c.text.includes('delivered')),
          `Should deliver on "${variant}"`
        );
      }
    });

    it('reports both successes and failures from delivery', async () => {
      _deliverStub = async () => ({
        successes: ['Wickr room'],
        failures: ['s3: REPORTS_BUCKET not set'],
      });

      const reply = makeSendReply();
      messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'YES' }),
        reply
      );

      const txt = reply.calls.map(c => c.text).join(' ');
      assert.ok(txt.includes('delivered'), 'should mention delivered');
      assert.ok(txt.includes('Failed'), 'should mention failures');
    });

    it('reports failure when all delivery channels fail', async () => {
      _deliverStub = async () => ({
        successes: [],
        failures: ['wickr-room: No room configured'],
      });

      const reply = makeSendReply();
      messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'YES' }),
        reply
      );

      const txt = reply.calls.map(c => c.text).join(' ').toLowerCase();
      assert.ok(txt.includes('failed'), 'should report delivery failure');
    });
  });

  // -- Confirmation flow -- NO --------------------------------------------------

  describe('confirmation flow -- NO', () => {
    it('discards pending state on NO', async () => {
      const reply = makeSendReply();

      messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'NO' }),
        reply
      );

      assert.equal(messageRouter.getPending('soldier@example.com'), null);
    });

    it('notifies user that the request was cancelled on NO', async () => {
      const reply = makeSendReply();

      messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'NO' }),
        reply
      );

      assert.equal(reply.calls.length, 1);
      assert.ok(
        reply.calls[0].text.toLowerCase().includes('cancel'),
        'should notify user of cancellation'
      );
    });

    it('accepts NO in any case (no, No, NO)', async () => {
      for (const variant of ['no', 'No', 'NO']) {
        clearAllPending();
        const reply = makeSendReply();

        messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
        await messageRouter.route(
          makeParsed({ userEmail: 'soldier@example.com', message: variant }),
          reply
        );

        assert.equal(messageRouter.getPending('soldier@example.com'), null, `${variant} should clear pending`);
        assert.equal(reply.calls.length, 1, `${variant} should send one reply`);
      }
    });

    it('does NOT call deliver on NO', async () => {
      let deliverCalled = false;
      _deliverStub = async () => { deliverCalled = true; return { successes: [], failures: [] }; };
      const reply = makeSendReply();

      messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'NO' }),
        reply
      );

      assert.equal(deliverCalled, false, 'should not call deliver on NO');
    });
  });

  // -- Confirmation flow -- CANCEL ----------------------------------------------

  describe('confirmation flow -- CANCEL', () => {
    it('discards pending state on CANCEL', async () => {
      const reply = makeSendReply();

      messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'CANCEL' }),
        reply
      );

      assert.equal(messageRouter.getPending('soldier@example.com'), null);
    });

    it('notifies user that the request was cancelled on CANCEL', async () => {
      const reply = makeSendReply();

      messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'CANCEL' }),
        reply
      );

      assert.ok(
        reply.calls[0].text.toLowerCase().includes('cancel'),
        'should notify user of cancellation'
      );
    });

    it('accepts CANCEL in any case (cancel, Cancel, CANCEL)', async () => {
      for (const variant of ['cancel', 'Cancel', 'CANCEL']) {
        clearAllPending();
        const reply = makeSendReply();

        messageRouter.setPending('soldier@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
        await messageRouter.route(
          makeParsed({ userEmail: 'soldier@example.com', message: variant }),
          reply
        );

        assert.equal(
          messageRouter.getPending('soldier@example.com'),
          null,
          `${variant} should clear pending`
        );
      }
    });
  });

  // -- Correction loop (NEW) ----------------------------------------------------

  describe('correction loop', () => {
    it('calls extractCorrection when user sends non-YES/NO/CANCEL text with pending', async () => {
      let correctionText = null;
      let correctionReport = null;
      _extractCorrectionStub = async (text, currentReport, formDef) => {
        correctionText = text;
        correctionReport = currentReport;
        return { location: 'NEW GRID XY 9999' };
      };

      const reply = makeSendReply();
      messageRouter.setPending('soldier@example.com', 'MEDEVAC', { ...SAMPLE_NINE_LINE });
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'line 1 is grid XY 9999' }),
        reply
      );

      assert.equal(correctionText, 'line 1 is grid XY 9999');
      assert.ok(correctionReport !== null, 'should pass current report to extractCorrection');
    });

    it('merges corrected fields into pending report and re-presents card', async () => {
      _extractCorrectionStub = async () => ({ location: 'CORRECTED LOCATION' });

      const reply = makeSendReply();
      messageRouter.setPending('soldier@example.com', 'MEDEVAC', { ...SAMPLE_NINE_LINE });
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'location is CORRECTED LOCATION' }),
        reply
      );

      const pending = messageRouter.getPending('soldier@example.com');
      assert.equal(pending.report.location, 'CORRECTED LOCATION', 'should merge corrected field');
      assert.equal(pending.report.callsign, SAMPLE_NINE_LINE.callsign, 'should preserve unchanged fields');

      // Should re-present the card
      const cardText = reply.calls.map(c => c.text).join('\n');
      assert.ok(cardText.includes('CORRECTED LOCATION'), 'card should show corrected value');
      assert.ok(cardText.toUpperCase().includes('YES'), 'should re-prompt for confirmation');
    });

    it('only merges fields that exist in the form definition', async () => {
      _extractCorrectionStub = async () => ({ location: 'NEW LOC', bogusField: 'ignored' });

      const reply = makeSendReply();
      messageRouter.setPending('soldier@example.com', 'MEDEVAC', { ...SAMPLE_NINE_LINE });
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'location is NEW LOC' }),
        reply
      );

      const pending = messageRouter.getPending('soldier@example.com');
      assert.equal(pending.report.location, 'NEW LOC');
      assert.equal(pending.report.bogusField, undefined, 'should not add unknown fields');
    });
  });

  // -- Empty correction (NEW) ---------------------------------------------------

  describe('empty correction', () => {
    it('notifies user and re-presents unchanged card when no fields corrected', async () => {
      _extractCorrectionStub = async () => ({});

      const reply = makeSendReply();
      messageRouter.setPending('soldier@example.com', 'MEDEVAC', { ...SAMPLE_NINE_LINE });
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'hmm not sure' }),
        reply
      );

      const allText = reply.calls.map(c => c.text).join('\n').toLowerCase();
      assert.ok(allText.includes('no fields'), 'should notify user no fields updated');
      assert.ok(allText.includes('yes'), 'should re-present confirmation prompt');

      // Pending should be unchanged
      const pending = messageRouter.getPending('soldier@example.com');
      assert.deepEqual(pending.report, SAMPLE_NINE_LINE);
    });

    it('notifies user when correction returns an error', async () => {
      _extractCorrectionStub = async () => ({ error: 'Correction service unavailable' });

      const reply = makeSendReply();
      messageRouter.setPending('soldier@example.com', 'MEDEVAC', { ...SAMPLE_NINE_LINE });
      await messageRouter.route(
        makeParsed({ userEmail: 'soldier@example.com', message: 'fix something' }),
        reply
      );

      const allText = reply.calls.map(c => c.text).join('\n').toLowerCase();
      assert.ok(
        allText.includes('could not process') || allText.includes('correction'),
        'should notify user about correction error'
      );
    });
  });

  // -- Voice memo with no pending (NEW) -----------------------------------------

  describe('voice memo with no pending', () => {
    it('transcribes then calls detectAndExtract', async () => {
      let detectText = null;
      _transcribeStub = async () => 'soldier down at grid AB 1234';
      _detectStub = async (text) => { detectText = text; return 'MEDEVAC'; };
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeFileParsed({ isVoiceMemo: true }),
        reply
      );

      assert.equal(detectText, 'soldier down at grid AB 1234');
    });

    it('stores pending after voice memo extraction', async () => {
      _transcribeStub = async () => 'medevac needed';
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.route(
        makeFileParsed({ userEmail: 'voice-user@example.com', isVoiceMemo: true }),
        reply
      );

      const pending = messageRouter.getPending('voice-user@example.com');
      assert.ok(pending !== null, 'should store pending after voice extraction');
      assert.equal(pending.formType, 'MEDEVAC');
    });
  });

  // -- Voice memo with pending (NEW) --------------------------------------------

  describe('voice memo with pending', () => {
    it('transcribes then enters correction loop', async () => {
      let correctionText = null;
      _transcribeStub = async () => 'change location to XY 5555';
      _extractCorrectionStub = async (text) => {
        correctionText = text;
        return { location: 'XY 5555' };
      };

      const reply = makeSendReply();
      messageRouter.setPending('soldier@example.com', 'MEDEVAC', { ...SAMPLE_NINE_LINE });
      await messageRouter.route(
        makeFileParsed({ userEmail: 'soldier@example.com', isVoiceMemo: true }),
        reply
      );

      assert.equal(correctionText, 'change location to XY 5555');
      const pending = messageRouter.getPending('soldier@example.com');
      assert.equal(pending.report.location, 'XY 5555');
    });
  });

  // -- Updated /help (NEW) ------------------------------------------------------

  describe('/help command', () => {
    it('includes all registered form commands in help text', async () => {
      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: '/help' }),
        reply
      );

      assert.ok(reply.calls.length >= 1);
      const txt = reply.calls[0].text;
      assert.ok(txt.includes('/salute'), 'should include /salute');
      assert.ok(txt.includes('/cas'), 'should include /cas');
      assert.ok(txt.includes('SALUTE Report'), 'should include SALUTE form name');
      assert.ok(txt.includes('CAS'), 'should include CAS');
    });

    it('includes auto-detect hint in help text', async () => {
      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: '/help' }),
        reply
      );

      const txt = reply.calls[0].text.toLowerCase();
      assert.ok(
        txt.includes('auto-detect') || txt.includes('voice memo') || txt.includes('text'),
        'should mention auto-detection or voice memo'
      );
    });
  });

  // -- Error resilience ---------------------------------------------------------

  describe('error resilience', () => {
    it('does not throw when parsed is null', async () => {
      const reply = makeSendReply();
      await assert.doesNotReject(async () => {
        await messageRouter.route(null, reply);
      });
    });

    it('does not throw when parsed has no message field', async () => {
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;
      const reply = makeSendReply();
      await assert.doesNotReject(async () => {
        await messageRouter.route(
          { userEmail: 'user@example.com', vgroupid: 'Sroom1' },
          reply
        );
      });
    });

    it('does not throw when parsed has empty message', async () => {
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;
      const reply = makeSendReply();
      await assert.doesNotReject(async () => {
        await messageRouter.route(
          makeParsed({ message: '' }),
          reply
        );
      });
    });

    it('does not throw when detection throws unexpectedly', async () => {
      _detectStub = async () => { throw new Error('Unexpected Bedrock failure'); };
      const reply = makeSendReply();
      await assert.doesNotReject(async () => {
        await messageRouter.route(
          makeParsed({ message: 'some text' }),
          reply
        );
      });
    });

    it('notifies user when detection/extraction throws unexpectedly', async () => {
      _detectStub = async () => { throw new Error('Unexpected Bedrock failure'); };
      const reply = makeSendReply();
      await messageRouter.route(
        makeParsed({ message: 'some text' }),
        reply
      );
      assert.ok(reply.calls.length >= 1, 'should send at least one error reply');
    });

    it('does not throw for very long messages', async () => {
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;
      const reply = makeSendReply();
      const longMessage = 'x'.repeat(10000);
      await assert.doesNotReject(async () => {
        await messageRouter.route(
          makeParsed({ message: longMessage }),
          reply
        );
      });
    });

    it('does not throw for messages with special characters', async () => {
      _detectStub = async () => 'MEDEVAC';
      _extractFormStub = async () => SAMPLE_NINE_LINE;
      const reply = makeSendReply();
      await assert.doesNotReject(async () => {
        await messageRouter.route(
          makeParsed({ message: '\u2620\uFE0F Soldier down! Grid: AB<1234>&5678 "urgent"' }),
          reply
        );
      });
    });
  });

  // -- handleNonCommand direct API ----------------------------------------------

  describe('handleNonCommand direct API', () => {
    it('runs detection/extraction when user has no pending state', async () => {
      let detectCalled = false;
      _detectStub = async () => { detectCalled = true; return 'MEDEVAC'; };
      _extractFormStub = async () => SAMPLE_NINE_LINE;

      const reply = makeSendReply();
      await messageRouter.handleNonCommand(
        makeParsed({ userEmail: 'fresh-user@example.com', message: 'new message' }),
        reply
      );

      assert.equal(detectCalled, true);
    });

    it('handles pending confirmation when user has pending state', async () => {
      const reply = makeSendReply();

      messageRouter.setPending('pending-user@example.com', 'MEDEVAC', SAMPLE_NINE_LINE);
      await messageRouter.handleNonCommand(
        makeParsed({ userEmail: 'pending-user@example.com', message: 'NO' }),
        reply
      );

      assert.equal(messageRouter.getPending('pending-user@example.com'), null);
      assert.ok(
        reply.calls[0].text.toLowerCase().includes('cancel'),
        'should send cancellation message'
      );
    });
  });

  // -- Multi-user pending state isolation ---------------------------------------

  describe('multi-user pending state isolation', () => {
    it('YES from user A does not affect pending state of user B', async () => {
      _deliverStub = async () => ({ successes: ['Wickr room'], failures: [] });
      const reply = makeSendReply();

      const nineLineA = Object.assign({}, SAMPLE_NINE_LINE, { location: 'User A Location' });
      const nineLineB = Object.assign({}, SAMPLE_NINE_LINE, { location: 'User B Location' });

      messageRouter.setPending('user-a@example.com', 'MEDEVAC', nineLineA);
      messageRouter.setPending('user-b@example.com', 'MEDEVAC', nineLineB);

      await messageRouter.route(
        makeParsed({ userEmail: 'user-a@example.com', message: 'YES', vgroupid: 'Sroom-a' }),
        reply
      );

      assert.equal(messageRouter.getPending('user-a@example.com'), null, 'User A pending should be cleared');
      assert.deepEqual(
        messageRouter.getPending('user-b@example.com'),
        { formType: 'MEDEVAC', report: nineLineB },
        'User B pending should be untouched'
      );
    });
  });
});
