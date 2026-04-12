// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const { v4: uuidv4 } = require('crypto').randomUUID ? { v4: () => require('crypto').randomUUID() } : { v4: null };
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ── Default region ─────────────────────────────────────────────────────────
const AWS_REGION = process.env.AWS_REGION || 'us-gov-west-1';
const S3_BUCKET = process.env.TRANSCRIPTION_S3_BUCKET || 'nine-line-transcription';

// ── Polling configuration ──────────────────────────────────────────────────
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 28000; // leave 2s buffer under the 30s acceptance criterion

// ── Streaming configuration ────────────────────────────────────────────────
const STREAM_CHUNK_SIZE = 25600;

// Magic bytes → format info for Transcribe Streaming
// Key: ASCII string of first 4 bytes of the file
const MAGIC_BYTES_MAP = {
  'RIFF': { encoding: 'pcm', needsHeaderStrip: true, defaultSampleRate: null },
  'OggS': { encoding: 'ogg-opus', needsHeaderStrip: false, defaultSampleRate: 48000 },
  'fLaC': { encoding: 'flac', needsHeaderStrip: false, defaultSampleRate: 16000 },
};

// ── Lazy-loaded clients (injectable for testing) ───────────────────────────
let _s3Client = null;
let _transcribeClient = null;
let _streamingClient = null;

function getS3Client() {
  if (_s3Client) return _s3Client;
  const { S3Client } = require('@aws-sdk/client-s3');
  _s3Client = new S3Client({ region: AWS_REGION });
  return _s3Client;
}

function getTranscribeClient() {
  if (_transcribeClient) return _transcribeClient;
  const { TranscribeClient } = require('@aws-sdk/client-transcribe');
  _transcribeClient = new TranscribeClient({ region: AWS_REGION });
  return _transcribeClient;
}

function getStreamingClient() {
  if (_streamingClient) return _streamingClient;
  const { TranscribeStreamingClient } = require('@aws-sdk/client-transcribe-streaming');
  _streamingClient = new TranscribeStreamingClient({ region: AWS_REGION });
  return _streamingClient;
}

/**
 * Inject mock S3 client (for testing).
 * @param {Object} client
 */
function _setS3Client(client) {
  _s3Client = client;
}

/**
 * Inject mock Transcribe client (for testing).
 * @param {Object} client
 */
function _setTranscribeClient(client) {
  _transcribeClient = client;
}

/**
 * Inject mock streaming client (for testing).
 * @param {Object} client
 */
function _setStreamingClient(client) {
  _streamingClient = client;
}

/**
 * Reads TRANSCRIBE_MODE env var and returns 'streaming' or 'batch'.
 * Returns 'streaming' only if the value is exactly 'streaming'.
 * Logs a warning for unrecognized values.
 * @returns {'batch' | 'streaming'}
 */
function resolveMode() {
  const mode = process.env.TRANSCRIBE_MODE;
  if (mode === 'streaming') return 'streaming';
  if (mode === 'batch' || mode === undefined || mode === '') return 'batch';
  logger.warn('transcribe', 'unrecognized_transcribe_mode', { configuredValue: mode, defaultingTo: 'batch' });
  return 'batch';
}

/**
 * Detects audio format by reading the first 4 bytes (magic bytes) of a Buffer.
 * @param {Buffer} buffer
 * @returns {object|null} Format info from MAGIC_BYTES_MAP, or null if unrecognized
 */
function detectFormat(buffer) {
  if (!buffer || buffer.length < 4) return null;
  const magic = buffer.slice(0, 4).toString('ascii');
  return MAGIC_BYTES_MAP[magic] || null;
}

/**
 * Generates a unique S3 key with a date-based TTL prefix.
 * Format: transcriptions/YYYY-MM-DD/<uuid>-<filename>
 * @param {string} filename
 * @returns {string}
 */
function generateS3Key(filename) {
  const datePrefix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const uniqueId = require('crypto').randomUUID();
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `transcriptions/${datePrefix}/${uniqueId}-${safeName}`;
}

/**
 * Deletes an S3 object. Errors are logged but not rethrown.
 * @param {string} bucket
 * @param {string} key
 */
