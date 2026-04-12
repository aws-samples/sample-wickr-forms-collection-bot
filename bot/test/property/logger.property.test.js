// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Feature: production-logging — Property-based tests for logger.js

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Helpers: capture stdout / stderr
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

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  savedLogLevel = process.env.LOG_LEVEL;
  delete process.env.LOG_LEVEL;
  delete require.cache[require.resolve('../../services/logger')];

  stdoutMock = mock.method(process.stdout, 'write', () => true);
  stderrMock = mock.method(process.stderr, 'write', () => true);

  logger = require('../../services/logger');
});

afterEach(() => {
  stdoutMock.mock.restore();
  stderrMock.mock.restore();

  if (savedLogLevel !== undefined) {
    process.env.LOG_LEVEL = savedLogLevel;
  } else {
    delete process.env.LOG_LEVEL;
  }

  delete require.cache[require.resolve('../../services/logger')];
});


// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const safeString = fc.stringOf(
  fc.char().filter(c => c !== '\0'),
  { minLength: 1, maxLength: 50 }
);

const RESERVED_KEYS = ['timestamp', 'level', 'component', 'message'];
const PII_KEYS = ['userEmail', 'senderEmail', 'email', 'messageText', 'text', 'content', 'filePath', 'file'];

// Context with only safe (non-reserved, non-PII) keys
const safeContextArb = fc.dictionary(
  fc.stringOf(fc.char().filter(c => /[a-zA-Z]/.test(c)), { minLength: 1, maxLength: 15 })
    .filter(k => !RESERVED_KEYS.includes(k) && !PII_KEYS.includes(k) && k !== 'error'),
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
  { minKeys: 0, maxKeys: 5 }
);

// ---------------------------------------------------------------------------
// Property 1: Log Entry Structure Invariant
// Feature: production-logging, Property 1: Log Entry Structure Invariant
// **Validates: Requirements 1.3, 14.1, 14.5**
// ---------------------------------------------------------------------------

