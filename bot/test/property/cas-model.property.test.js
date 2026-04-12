// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// **Validates: Requirements 4.8, 11.6**
// Property: For all valid CAS_Brief objects, formatting then parsing
// SHALL produce an equivalent CAS_Brief object (round-trip property).
// Optional null fields are omitted from format output and parse back as null.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { formatReport, parseReport } = require('../../services/form-registry');
const casDef = require('../../forms/cas');

// ---------------------------------------------------------------------------
// Arbitrary: generates valid CAS_Brief objects
//
// Each field is either null or a non-empty string that:
//   - contains no newlines (format uses '\n' as line separator)
//   - is not equal to '[Not provided]' (the NOT_PROVIDED sentinel)
//
// 11 required fields + 4 optional fields use the same generator.
// ---------------------------------------------------------------------------

const safeField = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1 }).filter(s => !s.includes('\n') && s !== '[Not provided]')
);

const casArbitrary = fc.record({
  // 11 required fields
  jtac:              safeField,
  controlType:       safeField,
  ipBp:              safeField,
  heading:           safeField,
  distance:          safeField,
  targetElevation:   safeField,
  targetDescription: safeField,
  targetLocation:    safeField,
  typeMark:          safeField,
  friendlies:        safeField,
  egress:            safeField,
  // 4 optional fields
  remarks:           safeField,
  laserToTargetLine: safeField,
  timeOnTarget:      safeField,
  timeToTarget:      safeField,
});

// ---------------------------------------------------------------------------
// Property: Format-then-Parse Round Trip for CAS
// ---------------------------------------------------------------------------

describe('CAS Property: Format-then-Parse Round Trip', () => {
  it('parseReport(casDef, formatReport(casDef, report)) deep-equals the original report (100 runs)', () => {
    // **Validates: Requirements 4.8, 11.6**
    fc.assert(
      fc.property(casArbitrary, (report) => {
        const formatted = formatReport(casDef, report);
        const parsed = parseReport(casDef, formatted);

        assert.deepStrictEqual(
          parsed,
          report,
          `Round-trip mismatch.\nOriginal: ${JSON.stringify(report)}\nFormatted:\n${formatted}\nParsed: ${JSON.stringify(parsed)}`
        );
      }),
      { numRuns: 100 }
    );
  });

  it('optional null fields are omitted from format output and parse back as null (100 runs)', () => {
    // **Validates: Requirements 4.8, 11.6**
    const optionalKeys = ['remarks', 'laserToTargetLine', 'timeOnTarget', 'timeToTarget'];
    const optionalLabels = casDef.fields
      .filter(f => f.optional)
      .map(f => f.label);

    fc.assert(
      fc.property(casArbitrary, (report) => {
        const formatted = formatReport(casDef, report);
        const parsed = parseReport(casDef, formatted);

        for (let i = 0; i < optionalKeys.length; i++) {
          const key = optionalKeys[i];
          const label = optionalLabels[i];

          if (report[key] === null) {
            // Null optional fields must NOT appear in formatted output
            assert.ok(
              !formatted.includes(label + ': '),
              `Optional field "${key}" is null but its label "${label}" appears in formatted output`
            );
            // And must parse back as null
            assert.strictEqual(
              parsed[key],
              null,
              `Optional field "${key}" should parse back as null when omitted from format`
            );
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