async function deleteS3Object(bucket, key) {
  try {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    logger.debug('transcribe', 's3_delete_complete', { bucket, key });
  } catch (err) {
    logger.error('transcribe', 's3_delete_error', { bucket, key, error: err });
  }
}

/**
 * Polls for transcription job completion, timing out after POLL_TIMEOUT_MS.
 * @param {string} jobName
 * @returns {Promise<string>} The transcript text URL
 * @throws {Error} if job fails or times out
 */
async function pollForCompletion(jobName) {
  const { GetTranscriptionJobCommand } = require('@aws-sdk/client-transcribe');
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await getTranscribeClient().send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName })
    );

    const job = response.TranscriptionJob;
    const status = job && job.TranscriptionJobStatus;

    if (status === 'COMPLETED') {
      const transcriptUri = job.Transcript && job.Transcript.TranscriptFileUri;
      if (!transcriptUri) {
        throw new Error('Transcription job completed but transcript URI is missing');
      }
      return transcriptUri;
    }

    if (status === 'FAILED') {
      const reason = (job && job.FailureReason) || 'Unknown reason';
      throw new Error(`Transcription job failed: ${reason}`);
    }

    // IN_PROGRESS or QUEUED — wait and retry
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('Transcription job timed out after 28 seconds');
}

/**
 * Fetches the transcript text from S3 using the SDK (authenticated).
 * The TranscriptFileUri from Transcribe is an S3 URL that requires SigV4 auth
 * in GovCloud -- plain HTTPS GET returns an XML AccessDenied error.
 * @param {string} transcriptUri - The TranscriptFileUri from Transcribe
 * @returns {Promise<string>}
 */
async function fetchTranscriptText(transcriptUri) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');

  // Parse bucket and key from the S3 HTTPS URL
  // Format: https://s3.<region>.amazonaws.com/<bucket>/<key>
  const url = new URL(transcriptUri);
  const pathParts = url.pathname.replace(/^\//, '').split('/');
  const bucket = pathParts[0];
  const key = pathParts.slice(1).join('/');

  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const data = await response.Body.transformToString('utf-8');

  const parsed = JSON.parse(data);
  const transcript = parsed.results &&
    parsed.results.transcripts &&
    parsed.results.transcripts[0] &&
    parsed.results.transcripts[0].transcript;

  if (typeof transcript === 'string') {
    return transcript;
  }
  throw new Error('Transcript text not found in Transcribe output');
}

/**
 * Batch transcription pipeline (extracted from original transcribe()):
 *   1. Upload audio file to S3 with a unique TTL-based key
 *   2. Start an Amazon Transcribe job
 *   3. Poll for job completion (max 28 seconds)
 *   4. Retrieve the transcript text
 *   5. Delete the S3 object
 *
 * @param {string} filePath - Local path to the audio file
 * @param {string} filename - Original filename (used for key generation and media format)
 * @returns {Promise<string>} The transcribed text
 * @throws {Error} on S3 upload failure or Transcribe failure (after attempting cleanup)
 */
