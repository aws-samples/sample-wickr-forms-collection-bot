// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Message Router -- the single routing layer for incoming Wickr messages.
// Manages the Pending_Confirmation confirmation flow with correction loop.
//
// Routing logic (in priority order):
//   1. Self-messages (sender === BOT_USERNAME)  -> discard
//   2. File message with audio content type     -> transcription-service.js
//   3. File message with non-audio content type -> ignore
//   4. Registry-based command routing           -> form-commands.js
//   5. Global commands (/help, /set-rooms, /status)
//   6. Plain text with user in Pending state    -> correction loop / confirm / cancel
//   7. Plain text (no pending, no command)      -> form-detector -> extraction-engine

const logger = require('./logger');
const crypto = require('crypto');
const extractionEngine = require('./extraction-engine');
const transcriptionService = require('./transcription-service');
const formDetector = require('./form-detector');
const registry = require('./form-registry');
const deliveryService = require('./delivery-service');
const formCommands = require('./form-commands');

// -- Pending confirmation store -------------------------------------------------
// Map: userId (string) -> { formType: string, report: object }
const pendingConfirmations = new Map();

function getPending(userId) {
  return pendingConfirmations.get(userId) || null;
}

function setPending(userId, formType, report) {
  pendingConfirmations.set(userId, { formType, report });
}

function clearPending(userId) {
  pendingConfirmations.delete(userId);
}

// -- Audio content type detection -----------------------------------------------
const AUDIO_CONTENT_TYPES = new Set([
  'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/m4a',
  'audio/wav', 'audio/x-wav',
  'audio/flac',
  'audio/ogg', 'audio/vorbis',
  'audio/amr',
  'audio/webm',
  'audio/aac',
  'audio/3gpp',
  'audio/3gpp2',
]);

function isAudioContentType(contentType) {
  if (!contentType) return false;
  const lower = contentType.toLowerCase().trim();
  if (AUDIO_CONTENT_TYPES.has(lower)) return true;
  for (const t of AUDIO_CONTENT_TYPES) {
    if (lower.startsWith(t)) return true;
  }
  return lower.startsWith('audio/');
}

// -- Confirmation-prompt text ---------------------------------------------------
const CONFIRMATION_PROMPT =
  '\nType YES to confirm and deliver, or NO to cancel.';

// -- Main entry points ----------------------------------------------------------

/**
 * Route a parsed Wickr message to the appropriate handler.
 *
 * @param {object}   parsed     Parsed Wickr message (from bot.parseMessage).
 * @param {Function} sendReply  async (vgroupid, text) => void
 * @param {object}   [wickrAPI] Wickr IO addon (needed for admin commands / broadcast).
 */
async function route(parsed, sendReply, wickrAPI) {
  const correlationId = crypto.randomUUID();
  const opts = { correlationId };
  try {
    if (!parsed) return;

    const sender = parsed.userEmail || '';
    const vgroupid = parsed.vgroupid || '';

    // -- Self-message filtering ---------------------------------------------------
    const botUsername = process.env.BOT_USERNAME || '';
    if (botUsername && sender === botUsername) return;

    // -- Ingress log (Req 4.1) ----------------------------------------------------
    logger.info('router', 'message_received', {
      correlationId,
      msgtype: parsed.msgtype,
      convotype: parsed.convotype,
      isFile: !!(parsed.isFile || parsed.msgtype === 'file'),
      isVoiceMemo: !!parsed.isVoiceMemo,
      hasFilename: !!(parsed.filename || parsed.fileName)
    });

    // -- File messages ------------------------------------------------------------
    if (parsed.isFile || parsed.msgtype === 'file' || parsed.isVoiceMemo === true) {
      logger.debug('router', 'routing_decision', { correlationId, route: 'file_message' });
      await handleFileMessage(parsed, sender, vgroupid, sendReply, opts);
      return;
    }

    const text = (parsed.message || '').trim();

    // -- Registry-based command routing --------------------------------------------
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const command = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
      const formDef = registry.getByCommand(command);
      if (formDef) {
        logger.debug('router', 'routing_decision', { correlationId, route: 'registry_command' });
        const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();
        logger.debug('router', 'command_routed', { correlationId, command });
        await formCommands.handle(formDef, parsed, args, vgroupid, sendReply, wickrAPI, opts);
        return;
      }
    }

    // -- Global commands ------------------------------------------------------------
    if (text.startsWith('/help')) {
      logger.debug('router', 'routing_decision', { correlationId, route: 'command:/help' });
      await handleHelp(vgroupid, sendReply);
      return;
    }

    if (text.startsWith('/set-rooms')) {
      logger.debug('router', 'routing_decision', { correlationId, route: 'command:/set-rooms' });
      await handleSetRooms(text, vgroupid, sendReply, wickrAPI);
      return;
    }

    if (text.startsWith('/status')) {
      logger.debug('router', 'routing_decision', { correlationId, route: 'command:/status' });
      await handleStatus(vgroupid, sendReply);
      return;
    }

    // -- Non-command text: pending-confirmation or detection/extraction ------------
    await handleNonCommand(parsed, sendReply, wickrAPI, opts);
  } catch (err) {
    logger.error('router', 'unhandled_error', { correlationId, error: err });
  }
}

