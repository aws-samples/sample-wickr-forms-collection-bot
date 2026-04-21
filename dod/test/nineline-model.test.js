// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

require('./setup');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  createNineLine,
  format,
  formatBroadcast,
  parse,
  isValid,
  VALID_PRECEDENCE,
  VALID_EQUIPMENT,
  VALID_SECURITY,
  VALID_NATIONALITY,
  VALID_NBC,
  NOT_PROVIDED,
  LINE_LABELS,
} = require('../services/nineline-model');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fully-populated Nine_Line_Request with all fields set */
function fullNineLine() {
  return createNineLine({
    location:    'AB 1234 5678',
    callsign:    'DUSTOFF 7-2, freq 33.45',
    precedence:  'URGENT',
    equipment:   'NONE',
    patientType: '2 LITTER, 1 AMBULATORY',
    security:    'POSSIBLE ENEMY',
    marking:     'SMOKE GREEN',
    nationality: 'US MILITARY',
    nbc:         'NONE',
  });
}

// ---------------------------------------------------------------------------
// 1. createNineLine
// ---------------------------------------------------------------------------

describe('createNineLine', () => {
  it('returns an object with all nine fields', () => {
    const nl = createNineLine({});
    const expected = ['location','callsign','precedence','equipment','patientType',
                      'security','marking','nationality','nbc'];
    for (const field of expected) {
      assert.ok(Object.prototype.hasOwnProperty.call(nl, field), `missing field: ${field}`);
    }
  });

  it('sets missing fields to null', () => {
    const nl = createNineLine({});
    assert.equal(nl.location, null);
    assert.equal(nl.precedence, null);
    assert.equal(nl.nbc, null);
  });

  it('sets supplied fields correctly', () => {
    const nl = createNineLine({ location: 'AB 1234 5678', nbc: 'NONE' });
    assert.equal(nl.location, 'AB 1234 5678');
    assert.equal(nl.nbc, 'NONE');
    assert.equal(nl.callsign, null);
  });

  it('preserves null values explicitly passed', () => {
    const nl = createNineLine({ location: null, nbc: null });
    assert.equal(nl.location, null);
    assert.equal(nl.nbc, null);
  });
});

// ---------------------------------------------------------------------------
// 2. isValid
// ---------------------------------------------------------------------------

