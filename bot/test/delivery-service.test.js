// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// ── Bootstrap: stub AWS SDK modules before any service loads ──────────────────
const Module = require('module');
const _originalResolve = Module._resolveFilename;

const AWS_BEDROCK_KEY    = '__aws_bedrock_runtime_stub__';
const AWS_S3_KEY         = '__aws_s3_stub__';
const AWS_TRANSCRIBE_KEY = '__aws_transcribe_stub__';

// Track PutObjectCommand calls for S3 assertions
let lastPutObjectParams = null;

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
  PutObjectCommand: class { constructor(p) { this.params = p; lastPutObjectParams = p; } },
});
require.cache[AWS_TRANSCRIBE_KEY] = makeAWSStub(AWS_TRANSCRIBE_KEY, {
  TranscribeClient:                class { constructor() {} async send() {} },
  StartTranscriptionJobCommand:    class { constructor(p) { this.params = p; } },
  GetTranscriptionJobCommand:      class { constructor(p) { this.params = p; } },
});

// ── Load Wickr IO mocks ──────────────────────────────────────────────────────
require('./setup');

// ── Imports ──────────────────────────────────────────────────────────────────
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const deliveryService = require('../services/delivery-service');
const registry = require('../services/form-registry');

// ── Test fixtures ────────────────────────────────────────────────────────────

const MOCK_FORM_WICKR_ROOM = {
  id: 'TEST_ROOM',
  name: 'Test Room Form',
  command: '/testroom',
  fields: [
    { key: 'alpha', label: 'Alpha', type: 'text' },
    { key: 'bravo', label: 'Bravo', type: 'text' },
  ],
  formatHeader: '=== TEST ===',
  formatFooter: '=============',
  outputs: [
    { type: 'wickr-room', kvKey: 'TEST_ROOM_VGROUPID', envVar: 'TEST_ROOM_VGROUPID' },
  ],
};

const MOCK_FORM_S3 = {
  id: 'TEST_S3',
  name: 'Test S3 Form',
  command: '/tests3',
  fields: [
    { key: 'alpha', label: 'Alpha', type: 'text' },
  ],
  formatHeader: '=== S3 ===',
  formatFooter: '===========',
  outputs: [
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'test-reports/' },
  ],
};

const MOCK_FORM_WEBHOOK = {
  id: 'TEST_WEBHOOK',
  name: 'Test Webhook Form',
  command: '/testwebhook',
  fields: [
    { key: 'alpha', label: 'Alpha', type: 'text' },
  ],
  formatHeader: '=== WEBHOOK ===',
  formatFooter: '================',
  outputs: [
    { type: 'webhook', kvKey: 'TEST_WEBHOOK_URL', envVar: 'TEST_WEBHOOK_URL' },
  ],
};