/**
 * /help -- list per-form commands plus the global commands.
 */
async function handleHelp(vgroupid, sendReply) {
  const formHelp = registry.getAll()
    .filter(f => f.command)
    .map(f => `${f.command} help - ${f.name} commands`)
    .join('\n');
  const helpText = 'Available commands:\n' +
    (formHelp ? formHelp + '\n' : '') +
    '/set-rooms - Set this room as broadcast room for all (or selected) forms\n' +
    '/status - Show delivery configuration for all forms\n' +
    '/help - Show this message\n\n' +
    'Send any text or voice memo to submit a report.\n' +
    'The bot will auto-detect the report type.';
  await sendReply(vgroupid, helpText);
}

/**
 * /set-rooms [FORM_ID ...] -- set the current room as the broadcast room for
 * all forms with a wickr-room output, or only the listed form IDs.
 */
async function handleSetRooms(text, vgroupid, sendReply, wickrAPI) {
  if (!vgroupid || !vgroupid.startsWith('S')) {
    await sendReply(vgroupid, 'Error: /set-rooms must be run from within the target room, not a DM.');
    return;
  }
  const args = text.substring('/set-rooms'.length).trim();
  const roomOutputs = [];

  if (args) {
    const requestedIds = args.toUpperCase().split(/[\s,]+/);
    for (const id of requestedIds) {
      const formDef = registry.getById(id);
      if (!formDef) {
        await sendReply(vgroupid, `Unknown form type: ${id}. Skipping.`);
        continue;
      }
      const roomOut = (formDef.outputs || []).find(o => o.type === 'wickr-room');
      if (roomOut) roomOutputs.push({ formDef, roomOut });
    }
  } else {
    for (const formDef of registry.getAll()) {
      const roomOut = (formDef.outputs || []).find(o => o.type === 'wickr-room');
      if (roomOut) roomOutputs.push({ formDef, roomOut });
    }
  }

  if (roomOutputs.length === 0) {
    await sendReply(vgroupid, 'No forms with Wickr room output found.');
    return;
  }

  const results = [];
  for (const { formDef, roomOut } of roomOutputs) {
    await deliveryService.saveConfig(wickrAPI, roomOut.kvKey, vgroupid);
    results.push(formDef.name);
  }
  await sendReply(vgroupid,
    `Broadcast room set for ${results.length} form(s):\n` +
    results.map(n => `  - ${n}`).join('\n') +
    `\n\nThis room (${vgroupid}) will receive confirmed reports.`);
}

/**
 * /status -- show delivery configuration for every registered form.
 */
async function handleStatus(vgroupid, sendReply) {
  const lines = ['=== Delivery Status ===', ''];
  for (const formDef of registry.getAll()) {
    lines.push(`${formDef.name} (${formDef.id}):`);
    for (const output of (formDef.outputs || [])) {
      switch (output.type) {
        case 'wickr-room': {
          const room = deliveryService.getConfig(output.kvKey);
          lines.push(`  Room: ${room || '(not configured)'}`);
          break;
        }
        case 's3': {
          const bucket = process.env[output.bucketEnvVar];
          lines.push(`  S3: ${bucket ? bucket + '/' + (output.prefix || '') : '(not configured)'}`);
          break;
        }
        case 'webhook': {
          const url = deliveryService.getConfig(output.kvKey);
          lines.push(`  Webhook: ${url || '(not configured)'}`);
          break;
        }
      }
    }
    lines.push('');
  }
  await sendReply(vgroupid, lines.join('\n'));
}

