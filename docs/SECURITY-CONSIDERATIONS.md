# Security Considerations

What this deployment does well, and what to address before treating it as production. The
gaps below are known and deliberate in a sample; they are listed so they are decisions
rather than surprises.


## Required external review

This solution processes sender identities, voice memos, and military operational report fields,
and its primary production topology references Army/DISA SCCA environments in AWS GovCloud.
Before production use, the owning team must obtain legal, privacy, records-management, and
security/compliance review for the intended data classification and impact level. That review
must decide retention, access, audit, incident-response, and approved-model requirements. The
controls below reduce risk but do not constitute FedRAMP, CMMC, DoD impact-level, Privacy Act,
or other regulatory certification.
## Already in place

- **Least-privilege task role.** AWS Secrets Manager scoped to a single secret ARN, Amazon Bedrock
  scoped to foundation-model and inference-profile ARNs, S3 scoped to the reports bucket.
  Amazon Transcribe `StartTranscriptionJob` has no resource type, so it uses `*` with a
  `transcribe:OutputBucketName` condition limiting output to the reports bucket;
  `GetTranscriptionJob` is scoped to transcription-job ARNs in the stack's account and Region.
- **Partition-correct IAM.** ARNs are built from `stack.partition` at synth time, so the
  same code is correct in GovCloud (`aws-us-gov`) and commercial (`aws`).
- **Egress-only networking.** The task security group has no inbound rules. In `imported`
  mode the task runs in private subnets with no public IP.
- **Encrypted, private reports bucket.** SSE-S3, versioning, `enforceSSL`, all public
  access blocked, retained on stack deletion. Transcription scratch prefixes expire after
  7 days.
- **Privacy-preserving logs.** Sender identities are hashed and a blocklist strips
  sensitive keys, so full message content and extracted field values are not logged. See
  `bot/services/logger.js`.
- **Human-in-the-loop.** No report is delivered without a user confirming the extracted
  fields, which bounds the impact of a bad extraction.

## Gaps to address before production

### Delivery configuration commands are not access controlled

**This is the most consequential one.** `/<form> set-webhook <url>`, `/<form> set-room`, and
`/set-rooms` can be run by any Wickr user who can message the bot. There is no sender
allowlist or admin check. A user could point a form's webhook at an endpoint they control
and receive every subsequent confirmed report of that type.

The URL is validated for shape only, not against an allowlist of approved destinations.

Remediation:

- Add a sender authorization check in `bot/services/message-router.js` and
  `bot/services/form-commands.js` before processing configuration commands. Back it with an
  allowlist -- a DynamoDB table or an environment variable -- and fail closed.
- Separately, validate webhook URLs against approved domains or prefixes before storing.

Until then, treat every user who can message the bot as able to redirect its output.

### No rate limiting

A user can flood the bot with messages or large voice memos, consuming Bedrock and
Transcribe quota, degrading service for everyone, and increasing cost. Consider per-sender
message rate limits, a voice memo size cap, and service quotas sized to expected usage.

### Prompt injection

User text goes to Bedrock for classification and extraction, so adversarial input can
influence the model's output. Structured prompts constrain it to JSON with known keys, enum
validation rejects out-of-set values, and the confirmation step puts a human in front of
delivery. Residual risk is a misleading-but-plausible extraction that a user confirms
without reading. Monitoring for reports with many `[Not provided]` fields is a cheap signal.

### Validate the container privilege boundary

`WickrIOSvr` must remain root so it can start and manage the `wickrio_bot` daemon. The
entrypoint now changes ownership of the extracted integration directory and launches only
`node bot.js` through `su-exec wickriouser`. The same `start_node` function is used for the
initial launch and monitor-loop restarts, so the JavaScript process does not regain root.

Validate this boundary against every new pinned base-image digest before production:

```bash
ps -eo user,pid,comm,args | grep -E 'WickrIOSvr|wickrio_bot|node bot.js'
```

Expect the Wickr daemon processes to run as root and `node bot.js` to run as `wickriouser`.
Also restart the Node process once and confirm it can still reach the ZeroMQ sockets and append
to `logs/log.output`. Keep `isDevelopmentEnv: false` in production so ECS Exec is unavailable.

### Credentials on the container filesystem

The entrypoint reads the secret and writes `clientConfig.json`, then clears the password
from the environment. That file remains on the container filesystem in plaintext for the
task's lifetime. Consider Secrets Manager rotation, and mounting the file on a `tmpfs`
volume so it never touches persistent storage.

### ECS Exec grants shell access

`isDevelopmentEnv: true` adds `ssmmessages:*` to the task role, allowing an interactive
shell into a running task. Useful while validating a deployment; it should be `false` in
production. A stack assertion test pins that those permissions are absent when the flag is
off.

## Operational notes

- **Bot credentials must be unique per deployment.** Two tasks authenticating as the same
  Wickr user fight over the session. The service is intentionally limited to one task
  deploying stop-then-start for this reason.
- **Moderator status is required** for the bot to receive room messages, which means adding
  the bot to a room is a privileged act: it can then read that room's traffic.
- **Reports contain operational content.** The bucket is retained on stack deletion by
  design, so decommissioning is a deliberate data-handling decision, not a side effect of
  `cdk destroy`.
- **Scope CloudWatch Logs read access.** Logs redact message content but retain metadata,
  correlation IDs, and form types. Enable CloudTrail for an API-level audit trail.
- **Pin the base image by digest.** The `Dockerfile` does this. Keeping it pinned, rather
  than tracking `:latest`, is what makes builds reproducible and prevents an upstream change
  from altering the runtime underneath you.


