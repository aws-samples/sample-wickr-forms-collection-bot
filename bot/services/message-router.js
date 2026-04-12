// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Message Router -- routes incoming Wickr messages to the correct handler and
// manages the Pending_Confirmation confirmation flow with correction loop.

const logger = require('./logger');
const crypto = require('crypto');
const extractionEngine = require('./extraction-engine');
const transcriptionService = require('./transcription-service');
const formDetector = require('./form-detector');
const registry = require('./form-registry');
const deliveryService = require('./delivery-service');
const formCommands = require('./form-commands');

// -- Pending confirmation store -------------------------------------------------
const pendingConfirmations = new Map();

function getPending(userId) {
  return pendingConfirmations.get(userId) || null;
}

function setPending(userId, formType, report) {
  logger.info('router', 'setPending_called', {
    userId, formType,
    pendingMapSizeBefore: pendingConfirmations.size,
    pendingKeysBefore: Array.from(pendingConfirmations.keys())
  });
  pendingConfirmations.set(userId, { formType, report });
  logger.info('router', 'setPending_done', {
    userId, formType,
    pendingMapSizeAfter: pendingConfirmations.size,
    pendingKeysAfter: Array.from(pendingConfirmations.keys())
  });
}

function clearPending(userId) {
  logger.info('router', 'clearPending_called', {
    userId,
    pendingMapSizeBefore: pendingConfirmations.size,
    hadKey: pendingConfirmations.has(userId)
  });
  pendingConfirmations.delete(userId);
}

// -- Audio content type detection -----------------------------------------------
const AUDIO_CONTENT_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a',
  'audio/wav', 'audio/x-wav', 'audio/flac',
  'audio/ogg', 'audio/vorbis', 'audio/amr',
  'audio/webm', 'audio/aac', 'audio/3gpp', 'audio/3gpp2',
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

async function route(parsed, sendReply, wickrAPI) {
  const correlationId = crypto.randomUUID();
  const opts = { correlationId };
  try {
    if (!parsed) return;

    const sender = parsed.userEmail || '';
    const vgroupid = parsed.vgroupid || '';

    const botUsername = process.env.BOT_USERNAME || '';
    if (botUsername && sender === botUsername) {
      logger.info('router', 'route_self_message_discarded', { correlationId, sender });
      return;
    }

    logger.info('router', 'route_entry', {
      correlationId, sender, vgroupid,
      msgtype: parsed.msgtype, convotype: parsed.convotype,
      isFile: !!(parsed.isFile || parsed.msgtype === 'file'),
      isVoiceMemo: !!parsed.isVoiceMemo,
      textPreview: (parsed.message || '').substring(0, 80)
    });

    // -- File messages ------------------------------------------------------------
    if (parsed.isFile || parsed.msgtype === 'file') {
      logger.info('router', 'route_to_file', { correlationId });
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
        logger.info('router', 'route_to_form_command', { correlationId, command, formId: formDef.id });
        const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();
        await formCommands.handle(formDef, parsed, args, vgroupid, sendReply, wickrAPI, opts);
        return;
      }
    }

    // -- /help command ------------------------------------------------------------
    if (text.startsWith('/help')) {
      logger.info('router', 'route_to_help', { correlationId });
      const allForms = registry.getAll();
      const formHelp = allForms
        .filter(f => f.command)
        .map(f => `${f.command} help - ${f.name} commands`)
        .join('\n');
      const helpText = 'Available commands:\n' +
        (formHelp ? formHelp + '\n' : '') +
        '/help - Show this message\n\n' +
        'Send any text or voice memo to submit a report.\n' +
        'The bot will auto-detect the report type.';
      await sendReply(vgroupid, helpText);
      return;
    }

    // -- Non-command text ---------------------------------------------------------
    logger.info('router', 'route_to_handleNonCommand', { correlationId });
    await handleNonCommand(parsed, sendReply, wickrAPI, opts);
  } catch (err) {
    logger.error('router', 'unhandled_error', { correlationId, error: err });
  }
}

