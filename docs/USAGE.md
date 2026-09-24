# Using the Bot

How to configure delivery targets after deploying, and the full command reference.

**Read this before assuming a deployment failed.** A freshly deployed bot classifies and
extracts correctly but delivers nowhere until you configure at least one delivery target.
The symptom is a confirmed report followed by `No room configured` and
`No webhook URL configured` in the logs. That is configuration, not a bug.

## Post-deploy configuration

Each report type has three independent delivery channels. Configure any combination.

### Amazon S3 (automatic)

Nothing to do. The CDK stack sets the `REPORTS_BUCKET` environment variable, so confirmed
reports are written as JSON to `<prefix>/<date>/<uuid>.json` in the reports bucket. Each
form uses its own prefix, for example `perstat-reports/`.

### Wickr room

Run this **from inside the room** you want reports delivered to, not from a direct message:

```
/perstat set-room
```

The bot stores the room's vGroupID in the Wickr IO key-value store, so it survives restarts
and redeployments. To point every form at the current room in one step:

```
/set-rooms
```

Or only specific forms:

```
/set-rooms PERSTAT MEDEVAC
```

### Webhook

From any conversation:

```
/perstat set-webhook https://your-endpoint.example.com/reports
```

The bot POSTs confirmed reports as JSON to that URL.

**These commands are not access controlled.** Any Wickr user who can message the bot can
repoint delivery. See [SECURITY-CONSIDERATIONS.md](SECURITY-CONSIDERATIONS.md).

### Verify

```
/status              # delivery configuration for every form
/perstat status      # one form
```

Channels with no configuration are skipped at delivery time and reported as a failure note
in the bot's reply.

## Submitting a report

Three ways, all equivalent in outcome:

1. **Free-form text.** Describe the situation in plain language. The bot classifies the
   report type, extracts fields, and shows a confirmation card.
2. **Voice memo.** Record and send it. Amazon Transcribe converts it to text, then the same
   classification and extraction runs.
3. **Explicit command.** `/perstat <text>` skips classification and goes straight to the
   named form.

The bot then shows the extracted fields and waits. Reply to confirm, cancel, or correct:

- Confirm to deliver to all configured channels.
- Cancel to discard.
- Send a correction in plain language -- for example `company is B Co not A Co` -- and the
  bot re-extracts the changed fields and shows the card again.

Fields it could not determine appear as `[Not provided]`. Required enum fields block
delivery until resolved, since a report with an unknown severity is worse than no report.

## Command reference

### Global

| Command | Effect |
|---|---|
| `/help` | List available commands and report types |
| `/status` | Show delivery configuration for all forms |
| `/set-rooms` | Set the current room as delivery target for all forms |
| `/set-rooms <ID> [<ID>...]` | Same, but only the listed form IDs |

`/set-rooms` must be run from inside a room, not a direct message.

### Report types

| Command | Form ID | Report |
|---|---|---|
| `/9line` | `MEDEVAC` | 9-Line MEDEVAC Request |
| `/cas` | `CAS` | 9-Line CAS Brief |
| `/salute` | `SALUTE` | SALUTE Report |
| `/perstat` | `PERSTAT` | PERSTAT Report |
| `/incident` | `INCIDENT` | Incident Report |
| `/flight` | `FLIGHT` | Flight Movement Report |
| `/ground` | `GROUND` | Ground Movement Report |

Note the MEDEVAC command is `/9line`, not `/medevac`.

### Per-form sub-commands

Every form supports the same four, substituting its own command prefix:

| Command | Effect |
|---|---|
| `/<form> help` | Fields, example input, and available sub-commands |
| `/<form> set-room` | Set the current room as this form's delivery target |
| `/<form> set-webhook <url>` | Set this form's webhook URL |
| `/<form> status` | Show this form's delivery configuration |

For example `/9line help` or `/cas set-webhook https://example.com/hook`.

## Confirming the bot is healthy

Startup logs, in order, in the stack's CloudWatch log group:

```
bot_starting                      botUsername, nodeVersion
isConnected: finally we are connected
registry_loaded                   formCount: 7
bot_ready
Bot message listener set successfully!
[start-bot] Entering monitor loop...
```

`formCount` should match the number of files in `bot/forms/`.

If the bot answers direct messages but ignores room messages, it is not a moderator in that
room. Wickr does not deliver room text messages to non-moderator bots, and nothing in the
logs indicates this -- the messages simply never arrive.
