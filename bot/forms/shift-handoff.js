// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

module.exports = {
  id: 'SHIFT_HANDOFF',
  name: 'Shift Handoff Report',
  command: '/handoff',

  detectionHint: 'A shift handoff report for patient status during shift changes. Keywords: ' +
    'handoff, handover, shift change, patient status, vitals, nurse report, rounds, bedside report.',

  fields: [
    { key: 'patientId',    label: 'Patient ID / Room',   type: 'text' },
    { key: 'dtg',          label: 'Date / Time',          type: 'text' },
    { key: 'reporter',     label: 'Outgoing Staff',       type: 'text' },
    { key: 'vitals',       label: 'Vital Signs Summary',  type: 'text' },
    { key: 'status',       label: 'Current Status',       type: 'enum',
      validValues: ['STABLE', 'GUARDED', 'SERIOUS', 'CRITICAL'] },
    { key: 'observations', label: 'Recent Changes / Observations', type: 'text' },
    { key: 'notes',        label: 'Additional Notes',     type: 'text', optional: true },
  ],

  extractionPrompt: `You are a shift handoff extraction specialist. Extract patient shift handoff
fields from the text.

Return ONLY a valid JSON object with these keys:
- patientId: Patient identifier or room number (e.g., "Bed 12A", "Patient #4821"). Free text.
- dtg: Date and time of the handoff (e.g., "2026-04-15 07:00", "0700 on Apr 15"). Free text.
- reporter: Name or ID of the outgoing staff member (e.g., "RN Smith", "Jordan Chen"). Free text.
- vitals: Current vital signs summary (e.g., "BP 120/80, HR 72, Temp 98.6, SpO2 97%"). Free text.
- status: Must be exactly one of: STABLE, GUARDED, SERIOUS, CRITICAL
- observations: Recent changes, trends, or noteworthy observations. Free text.
- notes: Additional context or reminders for the incoming shift. Free text or null.

Rules:
1. If a field cannot be determined from the text, set it to null.
2. For status, use ONLY the exact values listed. If unclear, set to null.
3. Return ONLY a raw JSON object. No markdown, no explanation, no code blocks.
4. Do not invent information. Only extract what is explicitly stated or clearly implied.
5. Example response: {"patientId":"Bed 12A","dtg":"2026-04-15 07:00","reporter":"RN Smith","vitals":"BP 120/80, HR 72","status":"STABLE","observations":"Responded well to morning medication","notes":null}`,

  correctionPrompt: `You are a shift handoff correction specialist. You will receive two inputs:

1. CURRENT FIELDS: A JSON object with the current shift handoff fields.
2. CORRECTION: A free-form text message from the user describing which fields to change.

Your task: Identify which fields the user wants to correct and return ONLY those fields with
their new values.

Field names: patientId, dtg, reporter, vitals, status, observations, notes.

For status, use ONLY: STABLE, GUARDED, SERIOUS, CRITICAL.

Rules:
1. Return ONLY a JSON object containing the corrected fields. Do NOT include unchanged fields.
2. Return ONLY raw JSON. No markdown, no explanation, no code blocks.
3. If the correction is unclear, return an empty object: {}.

Example: If the user says "status is guarded and vitals are BP 135/90":
{"status":"GUARDED","vitals":"BP 135/90"}`,

  formatHeader: '=== SHIFT HANDOFF REPORT ===',
  formatFooter: '============================',
  exampleInput: 'Handoff for Bed 12A at 0700 on Apr 15. RN Smith out. BP 120/80, HR 72, Temp 98.6, ' +
    'SpO2 97%. Status stable. Patient responded well to morning medication. Monitor fluid intake.',

  outputs: [
    { type: 'wickr-room', kvKey: 'SHIFT_HANDOFF_ROOM_VGROUPID', envVar: 'SHIFT_HANDOFF_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'shift-handoff-reports/' },
    { type: 'webhook', kvKey: 'SHIFT_HANDOFF_WEBHOOK_URL', envVar: 'SHIFT_HANDOFF_WEBHOOK_URL' },
  ],
};
