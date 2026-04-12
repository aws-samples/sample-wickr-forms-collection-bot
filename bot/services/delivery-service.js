// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const crypto = require('crypto');
const https = require('https');
const logger = require('./logger');

// ── Output config store (KV-backed, for wickr-room and webhook) ───────────
// Map: kvKey -> value (vGroupID or URL)
const configCache = new Map();

async function loadOutputConfigs(wickrAPI, formDef) {
  for (const output of (formDef.outputs || [])) {
    if (output.type === 'wickr-room' || output.type === 'webhook') {
      const kvKey = output.kvKey;
      if (!kvKey) continue;
      try {
        const value = await wickrAPI.cmdGetKeyValue(kvKey);
        if (value && value !== 'Failure') {
          configCache.set(kvKey, value);
          continue;
        }
      } catch (err) {
        logger.error('delivery', 'kv_read_error', { kvKey, error: err });
      }
      // Fallback to env var
      const envValue = process.env[output.envVar];
      if (envValue) configCache.set(kvKey, envValue);
    }
  }
}

async function saveConfig(wickrAPI, kvKey, value) {
  configCache.set(kvKey, value);
  try {
    await wickrAPI.cmdAddKeyValue(kvKey, value);
  } catch (err) {
    logger.error('delivery', 'kv_write_error', { kvKey, error: err });
  }
}

function getConfig(kvKey) { return configCache.get(kvKey) || null; }

/**
 * Deliver a confirmed report to all configured output channels.
 * @param {object} formDef - form definition
 * @param {object} report - the confirmed report object
 * @param {string} sender - Wickr username of the submitter
 * @param {Function} sendReply - async (vgroupid, text, meta?) => void
 * @param {object} registry - form-registry module (for formatBroadcast)
 * @returns {Promise<{successes: string[], failures: string[]}>}
 */
async function deliver(formDef, report, sender, sendReply, registry, options) {
  const correlationId = options && options.correlationId;
  const totalTimer = logger.startTimer();
  const timestamp = new Date().toISOString();
  const reportId = crypto.randomUUID();
  const successes = [];
  const failures = [];
  const channels = (formDef.outputs || []).map(o => o.type);

  logger.info('delivery', 'delivery_start', { correlationId, formType: formDef.id, channels });

  for (const output of (formDef.outputs || [])) {
    const channelTimer = logger.startTimer();
    try {
      switch (output.type) {
        case 'wickr-room':
          await deliverWickrRoom(output, formDef, report, sender, timestamp, sendReply, registry);
          successes.push('Wickr room');
          break;
        case 's3':
          await deliverS3(output, formDef, report, sender, timestamp, reportId);
          successes.push('S3');
          break;
        case 'webhook':
          await deliverWebhook(output, formDef, report, sender, timestamp, reportId);
          successes.push('Webhook');
          break;
        default:
          logger.warn('delivery', 'unknown_output_type', { correlationId, channel: output.type });
          break;
      }
      if (output.type === 'wickr-room' || output.type === 's3' || output.type === 'webhook') {
        logger.info('delivery', 'channel_success', {
          correlationId, formType: formDef.id, channel: output.type,
          durationMs: channelTimer.elapsed()
        });
      }
    } catch (err) {
      const errorCtx = {
        correlationId, formType: formDef.id, channel: output.type,
        error: err, durationMs: channelTimer.elapsed()
      };
      // Req 12.4: include httpStatus for webhook failures
      if (output.type === 'webhook') {
        const httpMatch = err.message && err.message.match(/^HTTP (\d+)/);
        if (httpMatch) errorCtx.httpStatus = parseInt(httpMatch[1], 10);
      }
      // Req 12.3: include bucket/key for S3 failures
      if (output.type === 's3') {
        const bucket = process.env[output.bucketEnvVar];
        if (bucket) errorCtx.bucket = bucket;
      }
      logger.error('delivery', 'channel_failure', errorCtx);
      failures.push(`${output.type}: ${err.message}`);
    }
  }

  logger.info('delivery', 'delivery_complete', {
    correlationId, formType: formDef.id,
    successes: successes.length, failures: failures.length,
    totalDurationMs: totalTimer.elapsed()
  });

  return { successes, failures };
}

// ── Wickr Room Handler ────────────────────────────────────────────────────

async function deliverWickrRoom(output, formDef, report, sender, timestamp, sendReply, registry) {
  const roomId = getConfig(output.kvKey);
  if (!roomId) throw new Error('No room configured');
  const broadcastMsg = registry.formatBroadcast(formDef, report, sender, timestamp);
  await sendReply(roomId, broadcastMsg);
}

// ── S3 Handler ────────────────────────────────────────────────────────────

let _s3Client = null;
function getS3Client() {
  if (_s3Client) return _s3Client;
  const { S3Client } = require('@aws-sdk/client-s3');
  _s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-gov-west-1' });
  return _s3Client;
}
function _setS3Client(client) { _s3Client = client; }

async function deliverS3(output, formDef, report, sender, timestamp, reportId) {
  const bucket = process.env[output.bucketEnvVar];
  if (!bucket) throw new Error(`${output.bucketEnvVar} not set`);

  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const datePrefix = timestamp.slice(0, 10); // YYYY-MM-DD
  const key = `${output.prefix || ''}${datePrefix}/${reportId}.json`;

  const payload = {
    reportId,
    formType: formDef.id,
    formName: formDef.name,
    sender,
    timestamp,
    fields: report,
  };

  await getS3Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(payload, null, 2),
    ContentType: 'application/json',
  }));

  logger.info('delivery', 's3_upload_complete', { bucket, key });
}

// ── Webhook Handler ───────────────────────────────────────────────────────

const WEBHOOK_TIMEOUT_MS = 10000;

async function deliverWebhook(output, formDef, report, sender, timestamp, reportId) {
  const webhookUrl = getConfig(output.kvKey);
  if (!webhookUrl) throw new Error('No webhook URL configured');

  const payload = JSON.stringify({
    reportId,
    formType: formDef.id,
    formName: formDef.name,
    sender,
    timestamp,
    fields: report,
  });

  return new Promise((resolve, reject) => {
    const parsed = new URL(webhookUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: WEBHOOK_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          logger.info('delivery', 'webhook_response', { httpStatus: res.statusCode });
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
    req.write(payload);
    req.end();
  });
}

function _reset() { configCache.clear(); _s3Client = null; }

module.exports = {
  loadOutputConfigs, saveConfig, getConfig, deliver,
  _setS3Client, _reset,
};
