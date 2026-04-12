// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Helpers: capture stdout / stderr via mock.method
// ---------------------------------------------------------------------------

let stdoutMock;
let stderrMock;
let logger;
let savedLogLevel;

function capturedStdout() {
  return stdoutMock.mock.calls.map(c => c.arguments[0]);
}

function capturedStderr() {
  return stderrMock.mock.calls.map(c => c.arguments[0]);
}

function parseFirst(lines) {
  assert.ok(lines.length > 0, 'expected at least one output line');
  return JSON.parse(lines[0].replace(/\n$/, ''));
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  savedLogLevel = process.env.LOG_LEVEL;
  delete process.env.LOG_LEVEL;

  // Clear require cache so logger re-reads LOG_LEVEL on require
  delete require.cache[require.resolve('../services/logger')];

  stdoutMock = mock.method(process.stdout, 'write', () => true);
  stderrMock = mock.method(process.stderr, 'write', () => true);

  logger = require('../services/logger');
});

afterEach(() => {
  stdoutMock.mock.restore();
  stderrMock.mock.restore();

  if (savedLogLevel !== undefined) {
    process.env.LOG_LEVEL = savedLogLevel;
  } else {
    delete process.env.LOG_LEVEL;
  }

  delete require.cache[require.resolve('../services/logger')];
});


// ---------------------------------------------------------------------------
// Tests: Log level functions emit correct JSON to correct stream
// ---------------------------------------------------------------------------

describe('logger — stream routing', () => {
  it('debug() writes JSON to stdout', () => {
    process.env.LOG_LEVEL = 'DEBUG';
    logger._resetLevel();
    logger.debug('test', 'hello');
    const entry = parseFirst(capturedStdout());
    assert.equal(entry.level, 'DEBUG');
    assert.equal(entry.component, 'test');
    assert.equal(entry.message, 'hello');
  });

  it('info() writes JSON to stdout', () => {
    logger.info('comp', 'msg');
    const entry = parseFirst(capturedStdout());
    assert.equal(entry.level, 'INFO');
  });

  it('warn() writes JSON to stdout', () => {
    logger.warn('comp', 'msg');
    const entry = parseFirst(capturedStdout());
    assert.equal(entry.level, 'WARN');
  });

  it('error() writes JSON to stderr', () => {
    logger.error('comp', 'msg');
    const entry = parseFirst(capturedStderr());
    assert.equal(entry.level, 'ERROR');
    assert.equal(capturedStdout().length, 0, 'error should not write to stdout');
  });
});

// ---------------------------------------------------------------------------
// Tests: Level filtering
// ---------------------------------------------------------------------------

