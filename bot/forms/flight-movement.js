// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

module.exports = {
  id: 'FLIGHT',
  name: 'Flight Movement Report',
  command: '/flight',
  detectionHint: 'A flight movement report for air travel and redeployment. Keywords: flight, ' +
    'movement, redeployment, departure, destination, airline, PAX, passengers, ETA, ' +
    'IATA, airport, connecting flight, air movement.',
  fields: [
    { key: 'poc',         label: 'POC',            type: 'text' },
    { key: 'movement',    label: 'Movement',       type: 'text' },
    { key: 'dtg',         label: 'DTG',            type: 'text' },
    { key: 'departure',   label: 'Departure',      type: 'text' },
    { key: 'destination', label: 'Destination',     type: 'text' },
    { key: 'air',         label: 'Air',            type: 'text' },
    { key: 'pax',         label: 'PAX',            type: 'text' },
    { key: 'unit',        label: 'Unit',           type: 'text' },
    { key: 'names',       label: 'Names',          type: 'text' },
    { key: 'nextFlight',  label: 'Next Flight',    type: 'text', optional: true },
  ],
  extractionPrompt: `You are a military movement report extraction specialist. Your task is to extract Flight Movement Report information from text.

A Flight Movement Report tracks personnel air travel for redeployment, TDY, leave, and other movements. Extract the following fields and return ONLY a valid JSON object:

- poc: Point of Contact -- the responsible individual (e.g., "SFC Johnson", "CPT Smith"). Free text.
- movement: Type of movement (e.g., "Redeployment", "SP", "TDY", "Leave", "Convoy"). Free text.
- dtg: Date-Time Group in military format DDHHMMMONYR (e.g., "172325OCT25", "200800MAY25"). Free text.
- departure: Departure location -- IATA airport code or installation name (e.g., "MNL", "Fort Liberty", "JFK"). Free text.
- destination: Destination location (e.g., "HND", "Camp Humphreys", "SEA"). Free text.
- air: Flight number, carrier, and ETA (e.g., "JL078 ETA 0440 on 18 Oct", "UA123 arriving 1530"). Free text.
- pax: Number of passengers (e.g., "2", "5"). Free text.
- unit: Unit designation (e.g., "1163d TFSB", "1MDTF", "3rd BCT"). Free text.
- names: Personnel on the movement (e.g., "SFC J & SGT C", "MAJ Smith, CPT Jones"). Free text.
- nextFlight: Connecting flight details if applicable (e.g., "1745 HND-SEA / JL068 / 1025 arrival"). Free text or null if not mentioned.

Rules:
1. If a field cannot be determined from the text, set it to null.
2. All fields are free text -- there are no restricted values.
3. Return ONLY a raw JSON object. No markdown, no explanation, no code blocks.
4. Do not invent information. Only extract what is explicitly stated or clearly implied.
5. Example response: {"poc":"SFC Johnson","movement":"Redeployment","dtg":"172325OCT25","departure":"MNL","destination":"HND","air":"JL078 ETA 0440 on 18 Oct","pax":"2","unit":"1163d TFSB","names":"SFC J & SGT C","nextFlight":"1745 HND-SEA / JL068 / 1025 arrival"}`,

  correctionPrompt: `You are a military report correction specialist. You will receive two inputs:
1. CURRENT FIELDS: A JSON object with the current Flight Movement Report fields.
2. CORRECTION: A free-form text message from the user describing which fields to change.

Your task: Identify which fields the user wants to correct and return ONLY those fields with their new values.

Flight Movement Report field names:
- poc: Point of Contact (free text)
- movement: Movement type (free text)
- dtg: Date-Time Group (free text)
- departure: Departure location (free text)
- destination: Destination location (free text)
- air: Flight number, carrier, ETA (free text)
- pax: Number of passengers (free text)
- unit: Unit designation (free text)
- names: Personnel names (free text)
- nextFlight: Connecting flight details (free text, optional)

Rules:
1. Return ONLY a JSON object containing the corrected fields. Do NOT include unchanged fields.
2. The user may refer to fields by number (e.g., "1" = poc, "6" = air) or by name.
3. Return ONLY raw JSON. No markdown, no explanation, no code blocks.
4. If you cannot determine which field the user wants to correct, return an empty object: {}

Example: If the user says "destination is SEA not HND":
{"destination":"SEA"}

Example: If the user says "PAX is 3 and add next flight 1745 HND-SEA JL068":
{"pax":"3","nextFlight":"1745 HND-SEA JL068"}`,
  formatHeader: '=== FLIGHT MOVEMENT REPORT ===',
  formatFooter: '==============================',
  exampleInput: 'Flight Movement Report: POC SFC Johnson, Redeployment, DTG 172325OCT25, departing MNL to HND, flight JL078 ETA 0440 on 18 Oct, 2 PAX, unit 1163d TFSB, names SFC J & SGT C. Next flight 1745 HND-SEA / JL068 / 1025 arrival.',
  outputs: [
    { type: 'wickr-room', kvKey: 'FLIGHT_ROOM_VGROUPID', envVar: 'FLIGHT_ROOM_VGROUPID' },
    { type: 's3', bucketEnvVar: 'REPORTS_BUCKET', prefix: 'flight-movement-reports/' },
    { type: 'webhook', kvKey: 'FLIGHT_WEBHOOK_URL', envVar: 'FLIGHT_WEBHOOK_URL' },
  ],
};