/**
 * Handle a file (voice memo or other attachment).
 * Audio files -> transcription pipeline.
 * Non-audio files -> silently ignored.
 */
async function handleFileMessage(parsed, sender, vgroupid, sendReply, opts) {
  const correlationId = opts && opts.correlationId;
  const isVoice = parsed.isVoiceMemo === true ||
    isAudioContentType(parsed.contentType || parsed.mimeType || '');

  if (!isVoice) return;

  const filePath = parsed.filePath || parsed.file || '';
  const filename = parsed.filename || parsed.fileName || 'voice.mp3';

  if (!filePath) {
    await sendReply(vgroupid, 'Could not process voice memo: file path missing.');
    return;
  }

  try {
    await sendReply(vgroupid, 'Received voice memo, transcribing...');
    const transcript = await transcriptionService.transcribe(filePath, filename, opts);

    if (!transcript || transcript.trim().length === 0) {
      logger.warn('router', 'empty_transcript', { correlationId, filename });
      await sendReply(vgroupid, 'Could not extract any speech from the voice memo. Please try again or send your report as a text message.');
      return;
    }

    const pending = getPending(sender);
    if (pending) {
      // Voice memo with pending -> correction loop
      await handleCorrection(transcript, sender, vgroupid, pending, sendReply, opts);
    } else {
      // Voice memo with no pending -> detect and extract
      await detectAndExtract(transcript, sender, vgroupid, sendReply, opts);
    }
  } catch (err) {
    logger.error('router', 'transcription_error', { correlationId, error: err });
    await sendReply(
      vgroupid,
      'Transcription failed. Please try again or send your report as a text message.'
    );
  }
}

/**
 * Handle a non-command text message.
 * Checks for pending confirmation state first, then falls through to detection/extraction.
 *
 * @param {object}   parsed
 * @param {Function} sendReply
 * @param {object}   [wickrAPI]
 * @param {object}   [opts]
 */
async function handleNonCommand(parsed, sendReply, wickrAPI, opts) {
  const correlationId = opts && opts.correlationId;
  const sender = parsed.userEmail || '';
  const vgroupid = parsed.vgroupid || '';
  const text = (parsed.message || '').trim();

  const pending = getPending(sender);

  if (pending) {
    logger.debug('router', 'routing_decision', { correlationId, route: 'pending_confirmation' });
    await handleConfirmationResponse(text, sender, vgroupid, pending, sendReply, wickrAPI, opts);
    return;
  }

  // No pending and no text -- nothing to classify. Non-text/system events
  // (empty payloads, read receipts, etc.) carry no message body; skip silently
  // rather than call the classifier (which would reject empty content) or reply.
  if (text === '') {
    logger.debug('router', 'routing_decision', { correlationId, route: 'ignore_empty' });
    return;
  }

  // No pending -- detect form type and extract
  logger.debug('router', 'routing_decision', { correlationId, route: 'detect_and_extract' });
  await detectAndExtract(text, sender, vgroupid, sendReply, opts);
}

/**
 * Process a user's response when they have a pending report.
 *
 * YES           -> deliver via delivery-service
 * NO / CANCEL   -> discard pending, notify user
 * anything else -> correction loop (extract corrections, merge, re-present)
 */
