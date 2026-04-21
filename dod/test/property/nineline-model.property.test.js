// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Feature: 9line-bot, Property 1: Format-then-Parse Round Trip
// Feature: 9line-bot, Property 2: Parse-then-Format Round Trip

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  createNineLine,
  format,
  parse,
  isValid,
  VALID_PRECEDENCE,
  VALID_EQUIPMENT,
  VALID_SECURITY,
  VALID_NATIONALITY,
  VALID_NBC,
  NOT_PROVIDED,
  LINE_FIELDS,
} = require('../../services/nineline-model');

// ---------------------------------------------------------------------------
// Arbitrary: generates valid Nine_Line_Request objects
//
// Free-text fields use strings that:
//   - contain no newlines (format uses '\n' as line separator)
//   - contain no carriage returns
//   - have length 1–50
//
// Enumerated fields are either null or one of the valid enum values.
// ---------------------------------------------------------------------------

const safeString = fc.stringOf(
  fc.char().filter(c => c !== '\n' && c !== '\r'),
  { minLength: 1, maxLength: 50 }
);

const nineLineArbitrary = fc.record({
  location:    fc.oneof(fc.constant(null), safeString),
  callsign:    fc.oneof(fc.constant(null), safeString),
  precedence:  fc.oneof(fc.constant(null), fc.constantFrom(...VALID_PRECEDENCE)),
  equipment:   fc.oneof(fc.constant(null), fc.constantFrom(...VALID_EQUIPMENT)),
  patientType: fc.oneof(fc.constant(null), safeString),
  security:    fc.oneof(fc.constant(null), fc.constantFrom(...VALID_SECURITY)),
  marking:     fc.oneof(fc.constant(null), safeString),
  nationality: fc.oneof(fc.constant(null), fc.constantFrom(...VALID_NATIONALITY)),
  nbc:         fc.oneof(fc.constant(null), fc.constantFrom(...VALID_NBC)),
});

// ---------------------------------------------------------------------------
// Property 1: Format-then-Parse Round Trip
//
// For any valid Nine_Line_Request, formatting then parsing SHALL produce an
// equivalent Nine_Line_Request.
// ---------------------------------------------------------------------------

