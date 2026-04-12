// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

require('./setup');

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const incidentForm = require('../forms/incident-report');

// ── Property 3: Incident report interface completeness ────────────────────────
// **Validates: Requirements 4.4**

describe('incident-report interface completeness', () => {
  const REQUIRED_KEYS = [
    'id', 'name', 'command', 'detectionHint', 'fields',
    'extractionPrompt', 'correctionPrompt', 'formatHeader', 'formatFooter', 'outputs',
  ];

  it('exports an object with all required keys', () => {
    for (const key of REQUIRED_KEYS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(incidentForm, key),
        `Missing required key: ${key}`
      );
    }
  });

  it('has id set to INCIDENT', () => {
    assert.strictEqual(incidentForm.id, 'INCIDENT');
  });

  it('has name set to Incident Report', () => {
    assert.strictEqual(incidentForm.name, 'Incident Report');
  });

  it('has command set to /incident', () => {
    assert.strictEqual(incidentForm.command, '/incident');
  });
});

// ── Property 4: Incident report field types ───────────────────────────────────
// **Validates: Requirements 4.5, 4.6**

describe('incident-report field types', () => {
  it('contains an enum field with severity validValues [LOW, MEDIUM, HIGH, CRITICAL]', () => {
    const enumFields = incidentForm.fields.filter(f => f.type === 'enum');
    assert.ok(enumFields.length >= 1, 'Expected at least one enum field');

    const severityField = enumFields.find(f => f.key === 'severity');
    assert.ok(severityField, 'Expected an enum field with key "severity"');
    assert.deepStrictEqual(
      severityField.validValues,
      ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    );
  });

  it('contains text fields for dateTime, location, description, affectedPersons', () => {
    const textFieldKeys = incidentForm.fields
      .filter(f => f.type === 'text')
      .map(f => f.key);

    for (const expected of ['dateTime', 'location', 'description', 'affectedPersons']) {
      assert.ok(
        textFieldKeys.includes(expected),
        `Expected text field with key "${expected}"`
      );
    }
  });

  it('has exactly 5 fields', () => {
    assert.strictEqual(incidentForm.fields.length, 5);
  });
});


// ── Property 2: Form registry discovery ───────────────────────────────────────
// **Validates: Requirements 4.3**

describe('incident-report form registry discovery', () => {
  const registry = require('../services/form-registry');

  it('loadForms discovers INCIDENT form in bot/forms/ directory', () => {
    const formsDir = path.join(__dirname, '..', 'forms');
    registry.loadForms(formsDir);

    const allIds = registry.getAllIds();
    assert.ok(
      allIds.includes('INCIDENT'),
      `Expected getAllIds() to include "INCIDENT", got: ${JSON.stringify(allIds)}`
    );
  });

  it('getById returns the incident report form definition', () => {
    const form = registry.getById('INCIDENT');
    assert.ok(form, 'Expected getById("INCIDENT") to return a form definition');
    assert.strictEqual(form.id, 'INCIDENT');
    assert.strictEqual(form.name, 'Incident Report');
    assert.strictEqual(form.command, '/incident');
  });
});


// ── Property 5: Format/parse round-trip ───────────────────────────────────────
// **Validates: Requirements 7.1, 7.2**

const fc = require('fast-check');
const registry = require('../services/form-registry');

describe('incident-report format/parse round-trip (property)', () => {
  const formDef = incidentForm;

  // Generator: produce report objects with non-empty string values or null for
  // each field. We avoid strings containing newlines or the label separator
  // pattern ("Label: ") to keep the round-trip clean -- parseReport splits on
  // newlines and matches label prefixes.
  const reportArb = fc.record({
    dateTime: fc.oneof(
      fc.constant(null),
      fc.string({ minLength: 1 }).filter(s => !s.includes('\n') && s !== '[Not provided]')
    ),
    location: fc.oneof(
      fc.constant(null),
      fc.string({ minLength: 1 }).filter(s => !s.includes('\n') && s !== '[Not provided]')
    ),
    severity: fc.oneof(
      fc.constant(null),
      fc.constantFrom('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    ),
    description: fc.oneof(
      fc.constant(null),
      fc.string({ minLength: 1 }).filter(s => !s.includes('\n') && s !== '[Not provided]')
    ),
    affectedPersons: fc.oneof(
      fc.constant(null),
      fc.string({ minLength: 1 }).filter(s => !s.includes('\n') && s !== '[Not provided]')
    ),
  });

  it('parseReport(formDef, formatReport(formDef, report)) produces equivalent output', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const formatted = registry.formatReport(formDef, report);
        const parsed = registry.parseReport(formDef, formatted);

        // Each field should round-trip: non-null values preserved, null stays null
        for (const field of formDef.fields) {
          const original = report[field.key];
          const result = parsed[field.key];
          if (original === null) {
            assert.strictEqual(result, null,
              `Field "${field.key}": expected null, got "${result}"`);
          } else {
            assert.strictEqual(result, original,
              `Field "${field.key}": expected "${original}", got "${result}"`);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 6: Enum validation ──────────────────────────────────────────────
// **Validates: Requirements 4.5, 7.1**

describe('incident-report enum validation (property)', () => {
  const formDef = incidentForm;
  const VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

  // Base report with valid text fields -- only severity varies
  const baseTextArb = fc.string({ minLength: 1 }).filter(s => !s.includes('\n'));

  it('isValidReport returns false when severity is not in validValues', () => {
    const invalidSeverityArb = fc.string({ minLength: 1 })
      .filter(s => !VALID_SEVERITIES.includes(s) && s !== '[Not provided]');

    fc.assert(
      fc.property(invalidSeverityArb, baseTextArb, baseTextArb, baseTextArb, baseTextArb,
        (severity, dateTime, location, description, affectedPersons) => {
          const report = { dateTime, location, severity, description, affectedPersons };
          assert.strictEqual(
            registry.isValidReport(formDef, report),
            false,
            `Expected isValidReport to return false for severity="${severity}"`
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isValidReport returns true when severity is one of LOW, MEDIUM, HIGH, CRITICAL', () => {
    const validSeverityArb = fc.constantFrom(...VALID_SEVERITIES);

    fc.assert(
      fc.property(validSeverityArb, baseTextArb, baseTextArb, baseTextArb, baseTextArb,
        (severity, dateTime, location, description, affectedPersons) => {
          const report = { dateTime, location, severity, description, affectedPersons };
          assert.strictEqual(
            registry.isValidReport(formDef, report),
            true,
            `Expected isValidReport to return true for severity="${severity}"`
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
