// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

module.exports = {
  id: 'SALUTE',
  name: 'SALUTE Report',
  command: '/salute',
  detectionHint: 'A SALUTE report for enemy observation. Keywords: salute, enemy, ' +
    'observed, activity, hostile, contact, patrol, movement, troops, vehicles.',
  fields: [
    { key: 'size',      label: 'S - Size',      type: 'text' },
    { key: 'activity',  label: 'A - Activity',  type: 'text' },
    { key: 'location',  label: 'L - Location',  type: 'text' },
    { key: 'unit',      label: 'U - Unit',      type: 'text' },
    { key: 'time',      label: 'T - Time',      type: 'text' },
    { key: 'equipment', label: 'E - Equipment', type: 'text' },
  ],
  extractionPrompt: `You are a military intelligence extraction specialist. Your task is to extract SALUTE report information from text.

SALUTE is a standard enemy observation report format used by the military. Extract the following six fields from the provided text and return ONLY a valid JSON object with exactly these six keys:

- size: How many enemy personnel or vehicles were observed (e.g., "3 dismounted infantry", "2 vehicles", "squad-sized element"). Free text.
- activity: What the enemy is doing (e.g., "moving east along MSR Tampa", "setting up checkpoint", "digging fighting positions"). Free text.
- location: Where the enemy was observed. Grid coordinates preferred (e.g., "AB 1234 5678"), but any location description is acceptable. Free text.
- unit: Enemy unit identification if known (e.g., "unknown unit", "possible 3rd Brigade", "wearing tan uniforms with no insignia"). Free text.
- time: When the observation occurred (e.g., "0630Z", "10 minutes ago", "approximately 1400 local"). Free text.
- equipment: What equipment the enemy has (e.g., "2 technicals with mounted MGs", "small arms only", "RPGs and AK-47s"). Free text.

Rules:
1. If a field cannot be determined from the text, set it to null.
2. All six fields are free text -- there are no restricted values.
3. Return ONLY a raw JSON object. No markdown, no explanation, no code blocks.
4. Do not invent information. Only extract what is explicitly stated or clearly implied.
5. Example response: {"size":"4 dismounted personnel","activity":"moving north along ridgeline","location":"AB 1234 5678","unit":"unknown","time":"0630Z","equipment":"small arms, 1 RPG"}`,

  correctionPrompt: `You are a military report correction specialist. You will receive two inputs:
1. CURRENT FIELDS: A JSON object with the current SALUTE report fields.
2. CORRECTION: A free-form text message from the user describing which fields to change.

Your task: Identify which fields the user wants to correct and return ONLY those fields with their new values.

SALUTE field names:
- size: S - How many enemy (free text)
- activity: A - What the enemy is doing (free text)
- location: L - Where observed (free text)
- unit: U - Enemy unit identification (free text)
- time: T - When observed (free text)
- equipment: E - What equipment (free text)

Rules:
1. Return ONLY a JSON object containing the corrected fields. Do NOT include unchanged fields.
2. The user may refer to fields by their SALUTE letter (e.g., "S is 5 troops", "L is grid XY 4567").
3. The user may refer to fields by name (e.g., "size", "location", "activity").
4. Return ONLY raw JSON. No markdown, no explanation, no code blocks.
5. If you cannot determine which field the user wants to correct, return an empty object: {}

Example: If the user says "location is grid XY 9876 5432":
{"location":"XY 9876 5432"}

Example: If the user says "S is 6 troops and they have RPGs":
{"size":"6 troops","equipment":"RPGs"}`,
  formatHeader: '=== SALUTE REPORT ===',
  formatFooter: '=====================',
  exampleInput: 'Observed 4 dismounted personnel moving north along the ridgeline at grid AB 1234 5678. Unknown unit, small arms and 1 RPG. Time of observation 0630Z.',
  outputs: [
    { type: 'wickr-room', kvKey: 'SALUTE_ROOM_VGROUPID', envVar: 'SALUTE_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'salute-reports/' },
    { type: 'webhook', kvKey: 'SALUTE_WEBHOOK_URL', envVar: 'SALUTE_WEBHOOK_URL' },
  ],
};
