// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

module.exports = {
  id: 'GROUND',
  name: 'Ground Movement Report',
  command: '/ground',
  detectionHint: 'A ground movement report for vehicle convoys and ground transportation. ' +
    'Keywords: ground movement, convoy, vehicle, van, bus, LMTV, HMMWV, SP, start point, ' +
    'ground transport, driving, road march.',
  fields: [
    { key: 'poc',         label: 'POC',            type: 'text' },
    { key: 'movement',    label: 'Movement',       type: 'text' },
    { key: 'dtg',         label: 'DTG',            type: 'text' },
    { key: 'departure',   label: 'Departure',      type: 'text' },
    { key: 'destination', label: 'Destination',     type: 'text' },
    { key: 'vehicle',     label: 'Vehicle',        type: 'text' },
    { key: 'pax',         label: 'PAX',            type: 'text' },
    { key: 'unit',        label: 'Unit',           type: 'text' },
    { key: 'notes',       label: 'Notes',          type: 'text', optional: true },
  ],
  extractionPrompt: `You are a military movement report extraction specialist. Your task is to extract Ground Movement Report information from text.

A Ground Movement Report tracks personnel ground transportation for convoys, SP movements, and vehicle transport. Extract the following fields and return ONLY a valid JSON object:

- poc: Point of Contact -- the responsible individual, optionally with phone number (e.g., "SFC N +86-010-1234-5678", "CPT Smith"). Free text.
- movement: Type of movement (e.g., "SP", "Convoy", "Redeployment", "Ground Transport"). SP means Start Point/departure. Free text.
- dtg: Date-Time Group in military format (e.g., "200825May2025", "151400JUN25"). Free text.
- departure: Departure location -- installation name, hotel, or address (e.g., "Marriott/Westin", "Camp Humphreys Gate 1"). Free text.
- destination: Destination location (e.g., "Camp A", "Osan AB", "FOB Liberty"). Free text.
- vehicle: Vehicle type and count (e.g., "VAN x 1", "LMTV x 2", "Bus x 1, HMMWV x 3"). Free text.
- pax: Number of passengers (e.g., "4", "12"). Free text.
- unit: Unit designation (e.g., "1MDTF", "3rd BCT", "1-25 IN"). Free text.
- notes: Additional personnel manifest, remarks, or special instructions. Include personnel names if listed. Free text or null if not mentioned.

Rules:
1. If a field cannot be determined from the text, set it to null.
2. All fields are free text -- there are no restricted values.
3. Return ONLY a raw JSON object. No markdown, no explanation, no code blocks.
4. Do not invent information. Only extract what is explicitly stated or clearly implied.
5. If personnel names are listed separately (e.g., a manifest), combine them into the notes field.
6. "SP" means Start Point -- it is a movement type, not a location.
7. Example response: {"poc":"SFC N +86-010-1234-5678","movement":"SP","dtg":"200825May2025","departure":"Marriott/Westin","destination":"Camp A","vehicle":"VAN x 1","pax":"4","unit":"1MDTF","notes":"MAJ Brian, SSG Jones, SSG Kim, SGT David"}`,

  correctionPrompt: `You are a military report correction specialist. You will receive two inputs:
1. CURRENT FIELDS: A JSON object with the current Ground Movement Report fields.
2. CORRECTION: A free-form text message from the user describing which fields to change.

Your task: Identify which fields the user wants to correct and return ONLY those fields with their new values.

Ground Movement Report field names:
- poc: Point of Contact with optional phone number (free text)
- movement: Movement type (free text)
- dtg: Date-Time Group (free text)
- departure: Departure location (free text)
- destination: Destination location (free text)
- vehicle: Vehicle type and count (free text)
- pax: Number of passengers (free text)
- unit: Unit designation (free text)
- notes: Personnel manifest or additional remarks (free text, optional)

Rules:
1. Return ONLY a JSON object containing the corrected fields. Do NOT include unchanged fields.
2. The user may refer to fields by number (e.g., "1" = poc, "6" = vehicle) or by name.
3. Return ONLY raw JSON. No markdown, no explanation, no code blocks.
4. If you cannot determine which field the user wants to correct, return an empty object: {}

Example: If the user says "destination is Camp B not Camp A":
{"destination":"Camp B"}

Example: If the user says "add SGT Park to the manifest and change PAX to 5":
{"pax":"5","notes":"MAJ Brian, SSG Jones, SSG Kim, SGT David, SGT Park"}`,
  formatHeader: '=== GROUND MOVEMENT REPORT ===',
  formatFooter: '==============================',
  exampleInput: 'Ground Movement Report: POC SFC N +86-010-1234-5678, SP, DTG 200825May2025, departing Marriott/Westin to Camp A, VAN x 1, 4 PAX, unit 1MDTF. Manifest: MAJ Brian, SSG Jones, SSG Kim, SGT David.',
  outputs: [
    { type: 'wickr-room', kvKey: 'GROUND_ROOM_VGROUPID', envVar: 'GROUND_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'ground-movement-reports/' },
    { type: 'webhook', kvKey: 'GROUND_WEBHOOK_URL', envVar: 'GROUND_WEBHOOK_URL' },
  ],
};
