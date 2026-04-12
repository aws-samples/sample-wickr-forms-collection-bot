// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

module.exports = {
  id: 'INCIDENT',
  name: 'Incident Report',
  command: '/incident',
  detectionHint: 'An incident report for workplace or field incidents. Keywords: incident, ' +
    'accident, injury, hazard, safety, spill, damage, near-miss, report.',
  fields: [
    { key: 'dateTime',         label: 'Date/Time',         type: 'text' },
    { key: 'location',         label: 'Location',          type: 'text' },
    { key: 'severity',         label: 'Severity',          type: 'enum',
      validValues: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    { key: 'description',      label: 'Description',       type: 'text' },
    { key: 'affectedPersons',  label: 'Affected Persons',  type: 'text' },
  ],
  extractionPrompt: `You are an incident report extraction specialist. Extract incident report fields from the provided text and return ONLY a valid JSON object with exactly these five fields:

- dateTime: When the incident occurred (e.g., "2024-03-15 14:30", "yesterday at 2pm"). Free text.
- location: Where the incident occurred (e.g., "Building A, Floor 3", "Warehouse loading dock"). Free text.
- severity: Must be exactly one of: LOW, MEDIUM, HIGH, CRITICAL
- description: What happened. Free text.
- affectedPersons: Who was affected (e.g., "2 employees", "John from maintenance"). Free text.

Rules:
1. If a field cannot be determined from the text, set it to null.
2. For severity, use ONLY the exact values listed above. If unclear, set to null.
3. Return ONLY a raw JSON object. No markdown, no explanation, no code blocks.`,

  correctionPrompt: `You are an incident report correction specialist. You will receive:
1. CURRENT FIELDS: A JSON object with the current incident report fields.
2. CORRECTION: A free-form text message describing which fields to change.

Field names:
- dateTime: When the incident occurred (free text)
- location: Where it occurred (free text)
- severity: Must be one of: LOW, MEDIUM, HIGH, CRITICAL
- description: What happened (free text)
- affectedPersons: Who was affected (free text)

Rules:
1. Return ONLY a JSON object containing the corrected fields. Do NOT include unchanged fields.
2. Return ONLY raw JSON. No markdown, no explanation, no code blocks.
3. If you cannot determine which field to correct, return: {}`,

  formatHeader: '=== INCIDENT REPORT ===',
  formatFooter: '=======================',
  exampleInput: 'Chemical spill in Building A loading dock at 2pm today. Severity high. 3 employees affected, one with skin irritation.',
  outputs: [
    { type: 'wickr-room', kvKey: 'INCIDENT_ROOM_VGROUPID', envVar: 'INCIDENT_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'incident-reports/' },
    { type: 'webhook', kvKey: 'INCIDENT_WEBHOOK_URL', envVar: 'INCIDENT_WEBHOOK_URL' },
  ],
};
