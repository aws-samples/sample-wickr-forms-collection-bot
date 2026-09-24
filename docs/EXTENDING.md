# Adding a Report Type

Report types are declarative. Drop one JavaScript file into `bot/forms/` and the bot loads
it at startup. No changes to `bot.js`, the message router, the delivery service, or the
infrastructure.

The seven shipped forms in `bot/forms/` are working examples; copying the closest one is
usually faster than starting from this reference. `incident-report.js` is the simplest.

## What you get for free

Adding the file wires up all of this with no other code:

- Classification from free-form text, using your `detectionHint`
- Field extraction, using your `extractionPrompt`
- Voice memo transcription, then the same classification and extraction
- Confirmation card listing every field
- Correction loop, using your `correctionPrompt`
- `/<command>` for direct submission, plus `help`, `set-room`, `set-webhook`, `status`
  sub-commands
- Delivery to every configured channel on confirmation

## Schema

```javascript
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

module.exports = {
  // --- Identity ---
  id: 'DELIVERY_LOG',           // Unique, uppercase. Registry key and Bedrock
                                // classification target. Also the token accepted by
                                // /set-rooms.
  name: 'Delivery Log Entry',   // Human-readable, shown in cards and replies.
  command: '/delivery',         // Slash command. Enables /delivery, /delivery help, etc.
                                // Must not collide with another form or a global command.

  // --- Detection ---
  // Fed into the classification prompt. Name the report type, then 5-10 words a user
  // would plausibly say. Weak hints are the usual cause of misclassification.
  detectionHint: 'A delivery log entry for tracking incoming shipments. Keywords: ' +
    'delivery, shipment, package, received, tracking, courier, carrier, dock.',

  // --- Fields ---
  fields: [
    { key: 'dtg',        label: 'Date / Time', type: 'text' },
    { key: 'carrier',    label: 'Carrier',     type: 'text' },
    { key: 'condition',  label: 'Condition',   type: 'enum',
      validValues: ['INTACT', 'DAMAGED', 'OPENED'] },
    { key: 'notes',      label: 'Notes',       type: 'text', optional: true },
  ],
  // key:      JSON key in the delivered report. Unique within the form.
  // label:    Shown on the confirmation card.
  // type:     'text' for free-form, 'enum' for a restricted set.
  // enum:     validValues is required; extraction normalizes to exactly these.
  // optional: true means the field is not required. Missing values render as
  //           "[Not provided]". Required fields block delivery until resolved.

  // --- Prompts ---
  extractionPrompt: `...`,   // See guidance below.
  correctionPrompt: `...`,

  // --- Display ---
  formatHeader: '=== DELIVERY LOG ===',
  formatFooter: '====================',
  exampleInput: 'FedEx delivery at 2:30pm today for the receiving dock, arrived intact.',
  // exampleInput is shown by /<command> help. Use realistic phrasing. Do not put real
  // names, units, or locations here -- it ships in the repository.

  // --- Delivery ---
  outputs: [
    { type: 'wickr-room', kvKey: 'DELIVERY_ROOM_VGROUPID', envVar: 'DELIVERY_ROOM_VGROUPID' },
    { type: 's3',   bucketEnvVar: 'REPORTS_BUCKET', prefix: 'delivery-log-reports/' },
    { type: 'webhook', kvKey: 'DELIVERY_WEBHOOK_URL', envVar: 'DELIVERY_WEBHOOK_URL' },
  ],
};
```

### Output types

| type | Keys | Behavior |
|---|---|---|
| `wickr-room` | `kvKey`, `envVar` | Broadcasts the formatted report to a room. The vGroupID is stored in the Wickr IO key-value store by `/<form> set-room`. |
| `s3` | `bucketEnvVar`, `prefix` | Writes JSON to `<prefix><date>/<uuid>.json`. Bucket comes from the named environment variable, which the CDK stack sets to the reports bucket. |
| `webhook` | `kvKey`, `envVar` | POSTs JSON to a URL stored by `/<form> set-webhook`. |

`kvKey` must be unique per form per channel, or two forms will overwrite each other's
delivery configuration. Forms that intentionally share a destination can share a key: give
a family of related forms the same `kvKey` and one `set-room` configures them all.

Omit a channel entirely if the form should never use it.

## Writing the prompts

The extraction prompt does the real work. What matters, in rough order:

- List every JSON key explicitly with its type and a short description.
- For enum fields, list the exact allowed values and instruct the model to use `null` when
  unsure. Guessing an enum is worse than leaving it blank, because the confirmation card is
  the human check.
- End with an unambiguous output instruction: return only raw JSON, no markdown, no code
  fences, no explanation.
- State that undeterminable fields must be `null`.

The correction prompt receives the current fields plus the user's free-form correction. It
must return only the changed fields, and an empty object `{}` when the correction is
unintelligible, so the bot can ask again rather than corrupting good data.

Both prompts go to Amazon Bedrock through the Converse API, so any Converse-capable model
works. See `bot/services/model-config.js`.

## Testing a new form

```bash
cd bot
npm test
```

Then rebuild the image, deploy, and confirm the count in the startup log:

```
registry_loaded   formCount: 8
```

If your form does not appear, the file failed to load -- check for a syntax error or a
duplicate `id`. If it loads but never classifies, strengthen `detectionHint`; if it
classifies but extracts poorly, the extraction prompt needs work. Exercising it with
`/delivery <text>` bypasses classification, which separates the two failure modes.