describe('Property 1: Log Entry Structure Invariant', () => {
  it('output is valid JSON with timestamp, level, component, message — round-trip holds (100 runs)', () => {
    // Feature: production-logging, Property 1: Log Entry Structure Invariant
    fc.assert(
      fc.property(safeString, safeString, safeContextArb, (component, message, context) => {
        stdoutMock.mock.resetCalls();
        stderrMock.mock.resetCalls();

        logger.info(component, message, context);

        const lines = capturedStdout();
        assert.ok(lines.length >= 1, 'should produce at least one output line');

        // Find the main entry (not a pii_redaction warning)
        const mainLine = lines[lines.length - 1];
        const entry = JSON.parse(mainLine.replace(/\n$/, ''));

        // Required fields
        assert.equal(typeof entry.timestamp, 'string');
        assert.ok(entry.timestamp.length > 0, 'timestamp should be non-empty');
        assert.equal(entry.level, 'INFO');
        assert.equal(entry.component, component);
        assert.equal(entry.message, message);

        // Round-trip: JSON.parse(JSON.stringify(entry)) deep-equals entry
        const roundTripped = JSON.parse(JSON.stringify(entry));
        assert.deepStrictEqual(roundTripped, entry);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Level Filtering
// Feature: production-logging, Property 2: Level Filtering
// **Validates: Requirements 2.5, 2.6**
// ---------------------------------------------------------------------------

describe('Property 2: Level Filtering', () => {
  it('levels below minimum produce no output; ERROR always emits (100 runs)', () => {
    // Feature: production-logging, Property 2: Level Filtering
    const levelArb = fc.constantFrom('DEBUG', 'INFO', 'WARN', 'ERROR');
    const minLevelArb = fc.constantFrom('DEBUG', 'INFO', 'WARN', 'ERROR');

    const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

    fc.assert(
      fc.property(levelArb, minLevelArb, safeString, safeString, (level, minLevel, comp, msg) => {
        stdoutMock.mock.resetCalls();
        stderrMock.mock.resetCalls();

        process.env.LOG_LEVEL = minLevel;
        logger._resetLevel();

        // Discard any output from _resetLevel (e.g. unrecognized level warning)
        stdoutMock.mock.resetCalls();
        stderrMock.mock.resetCalls();

        logger[level.toLowerCase()](comp, msg);

        const stdoutLines = capturedStdout();
        const stderrLines = capturedStderr();
        const totalOutput = stdoutLines.length + stderrLines.length;

        if (level === 'ERROR') {
          // ERROR always emits
          assert.ok(totalOutput > 0, `ERROR should always emit (minLevel=${minLevel})`);
        } else if (LEVELS[level] < LEVELS[minLevel]) {
          // Below minimum: no output
          assert.equal(totalOutput, 0,
            `${level} should be suppressed when minLevel=${minLevel}`);
        } else {
          // At or above minimum: should emit
          assert.ok(totalOutput > 0,
            `${level} should emit when minLevel=${minLevel}`);
        }
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 3: Reserved Key Protection
// Feature: production-logging, Property 3: Reserved Key Protection
// **Validates: Requirement 1.8**
// ---------------------------------------------------------------------------

describe('Property 3: Reserved Key Protection', () => {
  it('logger own values always win over context reserved keys (100 runs)', () => {
    // Feature: production-logging, Property 3: Reserved Key Protection
    const reservedValueArb = fc.record({
      timestamp: fc.string(),
      level: fc.string(),
      component: fc.string(),
      message: fc.string(),
    });

    fc.assert(
      fc.property(safeString, safeString, reservedValueArb, (comp, msg, reservedCtx) => {
        stdoutMock.mock.resetCalls();
        stderrMock.mock.resetCalls();

        logger.info(comp, msg, reservedCtx);

        const lines = capturedStdout();
        assert.ok(lines.length >= 1);
        const entry = JSON.parse(lines[lines.length - 1].replace(/\n$/, ''));

        // Logger's own values take precedence
        assert.equal(entry.level, 'INFO');
        assert.equal(entry.component, comp);
        assert.equal(entry.message, msg);
        assert.notEqual(entry.timestamp, reservedCtx.timestamp);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: PII Blocklist Redaction
// Feature: production-logging, Property 4: PII Blocklist Redaction
// **Validates: Requirement 11.7**
// ---------------------------------------------------------------------------

describe('Property 4: PII Blocklist Redaction', () => {
  it('blocklisted keys produce [REDACTED] in output (100 runs)', () => {
    // Feature: production-logging, Property 4: PII Blocklist Redaction
    const piiKeyArb = fc.constantFrom(...PII_KEYS);

    fc.assert(
      fc.property(piiKeyArb, safeString, safeString, safeString, (piiKey, piiValue, comp, msg) => {
        stdoutMock.mock.resetCalls();
        stderrMock.mock.resetCalls();

        logger.info(comp, msg, { [piiKey]: piiValue });

        const lines = capturedStdout();
        // Should have at least 2 lines: redaction warning + main entry
        assert.ok(lines.length >= 2, 'should emit redaction warning + main entry');

        // Find the main entry
        const entries = lines.map(l => JSON.parse(l.replace(/\n$/, '')));
        const mainEntry = entries.find(e => e.message === msg);
        assert.ok(mainEntry, 'should find main log entry');
        assert.equal(mainEntry[piiKey], '[REDACTED]',
          `${piiKey} should be [REDACTED]`);

        // Find the warning
        const warnEntry = entries.find(e => e.message === 'pii_redaction');
        assert.ok(warnEntry, 'should find pii_redaction warning');
        assert.equal(warnEntry.level, 'WARN');
        assert.equal(warnEntry.redactedKey, piiKey);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Error Serialization
// Feature: production-logging, Property 5: Error Serialization
// **Validates: Requirement 1.5**
// ---------------------------------------------------------------------------

describe('Property 5: Error Serialization', () => {
  it('Error instances produce { error: string, stack: string } (100 runs)', () => {
    // Feature: production-logging, Property 5: Error Serialization
    fc.assert(
      fc.property(safeString, safeString, safeString, (comp, msg, errMsg) => {
        stdoutMock.mock.resetCalls();
        stderrMock.mock.resetCalls();

        const err = new Error(errMsg);
        logger.error(comp, msg, { error: err });

        const lines = capturedStderr();
        assert.ok(lines.length >= 1);
        const entry = JSON.parse(lines[0].replace(/\n$/, ''));

        assert.equal(typeof entry.error, 'string', 'error should be a string');
        assert.equal(entry.error, errMsg);
        assert.equal(typeof entry.stack, 'string', 'stack should be a string');
        assert.ok(entry.stack.includes('Error:'), 'stack should contain Error:');
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: redactSender Determinism
// Feature: production-logging, Property 6: redactSender Determinism
// **Validates: Requirements 11.4, 11.5**
// ---------------------------------------------------------------------------

describe('Property 6: redactSender Determinism', () => {
  it('returns 8-char hex, same input same output (100 runs)', () => {
    // Feature: production-logging, Property 6: redactSender Determinism
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (input) => {
        const result1 = logger.redactSender(input);
        const result2 = logger.redactSender(input);

        // 8-char hex
        assert.equal(result1.length, 8, 'should be 8 characters');
        assert.match(result1, /^[0-9a-f]{8}$/, 'should be hex');

        // Deterministic
        assert.equal(result1, result2, 'same input should produce same output');
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: startTimer Monotonicity
// Feature: production-logging, Property 7: startTimer Monotonicity
// **Validates: Requirement 1.7**
// ---------------------------------------------------------------------------

describe('Property 7: startTimer Monotonicity', () => {
  it('elapsed() returns non-negative number (100 runs)', () => {
    // Feature: production-logging, Property 7: startTimer Monotonicity
    fc.assert(
      fc.property(fc.constant(null), () => {
        const timer = logger.startTimer();
        const elapsed = timer.elapsed();
        assert.equal(typeof elapsed, 'number');
        assert.ok(elapsed >= 0, 'elapsed should be non-negative');
      }),
      { numRuns: 100 }
    );
  });
});
