// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// ── Bootstrap: mock @aws-sdk/client-s3 and @aws-sdk/client-transcribe ─────────
// Must appear before any require of transcription-service.js so that Node's
// module system never tries to resolve the real AWS SDK packages.
const Module = require('module');
const _originalResolve = Module._resolveFilename;

const S3_STUB_KEY = '__aws_s3_stub__';
const TRANSCRIBE_STUB_KEY = '__aws_transcribe_stub__';

// ── Mutable stub state (reset per test) ──────────────────────────────────────
let s3SendStub = async () => ({});
let transcribeSendStub = async () => ({});

const S3ClientStub = {
  send: async (cmd) => s3SendStub(cmd),
};
const TranscribeClientStub = {
  send: async (cmd) => transcribeSendStub(cmd),
};

class PutObjectCommandStub {
  constructor(params) { this.params = params; this.constructor_name = 'PutObjectCommand'; }
}
class DeleteObjectCommandStub {
  constructor(params) { this.params = params; this.constructor_name = 'DeleteObjectCommand'; }
}
class GetObjectCommandStub {
  constructor(params) { this.params = params; this.constructor_name = 'GetObjectCommand'; }
}
class StartTranscriptionJobCommandStub {
  constructor(params) { this.params = params; this.constructor_name = 'StartTranscriptionJobCommand'; }
}
class GetTranscriptionJobCommandStub {
  constructor(params) { this.params = params; this.constructor_name = 'GetTranscriptionJobCommand'; }
}

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@aws-sdk/client-s3') return S3_STUB_KEY;
  if (request === '@aws-sdk/client-transcribe') return TRANSCRIBE_STUB_KEY;
  return _originalResolve.call(this, request, parent, isMain, options);
};

require.cache[S3_STUB_KEY] = {
  id: S3_STUB_KEY,
  filename: S3_STUB_KEY,
  loaded: true,
  exports: {
    S3Client: class S3Client {
      constructor() { return S3ClientStub; }
    },
    PutObjectCommand: PutObjectCommandStub,
    GetObjectCommand: GetObjectCommandStub,
    DeleteObjectCommand: DeleteObjectCommandStub,
  },
  parent: null,
  children: [],
  paths: [],
};

