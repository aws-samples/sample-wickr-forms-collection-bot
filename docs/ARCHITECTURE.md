# Architecture

Editable diagram: `diagrams/architecture-v3.drawio` (open with draw.io / diagrams.net).

## System overview

```
Wickr client (user)
   |  end-to-end encrypted message / voice memo
   v
AWS Wickr service  <--TCP 443-->  ECS Fargate task (private subnet, egress-only SG)
                                    |-- WickrIOSvr (Wickr daemon, spawns wickrio_bot)
                                    |-- node bot.js (started by entrypoint; WPM is
                                    |   unreliable in -notty mode)
                                    |
                                    |--> Amazon Bedrock (Converse API): classify + extract
                                    |--> Amazon Transcribe (batch jobs): voice memos
                                    |--> Amazon S3: report delivery + transcription scratch
                                    |--> AWS Secrets Manager: bot credentials (at startup)
                                    '--> HTTPS webhook (optional per-form delivery)
```

## Message flow

1. `bot.js` receives a raw message, parses it, and hands it to
   `services/message-router.js` -- the single routing layer.
2. The router discards self-messages, sends audio files through
   `transcription-service.js`, dispatches registry commands (`/9line`, `/salute`, ...)
   to `form-commands.js`, handles global commands (`/help`, `/set-rooms`, `/status`),
   and treats everything else as report content.
3. `form-detector.js` classifies free text into a form ID with one Bedrock Converse
   call; `extraction-engine.js` extracts the form's fields with a second call, using
   the prompt embedded in the form definition.
4. The user sees a confirmation card. YES delivers, NO/CANCEL discards, anything else
   runs a correction loop (`extractCorrection`) that merges changed fields and
   re-presents the card. Pending state is per-user, in memory.
5. `delivery-service.js` fans out confirmed reports to each output declared by the
   form definition: Wickr room broadcast, S3 JSON object, and/or HTTPS webhook.

## Forms as data

Every report type is one file in `bot/forms/` declaring id, command, detection hint,
fields (with enum constraints), extraction/correction prompts, format header/footer,
and delivery outputs. `form-registry.js` discovers these at startup and provides
generic format/parse/validate/normalize. Adding a report type requires no service
changes. MEDEVAC overrides formatting via `nineline-model.js` for byte-exact backward
compatibility with the legacy 9-Line format (covered by `backward-compat.test.js`).

## Model access

`model-config.js` is the single Bedrock seam: `buildConverseInput` /
`parseConverseResponse` plus the tolerant `extractJson` (strips code fences, labels,
and trailing prose from model output). The Converse API gives a uniform
request/response shape across providers, so `BEDROCK_MODEL_ID` alone selects the model.
Reasoning models that emit `reasoningContent` blocks are handled by scanning for the
first text block.

## Container startup

The entrypoint (`start-bot.sh`) resolves the image's Node.js via nvm, fetches
credentials from Secrets Manager, writes `clientConfig.json`, starts
`WickrIOSvr -notty`, waits for the integration extraction, then starts `node bot.js`
directly -- WPM does not reliably launch the process headless. A monitor loop restarts
node if it dies and exits the container (for ECS restart) if WickrIOSvr dies.

## Network model

Two modes, set by `network.mode` in `config.yaml`.

### `imported` (production, Army/DISA SCCA) -- the default

The stack creates **no** network resources: no VPC, no internet gateway, no NAT gateway
(NAT gateways are not permitted in these environments). The VPC, the Transit Gateway
attachment, and all routing belong to the network team. Outbound traffic follows the
subnets' default route to the Transit Gateway and is inspected by the Virtual Datacenter
Security Stack (VDSS). Wickr's TCP 443 egress must be permitted through that path or the
bot cannot connect.

Subnets are supplied as explicit IDs and passed straight to the service
(`vpcSubnets: { subnets }`). Subnet *type* selection is deliberately unused:
`Vpc.fromLookup` classifies a subnet as `PRIVATE_WITH_EGRESS` only when it finds a NAT
gateway route, so a TGW-routed subnet is classified as isolated and a
`subnetType: PRIVATE_WITH_EGRESS` selector matches nothing -- failing at synth or deploy.

Optional VPC endpoints (`network.createVpcEndpoints: true`) keep AWS service traffic off
the inspection path: interface endpoints for Bedrock, Transcribe,
Secrets Manager, CloudWatch Logs, and ECR (api + dkr), reachable on 443 from the task
security group only. Set this to `false` when the environment already provides them.

S3 is intentionally not created by this stack. The right endpoint for S3 is a *gateway*
endpoint (free, AWS-recommended), but it works by adding route table entries, and the
route tables belong to the network team. Ask them to provision it; without it, S3 traffic
hairpins through the VDSS.

### `create-dev-vpc` (demo and development only)

Creates a VPC with public subnets and one NAT gateway. Invalid in an SCCA environment;
this is what the current AWS demo account deployment uses.

## Deployment topology (CDK)

- ECS Fargate service: 1 task (1 vCPU / 2 GB), private subnet, no public IP,
  stop-then-start deployments so two bot logins never overlap.
- IAM task role: Secrets Manager (one ARN), Bedrock (foundation-model +
  inference-profile in the current partition), S3 (reports bucket objects),
  Transcribe (start: `*` conditioned on the reports bucket as output; get: job ARNs). ECS Exec only in development mode.
- Logs: CloudWatch, 1-month retention, retained on stack deletion.
- Reports bucket: S3-managed encryption, SSL enforced, versioned, public access
  blocked, 7-day lifecycle on transcription scratch, retained on stack deletion
  (or import an existing bucket via `reportsBucketName`).

## AWS Well-Architected Framework alignment

This prototype uses the [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html) as a design checklist. It is not a completed Well-Architected Review.

- **Operational Excellence:** structured logs, health checks, immutable image tags, documented update and troubleshooting procedures, and explicit deployment modes support repeatable operations.
- **Security:** the task runs in private subnets by default with an inbound-free security group, least-privilege IAM permissions, credentials in AWS Secrets Manager, encrypted S3 storage, and a non-root Node.js integration process. The production gaps in `SECURITY-CONSIDERATIONS.md` must still be closed.
- **Reliability:** ECS restarts failed tasks, the entrypoint monitors both WickrIOSvr and the Node.js process, S3 versioning protects reports, and lifecycle rules clean up orphaned transcription artifacts. The single-task Wickr identity creates a deliberate 2-3 minute deployment outage.
- **Performance Efficiency:** one 1 vCPU and 2 GB Fargate task fits the expected bot workload; Amazon Bedrock and Amazon Transcribe scale as managed services. Validate model latency, quota, and transcription duration against the intended workload.
- **Cost Optimization:** deployment-time network choices control the largest fixed costs. `imported` mode creates no NAT gateway, while optional interface endpoints and the development NAT gateway add hourly charges. See `MAINTENANCE.md` for assumptions and estimates.
- **Sustainability:** the service runs one right-sized task, uses managed services instead of idle supporting compute, expires transcription scratch data after seven days, and bounds retained image and log data. Revisit task sizing after measuring production utilization.
