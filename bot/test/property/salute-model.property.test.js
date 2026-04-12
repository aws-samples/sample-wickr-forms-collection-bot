// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// **Validates: Requirements 3.7, 11.5**
// Property: For all valid SALUTE_Report objects, formatting then parsing
// SHALL produce an equivalent SALUTE_Report object (round-trip property).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { formatReport, parseReport } = require('../../services/form-registry');
const saluteDef = require('../../forms/salute');

// ---------------------------------------------------------------------------
// Arbitrary: generates valid SALUTE_Report objects
//
// Each of the 6 fields is either null or a non-empty string that:
//   - contains no newlines (format uses '\n' as line separator)
//   - is not equal to '[Not provided]' (the NOT_PROVIDED sentinel)
// ---------------------------------------------------------------------------

const safeField = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1 }).filter(s => !s.includes('\n') && s !== '[Not provided]')
);

const saluteArbitrary = fc.record({
  size:      safeField,
  activity:  safeField,
  location:  safeField,
  unit:      safeField,
  time:      safeField,
  equipment: safeField,
});

// ---------------------------------------------------------------------------
// Property: Format-then-Parse Round Trip for SALUTE
// ---------------------------------------------------------------------------

describe('SALUTE Property: Format-then-Parse Round Trip', () => {
  it('parseReport(saluteDef, formatReport(saluteDef, report)) deep-equals the original report (100 runs)', () => {
    // **Validates: Requirements 3.7, 11.5**
    fc.assert(
      fc.property(saluteArbitrary, (report) => {
        const formatted = formatReport(saluteDef, report);
        const parsed = parseReport(saluteDef, formatted);

        assert.deepStrictEqual(
          parsed,
          report,
          `Round-trip mismatch.\nOriginal: ${JSON.stringify(report)}\nFormatted:\n${formatted}\nParsed: ${JSON.stringify(parsed)}`
        );
      }),
      { numRuns: 100 }
    );
  });
});
