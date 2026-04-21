# Form Collection Bot for AWS Wickr - Threat Model

## Introduction

### Purpose

This threat model documents the security analysis of the Form Collection Bot for AWS Wickr, an open-source sample/pattern published to AWS Samples (APG). The bot collects structured military reports from free-form text or voice memos using Amazon Bedrock for natural language processing. It is intended as an educational proof-of-concept demonstrating the integration of AWS Wickr IO, Amazon Bedrock, Amazon Transcribe, and Amazon S3 for conversational data collection in secure messaging environments.

This document identifies threats to the solution, evaluates their risk, and documents mitigations -- both those implemented in the sample code and those recommended for production deployment.

### Project/Asset Overview

The Form Collection Bot is a Node.js 20 application that runs inside an AWS Wickr IO container on Amazon ECS Fargate. Users send free-form text messages or voice memos via the AWS Wickr client. The bot classifies the report type (SALUTE, 9-Line MEDEVAC, 9-Line CAS, PERSTAT, Incident Report, Flight Movement, Ground Movement) using Amazon Bedrock, extracts structured fields, presents a confirmation card, and delivers confirmed reports to a Wickr room, Amazon S3, and/or an external webhook endpoint.

Major components:
- AWS Wickr IO container (WickrIOSvr + Node.js bot application) on ECS Fargate
- Amazon Bedrock (Claude Sonnet) for report classification and field extraction
- Amazon Transcribe for voice memo transcription (batch and streaming modes)
- Amazon S3 for confirmed report storage (JSON) and temporary Transcribe staging
- AWS Secrets Manager for bot credential storage
- Amazon VPC with private subnets (no public IP on the container), NAT Gateway for outbound
- Amazon CloudWatch Logs for structured application logging
- Amazon ECR for container image storage

Third-party dependencies: `wickrio-bot-api` (Wickr IO Node.js framework), `wickrio_addon` (native ZeroMQ addon), AWS SDK v3 clients (`@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-s3`, `@aws-sdk/client-transcribe-streaming`).

Infrastructure is deployed via AWS CDK v2. The CDK stack creates the VPC, ECS cluster, Fargate service, S3 bucket, IAM roles, and CloudWatch log group.

### Assumptions

| ID | Assumption | Comments |
|----|-----------|----------|
| A-01 | The sample asset will be deployed into a non-production environment for educational and proof-of-concept purposes only. | Deployers accept residual risk of sample-grade security controls. |
| A-02 | Amazon Bedrock model invocations are not logged or stored by AWS beyond standard CloudTrail API call logging. Input/output data is not used for model training. | Per Amazon Bedrock data privacy policy. Sensitive report content sent for classification/extraction is not persisted by the service. |
| A-03 | The deployer is responsible for enabling VPC Flow Logs and S3 access logging based on their organization's requirements. | cdk-nag suppressions document these as deployment-time decisions. |
| A-04 | All AWS API calls (Bedrock, S3, Transcribe, Secrets Manager) use TLS 1.2+ via AWS SDK v3 default configuration. | No additional TLS configuration required in bot code. |
| A-05 | Bot credentials are stored in AWS Secrets Manager with access scoped to the ECS task role via IAM policy. | Credential rotation supported via Secrets Manager. CDK grants secretsmanager:GetSecretValue scoped to the specific credentials ARN. |
| A-06 | The ECS Fargate task role provides least-privilege IAM permissions via temporary credentials from the container credential provider. | No long-term credentials used. Blast radius limited to granted permissions. |
| A-07 | All communication between the Wickr client and WickrIOSvr is end-to-end encrypted using the Wickr protocol (256-bit AES, ECDH key exchange). | Platform-level control managed by AWS Wickr, not by this sample code. |

### References