async function handleFileMessage(parsed, sender, vgroupid, sendReply, opts) {
  const correlationId = opts && opts.correlationId;
  const isVoice = parsed.isVoiceMemo === true ||
    isAudioContentType(parsed.contentType || parsed.mimeType || '');

  logger.info('router', 'handleFileMessage_entry', {
    correlationId, sender, isVoice,
    contentType: parsed.contentType || parsed.mimeType || '<none>',
    filename: parsed.filename || parsed.fileName || '<none>'
  });

  if (!isVoice) {
    logger.info('router', 'file_not_audio_skipped', { correlationId });
    return;
  }

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

    logger.info('router', 'transcript_received', { correlationId, transcriptLength: transcript.length });

    const pending = getPending(sender);
    if (pending) {
      logger.info('router', 'voice_memo_correction', { correlationId, formType: pending.formType });
      await handleCorrection(transcript, sender, vgroupid, pending, sendReply, opts);
    } else {
      logger.info('router', 'voice_memo_detect_extract', { correlationId });
      await detectAndExtract(transcript, sender, vgroupid, sendReply, opts);
    }
  } catch (err) {
    logger.error('router', 'transcription_error', { correlationId, error: err });
    await sendReply(vgroupid, 'Transcription failed. Please try again or send your report as a text message.');
  }
}

async function handleNonCommand(parsed, sendReply, wickrAPI, opts) {
  const correlationId = (opts && opts.correlationId) || crypto.randomUUID();
  if (!opts) opts = { correlationId };
  if (!opts.correlationId) opts.correlationId = correlationId;

  const sender = parsed.userEmail || '';
  const vgroupid = parsed.vgroupid || '';
  const text = (parsed.message || '').trim();

  logger.info('router', 'handleNonCommand_entry', {
    correlationId, senderRaw: sender, vgroupid,
    textPreview: text.substring(0, 80),
    textLength: text.length,
    msgtype: parsed.msgtype,
    isFile: !!parsed.isFile,
    isVoiceMemo: !!parsed.isVoiceMemo,
    pendingMapSize: pendingConfirmations.size,
    pendingKeys: Array.from(pendingConfirmations.keys())
  });

  // Check for file messages (voice memos) first
  if (parsed.msgtype === 'file' || parsed.isVoiceMemo) {
    logger.info('router', 'handleNonCommand_delegating_to_file', { correlationId, sender });
    await handleFileMessage(parsed, sender, vgroupid, sendReply, opts);
    return;
  }

  const pending = getPending(sender);

  if (pending) {
    logger.info('router', 'pending_found', {
      correlationId, senderRaw: sender,
      formType: pending.formType,
      pendingMapSize: pendingConfirmations.size
    });
    await handleConfirmationResponse(text, sender, vgroupid, pending, sendReply, wickrAPI, opts);
    return;
  }

  // No pending -- detect form type and extract
  logger.info('router', 'no_pending', {
    correlationId, senderRaw: sender,
    pendingMapSize: pendingConfirmations.size,
    pendingKeys: Array.from(pendingConfirmations.keys())
  });
  await detectAndExtract(text, sender, vgroupid, sendReply, opts);
}

async function handleConfirmationResponse(text, sender, vgroupid, pending, sendReply, wickrAPI, opts) {
  const correlationId = opts && opts.correlationId;
  const upper = text.toUpperCase();

  logger.info('router', 'handleConfirmationResponse_entry', {
    correlationId, sender, formType: pending.formType,
    textUpper: upper, textRaw: text
  });

  if (upper === 'YES') {
    logger.info('router', 'confirmation_YES', { correlationId, formType: pending.formType, sender });
    const formDef = registry.getById(pending.formType);

    // Check for missing required fields before delivering
    const missingFields = registry.getMissingRequiredFields(formDef, pending.report);
    if (missingFields.length > 0) {
      const fieldList = missingFields.map(f => `  - ${f.label}`).join('\n');
      logger.info('router', 'confirmation_blocked_missing_fields', {
        correlationId, formType: pending.formType, missingCount: missingFields.length,
        missingKeys: missingFields.map(f => f.key)
      });
      await sendReply(vgroupid,
        `Cannot deliver -- the following required field(s) are missing:\n${fieldList}\n\n` +
        'Please provide the missing information (e.g., "location is grid AB 1234 5678"), ' +
        'then type YES again to confirm.');
      return;
    }

    clearPending(sender);
    logger.info('router', 'delivering_report', { correlationId, formType: pending.formType });
    const result = await deliveryService.deliver(formDef, pending.report, sender, sendReply, registry, opts);
    logger.info('router', 'delivery_result', {
      correlationId, formType: pending.formType,
      successes: result.successes, failures: result.failures
    });
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
    logger.info('router', 'confirmation_CANCEL', { correlationId, formType: pending.formType, sender });
    clearPending(sender);
    const formDef = registry.getById(pending.formType);
    await sendReply(vgroupid, `Your ${formDef ? formDef.name : 'report'} has been cancelled.`);
    return;
  }

  // Correction loop
  logger.info('router', 'confirmation_CORRECTION', { correlationId, formType: pending.formType, sender, textPreview: text.substring(0, 80) });
  await handleCorrection(text, sender, vgroupid, pending, sendReply, opts);
}

