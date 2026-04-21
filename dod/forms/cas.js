// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

module.exports = {
  id: 'CAS',
  name: '9-Line CAS Brief',
  command: '/cas',
  detectionHint: 'A 9-Line Close Air Support brief. Keywords: CAS, close air support, ' +
    'JTAC, airstrike, target, IP, egress, ordnance, fire mission, bombing.',
  fields: [
    { key: 'jtac',              label: 'JTAC',                       type: 'text' },
    { key: 'controlType',       label: 'Control Type',               type: 'text' },
    { key: 'ipBp',              label: 'Line 1 (IP/BP)',             type: 'text' },
    { key: 'heading',           label: 'Line 2 (Heading)',           type: 'text' },
    { key: 'distance',          label: 'Line 3 (Distance)',          type: 'text' },
    { key: 'targetElevation',   label: 'Line 4 (Target Elevation)',  type: 'text' },
    { key: 'targetDescription', label: 'Line 5 (Target Description)',type: 'text' },
    { key: 'targetLocation',    label: 'Line 6 (Target Location)',   type: 'text' },
    { key: 'typeMark',          label: 'Line 7 (Type Mark)',         type: 'text' },
    { key: 'friendlies',        label: 'Line 8 (Friendlies)',        type: 'text' },
    { key: 'egress',            label: 'Line 9 (Egress)',            type: 'text' },
    { key: 'remarks',           label: 'Remarks',                    type: 'text', optional: true },
    { key: 'laserToTargetLine', label: 'Laser-to-Target Line',       type: 'text', optional: true },
    { key: 'timeOnTarget',      label: 'TOT',                        type: 'text', optional: true },
    { key: 'timeToTarget',      label: 'TTT',                        type: 'text', optional: true },
  ],
  extractionPrompt: `You are a close air support extraction specialist. Your task is to extract 9-Line CAS (Close Air Support) brief information from text.

The 9-Line CAS brief is a standardized format used by JTACs (Joint Terminal Attack Controllers) to request close air support. Extract the following fields and return ONLY a valid JSON object with exactly these keys:

Pre-brief fields:
- jtac: JTAC callsign (e.g., "HAWG 01", "ROMAN 77"). Free text.
- controlType: Type of terminal attack control. Usually "Type 1", "Type 2", or "Type 3". Free text.

Core 9 lines:
- ipBp: Line 1 - Initial Point or Battle Position (e.g., "IP ALPHA", "BP 22"). Free text.
- heading: Line 2 - Heading from IP/BP to target in degrees (e.g., "270", "090 degrees"). Free text.
- distance: Line 3 - Distance from IP/BP to target (e.g., "5 km", "3.2 nautical miles", "8000 meters"). Free text.
- targetElevation: Line 4 - Target elevation in feet MSL (e.g., "1200 ft MSL", "3500"). Free text.
- targetDescription: Line 5 - Description of the target (e.g., "T-72 tank in tree line", "enemy mortar position"). Free text.
- targetLocation: Line 6 - Target grid coordinates (e.g., "AB 12345 67890", "38S LC 12345 67890"). Free text.
- typeMark: Line 7 - Type of mark and WP coordinates if applicable (e.g., "WP", "Laser 1688", "IR pointer", "None"). Free text.
- friendlies: Line 8 - Location of friendly forces relative to target (e.g., "South 300m", "West 1km in tree line"). Free text.
- egress: Line 9 - Egress direction or instructions (e.g., "Egress south", "Right pull", "West"). Free text.

Optional fields (set to null if not mentioned):
- remarks: Any additional remarks or restrictions. Free text or null.
- laserToTargetLine: Laser-to-target line in degrees. Free text or null.
- timeOnTarget: TOT - Time on Target (e.g., "0630Z", "on station"). Free text or null.
- timeToTarget: TTT - Time to Target (e.g., "30 seconds", "1 minute"). Free text or null.

Rules:
1. If a required field cannot be determined from the text, set it to null.
2. If an optional field is not mentioned, set it to null.
3. All fields are free text -- there are no restricted enum values.
4. Return ONLY a raw JSON object. No markdown, no explanation, no code blocks.
5. Do not invent information. Only extract what is explicitly stated or clearly implied.
6. Example response: {"jtac":"HAWG 01","controlType":"Type 1","ipBp":"IP ALPHA","heading":"270","distance":"5 km","targetElevation":"1200 ft MSL","targetDescription":"T-72 in tree line","targetLocation":"AB 12345 67890","typeMark":"Laser 1688","friendlies":"South 300m","egress":"Egress south","remarks":"Danger close","laserToTargetLine":"270","timeOnTarget":null,"timeToTarget":null}`,

  correctionPrompt: `You are a military report correction specialist. You will receive two inputs:
1. CURRENT FIELDS: A JSON object with the current 9-Line CAS brief fields.
2. CORRECTION: A free-form text message from the user describing which fields to change.

Your task: Identify which fields the user wants to correct and return ONLY those fields with their new values.

CAS 9-Line field names and line numbers:
- jtac: JTAC callsign (pre-brief)
- controlType: Control type (pre-brief)
- ipBp: Line 1 - IP/BP
- heading: Line 2 - Heading
- distance: Line 3 - Distance
- targetElevation: Line 4 - Target elevation
- targetDescription: Line 5 - Target description
- targetLocation: Line 6 - Target location
- typeMark: Line 7 - Type mark
- friendlies: Line 8 - Friendlies
- egress: Line 9 - Egress
- remarks: Remarks (optional)
- laserToTargetLine: Laser-to-target line (optional)
- timeOnTarget: TOT (optional)
- timeToTarget: TTT (optional)

Rules:
1. Return ONLY a JSON object containing the corrected fields. Do NOT include unchanged fields.
2. The user may refer to fields by line number (e.g., "line 6 is grid XY 4567").
3. The user may refer to fields by name (e.g., "target elevation", "egress", "JTAC").
4. Return ONLY raw JSON. No markdown, no explanation, no code blocks.
5. If you cannot determine which field the user wants to correct, return an empty object: {}

Example: If the user says "line 6 is grid AB 99999 11111":
{"targetLocation":"AB 99999 11111"}

Example: If the user says "change egress to north and add remarks danger close":
{"egress":"North","remarks":"Danger close"}`,
  formatHeader: '=== 9-LINE CAS BRIEF ===',
  formatFooter: '========================',
  exampleInput: 'CAS request: JTAC is REAPER 11, type 1 control. IP north, heading 180, offset left. Target is enemy fighting position at grid AB 1234 5678, elevation 450m. Mark with laser code 1688. Friendlies 300m south. Egress west. TOT on station.',
  outputs: [
    { type: 'wickr-room', kvKey: 'CAS_ROOM_VGROUPID', envVar: 'CAS_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'cas-reports/' },
    { type: 'webhook', kvKey: 'CAS_WEBHOOK_URL', envVar: 'CAS_WEBHOOK_URL' },
  ],
};