- Code Repo: [github.com/aws-samples/form-collection-bot-deliverable-apg](https://github.com/aws-samples/form-collection-bot-deliverable-apg)
- Project Team: petlaugh
- CSR Link: TBD
- SFDC Opportunity Link: N/A
- Threat Composer Export: `.threatmodel/form-collection-bot-threat-model.json`

---

## Solution Architecture

### Architecture Diagram

```
                                    +-----------------------+
                                    |   AWS Wickr Network   |
                                    |  (E2E Encrypted Msgs) |
                                    +----------+------------+
                                               |
                                               | Wickr Protocol (E2E encrypted)
                                               |
+----------------------------------------------+-----------------------------------------------+
|  Amazon VPC (Private Subnets, No Public IP)                                                  |
|                                                                                              |
|  +-----------------------------------------------------------------------------------------+ |
|  |  ECS Fargate Task (1024 CPU / 2048 MiB)                                                 | |
|  |  Security Group: Egress-only TCP 443, UDP 16384-16584                                   | |
|  |                                                                                         | |
|  |  +---------------------+     ZeroMQ IPC     +----------------------------------------+ | |
|  |  |   WickrIOSvr        |<------------------->|  Node.js Bot Application (bot.js)      | | |
|  |  |   (wickrio_bot)      |                    |                                        | | |
|  |  +---------------------+                    |  +-- form-detector.js ----+             | | |
|  |                                              |  |                       |             | | |
|  |                                              |  +-- extraction-engine --+---> [1] Amazon Bedrock
|  |                                              |  |                       |     (Claude Sonnet)
|  |                                              |  +-- transcription-svc --+---> [2] Amazon Transcribe
|  |                                              |  |                       |
|  |                                              |  +-- delivery-service ---+---> [3] Amazon S3
|  |                                              |  |                       |     (Reports Bucket)
|  |                                              |  +-- form-registry ------+
|  |                                              |  |                       |---> [4] Wickr Room
|  |                                              |  +-- message-router -----+     (Broadcast)
|  |                                              |                          |
|  |                                              |                          +---> [5] Webhook
|  |                                              +----------------------------------------+ | |
|  +-----------------------------------------------------------------------------------------+ |
|                                                                                              |
+----------------------------------------------------------------------------------------------+
         |                    |                    |
         | [A] HTTPS          | [B] HTTPS          | [C] HTTPS
         v                    v                    v
+----------------+  +------------------+  +-------------------+
| AWS Secrets    |  | Amazon CloudWatch|  | Amazon ECR        |
| Manager        |  | Logs             |  | (Container Image) |
+----------------+  +------------------+  +-------------------+
```

**Data Flow:**

1. User sends a text message or voice memo via the Wickr client (E2E encrypted).
2. WickrIOSvr decrypts the message and passes it to the Node.js bot via ZeroMQ IPC.
3. The message router determines the handling path:
   - Text messages: form-detector classifies via Bedrock, extraction-engine extracts fields via Bedrock.
   - Voice memos: transcription-service converts audio to text via Transcribe, then follows the text path.
   - Slash commands: form-commands handles admin operations (set-room, set-webhook, help, status).
4. Extracted report is presented to the user as a confirmation card.
5. On user confirmation (YES), delivery-service sends the report to configured outputs:
   - Wickr room broadcast (via WickrIOSvr)
   - S3 JSON storage (date-partitioned, with sender/timestamp metadata)
   - External webhook (HTTPS POST with 10s timeout)

### Main Functionality / Use Cases

1. **Free-form text report submission**: User sends natural language text describing a military situation. Bot auto-detects the report type, extracts structured fields, and presents for confirmation.
2. **Voice memo report submission**: User sends an audio voice memo. Bot transcribes via Amazon Transcribe, then processes as text.
3. **Correction loop**: After extraction, user can send corrections in natural language. Bot re-extracts only the corrected fields and updates the pending report.
4. **Slash command direct submission**: User sends `/<form> <text>` to bypass auto-detection and submit directly to a specific form type.
5. **Admin configuration**: Room moderators configure delivery targets via `/<form> set-room` and `/<form> set-webhook <url>`.
6. **Multi-channel delivery**: Confirmed reports are delivered to all configured outputs (Wickr room, S3, webhook) simultaneously.

### Assets / Dependencies

| Asset Name | Asset Usage | Data Type | Comments |
|-----------|------------|-----------|----------|
| S3 Reports Bucket | Stores confirmed reports as JSON files | Confidential | SSE-S3 encryption, versioned, BlockPublicAccess, enforceSSL. Date-partitioned keys: `prefix/YYYY-MM-DD/uuid.json` |
| S3 Transcribe Staging | Temporary audio file storage for Transcribe batch mode | Confidential | Same bucket as reports. Files deleted after transcription completes. |
| Wickr Bot Credentials | Bot username and password for Wickr authentication | Restricted | Stored in AWS Secrets Manager. Retrieved at container startup, password cleared from env after use. |
| Wickr IO Key-Value Store | Per-form delivery configuration (room vGroupIDs, webhook URLs) | Internal | Persisted by WickrIOSvr on container filesystem. Survives bot restarts but not container replacement. |
| CloudWatch Log Group | Structured application logs with correlation IDs | Internal | 1-month retention. Privacy-preserving: logs message previews (80-100 chars), not full content. |
| ECR Container Image | Docker image containing bot application code | Internal | Built by CDK DockerImageAsset from bot/ directory. |
| Bedrock Model Access | InvokeModel API for Claude Sonnet | N/A (service) | Cross-region inference profiles. No data persistence by Bedrock. |
| Transcribe API Access | StartTranscriptionJob, GetTranscriptionJob, StartStreamTranscription | N/A (service) | Batch mode uses S3 staging; streaming mode uses WebSocket. |
| ECS Task Role | IAM role with least-privilege permissions | Restricted | Scoped to specific Secrets Manager ARN, S3 bucket, Bedrock models, and Transcribe. |
| clientConfig.json | Wickr bot credentials written at container startup | Restricted | Written by entrypoint script to `/usr/local/wickr/WickrIO/clientConfig.json`. Contains bot password in plaintext on container filesystem. |

---

## Threats & Mitigations

### Threat Actors

| Threat Actor # | Threat Actor Description |
|---------------|------------------------|
| TA1 | A threat actor from the internet with no authenticated access to the system |
| TA2 | A threat actor with valid Wickr user credentials who can message the bot |
| TA3 | A threat actor with development team permissions (access to code repo, CI/CD pipeline, ECR) |
| TA4 | A threat actor with AWS admin permissions (IAM, Secrets Manager, ECS) |
| TA5 | A threat actor with root credentials to the AWS account |

### Threat & Mitigation Detail

| Threat # | Priority | Threat | STRIDE | Affected Assets | Mitigations | Decision | Status/Notes |
|----------|----------|--------|--------|----------------|-------------|----------|-------------|
| T-001 | High | A threat actor from the internet (TA1) with network access between the bot and AWS service endpoints attempts to intercept or modify API calls to Bedrock, S3, or Transcribe in transit, leading to reduction in confidentiality or integrity of report data or AI model responses. | Tampering | Data-in-transit (AWS API calls) | M-004 | Mitigate | Implemented. AWS SDK v3 enforces TLS 1.2+. S3 enforceSSL enabled. |
| T-002 | Low | A threat actor (TA2) who is a valid Wickr user in the same network attempts to send messages to the bot impersonating another user to submit reports under a false identity, leading to reports attributed to wrong sender. | Spoofing | Report data, audit trail | M-011 | Avoid | Wickr E2E encryption and network-managed identity make spoofing infeasible without compromising the Wickr account itself. |
| T-003 | High | A threat actor (TA2) with access to the webhook delivery configuration attempts to configure a malicious webhook URL to exfiltrate confirmed report data to an attacker-controlled endpoint, leading to all confirmed reports for a form type being POSTed to the attacker's server. | Information Disclosure | Report data (all form types) | M-009 | Mitigate | Partially mitigated. Webhook URLs are set via slash commands accessible to any Wickr user who can message the bot. Deployers should restrict to admin users and validate URLs against an allowlist. |
| T-004 | Medium | A threat actor (TA2) who is a valid Wickr user able to message the bot attempts to craft adversarial input text to manipulate Bedrock model responses via prompt injection, leading to extraction of incorrect field values, misclassification, or unintended model output. | Tampering | Report data integrity | M-012, M-014 | Mitigate | Partially mitigated. Structured prompts constrain output format. Enum validation catches invalid values. Human-in-the-loop confirmation provides final check. Full prompt injection prevention is an open research problem. |
| T-005 | Medium | A threat actor (TA2) who is a valid Wickr user able to message the bot attempts to flood the bot with messages or large voice memos to exhaust Bedrock/Transcribe API quotas or container resources, leading to denial of service for legitimate users and increased AWS costs. | Denial of Service | Service availability, AWS costs | M-002 | Mitigate | Not implemented in sample. Deployers should add rate limiting at the Wickr network level or application level. |
| T-006 | Medium | A threat actor (TA2) with access to CloudWatch Logs or container stdout attempts to read sensitive military report content from application logs, leading to exposure of classified or sensitive report data. | Information Disclosure | Report data in logs | M-010 | Accept | Accepted. Bot logs message previews (80-100 chars) and metadata only, not full content or extracted fields. CloudWatch Logs access should be scoped via IAM. |
| T-007 | High | A threat actor (TA2) with access to the S3 reports bucket attempts to read confirmed military reports stored as JSON, leading to unauthorized access to structured military report data. | Information Disclosure | S3 report objects | M-015, M-008 | Mitigate | Implemented. S3 bucket has SSE-S3 encryption, BlockPublicAccess, enforceSSL. Access scoped to ECS task role only. Deployers should add bucket policy restricting access to specific IAM principals. |
| T-008 | Medium | A threat actor (TA2) with access to the S3 bucket used for Transcribe batch staging attempts to access audio files temporarily staged before cleanup, leading to exposure of voice memo audio containing sensitive report content. | Information Disclosure | Temporary audio files in S3 | M-007 | Mitigate | Implemented. Batch pipeline deletes audio after transcription. Streaming mode avoids S3 staging entirely. Window of exposure is the transcription duration (typically seconds to minutes). |
| T-009 | High | A threat actor (TA4) with access to the Wickr bot credentials in Secrets Manager attempts to impersonate the bot by extracting credentials and running a rogue bot instance, leading to ability to intercept all messages or send messages as the bot. | Spoofing | Bot identity, all message data | M-003, M-008 | Mitigate | Implemented. Credentials in Secrets Manager with scoped IAM access. Password cleared from env after startup. Deployers should enable Secrets Manager rotation and restrict GetSecretValue to the ECS task role only. |
| T-010 | High | A threat actor (TA3) with access to the ECR repository or Docker build pipeline attempts to inject malicious code into the container image or modify the base Wickr IO image reference, leading to compromised bot executing arbitrary code with ECS task role permissions. | Tampering | Container image, all bot functionality | M-005 | Mitigate | Partially mitigated. CDK builds deterministically from source. Base image from public ECR. Deployers should pin base image digest, enable ECR image scanning, and restrict ECR push permissions. |
| T-011 | Medium | A threat actor (TA3) with access to the ECS task environment or container filesystem attempts to read environment variables or clientConfig.json to obtain bot credentials or AWS configuration, leading to exposure of bot username, integration name, bucket name, and model ID. | Information Disclosure | Environment variables, clientConfig.json | M-003, M-013 | Mitigate | Partially mitigated. Password cleared from env vars after startup. clientConfig.json remains on container filesystem with bot password. ECS Exec disabled in production (isDevelopmentEnv=false). Fargate provides task-level isolation. |
| T-012 | High | A threat actor (TA3) with access to the ECS task or container attempts to exploit the container running as root to escalate privileges or access host resources, leading to container escape or access to ECS host metadata. | Elevation of Privilege | Container, ECS infrastructure | M-013 | Accept | WickrIOSvr requires root -- this is a platform constraint of the Wickr IO container architecture. Fargate provides VM-level isolation. Accepted exception documented in Dockerfile and Probe scan report. |
| T-013 | Medium | A threat actor (TA2) who is a valid Wickr user attempts to submit a report and later deny having submitted it, leading to inability to attribute report submissions for accountability. | Repudiation | Audit trail | M-006 | Mitigate | Implemented. S3 reports include sender identity and timestamp. CloudWatch logs include correlation IDs. Deployers should enable CloudTrail for API-level audit trail. |

---

## APPENDIX A - APIs

This solution does not expose any public or private REST/HTTP APIs. All interaction occurs through the AWS Wickr messaging protocol. The bot responds to the following Wickr message-based commands:

| Command | Method | Mutating | Functionality | Callable from Internet | Authorized Callers | Comments |
|---------|--------|----------|--------------|----------------------|-------------------|----------|
| Free-form text | Wickr message | Non-Mutating (until confirmation) | Auto-detect report type, extract fields, present confirmation | No (Wickr E2E only) | Any Wickr user who can message the bot | Requires YES confirmation to deliver |
| Voice memo | Wickr file message | Non-Mutating (until confirmation) | Transcribe audio, then process as text | No (Wickr E2E only) | Any Wickr user who can message the bot | Audio transcribed via Transcribe |
| `/<form> <text>` | Wickr message | Non-Mutating (until confirmation) | Direct submission to specific form type | No | Any Wickr user | Bypasses auto-detection |
| `/<form> set-room` | Wickr message | Mutating | Configure Wickr room delivery target | No | Any Wickr user in the target room | Stores room vGroupID in KV store |
| `/<form> set-webhook <url>` | Wickr message | Mutating | Configure webhook delivery URL | No | Any Wickr user | Stores URL in KV store. No URL validation. |
| `/<form> status` | Wickr message | Non-Mutating | Show delivery configuration | No | Any Wickr user | Displays configured room and webhook |
| `/help` | Wickr message | Non-Mutating | List available commands and form types | No | Any Wickr user | |
| `YES` / `NO` | Wickr message | Mutating (YES) | Confirm or cancel pending report | No | The user who submitted the report | YES triggers delivery to all configured outputs |

---

## APPENDIX B - Mitigations

| Mitigation # | Mitigation Description | Threats Mitigating | Status | Comments |
|-------------|----------------------|-------------------|--------|----------|
| M-001 | ECS Fargate task deployed in private subnet with no public IP. Security group allows egress-only: TCP 443 (HTTPS for Wickr messaging and AWS APIs) and UDP 16384-16584 (Wickr calling and media). No inbound rules. | T-001 | Implemented | CDK construct: `allowAllOutbound: false` with explicit egress rules. |
| M-002 | Deployers should implement rate limiting at the Wickr network level or add application-level throttling per sender. | T-005 | Recommended | Not implemented in sample. Production deployments should add per-user message rate limits and voice memo size limits. |
| M-003 | Bot credentials stored in AWS Secrets Manager. Entrypoint script retrieves credentials at startup, writes clientConfig.json, then immediately unsets password from environment variables (`unset WICKR_BOT_PASSWORD`, `unset BOT_PASSWORD`). | T-009, T-011 | Implemented | Password remains in clientConfig.json on container filesystem. Deployers should consider encrypting the file or using a tmpfs mount. |
| M-004 | All AWS API calls (Bedrock, S3, Transcribe, Secrets Manager) use TLS 1.2+ encryption in transit via AWS SDK v3 defaults. S3 bucket enforces SSL (`enforceSSL: true` in CDK). | T-001 | Implemented | AWS SDK v3 enforces TLS 1.2 minimum for all service endpoints. |
| M-005 | Docker image built from CDK DockerImageAsset (deterministic build from source). Base image pinned to `public.ecr.aws/x3s2s6k3/wickrio/bot-cloud:latest`. Node.js version pinned via Dockerfile ARG (`NODE_VERSION=20.20.1`). | T-010 | Implemented | Deployers should pin base image digest (not `:latest` tag) and enable ECR image scanning for production. |
| M-006 | S3 report objects include sender identity, timestamp, correlation ID, and form type in the JSON payload. CloudWatch logs include correlation IDs linking message receipt to extraction to delivery. | T-013 | Implemented | Provides audit trail for report attribution. Deployers should enable CloudTrail for API-level auditing. |
| M-007 | Transcribe batch pipeline deletes temporary audio files from S3 after transcription completes (`deleteS3Object` call in `batchPipeline`). Streaming mode does not stage files in S3 at all. | T-008 | Implemented | Window of exposure is the transcription duration. Deployers can use streaming mode exclusively to eliminate S3 staging. |
| M-008 | ECS task role follows least-privilege: Bedrock `InvokeModel` scoped to `foundation-model/*` and `inference-profile/*` ARNs, Secrets Manager `GetSecretValue` scoped to specific credentials ARN, S3 `PutObject/GetObject/DeleteObject` scoped to reports bucket, Transcribe actions on `Resource: *` (service limitation). | T-007, T-009 | Implemented | Transcribe does not support resource-level permissions. cdk-nag suppression documents this. |
| M-009 | Deployers should restrict webhook URL configuration to admin users only and validate webhook URLs against an allowlist of approved endpoints. | T-003 | Recommended | Not implemented in sample. The `/<form> set-webhook` command is accessible to any Wickr user who can message the bot. Production deployments should add authorization checks. |
| M-010 | Privacy-preserving logging: bot logs message previews (first 80-100 chars) and metadata (correlation IDs, timing, form types) but does not log full message content or extracted report fields. CloudWatch log group has 1-month retention. | T-006 | Implemented | Deployers should scope CloudWatch Logs read access via IAM policies. |
| M-011 | Wickr E2E encryption (256-bit AES, ECDH key exchange) protects all messages between users and the bot in transit. Identity is managed by the Wickr network -- users authenticate to Wickr, and the bot trusts the sender identity provided by WickrIOSvr. | T-002 | Implemented | Platform-level control. Spoofing requires compromising the Wickr account itself. |
| M-012 | Bedrock prompts use structured system prompts with explicit output format constraints ("Return ONLY raw JSON. No markdown, no explanation."). Extraction engine validates enum fields against allowed values and normalizes text fields. Invalid enum values are set to null rather than accepted. | T-004 | Implemented | Reduces but does not eliminate prompt injection risk. Human-in-the-loop confirmation (M-014) provides additional defense. |
| M-013 | Container runs as root (required by WickrIOSvr -- platform constraint of the Wickr IO container architecture). Fargate provides VM-level isolation between tasks. ECS Exec is conditionally enabled only when `isDevelopmentEnv` is true in config.yaml. No published AWS Wickr bot sample supports non-root execution. | T-011, T-012 | Accepted Exception | Deployers must set `isDevelopmentEnv: false` for production. Root execution cannot be avoided without upstream changes to WickrIOSvr. Probe scan findings `last-user-is-root` and `missing-user` are accepted exceptions. |
| M-014 | Human-in-the-loop confirmation: all extracted reports require explicit user confirmation (`YES`) before delivery. Users can review extracted fields, send corrections, or cancel (`NO`). Missing required fields (especially enum fields like severity) block delivery with a specific error message listing the missing fields. | T-004 | Implemented | Prevents delivery of incorrectly extracted reports. Does not prevent the user from confirming a report with subtly wrong values. |
| M-015 | S3 reports bucket configured with SSE-S3 encryption at rest, versioning enabled, and `BlockPublicAccess.BLOCK_ALL`. Only the ECS task role has `PutObject/GetObject/DeleteObject` permissions scoped to the bucket ARN. | T-007 | Implemented | Deployers should consider KMS-CMK encryption for additional key management control and add a bucket policy restricting access to specific IAM principals. |


---

## APPENDIX C - Probe Scan Findings

Static analysis scan performed by Probe (semgrep + checkov) on 2026-04-12. Scan export: `ProbeScanExport-ca55d880-b74a-4474-ba05-0ab76d47ad5a-main-20260412.csv`.

### Critical / Error Findings

| # | Rule ID | File | Severity | Finding | Disposition |
|---|---------|------|----------|---------|-------------|
| PS-001 | `last-user-is-root` | bot/Dockerfile:44 | ERROR | The last user in the container is 'root'. | Accepted Exception. WickrIOSvr requires root to start and manage the wickrio_bot daemon. This is a platform constraint of the Wickr IO container -- no published AWS Wickr bot sample supports non-root execution. Fargate provides VM-level task isolation. The node bot.js application process drops to wickriouser at runtime via gosu. See T-012, M-013. |
| PS-002 | `missing-user` | bot/Dockerfile:41 | ERROR | By not specifying a USER, a program in the container may run as 'root'. | Accepted Exception. Same root cause as PS-001. USER root is explicitly set with a comment documenting the platform constraint. |
