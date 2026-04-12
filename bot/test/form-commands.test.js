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
  S3Client:         class { constructor() {} async send() {} },
  PutObjectCommand: class { constructor(p) { this.params = p; } },
});
require.cache[AWS_TRANSCRIBE_KEY] = makeAWSStub(AWS_TRANSCRIBE_KEY, {
  TranscribeClient:                class { constructor() {} async send() {} },
  StartTranscriptionJobCommand:    class { constructor(p) { this.params = p; } },
  GetTranscriptionJobCommand:      class { constructor(p) { this.params = p; } },
});

// ── Load Wickr IO mocks ──────────────────────────────────────────────────────
require('./setup');

// ── Imports ──────────────────────────────────────────────────────────────────
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const deliveryService = require('../services/delivery-service');
const formCommands = require('../services/form-commands');

// ── Test fixtures ────────────────────────────────────────────────────────────

const MOCK_FORM_ALL = {
  id: 'TEST_ALL',
  name: 'Test All Form',
  command: '/testall',
  fields: [
    { key: 'alpha', label: 'Alpha', type: 'text' },
  ],
  formatHeader: '=== TEST ===',
  formatFooter: '=============',
  outputs: [
    { type: 'wickr-room', kvKey: 'TEST_ROOM_VGROUPID', envVar: 'TEST_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'test-reports/' },
    { type: 'webhook', kvKey: 'TEST_WEBHOOK_URL', envVar: 'TEST_WEBHOOK_URL' },
  ],
};

const MOCK_FORM_NO_WEBHOOK = {
  id: 'TEST_NO_WEBHOOK',
  name: 'Test No Webhook',
  command: '/testnw',
  fields: [
    { key: 'alpha', label: 'Alpha', type: 'text' },
  ],
  formatHeader: '=== TEST ===',
  formatFooter: '=============',
  outputs: [
    { type: 'wickr-room', kvKey: 'NW_ROOM_VGROUPID', envVar: 'NW_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'nw-reports/' },
  ],
};

const MOCK_FORM_NO_ROOM = {
  id: 'TEST_NO_ROOM',
  name: 'Test No Room',
  command: '/testnr',
  fields: [
    { key: 'alpha', label: 'Alpha', type: 'text' },
  ],
  formatHeader: '=== TEST ===',
  formatFooter: '=============',
  outputs: [
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'nr-reports/' },
    { type: 'webhook', kvKey: 'NR_WEBHOOK_URL', envVar: 'NR_WEBHOOK_URL' },
  ],
};

function makeMockWickrAPI() {
  const store = {};
  return {
    cmdGetKeyValue: mock.fn(async (key) => store[key] || 'Failure'),
    cmdAddKeyValue: mock.fn(async (key, value) => { store[key] = value; }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('form-commands', () => {
  beforeEach(() => {
    deliveryService._reset();
  });

  // ── help ───────────────────────────────────────────────────────────────

  describe('help', () => {
    it('lists set-room and set-webhook sub-commands for form with all outputs', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_ALL, {}, 'help', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('/testall set-room'), 'should list set-room');
      assert.ok(text.includes('/testall set-webhook'), 'should list set-webhook');
      assert.ok(text.includes('/testall help'), 'should list help');
      assert.ok(text.includes('/testall status'), 'should list status');
    });

    it('does not list set-webhook for form with no webhook output', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_NO_WEBHOOK, {}, 'help', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('/testnw set-room'), 'should list set-room');
      assert.ok(!text.includes('set-webhook'), 'should NOT list set-webhook');
    });

    it('does not list set-room for form with no wickr-room output', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_NO_ROOM, {}, 'help', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(!text.includes('set-room'), 'should NOT list set-room');
      assert.ok(text.includes('/testnr set-webhook'), 'should list set-webhook');
    });
  });

  // ── set-room ───────────────────────────────────────────────────────────

  describe('set-room', () => {
    it('saves config and confirms when run from a room (vgroupid starts with S)', async () => {
      const sendReply = mock.fn(async () => {});
      const wickrAPI = makeMockWickrAPI();
      await formCommands.handle(MOCK_FORM_ALL, {}, 'set-room', 'S_target_room_123', sendReply, wickrAPI);

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('broadcast room configured'), 'should confirm configuration');
      assert.ok(text.includes('S_target_room_123'), 'should include room ID');
      assert.equal(deliveryService.getConfig('TEST_ROOM_VGROUPID'), 'S_target_room_123');
    });

    it('returns error when run from a DM (vgroupid does not start with S)', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_ALL, {}, 'set-room', 'DM_user_abc', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('must be run from within the target room'), 'should show DM error');
    });

    it('returns error for form with no wickr-room output', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_NO_ROOM, {}, 'set-room', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('does not have a Wickr room output'), 'should show no-room error');
    });
  });

  // ── set-webhook ────────────────────────────────────────────────────────

  describe('set-webhook', () => {
    it('saves config and confirms when given a valid URL', async () => {
      const sendReply = mock.fn(async () => {});
      const wickrAPI = makeMockWickrAPI();
      await formCommands.handle(MOCK_FORM_ALL, {}, 'set-webhook https://example.com/hook', 'S_room1', sendReply, wickrAPI);

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('webhook configured'), 'should confirm webhook');
      assert.ok(text.includes('https://example.com/hook'), 'should include URL');
      assert.equal(deliveryService.getConfig('TEST_WEBHOOK_URL'), 'https://example.com/hook');
    });

    it('shows current config when no URL argument provided', async () => {
      const sendReply = mock.fn(async () => {});
      const wickrAPI = makeMockWickrAPI();
      // Pre-set a webhook URL
      await deliveryService.saveConfig(wickrAPI, 'TEST_WEBHOOK_URL', 'https://existing.com/hook');

      await formCommands.handle(MOCK_FORM_ALL, {}, 'set-webhook', 'S_room1', sendReply, wickrAPI);

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('https://existing.com/hook'), 'should show current URL');
    });

    it('shows not configured when no URL set and no argument', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_ALL, {}, 'set-webhook', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('(not configured)'), 'should show not configured');
    });

    it('returns error for invalid URL', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_ALL, {}, 'set-webhook not-a-url', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('Invalid URL'), 'should show invalid URL error');
    });

    it('returns error for form with no webhook output', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_NO_WEBHOOK, {}, 'set-webhook https://example.com', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('does not have a webhook output'), 'should show no-webhook error');
    });
  });

  // ── status ─────────────────────────────────────────────────────────────

  describe('status', () => {
    it('shows all output configs for form with all output types', async () => {
      const sendReply = mock.fn(async () => {});
      const wickrAPI = makeMockWickrAPI();
      // Pre-configure some outputs
      await deliveryService.saveConfig(wickrAPI, 'TEST_ROOM_VGROUPID', 'S_my_room');
      await deliveryService.saveConfig(wickrAPI, 'TEST_WEBHOOK_URL', 'https://hook.example.com');
      process.env.REPORTS_BUCKET = 'my-bucket';
      process.env.BOT_USERNAME = 'testbot';

      try {
        await formCommands.handle(MOCK_FORM_ALL, {}, 'status', 'S_room1', sendReply, wickrAPI);

        assert.equal(sendReply.mock.callCount(), 1);
        const text = sendReply.mock.calls[0].arguments[1];
        assert.ok(text.includes('Bot Username: testbot'), 'should show bot username');
        assert.ok(text.includes('Wickr Room: S_my_room'), 'should show room config');
        assert.ok(text.includes('S3 Bucket: my-bucket'), 'should show S3 bucket');
        assert.ok(text.includes('S3 Prefix: test-reports/'), 'should show S3 prefix');
        assert.ok(text.includes('Webhook URL: https://hook.example.com'), 'should show webhook URL');
      } finally {
        delete process.env.REPORTS_BUCKET;
        delete process.env.BOT_USERNAME;
      }
    });

    it('shows not configured for unconfigured outputs', async () => {
      const sendReply = mock.fn(async () => {});
      delete process.env.REPORTS_BUCKET;
      delete process.env.BOT_USERNAME;

      await formCommands.handle(MOCK_FORM_ALL, {}, 'status', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('Wickr Room: (not configured)'));
      assert.ok(text.includes('S3 Bucket: (not configured)'));
      assert.ok(text.includes('Webhook URL: (not configured)'));
      assert.ok(text.includes('Bot Username: (unknown)'));
    });
  });

  // ── unknown sub-command ────────────────────────────────────────────────

  describe('unknown sub-command', () => {
    it('returns error with help hint for unknown sub-command', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_ALL, {}, 'foobar', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('Unknown /testall sub-command: "foobar"'), 'should show unknown command');
      assert.ok(text.includes('/testall help'), 'should hint at help');
    });

    it('returns missing sub-command error when args are empty', async () => {
      const sendReply = mock.fn(async () => {});
      await formCommands.handle(MOCK_FORM_ALL, {}, '', 'S_room1', sendReply, makeMockWickrAPI());

      assert.equal(sendReply.mock.callCount(), 1);
      const text = sendReply.mock.calls[0].arguments[1];
      assert.ok(text.includes('Missing sub-command'), 'should show missing sub-command');
      assert.ok(text.includes('/testall help'), 'should hint at help');
    });
  });
});