async function batchPipeline(filePath, filename, options) {
  const correlationId = options && options.correlationId;
  const timer = logger.startTimer();
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { StartTranscriptionJobCommand } = require('@aws-sdk/client-transcribe');

  const bucket = S3_BUCKET;
  const s3Key = generateS3Key(filename);
  const jobName = `nine-line-${require('crypto').randomUUID()}`;
  const transcriptKey = `transcripts/${jobName}.json`;

  // Derive media format from file extension
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const mediaFormat = ['mp3', 'mp4', 'wav', 'flac', 'ogg', 'amr', 'webm', 'm4a'].includes(ext)
    ? ext
    : 'mp3'; // default fallback

  let uploaded = false;

  try {
    // ── Step 1: Upload to S3 ───────────────────────────────────────────────
    const fileBuffer = fs.readFileSync(filePath);
    logger.info('transcribe', 'transcription_start', { correlationId, mode: 'batch', fileSize: fileBuffer.length });
    const uploadTimer = logger.startTimer();
    await getS3Client().send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: `audio/${mediaFormat}`,
    }));
    uploaded = true;
    logger.debug('transcribe', 's3_upload_complete', { correlationId, bucket, key: s3Key, durationMs: uploadTimer.elapsed() });

    // ── Step 2: Start Transcribe job ───────────────────────────────────────
    logger.debug('transcribe', 'transcription_job_start', { correlationId, jobName });
    await getTranscribeClient().send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media: { MediaFileUri: `s3://${bucket}/${s3Key}` },
      MediaFormat: mediaFormat,
      IdentifyLanguage: true,
      OutputBucketName: bucket,
      OutputKey: `transcripts/${jobName}.json`,
    }));

    // ── Step 3: Poll for completion ────────────────────────────────────────
    logger.debug('transcribe', 'transcription_job_polling', { correlationId, jobName });
    const transcriptUri = await pollForCompletion(jobName);

    // ── Step 4: Retrieve transcript text ───────────────────────────────────
    logger.debug('transcribe', 'transcript_fetch_start', { correlationId });
    const text = await fetchTranscriptText(transcriptUri);
    logger.info('transcribe', 'transcription_complete', { correlationId, mode: 'batch', durationMs: timer.elapsed(), transcriptLength: text.length });

    return text;

  } catch (err) {
    logger.error('transcribe', 'transcription_error', { correlationId, mode: 'batch', error: err, durationMs: timer.elapsed() });
    throw err;
  } finally {
    // ── Step 5: Always clean up S3 objects ────────────────────────────────
    if (uploaded) {
      await deleteS3Object(bucket, s3Key);
      await deleteS3Object(bucket, transcriptKey);
    }
  }
}

/**
 * Streaming transcription pipeline:
 *   1. Read file into Buffer
 *   2. Detect format via magic bytes
 *   3. Parse WAV header or use defaults for OGG/FLAC
 *   4. Stream audio chunks to Transcribe Streaming
 *   5. Collect and return final transcript
 *
 * @param {string} filePath - Local path to the audio file
 * @param {string} filename - Original filename (passed through to batch fallback)
 * @returns {Promise<string>} The transcribed text
 */
