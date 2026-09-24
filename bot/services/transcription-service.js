// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ── Default region ─────────────────────────────────────────────────────────
const AWS_REGION = process.env.AWS_REGION || 'us-gov-west-1';
// No fallback name: a guessable default could be registered by someone else, and audio would
// then be uploaded to their bucket. Unset means transcription is disabled.
const S3_BUCKET = process.env.TRANSCRIPTION_S3_BUCKET || '';

// ── Polling configuration ──────────────────────────────────────────────────
const POLL_INTERVAL_MS = 2000;

// Ceiling on how long to wait for a Transcribe batch job, not a target latency.
// Polling returns as soon as the job completes, so a higher ceiling costs nothing in the
// normal case -- a job that finishes in 8s still returns in 8s. It only bounds the worst
// case, and hitting it means the user's voice memo is discarded and unrecoverable, since
// both the audio and the transcript are deleted on the way out.
//
// Observed job durations for a ~290 KB memo: ~8s in a warmed-up account, ~28s for the
// first job in a brand new account (cold capacity). The previous 28,000 ms ceiling lost
// that race by under a second and dropped the recording.
//
// Override with TRANSCRIBE_POLL_TIMEOUT_MS to tune without rebuilding the image.
const DEFAULT_POLL_TIMEOUT_MS = 60000;
const POLL_TIMEOUT_MS = (() => {
  const raw = process.env.TRANSCRIBE_POLL_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_POLL_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn('transcribe', 'invalid_poll_timeout', {
      configuredValue: raw,
      defaultingTo: DEFAULT_POLL_TIMEOUT_MS,
    });
    return DEFAULT_POLL_TIMEOUT_MS;
  }
  return parsed;
})();

// ── Lazy-loaded clients (injectable for testing) ───────────────────────────
let _s3Client = null;
let _transcribeClient = null;

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
  if (!bucket) {
    throw new Error('TRANSCRIPTION_S3_BUCKET is not set; voice memo transcription is disabled');
  }
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
 * Transcription entry point. Uses the Transcribe batch job API.
 *
 * Streaming transcription was removed: Amazon Transcribe Streaming does not accept the
 * audio format Wickr produces for voice memos, so the streaming path could never succeed
 * in practice. Batch is the only supported mode.
 *
 * @param {string} filePath - Local path to the audio file
 * @param {string} filename - Original filename (used for key generation and media format)
 * @returns {Promise<string>} The transcribed text
 * @throws {Error} on transcription failure
 */
async function transcribe(filePath, filename, options) {
  return batchPipeline(filePath, filename, options);
}

module.exports = {
  transcribe,
  generateS3Key,
  _setS3Client,
  _setTranscribeClient,
};
