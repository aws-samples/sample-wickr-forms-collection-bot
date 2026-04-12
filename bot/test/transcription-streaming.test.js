// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// ── Bootstrap: mock AWS SDK packages ──────────────────────────────────────────
// Must appear before any require of transcription-service.js so that Node's
// module system never tries to resolve the real AWS SDK packages.
// Uses the same Module._resolveFilename pattern as transcription-service.test.js.
const Module = require('module');
const _originalResolve = Module._resolveFilename;

const S3_STUB_KEY = '__aws_s3_stub_streaming__';
const TRANSCRIBE_STUB_KEY = '__aws_transcribe_stub_streaming__';
const STREAMING_STUB_KEY = '__aws_transcribe_streaming_stub__';

// ── Mutable stub state (reset per test) ──────────────────────────────────────
let s3SendStub = async () => ({});
let transcribeSendStub = async () => ({});
let streamingSendStub = async () => ({});
let streamingClientConstructorArgs = null;

const S3ClientStub = {
  send: async (cmd) => s3SendStub(cmd),
};
const TranscribeClientStub = {
  send: async (cmd) => transcribeSendStub(cmd),
};
const StreamingClientStub = {
  send: async (cmd) => streamingSendStub(cmd),
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
class StartStreamTranscriptionCommandStub {
  constructor(params) { this.params = params; this.constructor_name = 'StartStreamTranscriptionCommand'; }
}

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@aws-sdk/client-s3') return S3_STUB_KEY;
  if (request === '@aws-sdk/client-transcribe') return TRANSCRIBE_STUB_KEY;
  if (request === '@aws-sdk/client-transcribe-streaming') return STREAMING_STUB_KEY;
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
    DeleteObjectCommand: DeleteObjectCommandStub,
    GetObjectCommand: GetObjectCommandStub,
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

require.cache[STREAMING_STUB_KEY] = {
  id: STREAMING_STUB_KEY,
  filename: STREAMING_STUB_KEY,
  loaded: true,
  exports: {
    TranscribeStreamingClient: class TranscribeStreamingClient {
      constructor(config) {
        streamingClientConstructorArgs = config;
        return StreamingClientStub;
      }
    },
    StartStreamTranscriptionCommand: StartStreamTranscriptionCommandStub,
  },
  parent: null,
  children: [],
  paths: [],
};

// ── Setup: load Wickr IO mocks ─────────────────────────────────────────────────
require('./setup');

// ── Imports ───────────────────────────────────────────────────────────────────
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const transcriptionService = require('../services/transcription-service');

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Creates a minimal WAV file buffer with proper RIFF magic bytes and 44-byte header.
 * @param {number} sampleRate - Sample rate to write at bytes 24-27
 * @param {number} numChannels - Channel count to write at bytes 22-23
 * @param {Buffer} pcmData - Raw PCM audio data after the header
 * @returns {Buffer}
 */
function makeWavBuffer(sampleRate = 48000, numChannels = 1, pcmData = Buffer.from('fake-pcm-audio-data')) {
  const header = Buffer.alloc(44);
  // RIFF magic bytes
  header.write('RIFF', 0, 'ascii');
  // File size - 8 (placeholder)
  header.writeUInt32LE(36 + pcmData.length, 4);
  // WAVE format
  header.write('WAVE', 8, 'ascii');
  // fmt sub-chunk
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // sub-chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * 2, 28); // byte rate
  header.writeUInt16LE(numChannels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  // data sub-chunk
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}

/**
 * Creates a temp file with the given buffer content and returns its path.
 */
function makeTempFile(buffer, ext = 'wav') {
  const tmpPath = path.join(os.tmpdir(), `test-streaming-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

/**
 * Cleans up a temp file if it exists.
 */
function cleanupFile(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) {}
}

/**
 * Creates a mock TranscriptResultStream (async iterable) that yields the given events.
 */
function makeTranscriptStream(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

/**
 * Creates a standard non-partial transcript event.
 */
function makeFinalEvent(text) {
  return {
    TranscriptEvent: {
      Transcript: {
        Results: [{
          IsPartial: false,
          Alternatives: [{ Transcript: text }],
        }],
      },
    },
  };
}

// ── Unit Tests ────────────────────────────────────────────────────────────────

describe('transcription-streaming', () => {
  let tmpFile;
  let savedTranscribeMode;

  beforeEach(() => {
    // Save and clear env
    savedTranscribeMode = process.env.TRANSCRIBE_MODE;
    delete process.env.TRANSCRIBE_MODE;

    // Reset stub behaviour
    s3SendStub = async () => ({});
    transcribeSendStub = async () => ({});
    streamingSendStub = async () => ({});
    streamingClientConstructorArgs = null;

    // Re-inject the stubs
    transcriptionService._setS3Client(S3ClientStub);
    transcriptionService._setTranscribeClient(TranscribeClientStub);
    transcriptionService._setStreamingClient(StreamingClientStub);
  });

  afterEach(() => {
    // Restore env
    if (savedTranscribeMode !== undefined) {
      process.env.TRANSCRIBE_MODE = savedTranscribeMode;
    } else {
      delete process.env.TRANSCRIBE_MODE;
    }
    if (tmpFile) {
      cleanupFile(tmpFile);
      tmpFile = null;
    }
  });

  // ── 4.2: Module exports ───────────────────────────────────────────────────

  it('exports transcribe, generateS3Key, _setS3Client, _setTranscribeClient, _setStreamingClient, resolveMode, detectFormat', () => {
    assert.equal(typeof transcriptionService.transcribe, 'function');
    assert.equal(typeof transcriptionService.generateS3Key, 'function');
    assert.equal(typeof transcriptionService._setS3Client, 'function');
    assert.equal(typeof transcriptionService._setTranscribeClient, 'function');
    assert.equal(typeof transcriptionService._setStreamingClient, 'function');
    assert.equal(typeof transcriptionService.resolveMode, 'function');
    assert.equal(typeof transcriptionService.detectFormat, 'function');
  });

  // ── 4.3: Streaming pipeline does NOT call S3 or batch Transcribe ──────────

  it('streaming mode with RIFF file does not call S3 PutObject or StartTranscriptionJob', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    const wavBuffer = makeWavBuffer(48000, 1, Buffer.from('test-pcm-data-for-streaming'));
    tmpFile = makeTempFile(wavBuffer);

    const s3Calls = [];
    const transcribeCalls = [];

    s3SendStub = async (cmd) => {
      s3Calls.push(cmd.constructor_name);
      return {};
    };
    transcribeSendStub = async (cmd) => {
      transcribeCalls.push(cmd.constructor_name);
      return {};
    };

    streamingSendStub = async () => ({
      TranscriptResultStream: makeTranscriptStream([
        makeFinalEvent('grid 38SMB urgent'),
      ]),
    });

    const result = await transcriptionService.transcribe(tmpFile, 'voice-memo.wav');
    assert.equal(result, 'grid 38SMB urgent');
    assert.equal(s3Calls.filter(n => n === 'PutObjectCommand').length, 0, 'Should not call S3 PutObject');
    assert.equal(transcribeCalls.filter(n => n === 'StartTranscriptionJobCommand').length, 0, 'Should not call StartTranscriptionJob');
  });

  // ── 4.4: _setStreamingClient replaces the singleton ──────────────────────

  it('_setStreamingClient replaces the singleton — injected mock send is called', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    const wavBuffer = makeWavBuffer(48000, 1, Buffer.from('pcm-data'));
    tmpFile = makeTempFile(wavBuffer);

    let sendCalled = false;
    const mockClient = {
      send: async () => {
        sendCalled = true;
        return {
          TranscriptResultStream: makeTranscriptStream([
            makeFinalEvent('injected mock result'),
          ]),
        };
      },
    };

    transcriptionService._setStreamingClient(mockClient);

    const result = await transcriptionService.transcribe(tmpFile, 'voice-memo.wav');
    assert.equal(sendCalled, true, 'Injected mock client send should have been called');
    assert.equal(result, 'injected mock result');
  });

  // ── 4.5: Streaming client configured with AWS_REGION ─────────────────────

  it('streaming client is configured with AWS_REGION env var', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    // Clear the singleton so getStreamingClient() creates a new one
    transcriptionService._setStreamingClient(null);

    const wavBuffer = makeWavBuffer(48000, 1, Buffer.from('pcm'));
    tmpFile = makeTempFile(wavBuffer);

    streamingSendStub = async () => ({
      TranscriptResultStream: makeTranscriptStream([makeFinalEvent('region test')]),
    });

    await transcriptionService.transcribe(tmpFile, 'voice.wav');
    // AWS_REGION is captured at module load time. Verify the constructor
    // received a region property (the module's captured value).
    assert.ok(streamingClientConstructorArgs, 'TranscribeStreamingClient constructor should have been called');
    assert.equal(typeof streamingClientConstructorArgs.region, 'string', 'region should be a string');
    assert.ok(streamingClientConstructorArgs.region.length > 0, 'region should not be empty');

    // Re-inject stub to avoid stale singleton
    transcriptionService._setStreamingClient(StreamingClientStub);
  });

  // ── 4.6: File read error rejects before any AWS call ──────────────────────

  it('file read error rejects before any AWS call', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    let anyAwsCallMade = false;
    s3SendStub = async () => { anyAwsCallMade = true; return {}; };
    transcribeSendStub = async () => { anyAwsCallMade = true; return {}; };
    streamingSendStub = async () => { anyAwsCallMade = true; return {}; };

    await assert.rejects(
      () => transcriptionService.transcribe('/nonexistent/path/audio.wav', 'audio.wav'),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
    assert.equal(anyAwsCallMade, false, 'No AWS calls should be made when file read fails');
  });

  // ── 4.7: WebSocket/streaming failure rejects with descriptive error ───────

  it('streaming failure rejects with descriptive error', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    const wavBuffer = makeWavBuffer(48000, 1, Buffer.from('pcm-data'));
    tmpFile = makeTempFile(wavBuffer);

    streamingSendStub = async () => {
      throw new Error('WebSocket connection refused');
    };

    await assert.rejects(
      () => transcriptionService.transcribe(tmpFile, 'voice.wav'),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('WebSocket connection refused'), `Expected descriptive error, got: ${err.message}`);
        return true;
      }
    );
  });

  // ── 4.8: Zero transcript results falls back to batch mode ──────────────

  it('zero transcript results falls back to batch mode', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    const wavBuffer = makeWavBuffer(48000, 1, Buffer.from('pcm-data'));
    tmpFile = makeTempFile(wavBuffer);

    streamingSendStub = async () => ({
      TranscriptResultStream: makeTranscriptStream([]),
    });

    // Mock batch pipeline to succeed after streaming fallback
    let s3PutCalled = false;
    s3SendStub = async (cmd) => {
      if (cmd.constructor_name === 'PutObjectCommand') {
        s3PutCalled = true;
        return {};
      }
      if (cmd.constructor_name === 'DeleteObjectCommand') return {};
      if (cmd.constructor_name === 'GetObjectCommand') {
        return {
          Body: {
            transformToString: async () => JSON.stringify({
              results: { transcripts: [{ transcript: 'batch fallback text' }] },
            }),
          },
        };
      }
      return {};
    };
    transcribeSendStub = async (cmd) => {
      if (cmd.constructor_name === 'StartTranscriptionJobCommand') return {};
      if (cmd.constructor_name === 'GetTranscriptionJobCommand') {
        return {
          TranscriptionJob: {
            TranscriptionJobStatus: 'COMPLETED',
            Transcript: { TranscriptFileUri: 'https://s3.us-gov-west-1.amazonaws.com/bucket/transcripts/job.json' },
          },
        };
      }
      return {};
    };

    const result = await transcriptionService.transcribe(tmpFile, 'voice.wav');
    assert.equal(result, 'batch fallback text');
    assert.ok(s3PutCalled, 'batch pipeline should have been invoked (S3 PutObject called)');
  });

  // ── 4.9: Empty file (0 bytes) falls back to batch mode ───────────────────

  it('empty file falls back to batch mode', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    tmpFile = makeTempFile(Buffer.alloc(0), 'wav');

    const s3Calls = [];
    s3SendStub = async (cmd) => {
      s3Calls.push(cmd.constructor_name);
      return {};
    };

    // Batch pipeline will call StartTranscriptionJob then poll
    transcribeSendStub = async (cmd) => {
      if (cmd.constructor_name === 'StartTranscriptionJobCommand') return {};
      if (cmd.constructor_name === 'GetTranscriptionJobCommand') {
        return {
          TranscriptionJob: {
            TranscriptionJobStatus: 'COMPLETED',
            Transcript: { TranscriptFileUri: 'https://s3.amazonaws.com/bucket/t.json' },
          },
        };
      }
      return {};
    };

    // Mock the S3 GetObject for fetchTranscriptText
    const origS3Send = s3SendStub;
    s3SendStub = async (cmd) => {
      if (cmd.constructor_name === 'PutObjectCommand') {
        s3Calls.push('PutObjectCommand');
        return {};
      }
      if (cmd.constructor_name === 'DeleteObjectCommand') {
        s3Calls.push('DeleteObjectCommand');
        return {};
      }
      if (cmd.constructor_name === 'GetObjectCommand') {
        return {
          Body: {
            transformToString: async () => JSON.stringify({
              results: { transcripts: [{ transcript: 'batch fallback text' }] },
            }),
          },
        };
      }
      return {};
    };

    const result = await transcriptionService.transcribe(tmpFile, 'empty.wav');
    assert.equal(result, 'batch fallback text');
    assert.ok(s3Calls.includes('PutObjectCommand'), 'Batch mode should call S3 PutObject (fallback)');
  });

  // ── 4.10: File < 4 bytes falls back to batch mode ────────────────────────

  it('file < 4 bytes falls back to batch mode', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    tmpFile = makeTempFile(Buffer.from([0x01, 0x02]), 'bin');

    const s3Calls = [];
    s3SendStub = async (cmd) => {
      if (cmd.constructor_name === 'PutObjectCommand') {
        s3Calls.push('PutObjectCommand');
        return {};
      }
      if (cmd.constructor_name === 'DeleteObjectCommand') return {};
      if (cmd.constructor_name === 'GetObjectCommand') {
        return {
          Body: {
            transformToString: async () => JSON.stringify({
              results: { transcripts: [{ transcript: 'small file batch' }] },
            }),
          },
        };
      }
      return {};
    };

    transcribeSendStub = async (cmd) => {
      if (cmd.constructor_name === 'StartTranscriptionJobCommand') return {};
      if (cmd.constructor_name === 'GetTranscriptionJobCommand') {
        return {
          TranscriptionJob: {
            TranscriptionJobStatus: 'COMPLETED',
            Transcript: { TranscriptFileUri: 'https://s3.amazonaws.com/bucket/t.json' },
          },
        };
      }
      return {};
    };

    const result = await transcriptionService.transcribe(tmpFile, 'tiny.bin');
    assert.equal(result, 'small file batch');
    assert.ok(s3Calls.includes('PutObjectCommand'), 'Batch mode should call S3 PutObject for small file fallback');
  });

  // ── 4.11: WAV file < 44 bytes throws Error ───────────────────────────────

  it('WAV file < 44 bytes (RIFF magic but truncated) throws Error', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    // 10 bytes starting with RIFF
    const truncatedWav = Buffer.alloc(10);
    truncatedWav.write('RIFF', 0, 'ascii');
    tmpFile = makeTempFile(truncatedWav, 'wav');

    await assert.rejects(
      () => transcriptionService.transcribe(tmpFile, 'truncated.wav'),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('WAV file too small'), `Expected "WAV file too small" error, got: ${err.message}`);
        return true;
      }
    );
  });

  // ── 4.12: Audio stream generator closes after all data sent ───────────────

  it('audio stream generator terminates — streaming call completes without hanging', async () => {
    process.env.TRANSCRIBE_MODE = 'streaming';

    // Create a WAV with enough data for multiple chunks
    const pcmData = Buffer.alloc(60000, 0xAB); // > 2 chunks of 25600
    const wavBuffer = makeWavBuffer(16000, 1, pcmData);
    tmpFile = makeTempFile(wavBuffer);

    let receivedChunks = 0;
    streamingSendStub = async (cmd) => {
      // Consume the AudioStream to verify it terminates
      if (cmd.params && cmd.params.AudioStream) {
        for await (const chunk of cmd.params.AudioStream) {
          if (chunk.AudioEvent && chunk.AudioEvent.AudioChunk) {
            receivedChunks++;
          }
        }
      }
      return {
        TranscriptResultStream: makeTranscriptStream([
          makeFinalEvent('stream completed'),
        ]),
      };
    };

    const result = await transcriptionService.transcribe(tmpFile, 'voice.wav');
    assert.equal(result, 'stream completed');
    assert.ok(receivedChunks >= 3, `Expected at least 3 chunks for 60000 bytes, got ${receivedChunks}`);
  });
});
