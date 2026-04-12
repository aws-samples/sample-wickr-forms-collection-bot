// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

/**
 * Nine_Line_Request data model, Pretty Printer, and Parser
 *
 * Nine_Line_Request object shape:
 * {
 *   location:    string | null,  // Line 1: Grid coordinates
 *   callsign:    string | null,  // Line 2: Radio frequency / callsign
 *   precedence:  string | null,  // Line 3: URGENT | URGENT SURGICAL | PRIORITY | ROUTINE | CONVENIENCE
 *   equipment:   string | null,  // Line 4: NONE | HOIST | EXTRACTION EQUIPMENT | VENTILATOR
 *   patientType: string | null,  // Line 5: Number by type (LITTER / AMBULATORY)
 *   security:    string | null,  // Line 6: NO ENEMY TROOPS | POSSIBLE ENEMY | ENEMY IN AREA | ARMED ESCORT REQUIRED
 *   marking:     string | null,  // Line 7: PANELS | PYROTECHNIC | SMOKE <color> | NONE | OTHER
 *   nationality: string | null,  // Line 8: US MILITARY | US CIVILIAN | NON-US MILITARY | NON-US CIVILIAN | EPW
 *   nbc:         string | null   // Line 9: NUCLEAR | BIOLOGICAL | CHEMICAL | NONE
 * }
 */

// ---------------------------------------------------------------------------
// Enumerated value constants
// ---------------------------------------------------------------------------

const VALID_PRECEDENCE  = ['URGENT', 'URGENT SURGICAL', 'PRIORITY', 'ROUTINE', 'CONVENIENCE'];
const VALID_EQUIPMENT   = ['NONE', 'HOIST', 'EXTRACTION EQUIPMENT', 'VENTILATOR'];
const VALID_SECURITY    = ['NO ENEMY TROOPS', 'POSSIBLE ENEMY', 'ENEMY IN AREA', 'ARMED ESCORT REQUIRED'];
const VALID_NATIONALITY = ['US MILITARY', 'US CIVILIAN', 'NON-US MILITARY', 'NON-US CIVILIAN', 'EPW'];
const VALID_NBC         = ['NUCLEAR', 'BIOLOGICAL', 'CHEMICAL', 'NONE'];

const NOT_PROVIDED = '[Not provided]';

// ---------------------------------------------------------------------------
// Line labels (order matters — index 0 == Line 1)
// ---------------------------------------------------------------------------

const LINE_LABELS = [
  'Line 1 (Location)',
  'Line 2 (Callsign)',
  'Line 3 (Precedence)',
  'Line 4 (Equipment)',
  'Line 5 (# Patients by Type)',
  'Line 6 (Security)',
  'Line 7 (Marking)',
  'Line 8 (Nationality)',
  'Line 9 (NBC)',
];

// Mapping from line index (0-based) to Nine_Line_Request field name
const LINE_FIELDS = [
  'location',
  'callsign',
  'precedence',
  'equipment',
  'patientType',
  'security',
  'marking',
  'nationality',
  'nbc',
];

// The separator used between a label and its value in formatted output.
// Must be kept in sync between format() and parse().
const LABEL_SEP = ': ';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Nine_Line_Request object.
 * Any field not supplied (or explicitly undefined/null) is stored as null.
 *
 * @param {object} [fields]
 * @returns {object} Nine_Line_Request
 */