const MOCK_FORM_ALL_OUTPUTS = {
  id: 'TEST_ALL',
  name: 'Test All Outputs',
  command: '/testall',
  fields: [
    { key: 'alpha', label: 'Alpha', type: 'text' },
  ],
  formatHeader: '=== ALL ===',
  formatFooter: '============',
  outputs: [
    { type: 'wickr-room', kvKey: 'ALL_ROOM_VGROUPID', envVar: 'ALL_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'all-reports/' },
    { type: 'webhook', kvKey: 'ALL_WEBHOOK_URL', envVar: 'ALL_WEBHOOK_URL' },
  ],
};

const MOCK_FORM_NO_OUTPUTS = {
  id: 'TEST_EMPTY',
  name: 'Test No Outputs',
  command: '/testempty',
  fields: [{ key: 'alpha', label: 'Alpha', type: 'text' }],
  formatHeader: '=== EMPTY ===',
  formatFooter: '==============',
  outputs: [],
};

const SAMPLE_REPORT = { alpha: 'Hello', bravo: 'World' };

function makeMockWickrAPI(kvStore) {
  const store = kvStore || {};
  return {
    cmdGetKeyValue: mock.fn(async (key) => store[key] || 'Failure'),
    cmdAddKeyValue: mock.fn(async (key, value) => { store[key] = value; }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('delivery-service', () => {
  beforeEach(() => {
    deliveryService._reset();
    lastPutObjectParams = null;
  });

  // ── loadOutputConfigs ──────────────────────────────────────────────────

  describe('loadOutputConfigs', () => {
    it('loads wickr-room config from KV store', async () => {
      const wickrAPI = makeMockWickrAPI({ TEST_ROOM_VGROUPID: 'S_room_123' });
      await deliveryService.loadOutputConfigs(wickrAPI, MOCK_FORM_WICKR_ROOM);
      assert.equal(deliveryService.getConfig('TEST_ROOM_VGROUPID'), 'S_room_123');
    });

    it('falls back to env var when KV returns Failure', async () => {
      const wickrAPI = makeMockWickrAPI(); // returns 'Failure' for all keys
      process.env.TEST_ROOM_VGROUPID = 'S_env_room';
      try {
        await deliveryService.loadOutputConfigs(wickrAPI, MOCK_FORM_WICKR_ROOM);
        assert.equal(deliveryService.getConfig('TEST_ROOM_VGROUPID'), 'S_env_room');
      } finally {
        delete process.env.TEST_ROOM_VGROUPID;
      }
    });

    it('handles KV error gracefully and falls back to env var', async () => {
      const wickrAPI = {
        cmdGetKeyValue: mock.fn(async () => { throw new Error('KV unavailable'); }),
        cmdAddKeyValue: mock.fn(async () => {}),
      };
      process.env.TEST_ROOM_VGROUPID = 'S_fallback';
      try {
        await deliveryService.loadOutputConfigs(wickrAPI, MOCK_FORM_WICKR_ROOM);
        assert.equal(deliveryService.getConfig('TEST_ROOM_VGROUPID'), 'S_fallback');
      } finally {
        delete process.env.TEST_ROOM_VGROUPID;
      }
    });

    it('loads webhook config from KV store', async () => {
      const wickrAPI = makeMockWickrAPI({ TEST_WEBHOOK_URL: 'https://example.com/hook' });
      await deliveryService.loadOutputConfigs(wickrAPI, MOCK_FORM_WEBHOOK);
      assert.equal(deliveryService.getConfig('TEST_WEBHOOK_URL'), 'https://example.com/hook');
    });

    it('skips s3 outputs (no KV key to load)', async () => {
      const wickrAPI = makeMockWickrAPI();
      await deliveryService.loadOutputConfigs(wickrAPI, MOCK_FORM_S3);
      // s3 outputs have no kvKey, so nothing should be cached
      assert.equal(wickrAPI.cmdGetKeyValue.mock.callCount(), 0);
    });
  });

  // ── saveConfig ─────────────────────────────────────────────────────────

  describe('saveConfig', () => {
    it('updates cache and calls cmdAddKeyValue', async () => {
      const wickrAPI = makeMockWickrAPI();
      await deliveryService.saveConfig(wickrAPI, 'MY_KEY', 'my_value');
      assert.equal(deliveryService.getConfig('MY_KEY'), 'my_value');
      assert.equal(wickrAPI.cmdAddKeyValue.mock.callCount(), 1);
      assert.deepEqual(wickrAPI.cmdAddKeyValue.mock.calls[0].arguments, ['MY_KEY', 'my_value']);
    });

    it('handles KV error gracefully (cache still updated)', async () => {
      const wickrAPI = {
        cmdGetKeyValue: mock.fn(async () => 'Failure'),
        cmdAddKeyValue: mock.fn(async () => { throw new Error('KV write failed'); }),
      };
      await deliveryService.saveConfig(wickrAPI, 'MY_KEY', 'val');
      // Cache should still be updated even though KV write failed
      assert.equal(deliveryService.getConfig('MY_KEY'), 'val');
    });
  });

  // ── getConfig ──────────────────────────────────────────────────────────

  describe('getConfig', () => {
    it('returns cached value', async () => {
      const wickrAPI = makeMockWickrAPI();
      await deliveryService.saveConfig(wickrAPI, 'CACHED_KEY', 'cached_val');
      assert.equal(deliveryService.getConfig('CACHED_KEY'), 'cached_val');
    });

    it('returns null for missing key', () => {
      assert.equal(deliveryService.getConfig('NONEXISTENT'), null);
    });
  });

  // ── deliver: wickr-room ────────────────────────────────────────────────

  describe('deliver with wickr-room output', () => {
    it('calls sendReply with formatted broadcast to configured room', async () => {
      const wickrAPI = makeMockWickrAPI();
      await deliveryService.saveConfig(wickrAPI, 'TEST_ROOM_VGROUPID', 'S_target_room');

      const sendReply = mock.fn(async () => {});
      const result = await deliveryService.deliver(
        MOCK_FORM_WICKR_ROOM, SAMPLE_REPORT, 'soldier1', sendReply, registry
      );

      assert.equal(result.successes.length, 1);
      assert.equal(result.successes[0], 'Wickr room');
      assert.equal(result.failures.length, 0);
      assert.equal(sendReply.mock.callCount(), 1);
      assert.equal(sendReply.mock.calls[0].arguments[0], 'S_target_room');
      // Verify broadcast message contains sender and report content
      const broadcastMsg = sendReply.mock.calls[0].arguments[1];
      assert.ok(broadcastMsg.includes('soldier1'), 'broadcast should include sender');
      assert.ok(broadcastMsg.includes('Hello'), 'broadcast should include field value');
    });

    it('reports failure when no room configured', async () => {
      const sendReply = mock.fn(async () => {});
      const result = await deliveryService.deliver(
        MOCK_FORM_WICKR_ROOM, SAMPLE_REPORT, 'soldier1', sendReply, registry
      );

      assert.equal(result.successes.length, 0);
      assert.equal(result.failures.length, 1);
      assert.ok(result.failures[0].includes('No room configured'));
      assert.equal(sendReply.mock.callCount(), 0);
    });
  });

  // ── deliver: s3 ────────────────────────────────────────────────────────

  describe('deliver with s3 output', () => {
    it('calls PutObjectCommand with correct bucket/key/payload', async () => {
      process.env.REPORTS_BUCKET = 'my-test-bucket';
      const mockS3 = { send: mock.fn(async () => {}) };
      deliveryService._setS3Client(mockS3);

      try {
        const sendReply = mock.fn(async () => {});
        const result = await deliveryService.deliver(
          MOCK_FORM_S3, { alpha: 'test-value' }, 'soldier1', sendReply, registry
        );

        assert.equal(result.successes.length, 1);
        assert.equal(result.successes[0], 'S3');
        assert.equal(result.failures.length, 0);
        assert.equal(mockS3.send.mock.callCount(), 1);

        // Verify PutObjectCommand params
        assert.ok(lastPutObjectParams, 'PutObjectCommand should have been called');
        assert.equal(lastPutObjectParams.Bucket, 'my-test-bucket');
        assert.ok(lastPutObjectParams.Key.startsWith('test-reports/'));
        assert.ok(lastPutObjectParams.Key.endsWith('.json'));
        assert.equal(lastPutObjectParams.ContentType, 'application/json');

        // Verify payload structure
        const body = JSON.parse(lastPutObjectParams.Body);
        assert.equal(body.formType, 'TEST_S3');
        assert.equal(body.formName, 'Test S3 Form');
        assert.equal(body.sender, 'soldier1');
        assert.ok(body.reportId, 'should have a reportId');
        assert.ok(body.timestamp, 'should have a timestamp');
        assert.deepEqual(body.fields, { alpha: 'test-value' });
      } finally {
        delete process.env.REPORTS_BUCKET;
      }
    });

    it('reports failure when bucket env var not set', async () => {
      delete process.env.REPORTS_BUCKET;
      const mockS3 = { send: mock.fn(async () => {}) };
      deliveryService._setS3Client(mockS3);

      const sendReply = mock.fn(async () => {});
      const result = await deliveryService.deliver(
        MOCK_FORM_S3, { alpha: 'val' }, 'soldier1', sendReply, registry
      );

      assert.equal(result.successes.length, 0);
      assert.equal(result.failures.length, 1);
      assert.ok(result.failures[0].includes('REPORTS_BUCKET not set'));
      assert.equal(mockS3.send.mock.callCount(), 0);
    });
  });

  // ── deliver: webhook ───────────────────────────────────────────────────

  describe('deliver with webhook output', () => {
    // We need to mock the https module for webhook tests.
    // Since delivery-service uses the built-in https module directly,
    // we mock it by replacing https.request via the module's internal reference.
    // Instead, we test webhook behavior by verifying the error paths
    // and using a mock that intercepts the https.request call.

    let originalHttpsRequest;
    const https = require('https');

    beforeEach(() => {
      originalHttpsRequest = https.request;
    });

    afterEach(() => {
      https.request = originalHttpsRequest;
    });

    it('sends POST with correct payload on success', async () => {
      const wickrAPI = makeMockWickrAPI();
      await deliveryService.saveConfig(wickrAPI, 'TEST_WEBHOOK_URL', 'https://example.com/webhook');

      let capturedOptions = null;
      let capturedPayload = null;

      // Mock https.request
      https.request = (options, callback) => {
        capturedOptions = options;
        // Simulate a successful response
        const mockRes = {
          statusCode: 200,
          on: (event, handler) => {
            if (event === 'data') { /* no data */ }
            if (event === 'end') { setTimeout(handler, 0); }
            return mockRes;
          },
        };
        setTimeout(() => callback(mockRes), 0);
        return {
          on: (event, handler) => { return { on: () => ({}), write: () => {}, end: () => {} }; },
          write: (data) => { capturedPayload = data; },
          end: () => {},
          destroy: () => {},
        };
      };

      const sendReply = mock.fn(async () => {});
      const result = await deliveryService.deliver(
        MOCK_FORM_WEBHOOK, { alpha: 'webhook-val' }, 'soldier1', sendReply, registry
      );

      assert.equal(result.successes.length, 1);
      assert.equal(result.successes[0], 'Webhook');
      assert.equal(result.failures.length, 0);
      assert.equal(capturedOptions.hostname, 'example.com');
      assert.equal(capturedOptions.method, 'POST');
      assert.equal(capturedOptions.headers['Content-Type'], 'application/json');

      const body = JSON.parse(capturedPayload);
      assert.equal(body.formType, 'TEST_WEBHOOK');
      assert.equal(body.sender, 'soldier1');
      assert.deepEqual(body.fields, { alpha: 'webhook-val' });
    });

    it('rejects on non-2xx response', async () => {
      const wickrAPI = makeMockWickrAPI();
      await deliveryService.saveConfig(wickrAPI, 'TEST_WEBHOOK_URL', 'https://example.com/webhook');

      https.request = (options, callback) => {
        const mockRes = {
          statusCode: 500,
          on: (event, handler) => {
            if (event === 'data') { handler('Internal Server Error'); }
            if (event === 'end') { setTimeout(handler, 0); }
            return mockRes;
          },
        };
        setTimeout(() => callback(mockRes), 0);
        return {
          on: () => ({ on: () => ({}), write: () => {}, end: () => {} }),
          write: () => {},
          end: () => {},
          destroy: () => {},
        };
      };

      const sendReply = mock.fn(async () => {});
      const result = await deliveryService.deliver(
        MOCK_FORM_WEBHOOK, { alpha: 'val' }, 'soldier1', sendReply, registry
      );

      assert.equal(result.successes.length, 0);
      assert.equal(result.failures.length, 1);
      assert.ok(result.failures[0].includes('HTTP 500'));
    });

    it('rejects on timeout', async () => {
      const wickrAPI = makeMockWickrAPI();
      await deliveryService.saveConfig(wickrAPI, 'TEST_WEBHOOK_URL', 'https://example.com/webhook');

      https.request = (options, callback) => {
        let timeoutHandler = null;
        const req = {
          on: (event, handler) => {
            if (event === 'timeout') timeoutHandler = handler;
            if (event === 'error') { /* swallow */ }
            return req;
          },
          write: () => {},
          end: () => {
            // Simulate timeout after end is called
            if (timeoutHandler) setTimeout(timeoutHandler, 0);
          },
          destroy: () => {},
        };
        return req;
      };

      const sendReply = mock.fn(async () => {});
      const result = await deliveryService.deliver(
        MOCK_FORM_WEBHOOK, { alpha: 'val' }, 'soldier1', sendReply, registry
      );

      assert.equal(result.successes.length, 0);
      assert.equal(result.failures.length, 1);
      assert.ok(result.failures[0].includes('Webhook timeout'));
    });

    it('reports failure when no webhook URL configured', async () => {
      // No config set for TEST_WEBHOOK_URL
      const sendReply = mock.fn(async () => {});
      const result = await deliveryService.deliver(
        MOCK_FORM_WEBHOOK, { alpha: 'val' }, 'soldier1', sendReply, registry
      );

      assert.equal(result.successes.length, 0);
      assert.equal(result.failures.length, 1);
      assert.ok(result.failures[0].includes('No webhook URL configured'));
    });
  });

  // ── Partial failure ────────────────────────────────────────────────────

  describe('partial failure', () => {
    it('one output fails, others still succeed', async () => {
      const wickrAPI = makeMockWickrAPI();
      // Configure room but NOT bucket env var -- s3 will fail, room will succeed
      await deliveryService.saveConfig(wickrAPI, 'ALL_ROOM_VGROUPID', 'S_room_ok');
      // No REPORTS_BUCKET set -- s3 will fail
      delete process.env.REPORTS_BUCKET;
      // Configure webhook
      await deliveryService.saveConfig(wickrAPI, 'ALL_WEBHOOK_URL', 'https://example.com/hook');

      const https = require('https');
      const origReq = https.request;
      https.request = (options, callback) => {
        const mockRes = {
          statusCode: 200,
          on: (event, handler) => {
            if (event === 'end') setTimeout(handler, 0);
            return mockRes;
          },
        };
        setTimeout(() => callback(mockRes), 0);
        return {
          on: () => ({ on: () => ({}), write: () => {}, end: () => {} }),
          write: () => {},
          end: () => {},
          destroy: () => {},
        };
      };

      try {
        const sendReply = mock.fn(async () => {});
        const result = await deliveryService.deliver(
          MOCK_FORM_ALL_OUTPUTS, { alpha: 'val' }, 'soldier1', sendReply, registry
        );

        // Room should succeed, S3 should fail, Webhook should succeed
        assert.ok(result.successes.includes('Wickr room'));
        assert.ok(result.successes.includes('Webhook'));
        assert.equal(result.failures.length, 1);
        assert.ok(result.failures[0].includes('REPORTS_BUCKET not set'));
      } finally {
        https.request = origReq;
      }
    });
  });

  // ── deliver with no outputs ────────────────────────────────────────────

  describe('deliver with no outputs', () => {
    it('returns empty successes and failures', async () => {
      const sendReply = mock.fn(async () => {});
      const result = await deliveryService.deliver(
        MOCK_FORM_NO_OUTPUTS, { alpha: 'val' }, 'soldier1', sendReply, registry
      );

      assert.deepEqual(result.successes, []);
      assert.deepEqual(result.failures, []);
    });
  });
});
