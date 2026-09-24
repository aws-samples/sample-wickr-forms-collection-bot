// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const ninelineModel = require('../services/nineline-model');

module.exports = {
  id: 'MEDEVAC',
  name: '9-Line MEDEVAC Request',
  command: '/9line',
  detectionHint: 'A 9-Line MEDEVAC request for medical evacuation. Keywords: medevac, casualty, ' +
    'wounded, injured, litter, ambulatory, pickup zone, landing zone, patient, evacuation, medic.',
  fields: [
    { key: 'location',    label: 'Line 1 (Location)',            type: 'text' },
    { key: 'callsign',    label: 'Line 2 (Callsign)',            type: 'text' },
    { key: 'precedence',  label: 'Line 3 (Precedence)',          type: 'enum',
      validValues: ninelineModel.VALID_PRECEDENCE },
    { key: 'equipment',   label: 'Line 4 (Equipment)',           type: 'enum',
      validValues: ninelineModel.VALID_EQUIPMENT },
    { key: 'patientType', label: 'Line 5 (# Patients by Type)',  type: 'text' },
    { key: 'security',    label: 'Line 6 (Security)',            type: 'enum',
      validValues: ninelineModel.VALID_SECURITY },
    { key: 'marking',     label: 'Line 7 (Marking)',             type: 'text' },
    { key: 'nationality', label: 'Line 8 (Nationality)',         type: 'enum',
      validValues: ninelineModel.VALID_NATIONALITY },
    { key: 'nbc',         label: 'Line 9 (NBC)',                 type: 'enum',
      validValues: ninelineModel.VALID_NBC },
  ],
  extractionPrompt: `You are a military medical extraction specialist. Your task is to extract 9-line MEDEVAC request information from text.

Extract the following fields from the provided text and return ONLY a valid JSON object with exactly these nine fields:
- location: Grid coordinates or location description (free text)
- callsign: Radio frequency and callsign (free text)
- precedence: Must be exactly one of: URGENT, URGENT SURGICAL, PRIORITY, ROUTINE, CONVENIENCE
- equipment: Must be exactly one of: NONE, HOIST, EXTRACTION EQUIPMENT, VENTILATOR
- patientType: Number and type of patients (e.g., "2 LITTER, 1 AMBULATORY") (free text)
- security: Must be exactly one of: NO ENEMY TROOPS, POSSIBLE ENEMY, ENEMY IN AREA, ARMED ESCORT REQUIRED
- marking: How the pickup zone is marked (free text)
- nationality: Must be exactly one of: US MILITARY, US CIVILIAN, NON-US MILITARY, NON-US CIVILIAN, EPW
- nbc: Must be exactly one of: NUCLEAR, BIOLOGICAL, CHEMICAL, NONE

Rules:
1. If a field cannot be determined from the text, set it to null.
2. For enum fields, use ONLY the exact values listed above. If you cannot determine the value, set it to null.
3. Return ONLY a raw JSON object. No markdown, no explanation, no code blocks.
4. Example response: {"location":"AB 1234 5678","callsign":"DUSTOFF 7-2, freq 33.45","precedence":"URGENT","equipment":"NONE","patientType":"2 LITTER","security":"POSSIBLE ENEMY","marking":"SMOKE GREEN","nationality":"US MILITARY","nbc":"NONE"}`,

  correctionPrompt: `You are a military medical report correction specialist. You will receive two inputs:
1. CURRENT FIELDS: A JSON object with the current 9-Line MEDEVAC report fields.
2. CORRECTION: A free-form text message from the user describing which fields to change.

Your task: Identify which fields the user wants to correct and return ONLY those fields with their new values.

Field names and types:
- location: Grid coordinates or location description (free text)
- callsign: Radio frequency and callsign (free text)
- precedence: Must be exactly one of: URGENT, URGENT SURGICAL, PRIORITY, ROUTINE, CONVENIENCE
- equipment: Must be exactly one of: NONE, HOIST, EXTRACTION EQUIPMENT, VENTILATOR
- patientType: Number and type of patients (free text)
- security: Must be exactly one of: NO ENEMY TROOPS, POSSIBLE ENEMY, ENEMY IN AREA, ARMED ESCORT REQUIRED
- marking: How the pickup zone is marked (free text)
- nationality: Must be exactly one of: US MILITARY, US CIVILIAN, NON-US MILITARY, NON-US CIVILIAN, EPW
- nbc: Must be exactly one of: NUCLEAR, BIOLOGICAL, CHEMICAL, NONE

Rules:
1. Return ONLY a JSON object containing the corrected fields. Do NOT include unchanged fields.
2. For enum fields, use ONLY the exact values listed above.
3. The user may refer to fields by line number (e.g., "line 3" = precedence, "line 7" = marking).
4. The user may refer to fields by name (e.g., "location", "callsign", "NBC").
5. Return ONLY raw JSON. No markdown, no explanation, no code blocks.
6. If you cannot determine which field the user wants to correct, return an empty object: {}

Example: If the user says "line 1 is grid AB 9999 1234" and current location is "AB 1234 5678":
{"location":"AB 9999 1234"}

Example: If the user says "change precedence to routine and marking is smoke red":
{"precedence":"ROUTINE","marking":"SMOKE RED"}`,
  formatHeader: '=== 9-LINE MEDEVAC REQUEST ===',
  formatFooter: '==============================',
  exampleInput: 'MEDEVAC request: grid AB 1234 5678, callsign DUSTOFF 7-2 on freq 33.45. 2 litter urgent surgical. No enemy troops in area. Pickup marked with green smoke. US military, no NBC.',
  outputs: [
    {
      type: 'wickr-room',
      kvKey: 'MEDIC_ROOM_VGROUPID',
      envVar: 'MEDIC_ROOM_VGROUPID',
    },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'medevac-reports/' },
    { type: 'webhook', kvKey: 'MEDEVAC_WEBHOOK_URL', envVar: 'MEDEVAC_WEBHOOK_URL' },
  ],
  _formatOverride: (report) => ninelineModel.format(report),
  _parseOverride: (text) => ninelineModel.parse(text),
  _formatBroadcastOverride: (report, sender, ts) => ninelineModel.formatBroadcast(report, sender, ts),
};
