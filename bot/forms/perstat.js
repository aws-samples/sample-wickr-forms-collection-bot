// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// PERSTAT (Personnel Status) Report -- RED 1
//
// This form definition was ported from the form-collection-bot's JSON-based
// PERSTAT form to demonstrate the plugin architecture. It serves as the
// canonical example for "How to Add a New Form Type" in the README.

module.exports = {
  id: 'PERSTAT',
  name: 'PERSTAT Report',
  command: '/perstat',

  detectionHint: 'A RED 1 Personnel Status report for unit accountability. Keywords: perstat, ' +
    'personnel status, strength, assigned, present for duty, leave, TDY, replacements, ' +
    'accountability, headcount, manning.',

  fields: [
    { key: 'company',        label: 'Company',            type: 'text' },
    { key: 'platoon',        label: 'Platoon',            type: 'text', optional: true },
    { key: 'location',       label: 'Location',          type: 'text' },
    { key: 'assigned',       label: 'Assigned',          type: 'text' },
    { key: 'presentForDuty', label: 'Present for Duty',  type: 'text' },
    { key: 'leavePass',      label: 'Leave/Pass',        type: 'text' },
    { key: 'tdy',            label: 'TDY',               type: 'text' },
    { key: 'replacements',   label: 'Replacements',      type: 'text', optional: true },
    { key: 'remarks',        label: 'Remarks',           type: 'text', optional: true },
  ],

  extractionPrompt: `You are a military personnel accountability extraction specialist. Your task is to extract RED 1 PERSTAT (Personnel Status) report information from text.

PERSTAT is a standard personnel accountability report used by the military to track unit strength. Extract the following fields from the provided text and return ONLY a valid JSON object with exactly these keys:

- company: The company name (e.g., "Alpha Company", "Bravo Company", "Charlie Company"). Use the full name form. Required.
- platoon: The platoon designation (e.g., "1st Platoon", "2nd Platoon", "Weapons Platoon"). Null if not mentioned.
- location: Where the unit is located. MGRS grid coordinates preferred (e.g., "11SNA 4523 6789"), but any location description is acceptable. Free text.
- assigned: Total number of personnel assigned to the unit (e.g., "32", "45"). Free text.
- presentForDuty: Number of personnel present for duty (e.g., "28", "30"). Free text.
- leavePass: Number of personnel on leave or pass (e.g., "2", "3"). Free text.
- tdy: Number of personnel on Temporary Duty (TDY) assignment (e.g., "1", "2"). Free text.
- replacements: Replacement personnel required, including MOS and grade if mentioned. Free text or null if not mentioned.
- remarks: Any additional notes about personnel status. Free text or null if not mentioned.

Rules:
1. If a field cannot be determined from the text, set it to null.
2. All fields are free text -- there are no restricted values.
3. Return ONLY a raw JSON object. No markdown, no explanation, no code blocks.
4. Do not invent information. Only extract what is explicitly stated or clearly implied.
5. "Alpha" or "A" or "A Co" all map to company="Alpha Company". Always use the full name form.
6. "Bravo" or "B" -> "Bravo Company", "Charlie" or "C" -> "Charlie Company", etc.
7. "1st PLT" or "first platoon" -> platoon="1st Platoon".
8. "Present" or "present for duty" or "PFD" all mean the presentForDuty field.
9. "Leave" or "pass" or "leave/pass" all mean the leavePass field.
10. "TDY" or "temporary duty" both mean the tdy field.
11. Example response: {"company":"Alpha Company","platoon":"1st Platoon","location":"11SNA 4523 6789","assigned":"32","presentForDuty":"28","leavePass":"2","tdy":"1","replacements":"2x 11B E-4","remarks":"1 soldier at aid station"}`,

  correctionPrompt: `You are a military report correction specialist. You will receive two inputs:
1. CURRENT FIELDS: A JSON object with the current PERSTAT report fields.
2. CORRECTION: A free-form text message from the user describing which fields to change.

Your task: Identify which fields the user wants to correct and return ONLY those fields with their new values.

PERSTAT field names:
- company: Company name (e.g., "Alpha Company")
- platoon: Platoon designation (e.g., "1st Platoon", optional)
- location: Unit location (free text)
- assigned: Personnel assigned count (free text)
- presentForDuty: Present for duty count (free text)
- leavePass: Leave/pass count (free text)
- tdy: TDY count (free text)
- replacements: Replacement requirements (free text, optional)
- remarks: Additional notes (free text, optional)

Rules:
1. Return ONLY a JSON object containing the corrected fields. Do NOT include unchanged fields.
2. The user may refer to fields by name (e.g., "assigned is 35", "change location to FOB Hammer").
3. The user may use abbreviations (e.g., "PFD is 30" means presentForDuty, "TDY is 2" means tdy).
4. Return ONLY raw JSON. No markdown, no explanation, no code blocks.
5. If you cannot determine which field the user wants to correct, return an empty object: {}

Example: If the user says "assigned is actually 35 and we have 2 on leave":
{"assigned":"35","leavePass":"2"}

Example: If the user says "location is grid 11SNA 4523 6789":
{"location":"11SNA 4523 6789"}`,

  formatHeader: '=== PERSTAT REPORT ===',
  formatFooter: '======================',
  exampleInput: 'Alpha Company, 1st Platoon at grid 11SNA 4523 6789. 32 assigned, 28 present for duty, 2 on leave, 1 TDY. Need 1 replacement 11B E-4.',

  outputs: [
    { type: 'wickr-room', kvKey: 'PERSTAT_ROOM_VGROUPID', envVar: 'PERSTAT_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'perstat-reports/' },
    { type: 'webhook', kvKey: 'PERSTAT_WEBHOOK_URL', envVar: 'PERSTAT_WEBHOOK_URL' },
  ],
};