async function handleConfirmationResponse(text, sender, vgroupid, pending, sendReply, wickrAPI, opts) {
  const correlationId = opts && opts.correlationId;
  const upper = text.toUpperCase();

  if (upper === 'YES') {
    logger.info('router', 'confirmation_response', { correlationId, formType: pending.formType, response: 'confirm' });
    const formDef = registry.getById(pending.formType);

    // Check for missing required fields before delivering
    const missingFields = registry.getMissingRequiredFields(formDef, pending.report);
    if (missingFields.length > 0) {
      const fieldList = missingFields.map(f => `  - ${f.label}`).join('\n');
      await sendReply(vgroupid,
        `Cannot deliver -- the following required field(s) are missing:\n${fieldList}\n\n` +
        'Please provide the missing information (e.g., "location is grid AB 1234 5678"), ' +
        'then type YES again to confirm.');
      return;
    }

    clearPending(sender);
    const result = await deliveryService.deliver(formDef, pending.report, sender, sendReply, registry, opts);
    if (result.successes.length > 0) {
      await sendReply(vgroupid,
        `${formDef.name} delivered: ${result.successes.join(', ')}.` +
        (result.failures.length > 0 ? ` Failed: ${result.failures.join('; ')}.` : ''));
    } else {
      await sendReply(vgroupid,
        `Failed to deliver ${formDef.name}. ${result.failures.join('; ')}`);
    }
    return;
  }

  if (upper === 'NO' || upper === 'CANCEL') {
    logger.info('router', 'confirmation_response', { correlationId, formType: pending.formType, response: 'cancel' });
    clearPending(sender);
    const formDef = registry.getById(pending.formType);
    await sendReply(vgroupid, `Your ${formDef ? formDef.name : 'report'} has been cancelled.`);
    return;
  }

  // Correction loop
  logger.info('router', 'confirmation_response', { correlationId, formType: pending.formType, response: 'correction' });
  await handleCorrection(text, sender, vgroupid, pending, sendReply, opts);
}

/**
 * Correction loop: extract corrections from text, merge into pending report,
 * and re-present the updated card.
 */
async function handleCorrection(text, sender, vgroupid, pending, sendReply, opts) {
  const correlationId = opts && opts.correlationId;
  const formDef = registry.getById(pending.formType);

  try {
    const corrections = await extractionEngine.extractCorrection(text, pending.report, formDef, opts);

    if (corrections && corrections.error) {
      const card = registry.formatReport(formDef, pending.report);
      await sendReply(vgroupid, `Could not process correction: ${corrections.error}`);
      await sendReply(vgroupid, card + CONFIRMATION_PROMPT);
      return;
    }

    const correctedKeys = Object.keys(corrections).filter(k =>
      formDef.fields.some(f => f.key === k));

    if (correctedKeys.length === 0) {
      const card = registry.formatReport(formDef, pending.report);
      await sendReply(vgroupid, 'No fields could be updated from your message.');
      await sendReply(vgroupid, card + CONFIRMATION_PROMPT);
      return;
    }

    for (const key of correctedKeys) { pending.report[key] = corrections[key]; }
    setPending(sender, pending.formType, pending.report);
    const card = registry.formatReport(formDef, pending.report);
    await sendReply(vgroupid, card + CONFIRMATION_PROMPT);
  } catch (err) {
    logger.error('router', 'correction_error', { correlationId, error: err });
    const card = registry.formatReport(formDef, pending.report);
    await sendReply(vgroupid, 'An error occurred while processing your correction.');
    await sendReply(vgroupid, card + CONFIRMATION_PROMPT);
  }
}

/**
 * Detect the form type from text, extract fields, present card, and store pending.
 */
async function detectAndExtract(text, sender, vgroupid, sendReply, opts) {
  const correlationId = opts && opts.correlationId;
  try {
    const allForms = registry.getAll();
    const formType = await formDetector.detect(text, allForms, opts);

    if (formType === 'UNKNOWN') {
      const formNames = allForms.map(f => `- ${f.name} (${f.id})`).join('\n');
      await sendReply(vgroupid,
        'I could not determine the report type. Please clarify which report you want to submit:\n' +
        formNames +
        '\n\nOr use a command like /9line, /salute, or /cas.');
      return;
    }

    const formDef = registry.getById(formType);
    if (!formDef) {
      await sendReply(vgroupid, `Unknown form type: ${formType}. Please try again.`);
      return;
    }

    const report = await extractionEngine.extractForm(text, formDef, opts);

    if (report && report.error) {
      await sendReply(vgroupid, `Could not extract ${formDef.name}: ${report.error}`);
      return;
    }

    const card = registry.formatReport(formDef, report);
    await sendReply(vgroupid, card + CONFIRMATION_PROMPT);
    setPending(sender, formDef.id, report);
  } catch (err) {
    logger.error('router', 'detection_extraction_error', { correlationId, error: err });
    await sendReply(
      vgroupid,
      'An error occurred while processing your message. Please try again.'
    );
  }
}

// -- Exports --------------------------------------------------------------------

module.exports = {
  route,
  handleNonCommand,
  getPending,
  setPending,
  clearPending,
  // Exposed for testing
  _pendingConfirmations: pendingConfirmations,
};