describe('logger — level filtering', () => {
  it('ERROR always emits regardless of LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'ERROR';
    logger._resetLevel();
    logger.error('comp', 'critical');
    assert.equal(capturedStderr().length, 1);
  });

  it('DEBUG is suppressed when LOG_LEVEL=INFO', () => {
    // Default is INFO (no LOG_LEVEL set), so DEBUG should be suppressed
    logger.debug('comp', 'trace');
    assert.equal(capturedStdout().length, 0);
    assert.equal(capturedStderr().length, 0);
  });

  it('INFO emits when LOG_LEVEL=INFO', () => {
    logger.info('comp', 'msg');
    assert.ok(capturedStdout().length > 0);
  });

  it('WARN emits when LOG_LEVEL=INFO', () => {
    logger.warn('comp', 'msg');
    assert.ok(capturedStdout().length > 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Unrecognized LOG_LEVEL
// ---------------------------------------------------------------------------

describe('logger — unrecognized LOG_LEVEL', () => {
  it('defaults to INFO and emits a warning for unrecognized LOG_LEVEL', () => {
    // Need to re-require with bad LOG_LEVEL
    stdoutMock.mock.restore();
    stderrMock.mock.restore();
    delete require.cache[require.resolve('../services/logger')];

    process.env.LOG_LEVEL = 'BANANA';
    stdoutMock = mock.method(process.stdout, 'write', () => true);
    stderrMock = mock.method(process.stderr, 'write', () => true);

    const freshLogger = require('../services/logger');

    // The warning should have been emitted during module load
    const lines = capturedStdout();
    assert.ok(lines.length >= 1, 'should emit at least one warning');
    const warnEntry = JSON.parse(lines[0].replace(/\n$/, ''));
    assert.equal(warnEntry.level, 'WARN');
    assert.equal(warnEntry.message, 'unrecognized_log_level');
    assert.equal(warnEntry.configuredValue, 'BANANA');
    assert.equal(warnEntry.defaultingTo, 'INFO');

    // Verify it defaults to INFO: DEBUG should be suppressed
    freshLogger.debug('comp', 'trace');
    // Only the warning line should be in stdout, no debug line
    const afterLines = capturedStdout();
    assert.equal(afterLines.length, 1, 'DEBUG should be suppressed after defaulting to INFO');
  });
});


// ---------------------------------------------------------------------------
// Tests: Context fields merged into log entry
// ---------------------------------------------------------------------------

describe('logger — context merging', () => {
  it('context fields appear as top-level keys in the log entry', () => {
    logger.info('comp', 'msg', { correlationId: 'abc-123', durationMs: 42 });
    const entry = parseFirst(capturedStdout());
    assert.equal(entry.correlationId, 'abc-123');
    assert.equal(entry.durationMs, 42);
  });

  it('array context is ignored (not iterated)', () => {
    logger.info('comp', 'msg', ['a', 'b']);
    const entry = parseFirst(capturedStdout());
    // Should have base fields only, no array elements
    assert.equal(entry.level, 'INFO');
    assert.equal(entry.component, 'comp');
    assert.equal(entry.message, 'msg');
    assert.equal(entry['0'], undefined, 'array elements should not appear');
  });
});

// ---------------------------------------------------------------------------
// Tests: Error serialization
// ---------------------------------------------------------------------------

describe('logger — error serialization', () => {
  it('Error instances in context are serialized to { error, stack }', () => {
    const err = new Error('something broke');
    logger.error('comp', 'fail', { error: err });
    const entry = parseFirst(capturedStderr());
    assert.equal(entry.error, 'something broke');
    assert.equal(typeof entry.stack, 'string');
    assert.ok(entry.stack.includes('Error: something broke'));
  });
});

// ---------------------------------------------------------------------------
// Tests: Reserved key protection
// ---------------------------------------------------------------------------

describe('logger — reserved key protection', () => {
  it('reserved keys in context are silently dropped', () => {
    logger.info('real-comp', 'real-msg', {
      timestamp: 'fake-time',
      level: 'FAKE',
      component: 'fake-comp',
      message: 'fake-msg',
      extra: 'kept'
    });
    const entry = parseFirst(capturedStdout());
    assert.equal(entry.level, 'INFO', 'level should be logger value');
    assert.equal(entry.component, 'real-comp', 'component should be logger value');
    assert.equal(entry.message, 'real-msg', 'message should be logger value');
    assert.notEqual(entry.timestamp, 'fake-time', 'timestamp should be logger value');
    assert.equal(entry.extra, 'kept', 'non-reserved keys should be kept');
  });
});

// ---------------------------------------------------------------------------
// Tests: PII blocklist redaction
// ---------------------------------------------------------------------------

describe('logger — PII blocklist', () => {
  it('blocklisted keys are replaced with [REDACTED]', () => {
    logger.info('comp', 'msg', { userEmail: 'user@example.com' });
    const lines = capturedStdout();
    // First line is the WARN about redaction, second is the actual log
    // Actually: the PII warn is emitted first, then the main entry
    assert.ok(lines.length >= 2, 'should emit redaction warning + main entry');

    // Find the main entry (the one with message 'msg')
    const mainEntry = lines.map(l => JSON.parse(l.replace(/\n$/, '')))
      .find(e => e.message === 'msg');
    assert.ok(mainEntry, 'should find main log entry');
    assert.equal(mainEntry.userEmail, '[REDACTED]');

    // Find the warning entry
    const warnEntry = lines.map(l => JSON.parse(l.replace(/\n$/, '')))
      .find(e => e.message === 'pii_redaction');
    assert.ok(warnEntry, 'should find PII redaction warning');
    assert.equal(warnEntry.level, 'WARN');
    assert.equal(warnEntry.redactedKey, 'userEmail');
  });

  it('all blocklisted keys are redacted', () => {
    const blocklist = ['userEmail', 'senderEmail', 'email', 'messageText', 'text', 'content', 'filePath', 'file'];
    for (const key of blocklist) {
      stdoutMock.mock.resetCalls();
      stderrMock.mock.resetCalls();
      logger.info('comp', 'msg', { [key]: 'secret-value' });
      const mainEntry = capturedStdout().map(l => JSON.parse(l.replace(/\n$/, '')))
        .find(e => e.message === 'msg');
      assert.equal(mainEntry[key], '[REDACTED]', `${key} should be redacted`);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: redactSender
// ---------------------------------------------------------------------------

describe('logger — redactSender', () => {
  it('returns an 8-character hex string', () => {
    const result = logger.redactSender('user@example.com');
    assert.equal(result.length, 8);
    assert.match(result, /^[0-9a-f]{8}$/);
  });

  it('is deterministic (same input, same output)', () => {
    const a = logger.redactSender('test@test.com');
    const b = logger.redactSender('test@test.com');
    assert.equal(a, b);
  });

  it('different inputs produce different outputs', () => {
    const a = logger.redactSender('alice@example.com');
    const b = logger.redactSender('bob@example.com');
    assert.notEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// Tests: startTimer
// ---------------------------------------------------------------------------

describe('logger — startTimer', () => {
  it('elapsed() returns a non-negative number', () => {
    const timer = logger.startTimer();
    const elapsed = timer.elapsed();
    assert.equal(typeof elapsed, 'number');
    assert.ok(elapsed >= 0, 'elapsed should be non-negative');
  });
});