describe('Property 1: Format-then-Parse Round Trip', () => {
  it('parse(format(nl)) is equivalent to nl for any valid Nine_Line_Request (100 runs)', () => {
    // Feature: 9line-bot, Property 1: Format-then-Parse Round Trip
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const formatted = format(nl);
        const parsed = parse(formatted);

        for (const field of LINE_FIELDS) {
          assert.equal(
            parsed[field],
            nl[field],
            `field "${field}" mismatch after format→parse: ` +
            `expected ${JSON.stringify(nl[field])}, got ${JSON.stringify(parsed[field])}`
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  it('round-tripped object passes isValid for any valid Nine_Line_Request (100 runs)', () => {
    // Feature: 9line-bot, Property 1: Format-then-Parse Round Trip
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const parsed = parse(format(nl));
        assert.equal(
          isValid(parsed),
          true,
          `isValid failed after format→parse round-trip for: ${JSON.stringify(nl)}`
        );
      }),
      { numRuns: 100 }
    );
  });

  it('all fields survive format→parse for fully-populated objects (100 runs)', () => {
    // Feature: 9line-bot, Property 1: Format-then-Parse Round Trip
    // Variant with all enum fields populated (no nulls for enum fields)
    const fullArbitrary = fc.record({
      location:    safeString,
      callsign:    safeString,
      precedence:  fc.constantFrom(...VALID_PRECEDENCE),
      equipment:   fc.constantFrom(...VALID_EQUIPMENT),
      patientType: safeString,
      security:    fc.constantFrom(...VALID_SECURITY),
      marking:     safeString,
      nationality: fc.constantFrom(...VALID_NATIONALITY),
      nbc:         fc.constantFrom(...VALID_NBC),
    });

    fc.assert(
      fc.property(fullArbitrary, (nl) => {
        const parsed = parse(format(nl));
        for (const field of LINE_FIELDS) {
          assert.equal(
            parsed[field],
            nl[field],
            `field "${field}" mismatch in fully-populated round-trip`
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  it('null fields remain null after format→parse (100 runs)', () => {
    // Feature: 9line-bot, Property 1: Format-then-Parse Round Trip
    // Variant: all-null Nine_Line_Request
    const allNullNl = createNineLine({});
    const parsed = parse(format(allNullNl));
    for (const field of LINE_FIELDS) {
      assert.equal(
        parsed[field],
        null,
        `field "${field}" should be null after all-null format→parse round-trip`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Property 2 (variant A): Pretty-Printer output → Parse round trip
//
// For any valid Nine_Line_Request, parsing the output of the Pretty_Printer
// (format) SHALL produce an equivalent Nine_Line_Request.
//
// (This is the same as Property 1 expressed from the parser's perspective.)
// ---------------------------------------------------------------------------

describe('Property 2a: Pretty-Printer format → Parse Round Trip', () => {
  it('parse(format(nl)) reproduces all fields for any valid Nine_Line_Request (100 runs)', () => {
    // Feature: 9line-bot, Property 2: Parse-then-Format Round Trip
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const prettyPrinted = format(nl);
        const parsed = parse(prettyPrinted);

        for (const field of LINE_FIELDS) {
          assert.equal(
            parsed[field],
            nl[field],
            `Pretty-Printer output not faithfully parsed: field "${field}" ` +
            `expected ${JSON.stringify(nl[field])}, got ${JSON.stringify(parsed[field])}`
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 (variant B): Parse-then-Format Round Trip
//
// For any valid formatted 9-Line text block (produced by format from any valid
// Nine_Line_Request), pretty-printing the output of the Parser SHALL produce
// an equivalent text block.
// ---------------------------------------------------------------------------

describe('Property 2b: Parse-then-Format (Pretty-Printer) Round Trip', () => {
  it('format(parse(text)) equals original text for any format-produced text (100 runs)', () => {
    // Feature: 9line-bot, Property 2: Parse-then-Format Round Trip
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const originalText = format(nl);
        const parsed = parse(originalText);
        const reformatted = format(parsed);

        assert.equal(
          reformatted,
          originalText,
          `Re-formatted text differs from original.\n` +
          `Original:\n${originalText}\n\nReformatted:\n${reformatted}`
        );
      }),
      { numRuns: 100 }
    );
  });

  it('format(parse(text)) produces valid structure for any Nine_Line_Request text (100 runs)', () => {
    // Feature: 9line-bot, Property 2: Parse-then-Format Round Trip
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const text = format(nl);
        const reformatted = format(parse(text));

        // Must start with header and end with footer
        assert.ok(
          reformatted.startsWith('=== 9-LINE MEDEVAC REQUEST ==='),
          'reformatted text must start with header'
        );
        assert.ok(
          reformatted.endsWith('=============================='),
          'reformatted text must end with footer'
        );

        // Must contain exactly 9 labeled lines
        const labeledLines = reformatted.match(/^Line \d/gm);
        assert.equal(
          labeledLines ? labeledLines.length : 0,
          9,
          'reformatted text must contain exactly 9 labeled lines'
        );
      }),
      { numRuns: 100 }
    );
  });

  it('NOT_PROVIDED sentinel is preserved through parse→format (100 runs)', () => {
    // Feature: 9line-bot, Property 2: Parse-then-Format Round Trip
    // Null fields format to NOT_PROVIDED; parsing NOT_PROVIDED gives null;
    // re-formatting null gives NOT_PROVIDED again — a stable fixed point.
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const formatted = format(nl);
        const parsed = parse(formatted);
        const reformatted = format(parsed);

        // Every occurrence of NOT_PROVIDED in the original should appear in reformatted
        const originalNPCount = (formatted.match(/\[Not provided\]/g) || []).length;
        const reformattedNPCount = (reformatted.match(/\[Not provided\]/g) || []).length;
        assert.equal(
          reformattedNPCount,
          originalNPCount,
          `NOT_PROVIDED count changed: original=${originalNPCount}, reformatted=${reformattedNPCount}`
        );
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Additional structural properties
// ---------------------------------------------------------------------------

describe('Property: format output structure invariants', () => {
  it('formatted output always has exactly 9 labeled lines (100 runs)', () => {
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const out = format(nl);
        const matches = out.match(/^Line \d/gm);
        assert.equal(matches ? matches.length : 0, 9);
      }),
      { numRuns: 100 }
    );
  });

  it('formatted output always starts with header and ends with footer (100 runs)', () => {
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const out = format(nl);
        assert.ok(out.startsWith('=== 9-LINE MEDEVAC REQUEST ==='));
        assert.ok(out.endsWith('=============================='));
      }),
      { numRuns: 100 }
    );
  });

  it('null fields are rendered as NOT_PROVIDED in formatted output (100 runs)', () => {
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const out = format(nl);
        for (const field of LINE_FIELDS) {
          if (nl[field] === null) {
            // Find the line for this field index
            const fieldIndex = LINE_FIELDS.indexOf(field);
            const lineNum = fieldIndex + 1;
            const linePattern = new RegExp(`^Line ${lineNum} \\([^)]+\\): \\[Not provided\\]$`, 'm');
            assert.ok(
              linePattern.test(out),
              `null field "${field}" should be rendered as [Not provided] in formatted output`
            );
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