function createNineLine(fields) {
  const f = fields || {};
  return {
    location:    f.location    !== undefined ? f.location    : null,
    callsign:    f.callsign    !== undefined ? f.callsign    : null,
    precedence:  f.precedence  !== undefined ? f.precedence  : null,
    equipment:   f.equipment   !== undefined ? f.equipment   : null,
    patientType: f.patientType !== undefined ? f.patientType : null,
    security:    f.security    !== undefined ? f.security    : null,
    marking:     f.marking     !== undefined ? f.marking     : null,
    nationality: f.nationality !== undefined ? f.nationality : null,
    nbc:         f.nbc         !== undefined ? f.nbc         : null,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Returns true when all enumerated fields either are null/NOT_PROVIDED
 * or contain one of their valid enumerated values.
 *
 * @param {object} nineLine
 * @returns {boolean}
 */
function isValid(nineLine) {
  if (!nineLine || typeof nineLine !== 'object') return false;

  const checks = [
    { value: nineLine.precedence,  valid: VALID_PRECEDENCE  },
    { value: nineLine.equipment,   valid: VALID_EQUIPMENT   },
    { value: nineLine.security,    valid: VALID_SECURITY    },
    { value: nineLine.nationality, valid: VALID_NATIONALITY },
    { value: nineLine.nbc,         valid: VALID_NBC         },
  ];

  for (const { value, valid } of checks) {
    if (value === null || value === undefined || value === NOT_PROVIDED) continue;
    if (!valid.includes(value)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Pretty Printer
// ---------------------------------------------------------------------------

/**
 * Format a Nine_Line_Request into the standard labeled multi-line text block.
 *
 * Null (or undefined) field values are rendered as NOT_PROVIDED ("[Not provided]").
 *
 * @param {object} nineLine
 * @returns {string}
 */
function format(nineLine) {
  const lines = ['=== 9-LINE MEDEVAC REQUEST ==='];

  for (let i = 0; i < LINE_LABELS.length; i++) {
    const label = LINE_LABELS[i];
    const field = LINE_FIELDS[i];
    const value = (nineLine[field] !== null && nineLine[field] !== undefined)
      ? nineLine[field]
      : NOT_PROVIDED;
    lines.push(label + LABEL_SEP + value);
  }

  lines.push('==============================');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Broadcast formatter
// ---------------------------------------------------------------------------

/**
 * Format a Nine_Line_Request as a broadcast message that includes the
 * submitter's username and a timestamp above the nine lines.
 *
 * @param {object} nineLine
 * @param {string} senderUsername
 * @param {string} timestamp  – ISO-8601 string or any timestamp representation
 * @returns {string}
 */
function formatBroadcast(nineLine, senderUsername, timestamp) {
  const parts = [
    '=== 9-LINE MEDEVAC REQUEST ===',
    'Submitted by: ' + senderUsername,
    'Timestamp: ' + timestamp,
    '',
  ];

  for (let i = 0; i < LINE_LABELS.length; i++) {
    const label = LINE_LABELS[i];
    const field = LINE_FIELDS[i];
    const value = (nineLine[field] !== null && nineLine[field] !== undefined)
      ? nineLine[field]
      : NOT_PROVIDED;
    parts.push(label + LABEL_SEP + value);
  }

  parts.push('==============================');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a formatted 9-Line text block back into a Nine_Line_Request object.
 *
 * Each line is matched against the known labels using the fixed ": " separator
 * so that whitespace-only field values are preserved faithfully.
 *
 * Fields that are missing from the text, or whose value equals NOT_PROVIDED
 * ("[Not provided]"), are stored as null in the resulting object.
 *
 * @param {string} text
 * @returns {object} Nine_Line_Request
 */
function parse(text) {
  const result = createNineLine();

  if (!text || typeof text !== 'string') return result;

  const rawLines = text.split('\n');

  // Build a lookup: label string → field name
  // Pre-compute the prefix we expect on each formatted line: "Label: "
  for (const rawLine of rawLines) {
    for (let i = 0; i < LINE_LABELS.length; i++) {
      const prefix = LINE_LABELS[i] + LABEL_SEP;
      if (rawLine.startsWith(prefix)) {
        const value = rawLine.slice(prefix.length);
        const field = LINE_FIELDS[i];
        // Treat empty string or the NOT_PROVIDED sentinel as null
        result[field] = (value === '' || value === NOT_PROVIDED) ? null : value;
        break; // each line can only match one label
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
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
  LINE_FIELDS,
};