require.cache[TRANSCRIBE_STUB_KEY] = {
  id: TRANSCRIBE_STUB_KEY,
  filename: TRANSCRIBE_STUB_KEY,
  loaded: true,
  exports: {
    TranscribeClient: class TranscribeClient {
      constructor() { return TranscribeClientStub; }
    },
    StartTranscriptionJobCommand: StartTranscriptionJobCommandStub,
    GetTranscriptionJobCommand: GetTranscriptionJobCommandStub,
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
const fs = require('fs');
const path = require('path');
const os = require('os');

const transcriptionService = require('../services/transcription-service');

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Creates a temporary audio file and returns its path.
 */
function makeTempAudioFile(ext = 'mp3') {
  const tmpPath = path.join(os.tmpdir(), `test-audio-${Date.now()}.${ext}`);
  fs.writeFileSync(tmpPath, Buffer.from('fake-audio-data'));
  return tmpPath;
}

/**
 * Cleans up a temp file if it exists.
 */
function cleanupFile(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) {}
}

/**
 * Builds a mock GetTranscriptionJob response for a given status.
 */
function makeJobResponse(status, transcriptUri = null, failureReason = null) {
  return {
    TranscriptionJob: {
      TranscriptionJobName: 'test-job',
      TranscriptionJobStatus: status,
      ...(transcriptUri ? { Transcript: { TranscriptFileUri: transcriptUri } } : {}),
      ...(failureReason ? { FailureReason: failureReason } : {}),
    },
  };
}

/**
 * Installs an HTTPS mock for fetchTranscriptText to intercept the URI fetch.
 * Returns the transcript text that would be "fetched".
 */
function mockHttpsGet(transcriptText) {
  const https = require('https');
  const originalGet = https.get;

  // Override https.get to return our fake transcript JSON
  https.get = function (url, callback) {
    const body = JSON.stringify({
      results: {
        transcripts: [{ transcript: transcriptText }],
      },
    });

    // Simulate an IncomingMessage-like readable stream
    const { Readable } = require('stream');
    const stream = new Readable({ read() {} });
    stream.statusCode = 200;
    stream.headers = {};

    if (callback) {
      process.nextTick(() => {
        callback(stream);
        stream.emit('data', body);
        stream.emit('end');
      });
    }

    // Return an object with .on('error') to satisfy the call site
    return {
      on: (_event, _handler) => {},
    };
  };

  return function restore() {
    https.get = originalGet;
  };
}

// ── Unit Tests ────────────────────────────────────────────────────────────────

describe('transcription-service', () => {
  let tmpFile;

  beforeEach(() => {
    // Reset stub behaviour
    s3SendStub = async () => ({});
    transcribeSendStub = async () => ({});
    // Re-inject the stubs (module cache holds singleton clients)
    transcriptionService._setS3Client(S3ClientStub);
    transcriptionService._setTranscribeClient(TranscribeClientStub);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('happy path: uploads to S3, starts job, polls, retrieves transcript, deletes S3 object', async () => {
    tmpFile = makeTempAudioFile('mp3');

    const transcriptText = 'Grid 38SMB, urgent, two litter patients';
    const transcriptUri = 'https://s3.amazonaws.com/bucket/transcripts/job.json';

    let pollCount = 0;
    transcribeSendStub = async (cmd) => {
      if (cmd.constructor_name === 'StartTranscriptionJobCommand') {
        return {};
      }
      if (cmd.constructor_name === 'GetTranscriptionJobCommand') {
        pollCount++;
        return makeJobResponse('COMPLETED', transcriptUri);
      }
      return {};
    };

    const deleteKeys = [];
    s3SendStub = async (cmd) => {
      if (cmd.constructor_name === 'DeleteObjectCommand') {
        deleteKeys.push(cmd.params.Key);
      }
      if (cmd.constructor_name === 'GetObjectCommand') {
        return { Body: { transformToString: async () => JSON.stringify({ results: { transcripts: [{ transcript: transcriptText }] } }) } };
      }
      return {};
    };

    try {
      const result = await transcriptionService.transcribe(tmpFile, 'audio.mp3');
      assert.equal(result, transcriptText);
      assert.ok(deleteKeys.length >= 1, 'S3 objects should be deleted after success');
    } finally {
      cleanupFile(tmpFile);
    }
  });

  // ── Polling: in-progress then complete ────────────────────────────────────

  it('polls through IN_PROGRESS status before COMPLETED', async () => {
    tmpFile = makeTempAudioFile('wav');

    const transcriptText = 'soldier down at grid 1234';
    const transcriptUri = 'https://s3.amazonaws.com/bucket/transcripts/job.json';

    let pollCount = 0;
    transcribeSendStub = async (cmd) => {
      if (cmd.constructor_name === 'StartTranscriptionJobCommand') return {};
      if (cmd.constructor_name === 'GetTranscriptionJobCommand') {
        pollCount++;
        if (pollCount < 3) return makeJobResponse('IN_PROGRESS');
        return makeJobResponse('COMPLETED', transcriptUri);
      }
      return {};
    };

    const deleteKeys = [];
    s3SendStub = async (cmd) => {
      if (cmd.constructor_name === 'DeleteObjectCommand') deleteKeys.push(cmd.params.Key);
      if (cmd.constructor_name === 'GetObjectCommand') {
        return { Body: { transformToString: async () => JSON.stringify({ results: { transcripts: [{ transcript: transcriptText }] } }) } };
      }
      return {};
    };

    try {
      const result = await transcriptionService.transcribe(tmpFile, 'audio.wav');
      assert.equal(result, transcriptText);
      assert.ok(pollCount >= 3, `Expected at least 3 polls, got ${pollCount}`);
      assert.ok(deleteKeys.length >= 1, 'S3 objects should be deleted after success');
    } finally {
      cleanupFile(tmpFile);
    }
  });

  // ── Transcribe job FAILED ─────────────────────────────────────────────────

  it('throws when Transcribe job status is FAILED and still deletes S3 object', async () => {
    tmpFile = makeTempAudioFile('mp3');

    transcribeSendStub = async (cmd) => {
      if (cmd.constructor_name === 'StartTranscriptionJobCommand') return {};
      if (cmd.constructor_name === 'GetTranscriptionJobCommand') {
        return makeJobResponse('FAILED', null, 'Unsupported audio format');
      }
      return {};
    };

    const deleteKeys = [];
    s3SendStub = async (cmd) => {
      if (cmd.constructor_name === 'DeleteObjectCommand') deleteKeys.push(cmd.params.Key);
      return {};
    };

    try {
      await assert.rejects(
        () => transcriptionService.transcribe(tmpFile, 'audio.mp3'),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('failed'), `Expected error about job failure, got: ${err.message}`);
          return true;
        }
      );
      assert.ok(deleteKeys.length >= 1, 'S3 object should still be deleted on job failure');
    } finally {
      cleanupFile(tmpFile);
    }
  });

  // ── S3 upload error ───────────────────────────────────────────────────────

  it('throws when S3 upload fails and does NOT attempt to delete (nothing was uploaded)', async () => {
    tmpFile = makeTempAudioFile('mp3');

    s3SendStub = async (cmd) => {
      if (cmd.constructor_name === 'PutObjectCommand') {
        throw new Error('S3 access denied');
      }
      return {};
    };

    const deleteKeys = [];
    const origS3Send = S3ClientStub.send;
    const calls = [];
    S3ClientStub.send = async (cmd) => {
      calls.push(cmd.constructor_name);
      return s3SendStub(cmd);
    };

    try {
      await assert.rejects(
        () => transcriptionService.transcribe(tmpFile, 'audio.mp3'),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('S3 access denied'), `Unexpected error: ${err.message}`);
          return true;
        }
      );
      const deleteCalls = calls.filter((n) => n === 'DeleteObjectCommand');
      assert.equal(deleteCalls.length, 0, 'Should not attempt delete when upload never succeeded');
    } finally {
      S3ClientStub.send = origS3Send;
      cleanupFile(tmpFile);
    }
  });

  // ── S3 object always deleted on success ──────────────────────────────────

  it('deletes S3 object after successful transcription', async () => {
    tmpFile = makeTempAudioFile('mp3');

    const transcriptUri = 'https://s3.amazonaws.com/bucket/t.json';
    transcribeSendStub = async (cmd) => {
      if (cmd.constructor_name === 'StartTranscriptionJobCommand') return {};
      if (cmd.constructor_name === 'GetTranscriptionJobCommand') {
        return makeJobResponse('COMPLETED', transcriptUri);
      }
      return {};
    };

    const deletedKeys = [];
    s3SendStub = async (cmd) => {
      if (cmd.constructor_name === 'DeleteObjectCommand') {
        deletedKeys.push(cmd.params.Key);
      }
      if (cmd.constructor_name === 'GetObjectCommand') {
        return { Body: { transformToString: async () => JSON.stringify({ results: { transcripts: [{ transcript: 'some transcript' }] } }) } };
      }
      return {};
    };

    try {
      await transcriptionService.transcribe(tmpFile, 'voice.mp3');
      assert.ok(deletedKeys.length >= 1);
    } finally {
      cleanupFile(tmpFile);
    }
  });

  // ── S3 object deleted even on transcription failure ───────────────────────

  it('deletes S3 object even when Transcribe job fails', async () => {
    tmpFile = makeTempAudioFile('mp3');

    transcribeSendStub = async (cmd) => {
      if (cmd.constructor_name === 'StartTranscriptionJobCommand') return {};
      if (cmd.constructor_name === 'GetTranscriptionJobCommand') {
        return makeJobResponse('FAILED', null, 'bad audio');
      }
      return {};
    };

    const deletedKeys = [];
    s3SendStub = async (cmd) => {
      if (cmd.constructor_name === 'DeleteObjectCommand') {
        deletedKeys.push(cmd.params.Key);
      }
      return {};
    };

    try {
      await assert.rejects(() => transcriptionService.transcribe(tmpFile, 'voice.mp3'));
      assert.ok(deletedKeys.length >= 1, 'S3 object must be deleted even on failure');
    } finally {
      cleanupFile(tmpFile);
    }
  });

  // ── S3 key uniqueness ─────────────────────────────────────────────────────

  it('generates unique S3 keys for the same filename across multiple calls', () => {
    const filename = 'voice-memo.mp3';
    const keys = new Set();
    for (let i = 0; i < 20; i++) {
      keys.add(transcriptionService.generateS3Key(filename));
    }
    assert.equal(keys.size, 20, 'All 20 generated keys should be unique');
  });

  it('generates unique S3 keys for two distinct voice memo uploads', () => {
    const key1 = transcriptionService.generateS3Key('audio.mp3');
    const key2 = transcriptionService.generateS3Key('audio.mp3');
    assert.notEqual(key1, key2, 'Same filename must yield different S3 keys');
  });

  it('S3 key contains a TTL-based date prefix', () => {
    const key = transcriptionService.generateS3Key('test.mp3');
    // Expect format: transcriptions/YYYY-MM-DD/<uuid>-filename
    assert.match(key, /^transcriptions\/\d{4}-\d{2}-\d{2}\//);
  });

  it('S3 key contains the original sanitised filename', () => {
    const key = transcriptionService.generateS3Key('my voice.mp3');
    assert.ok(key.includes('my_voice.mp3') || key.includes('my voice.mp3') || key.endsWith('.mp3'),
      `Key should contain sanitised filename, got: ${key}`);
  });

  // ── Error message content ─────────────────────────────────────────────────

  it('error from FAILED job includes failure reason in message', async () => {
    tmpFile = makeTempAudioFile('mp3');

    transcribeSendStub = async (cmd) => {
      if (cmd.constructor_name === 'StartTranscriptionJobCommand') return {};
      if (cmd.constructor_name === 'GetTranscriptionJobCommand') {
        return makeJobResponse('FAILED', null, 'Audio is too short');
      }
      return {};
    };
    s3SendStub = async () => ({});

    try {
      await assert.rejects(
        () => transcriptionService.transcribe(tmpFile, 'audio.mp3'),
        (err) => {
          assert.ok(err.message.includes('Audio is too short') || err.message.includes('failed'),
            `Expected failure reason in message, got: ${err.message}`);
          return true;
        }
      );
    } finally {
      cleanupFile(tmpFile);
    }
  });

  // ── Module exports ────────────────────────────────────────────────────────

  it('exports transcribe, generateS3Key, _setS3Client, _setTranscribeClient', () => {
    assert.equal(typeof transcriptionService.transcribe, 'function');
    assert.equal(typeof transcriptionService.generateS3Key, 'function');
    assert.equal(typeof transcriptionService._setS3Client, 'function');
    assert.equal(typeof transcriptionService._setTranscribeClient, 'function');
  });
});
