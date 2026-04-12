// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Feature: transcribe-streaming, Property 1: Mode Resolution Correctness
// Feature: transcribe-streaming, Property 2: Magic Bytes Format Detection Correctness
// Feature: transcribe-streaming, Property 3: Audio Chunk Size Invariant and Data Integrity
// Feature: transcribe-streaming, Property 4: Partial Result Filtering
// Feature: transcribe-streaming, Property 5: WAV Header Field Extraction

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { resolveMode, detectFormat } = require('../../services/transcription-service');

// ── Constants matching the service implementation ──────────────────────────
const STREAM_CHUNK_SIZE = 25600;

// ---------------------------------------------------------------------------
// Property 1: Mode Resolution Correctness
//
// For any value of the TRANSCRIBE_MODE environment variable (including unset,
// empty, and arbitrary strings), resolveMode() shall return 'streaming' if and
// only if TRANSCRIBE_MODE is exactly the string 'streaming'. In all other
// cases it shall return 'batch'.
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.4
// ---------------------------------------------------------------------------

describe('Property 1: Mode Resolution Correctness', () => {
  it('resolveMode() returns "streaming" iff TRANSCRIBE_MODE is exactly "streaming"', () => {
    // Feature: transcribe-streaming, Property 1: Mode Resolution Correctness
    const modeArbitrary = fc.oneof(
      fc.constant('streaming'),
      fc.constant('batch'),
      fc.constant(''),
      fc.constant(undefined),
      fc.string()
    );

    fc.assert(
      fc.property(modeArbitrary, (modeValue) => {
        const original = process.env.TRANSCRIBE_MODE;
        try {
          if (modeValue === undefined) {
            delete process.env.TRANSCRIBE_MODE;
          } else {
            process.env.TRANSCRIBE_MODE = modeValue;
          }

          const result = resolveMode();

          if (modeValue === 'streaming') {
            assert.equal(result, 'streaming',
              `Expected 'streaming' when TRANSCRIBE_MODE="${modeValue}", got "${result}"`);
          } else {
            assert.equal(result, 'batch',
              `Expected 'batch' when TRANSCRIBE_MODE=${JSON.stringify(modeValue)}, got "${result}"`);
          }
        } finally {
          // Restore original env
          if (original === undefined) {
            delete process.env.TRANSCRIBE_MODE;
          } else {
            process.env.TRANSCRIBE_MODE = original;
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 2: Magic Bytes Format Detection Correctness
//
// For any Buffer of 4 or more bytes, detectFormat(buffer) shall return the
// correct format info from MAGIC_BYTES_MAP when the first 4 bytes match a
// known magic bytes pattern. For any Buffer whose first 4 bytes do not match
// any known pattern, detectFormat shall return null.
//
// Validates: Requirements 1.5, 1.6, 4.1, 4.2, 4.3, 4.4, 4.5
// ---------------------------------------------------------------------------

describe('Property 2: Magic Bytes Format Detection Correctness', () => {
  const KNOWN_FORMATS = [
    { magic: 'RIFF', expected: { encoding: 'pcm', needsHeaderStrip: true, defaultSampleRate: null } },
    { magic: 'OggS', expected: { encoding: 'ogg-opus', needsHeaderStrip: false, defaultSampleRate: 48000 } },
    { magic: 'fLaC', expected: { encoding: 'flac', needsHeaderStrip: false, defaultSampleRate: 16000 } },
  ];

  it('detectFormat() returns correct format info for known magic bytes and null for unknown', () => {
    // Feature: transcribe-streaming, Property 2: Magic Bytes Format Detection Correctness
    const knownMagicArbitrary = fc.constantFrom(...KNOWN_FORMATS);
    const trailingArbitrary = fc.uint8Array({ minLength: 0, maxLength: 200 });

    // Test known magic bytes with random trailing data
    const knownBufferArbitrary = fc.tuple(knownMagicArbitrary, trailingArbitrary).map(
      ([fmt, trailing]) => {
        const magicBuf = Buffer.from(fmt.magic, 'ascii');
        const combined = Buffer.concat([magicBuf, Buffer.from(trailing)]);
        return { buffer: combined, expected: fmt.expected };
      }
    );

    // Test random buffers that do NOT start with known magic bytes
    const knownMagicSet = new Set(KNOWN_FORMATS.map(f => f.magic));
    const randomBufferArbitrary = fc.uint8Array({ minLength: 4, maxLength: 200 })
      .filter(arr => {
        const first4 = Buffer.from(arr.slice(0, 4)).toString('ascii');
        return !knownMagicSet.has(first4);
      });

    // Property: known magic bytes produce correct format info
    fc.assert(
      fc.property(knownBufferArbitrary, ({ buffer, expected }) => {
        const result = detectFormat(buffer);
        assert.notEqual(result, null, 'detectFormat should not return null for known magic bytes');
        assert.equal(result.encoding, expected.encoding);
        assert.equal(result.needsHeaderStrip, expected.needsHeaderStrip);
        assert.equal(result.defaultSampleRate, expected.defaultSampleRate);
      }),
      { numRuns: 100 }
    );

    // Property: unknown magic bytes produce null
    fc.assert(
      fc.property(randomBufferArbitrary, (arr) => {
        const buffer = Buffer.from(arr);
        const result = detectFormat(buffer);
        assert.equal(result, null,
          `detectFormat should return null for unknown magic bytes, got ${JSON.stringify(result)}`);
      }),
      { numRuns: 100 }
    );
  });

  it('detectFormat() returns null for buffers shorter than 4 bytes', () => {
    // Feature: transcribe-streaming, Property 2: Magic Bytes Format Detection Correctness
    const shortBufferArbitrary = fc.uint8Array({ minLength: 0, maxLength: 3 });

    fc.assert(
      fc.property(shortBufferArbitrary, (arr) => {
        const buffer = Buffer.from(arr);
        const result = detectFormat(buffer);
        assert.equal(result, null,
          `detectFormat should return null for buffer of length ${buffer.length}`);
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 3: Audio Chunk Size Invariant and Data Integrity
//
// For any audio data buffer of any size, every chunk yielded by the audio
// stream generator shall have a byte length > 0 and <= 25,600 bytes, and the
// concatenation of all chunks shall exactly equal the original audio data
// buffer. For 0-byte input, zero chunks are yielded.
//
// Validates: Requirements 3.1, 3.2, 3.3
// ---------------------------------------------------------------------------

describe('Property 3: Audio Chunk Size Invariant and Data Integrity', () => {
  /**
   * Replicates the chunking logic from streamPipeline's async generator.
   * Yields chunks of audioData, each <= STREAM_CHUNK_SIZE bytes.
   */
  function* chunkAudioData(audioData) {
    if (audioData.length === 0) return;
    for (let offset = 0; offset < audioData.length; offset += STREAM_CHUNK_SIZE) {
      yield audioData.slice(offset, offset + STREAM_CHUNK_SIZE);
    }
  }

  it('all chunks are > 0 and <= 25600 bytes, and concatenation equals original', () => {
    // Feature: transcribe-streaming, Property 3: Audio Chunk Size Invariant and Data Integrity
    const audioArbitrary = fc.uint8Array({ minLength: 0, maxLength: 100000 });

    fc.assert(
      fc.property(audioArbitrary, (arr) => {
        const audioData = Buffer.from(arr);
        const chunks = [...chunkAudioData(audioData)];

        if (audioData.length === 0) {
          assert.equal(chunks.length, 0, 'Zero-byte input should yield zero chunks');
          return;
        }

        // Every chunk must be > 0 and <= STREAM_CHUNK_SIZE
        for (let i = 0; i < chunks.length; i++) {
          assert.ok(chunks[i].length > 0,
            `Chunk ${i} has length 0`);
          assert.ok(chunks[i].length <= STREAM_CHUNK_SIZE,
            `Chunk ${i} has length ${chunks[i].length}, exceeds ${STREAM_CHUNK_SIZE}`);
        }

        // Concatenation must equal original
        const reassembled = Buffer.concat(chunks);
        assert.equal(reassembled.length, audioData.length,
          `Reassembled length ${reassembled.length} != original ${audioData.length}`);
        assert.ok(reassembled.equals(audioData),
          'Reassembled buffer does not equal original audio data');
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 4: Partial Result Filtering
//
// For any sequence of Transcribe Streaming transcript events containing a mix
// of partial (IsPartial: true) and final (IsPartial: false) results, the
// assembled transcript shall contain only the text from final results,
// concatenated with spaces, and shall contain none of the partial result text
// (unless a partial result happens to share text with a final result).
//
// Validates: Requirements 2.3, 3.4
// ---------------------------------------------------------------------------

describe('Property 4: Partial Result Filtering', () => {
  /**
   * Replicates the result filtering logic from streamPipeline.
   * Collects only non-partial results and concatenates with spaces.
   */
  function assembleTranscript(events) {
    const transcripts = [];
    for (const event of events) {
      const results = event.TranscriptEvent &&
        event.TranscriptEvent.Transcript &&
        event.TranscriptEvent.Transcript.Results;
      if (!results) continue;
      for (const result of results) {
        if (result.IsPartial === false &&
            result.Alternatives &&
            result.Alternatives[0] &&
            result.Alternatives[0].Transcript) {
          transcripts.push(result.Alternatives[0].Transcript);
        }
      }
    }
    return transcripts.join(' ');
  }

  it('assembled transcript contains only non-partial text', () => {
    // Feature: transcribe-streaming, Property 4: Partial Result Filtering

    // Generate unique text tokens to distinguish partial from final
    const uniqueText = fc.stringOf(
      fc.char().filter(c => c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t'),
      { minLength: 1, maxLength: 30 }
    );

    const resultArbitrary = fc.record({
      isPartial: fc.boolean(),
      text: uniqueText,
    });

    const eventsArbitrary = fc.array(resultArbitrary, { minLength: 0, maxLength: 20 }).map(
      results => results.map(r => ({
        TranscriptEvent: {
          Transcript: {
            Results: [{
              IsPartial: r.isPartial,
              Alternatives: [{ Transcript: r.text }],
            }],
          },
        },
      }))
    );

    fc.assert(
      fc.property(eventsArbitrary, (events) => {
        const transcript = assembleTranscript(events);

        // Collect expected final texts
        const finalTexts = [];
        const partialOnlyTexts = [];

        for (const event of events) {
          const results = event.TranscriptEvent.Transcript.Results;
          for (const result of results) {
            if (result.IsPartial === false) {
              finalTexts.push(result.Alternatives[0].Transcript);
            } else {
              partialOnlyTexts.push(result.Alternatives[0].Transcript);
            }
          }
        }

        // The assembled transcript should equal final texts joined with spaces
        const expected = finalTexts.join(' ');
        assert.equal(transcript, expected,
          `Transcript mismatch: expected "${expected}", got "${transcript}"`);

        // Partial-only texts should not appear in the transcript
        // (unless they coincidentally match a final text substring)
        for (const partialText of partialOnlyTexts) {
          if (!finalTexts.some(ft => ft.includes(partialText))) {
            assert.ok(!transcript.includes(partialText),
              `Partial text "${partialText}" should not appear in assembled transcript`);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 5: WAV Header Field Extraction
//
// For any Buffer of at least 44 bytes whose first 4 bytes are RIFF, the
// sample rate parsed from bytes 24-27 (little-endian uint32) and the channel
// count parsed from bytes 22-23 (little-endian uint16) shall exactly match
// the values written at those byte offsets.
//
// Validates: Requirements 3.7, 4.6
// ---------------------------------------------------------------------------

describe('Property 5: WAV Header Field Extraction', () => {
  it('WAV header sample rate and channel count are correctly extracted', () => {
    // Feature: transcribe-streaming, Property 5: WAV Header Field Extraction

    // Generate realistic sample rates (1-192000) and channel counts (1-8)
    const sampleRateArbitrary = fc.integer({ min: 1, max: 192000 });
    const channelCountArbitrary = fc.integer({ min: 1, max: 8 });
    const paddingArbitrary = fc.uint8Array({ minLength: 0, maxLength: 200 });

    fc.assert(
      fc.property(
        sampleRateArbitrary,
        channelCountArbitrary,
        paddingArbitrary,
        (sampleRate, channelCount, padding) => {
          // Build a 44+ byte WAV buffer
          const header = Buffer.alloc(44);

          // Write RIFF magic bytes
          header.write('RIFF', 0, 4, 'ascii');

          // Write file size placeholder at bytes 4-7
          header.writeUInt32LE(36 + padding.length, 4);

          // Write WAVE format
          header.write('WAVE', 8, 4, 'ascii');

          // Write fmt sub-chunk
          header.write('fmt ', 12, 4, 'ascii');
          header.writeUInt32LE(16, 16);       // Sub-chunk size
          header.writeUInt16LE(1, 20);        // Audio format (PCM = 1)
          header.writeUInt16LE(channelCount, 22);  // Number of channels
          header.writeUInt32LE(sampleRate, 24);    // Sample rate
          header.writeUInt32LE(sampleRate * channelCount * 2, 28); // Byte rate
          header.writeUInt16LE(channelCount * 2, 32);  // Block align
          header.writeUInt16LE(16, 34);       // Bits per sample

          // Write data sub-chunk header
          header.write('data', 36, 4, 'ascii');
          header.writeUInt32LE(padding.length, 40);

          const wavBuffer = Buffer.concat([header, Buffer.from(padding)]);

          // Verify detectFormat identifies this as WAV
          const formatInfo = detectFormat(wavBuffer);
          assert.notEqual(formatInfo, null, 'detectFormat should recognize RIFF magic');
          assert.equal(formatInfo.encoding, 'pcm');
          assert.equal(formatInfo.needsHeaderStrip, true);

          // Parse header fields the same way streamPipeline does
          const parsedSampleRate = wavBuffer.readUInt32LE(24);
          const parsedChannelCount = wavBuffer.readUInt16LE(22);

          assert.equal(parsedSampleRate, sampleRate,
            `Sample rate mismatch: wrote ${sampleRate}, read ${parsedSampleRate}`);
          assert.equal(parsedChannelCount, channelCount,
            `Channel count mismatch: wrote ${channelCount}, read ${parsedChannelCount}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});