describe('isValid', () => {
  it('returns true for a fully-populated valid object', () => {
    assert.equal(isValid(fullNineLine()), true);
  });

  it('returns true for an all-null object', () => {
    assert.equal(isValid(createNineLine({})), true);
  });

  it('returns false for invalid precedence', () => {
    const nl = createNineLine({ precedence: 'VERY URGENT' });
    assert.equal(isValid(nl), false);
  });

  it('returns false for invalid equipment', () => {
    const nl = createNineLine({ equipment: 'PARACHUTE' });
    assert.equal(isValid(nl), false);
  });

  it('returns false for invalid security', () => {
    const nl = createNineLine({ security: 'SAFE' });
    assert.equal(isValid(nl), false);
  });

  it('returns false for invalid nationality', () => {
    const nl = createNineLine({ nationality: 'UNKNOWN' });
    assert.equal(isValid(nl), false);
  });

  it('returns false for invalid nbc', () => {
    const nl = createNineLine({ nbc: 'RADIOLOGICAL' });
    assert.equal(isValid(nl), false);
  });

  it('returns false for null input', () => {
    assert.equal(isValid(null), false);
  });

  it('accepts every VALID_PRECEDENCE value', () => {
    for (const v of VALID_PRECEDENCE) {
      assert.equal(isValid(createNineLine({ precedence: v })), true, `failed for: ${v}`);
    }
  });

  it('accepts every VALID_EQUIPMENT value', () => {
    for (const v of VALID_EQUIPMENT) {
      assert.equal(isValid(createNineLine({ equipment: v })), true, `failed for: ${v}`);
    }
  });

  it('accepts every VALID_SECURITY value', () => {
    for (const v of VALID_SECURITY) {
      assert.equal(isValid(createNineLine({ security: v })), true, `failed for: ${v}`);
    }
  });

  it('accepts every VALID_NATIONALITY value', () => {
    for (const v of VALID_NATIONALITY) {
      assert.equal(isValid(createNineLine({ nationality: v })), true, `failed for: ${v}`);
    }
  });

  it('accepts every VALID_NBC value', () => {
    for (const v of VALID_NBC) {
      assert.equal(isValid(createNineLine({ nbc: v })), true, `failed for: ${v}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. format (Pretty Printer)
// ---------------------------------------------------------------------------

describe('format', () => {
  it('returns a string', () => {
    assert.equal(typeof format(fullNineLine()), 'string');
  });

  it('starts with the header and ends with the footer', () => {
    const out = format(fullNineLine());
    assert.ok(out.startsWith('=== 9-LINE MEDEVAC REQUEST ==='));
    assert.ok(out.endsWith('=============================='));
  });

  it('contains all nine labeled lines', () => {
    const out = format(fullNineLine());
    for (const label of LINE_LABELS) {
      assert.ok(out.includes(label + ':'), `missing label: ${label}`);
    }
  });

  it('renders populated field values correctly', () => {
    const out = format(fullNineLine());
    assert.ok(out.includes('Line 1 (Location): AB 1234 5678'));
    assert.ok(out.includes('Line 3 (Precedence): URGENT'));
    assert.ok(out.includes('Line 9 (NBC): NONE'));
  });

  it('renders null fields as [Not provided]', () => {
    const nl = createNineLine({ location: 'AB 1234 5678' }); // all others null
    const out = format(nl);
    assert.ok(out.includes(`Line 2 (Callsign): ${NOT_PROVIDED}`));
    assert.ok(out.includes(`Line 9 (NBC): ${NOT_PROVIDED}`));
  });

  it('contains exactly nine "Line N" occurrences', () => {
    const out = format(fullNineLine());
    const matches = out.match(/^Line \d/gm);
    assert.equal(matches.length, 9);
  });

  it('formats the full canonical example correctly', () => {
    const expected = [
      '=== 9-LINE MEDEVAC REQUEST ===',
      'Line 1 (Location): AB 1234 5678',
      'Line 2 (Callsign): DUSTOFF 7-2, freq 33.45',
      'Line 3 (Precedence): URGENT',
      'Line 4 (Equipment): NONE',
      'Line 5 (# Patients by Type): 2 LITTER, 1 AMBULATORY',
      'Line 6 (Security): POSSIBLE ENEMY',
      'Line 7 (Marking): SMOKE GREEN',
      'Line 8 (Nationality): US MILITARY',
      'Line 9 (NBC): NONE',
      '==============================',
    ].join('\n');
    assert.equal(format(fullNineLine()), expected);
  });
});

// ---------------------------------------------------------------------------
// 4. formatBroadcast
// ---------------------------------------------------------------------------

describe('formatBroadcast', () => {
  it('returns a string', () => {
    assert.equal(typeof formatBroadcast(fullNineLine(), 'user@example.com', '2025-01-15T14:30:00Z'), 'string');
  });

  it('includes the sender username', () => {
    const out = formatBroadcast(fullNineLine(), 'user@example.com', '2025-01-15T14:30:00Z');
    assert.ok(out.includes('Submitted by: user@example.com'));
  });

  it('includes the timestamp', () => {
    const out = formatBroadcast(fullNineLine(), 'user@example.com', '2025-01-15T14:30:00Z');
    assert.ok(out.includes('Timestamp: 2025-01-15T14:30:00Z'));
  });

  it('includes all nine labeled lines', () => {
    const out = formatBroadcast(fullNineLine(), 'user@example.com', '2025-01-15T14:30:00Z');
    for (const label of LINE_LABELS) {
      assert.ok(out.includes(label + ':'), `missing label: ${label}`);
    }
  });

  it('starts with the header', () => {
    const out = formatBroadcast(fullNineLine(), 'user@example.com', '2025-01-15T14:30:00Z');
    assert.ok(out.startsWith('=== 9-LINE MEDEVAC REQUEST ==='));
  });

  it('ends with the footer', () => {
    const out = formatBroadcast(fullNineLine(), 'user@example.com', '2025-01-15T14:30:00Z');
    assert.ok(out.endsWith('=============================='));
  });

  it('formats the full canonical broadcast example', () => {
    const expected = [
      '=== 9-LINE MEDEVAC REQUEST ===',
      'Submitted by: user@example.com',
      'Timestamp: 2025-01-15T14:30:00Z',
      '',
      'Line 1 (Location): AB 1234 5678',
      'Line 2 (Callsign): DUSTOFF 7-2, freq 33.45',
      'Line 3 (Precedence): URGENT',
      'Line 4 (Equipment): NONE',
      'Line 5 (# Patients by Type): 2 LITTER, 1 AMBULATORY',
      'Line 6 (Security): POSSIBLE ENEMY',
      'Line 7 (Marking): SMOKE GREEN',
      'Line 8 (Nationality): US MILITARY',
      'Line 9 (NBC): NONE',
      '==============================',
    ].join('\n');
    assert.equal(formatBroadcast(fullNineLine(), 'user@example.com', '2025-01-15T14:30:00Z'), expected);
  });
});

// ---------------------------------------------------------------------------
// 5. parse
// ---------------------------------------------------------------------------

describe('parse', () => {
  it('returns a Nine_Line_Request object', () => {
    const result = parse(format(fullNineLine()));
    assert.equal(typeof result, 'object');
    assert.ok(result !== null);
  });

  it('parses all nine fields from a fully-formatted block', () => {
    const original = fullNineLine();
    const result = parse(format(original));
    assert.equal(result.location,    'AB 1234 5678');
    assert.equal(result.callsign,    'DUSTOFF 7-2, freq 33.45');
    assert.equal(result.precedence,  'URGENT');
    assert.equal(result.equipment,   'NONE');
    assert.equal(result.patientType, '2 LITTER, 1 AMBULATORY');
    assert.equal(result.security,    'POSSIBLE ENEMY');
    assert.equal(result.marking,     'SMOKE GREEN');
    assert.equal(result.nationality, 'US MILITARY');
    assert.equal(result.nbc,         'NONE');
  });

  it('sets missing lines to null', () => {
    const text = [
      '=== 9-LINE MEDEVAC REQUEST ===',
      'Line 1 (Location): AB 1234 5678',
      '==============================',
    ].join('\n');
    const result = parse(text);
    assert.equal(result.location, 'AB 1234 5678');
    assert.equal(result.callsign, null);
    assert.equal(result.nbc, null);
  });

  it(`sets lines marked "${NOT_PROVIDED}" to null`, () => {
    const nl = createNineLine({ location: 'AB 1234 5678' }); // rest null → NOT_PROVIDED
    const result = parse(format(nl));
    assert.equal(result.callsign,    null);
    assert.equal(result.precedence,  null);
    assert.equal(result.equipment,   null);
    assert.equal(result.patientType, null);
    assert.equal(result.security,    null);
    assert.equal(result.marking,     null);
    assert.equal(result.nationality, null);
    assert.equal(result.nbc,         null);
  });

  it('returns all-null object for empty string input', () => {
    const result = parse('');
    for (const field of ['location','callsign','precedence','equipment','patientType',
                          'security','marking','nationality','nbc']) {
      assert.equal(result[field], null);
    }
  });

  it('returns all-null object for null input', () => {
    const result = parse(null);
    assert.equal(result.location, null);
  });

  it('can parse a broadcast-formatted block', () => {
    const original = fullNineLine();
    const broadcast = formatBroadcast(original, 'user@example.com', '2025-01-15T14:30:00Z');
    const result = parse(broadcast);
    assert.equal(result.location,    'AB 1234 5678');
    assert.equal(result.precedence,  'URGENT');
    assert.equal(result.nbc,         'NONE');
  });
});

// ---------------------------------------------------------------------------
// 6. Property tests (fast-check)
// ---------------------------------------------------------------------------

/**
 * Arbitrary that produces a valid Nine_Line_Request (nullable fields allowed).
 * Strings are restricted to printable ASCII to avoid colon/newline ambiguities
 * in the format output.
 */
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

describe('Property: format → parse round-trip', () => {
  it('parse(format(nl)) equals nl for any valid Nine_Line_Request (100 runs)', () => {
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const formatted = format(nl);
        const parsed    = parse(formatted);

        for (const field of ['location','callsign','precedence','equipment','patientType',
                              'security','marking','nationality','nbc']) {
          // null in original ↔ null after round-trip
          assert.equal(parsed[field], nl[field],
            `field "${field}" mismatch: expected ${JSON.stringify(nl[field])}, got ${JSON.stringify(parsed[field])}`);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property: parse → format round-trip', () => {
  it('format(parse(text)) equals text for any format-produced text (100 runs)', () => {
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const text      = format(nl);
        const parsed    = parse(text);
        const reformatted = format(parsed);
        assert.equal(reformatted, text,
          `re-formatted text differs from original`);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property: formatted output contains exactly nine labeled lines', () => {
  it('format(nl) has exactly 9 labeled lines for any Nine_Line_Request (100 runs)', () => {
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        const out = format(nl);
        const matches = out.match(/^Line \d/gm);
        assert.equal(matches ? matches.length : 0, 9);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property: isValid accepts all generated Nine_Line_Requests', () => {
  it('isValid(nl) is true for all arbitrarily-generated valid Nine_Line_Requests (100 runs)', () => {
    fc.assert(
      fc.property(nineLineArbitrary, (nl) => {
        assert.equal(isValid(nl), true);
      }),
      { numRuns: 100 }
    );
  });
});
