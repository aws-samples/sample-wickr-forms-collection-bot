// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';
const crypto = require('crypto');

// -- Log levels ---------------------------------------------------------------
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

// -- PII blocklist ------------------------------------------------------------
const PII_BLOCKLIST = new Set([
  'userEmail', 'senderEmail', 'email',
  'messageText', 'text', 'content',
  'filePath', 'file'
]);

// -- Reserved keys (Logger's own fields take precedence) ----------------------
const RESERVED_KEYS = new Set(['timestamp', 'level', 'component', 'message']);

// -- Resolve minimum level from env -------------------------------------------
function resolveMinLevel() {
  const raw = (process.env.LOG_LEVEL || '').toUpperCase();
  if (raw === '') return LEVELS.INFO;
  if (LEVELS[raw] !== undefined) return LEVELS[raw];
  // Unrecognized value: default to INFO, emit warning
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'WARN',
    component: 'logger',
    message: 'unrecognized_log_level',
    configuredValue: process.env.LOG_LEVEL,
    defaultingTo: 'INFO'
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
  return LEVELS.INFO;
}

let minLevel = resolveMinLevel();

// -- Core emit ----------------------------------------------------------------
function emit(level, component, message, context) {
  const numericLevel = LEVELS[level];
  // Suppress below minimum (ERROR always emits)
  if (numericLevel < minLevel && level !== 'ERROR') return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message
  };

  if (context && typeof context === 'object' && !Array.isArray(context)) {
    for (const [key, value] of Object.entries(context)) {
      // Skip reserved keys — Logger's own values take precedence
      if (RESERVED_KEYS.has(key)) continue;

      // PII blocklist check
      if (PII_BLOCKLIST.has(key)) {
        entry[key] = '[REDACTED]';
        // Emit a warning about the redaction attempt
        const warnEntry = {
          timestamp: new Date().toISOString(),
          level: 'WARN',
          component: 'logger',
          message: 'pii_redaction',
          redactedKey: key,
          sourceComponent: component,
          sourceMessage: message
        };
        process.stdout.write(JSON.stringify(warnEntry) + '\n');
        continue;
      }

      // Error serialization: convert Error instances BEFORE stringify
      if (key === 'error' && value instanceof Error) {
        entry.error = value.message;
        entry.stack = value.stack;
        continue;
      }

      entry[key] = value;
    }
  }

  const line = JSON.stringify(entry) + '\n';
  if (level === 'ERROR') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

// -- Public API ---------------------------------------------------------------
function debug(component, message, context) { emit('DEBUG', component, message, context); }
function info(component, message, context)  { emit('INFO', component, message, context); }
function warn(component, message, context)  { emit('WARN', component, message, context); }
function error(component, message, context) { emit('ERROR', component, message, context); }

// -- Utilities ----------------------------------------------------------------
function redactSender(email) {
  return crypto.createHash('sha256').update(email).digest('hex').slice(0, 8);
}

function startTimer() {
  const start = Date.now();
  return { elapsed: () => Date.now() - start };
}

// -- Reset (for testing) ------------------------------------------------------
function _resetLevel() { minLevel = resolveMinLevel(); }

module.exports = { debug, info, warn, error, redactSender, startTimer, _resetLevel };