async function handleCorrection(text, sender, vgroupid, pending, sendReply, opts) {
  const correlationId = opts && opts.correlationId;
  const formDef = registry.getById(pending.formType);

  logger.info('router', 'handleCorrection_entry', { correlationId, formType: pending.formType, sender });

  try {
    const corrections = await extractionEngine.extractCorrection(text, pending.report, formDef, opts);

    if (corrections && corrections.error) {
      logger.info('router', 'correction_error_from_engine', { correlationId, error: corrections.error });
      const card = registry.formatReport(formDef, pending.report);
      await sendReply(vgroupid, `Could not process correction: ${corrections.error}`);
      await sendReply(vgroupid, card + CONFIRMATION_PROMPT);
      return;
    }

    const correctedKeys = Object.keys(corrections).filter(k =>
      formDef.fields.some(f => f.key === k));

    logger.info('router', 'correction_result', { correlationId, correctedKeys, totalKeys: Object.keys(corrections).length });

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

async function detectAndExtract(text, sender, vgroupid, sendReply, opts) {
  const correlationId = opts && opts.correlationId;
  logger.info('router', 'detectAndExtract_entry', {
    correlationId, sender, textPreview: text.substring(0, 80), textLength: text.length
  });

  try {
    const allForms = registry.getAll();
    logger.info('router', 'calling_formDetector', { correlationId, formCount: allForms.length });

    const formType = await formDetector.detect(text, allForms, opts);
    logger.info('router', 'formDetector_returned', { correlationId, formType });

    if (formType === 'UNKNOWN') {
      logger.info('router', 'detection_unknown', { correlationId });
      const formNames = allForms.map(f => `- ${f.name} (${f.id})`).join('\n');
      await sendReply(vgroupid,
        'I could not determine the report type. Please clarify which report you want to submit:\n' +
        formNames +
        '\n\nOr use a command like /9line, /salute, or /cas.');
      return;
    }

    const formDef = registry.getById(formType);
    if (!formDef) {
      logger.warn('router', 'formDef_not_found', { correlationId, formType });
      await sendReply(vgroupid, `Unknown form type: ${formType}. Please try again.`);
      return;
    }

    logger.info('router', 'calling_extractForm', { correlationId, formType: formDef.id });
    const report = await extractionEngine.extractForm(text, formDef, opts);
    logger.info('router', 'extractForm_returned', { correlationId, formType: formDef.id, hasError: !!(report && report.error) });

    if (report && report.error) {
      await sendReply(vgroupid, `Could not extract ${formDef.name}: ${report.error}`);
      return;
    }

    const card = registry.formatReport(formDef, report);
    logger.info('router', 'about_to_setPending', { correlationId, sender, formType: formDef.id });
    setPending(sender, formDef.id, report);
    logger.info('router', 'setPending_complete_sending_card', {
      correlationId, sender, formType: formDef.id,
      pendingMapSize: pendingConfirmations.size,
      pendingKeys: Array.from(pendingConfirmations.keys())
    });
    await sendReply(vgroupid, card + CONFIRMATION_PROMPT);
    logger.info('router', 'card_sent', { correlationId, sender, formType: formDef.id });
  } catch (err) {
    logger.error('router', 'detection_extraction_error', { correlationId, error: err });
    await sendReply(vgroupid, 'An error occurred while processing your message. Please try again.');
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