async function streamPipeline(filePath, filename, options) {
  const correlationId = options && options.correlationId;
  const timer = logger.startTimer();
  try {
    // ── Step 1: Read file ──────────────────────────────────────────────────
    const buffer = fs.readFileSync(filePath);

    // ── Step 2: Check minimum size ─────────────────────────────────────────
    if (buffer.length < 4) {
      logger.warn('transcribe', 'streaming_fallback_to_batch', { correlationId, reason: `file too small (${buffer.length} bytes)` });
      return batchPipeline(filePath, filename, options);
    }

    // ── Step 3: Detect format ──────────────────────────────────────────────
    const formatInfo = detectFormat(buffer);
    if (!formatInfo) {
      const hex = buffer.slice(0, 4).toString('hex');
      logger.warn('transcribe', 'streaming_fallback_to_batch', { correlationId, reason: `unrecognized magic bytes (0x${hex})` });
      return batchPipeline(filePath, filename, options);
    }

    const magic = buffer.slice(0, 4).toString('ascii');
    logger.info('transcribe', 'transcription_start', { correlationId, mode: 'streaming', fileSize: buffer.length, detectedMagic: magic, encoding: formatInfo.encoding });

    let audioData;
    let sampleRate;
    let mediaEncoding;
    let numberOfChannels;

    // ── Step 4: Parse format-specific data ─────────────────────────────────
    if (formatInfo.needsHeaderStrip) {
      // WAV (RIFF) — walk chunks to find the 'data' subchunk
      if (buffer.length < 44) {
        throw new Error('WAV file too small to contain valid header');
      }

      // Validate WAV format: Transcribe Streaming requires PCM 16-bit signed LE
      const audioFormat = buffer.readUInt16LE(20);   // 1 = PCM, 3 = IEEE float, others = compressed
      const bitsPerSample = buffer.readUInt16LE(34);
      sampleRate = buffer.readUInt32LE(24);
      numberOfChannels = buffer.readUInt16LE(22);

      if (audioFormat !== 1 || bitsPerSample !== 16) {
        logger.warn('transcribe', 'streaming_fallback_to_batch', {
          correlationId,
          reason: `WAV not PCM-16: audioFormat=${audioFormat}, bitsPerSample=${bitsPerSample}`,
        });
        return batchPipeline(filePath, filename, options);
      }

      mediaEncoding = 'pcm';

      // Walk RIFF subchunks starting after the RIFF header (12 bytes)
      let dataOffset = 12;
      while (dataOffset + 8 <= buffer.length) {
        const chunkId = buffer.slice(dataOffset, dataOffset + 4).toString('ascii');
        const chunkSize = buffer.readUInt32LE(dataOffset + 4);
        if (chunkId === 'data') {
          audioData = buffer.slice(dataOffset + 8, dataOffset + 8 + chunkSize);
          break;
        }
        dataOffset += 8 + chunkSize;
        // RIFF chunks are word-aligned
        if (chunkSize % 2 !== 0) dataOffset += 1;
      }
      if (!audioData) {
        logger.warn('transcribe', 'streaming_fallback_to_batch', {
          correlationId, reason: 'WAV data chunk not found',
        });
        return batchPipeline(filePath, filename, options);
      }
    } else {
      // OGG or FLAC
      audioData = buffer;
      sampleRate = formatInfo.defaultSampleRate;
      mediaEncoding = formatInfo.encoding;
    }

    // ── Step 5: Build command params ───────────────────────────────────────
    logger.debug('transcribe', 'format_detected', { correlationId, encoding: mediaEncoding, sampleRate });
    const { StartStreamTranscriptionCommand } = require('@aws-sdk/client-transcribe-streaming');

    const commandParams = {
      LanguageCode: 'en-US',
      MediaEncoding: mediaEncoding,
      MediaSampleRateHertz: sampleRate,
      AudioStream: (async function* () {
        if (audioData.length === 0) return;
        for (let offset = 0; offset < audioData.length; offset += STREAM_CHUNK_SIZE) {
          const chunk = audioData.slice(offset, offset + STREAM_CHUNK_SIZE);
          yield { AudioEvent: { AudioChunk: chunk } };
        }
      })(),
    };

    if (numberOfChannels !== undefined && numberOfChannels >= 2) {
      commandParams.NumberOfChannels = numberOfChannels;
    }

    // ── Step 6: Send to Transcribe Streaming ───────────────────────────────
    logger.debug('transcribe', 'streaming_session_start', { correlationId, encoding: mediaEncoding, sampleRate, audioBytes: audioData.length });
    const response = await getStreamingClient().send(
      new StartStreamTranscriptionCommand(commandParams)
    );

    // ── Step 7: Collect results ────────────────────────────────────────────
    const transcripts = [];
    for await (const event of response.TranscriptResultStream) {
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

    // ── Step 8: Validate and return ────────────────────────────────────────
    if (transcripts.length === 0) {
      logger.warn('transcribe', 'streaming_empty_fallback_to_batch', {
        correlationId,
        encoding: mediaEncoding,
        sampleRate,
        audioBytes: audioData.length,
        durationMs: timer.elapsed(),
      });
      return batchPipeline(filePath, filename, options);
    }

    const text = transcripts.join(' ');
    logger.info('transcribe', 'transcription_complete', { correlationId, mode: 'streaming', durationMs: timer.elapsed(), transcriptLength: text.length });
    return text;

  } catch (err) {
    logger.error('transcribe', 'transcription_error', { correlationId, mode: 'streaming', error: err, durationMs: timer.elapsed() });
    throw err;
  }
}

/**
 * Transcription entry point — delegates to streaming or batch pipeline
 * based on the TRANSCRIBE_MODE environment variable.
 *
 * @param {string} filePath - Local path to the audio file
 * @param {string} filename - Original filename (used for key generation and media format)
 * @returns {Promise<string>} The transcribed text
 * @throws {Error} on transcription failure
 */
async function transcribe(filePath, filename, options) {
  const mode = resolveMode();
  if (mode === 'streaming') {
    return streamPipeline(filePath, filename, options);
  }
  return batchPipeline(filePath, filename, options);
}

module.exports = {
  transcribe,
  generateS3Key,
  _setS3Client,
  _setTranscribeClient,
  _setStreamingClient,
  resolveMode,
  detectFormat,
};
