# Wickr Forms Collection Bot

An AWS Wickr IO bot that collects structured military reports from free-form text or voice
memos. Amazon Bedrock classifies the report type and extracts fields via the Converse API,
the user confirms or corrects the result, and confirmed reports are delivered to a Wickr
room, Amazon S3, and/or an HTTPS webhook.

Seven report types ship with it: 9-Line MEDEVAC, 9-Line CAS, SALUTE, PERSTAT, incident
report, and flight and ground movement. Adding another is one file in `bot/forms/` -- see
[docs/EXTENDING.md](docs/EXTENDING.md).

Runs as a single ECS Fargate task. Defaults target AWS GovCloud (`us-gov-west-1`); the CDK
application resolves the IAM partition at synth time, so it deploys to commercial AWS too.

## Documentation

| Document | What it covers |
|---|---|
| [docs/PREREQUISITES.md](docs/PREREQUISITES.md) | Wickr bot account, Secrets Manager, Bedrock, CDK bootstrap, partition choice. **Start here** -- shared by every deployment path. |
| [docs/DEPLOY-CDK-CODEBUILD.md](docs/DEPLOY-CDK-CODEBUILD.md) | Deploy to ECS Fargate, image built in AWS CodeBuild. No local Docker; works from Windows. |
| [docs/DEPLOY-CDK-LOCAL-DOCKER.md](docs/DEPLOY-CDK-LOCAL-DOCKER.md) | Deploy to ECS Fargate, image built on your own machine. Requires Docker on Linux or macOS. |
| [docs/DEPLOY-EC2.md](docs/DEPLOY-EC2.md) | Deploy on EC2 with Docker and the interactive Wickr IO console. Development and quick iteration; no image build, no ECR. |
| [docs/USAGE.md](docs/USAGE.md) | Post-deploy configuration and the command reference. Read this after deploying -- a deployed bot delivers nowhere until configured. |
| [docs/EXTENDING.md](docs/EXTENDING.md) | Adding a report type: the form definition schema. |
| [docs/SECURITY-CONSIDERATIONS.md](docs/SECURITY-CONSIDERATIONS.md) | Security posture and gaps to close before production. |
| [docs/MAINTENANCE.md](docs/MAINTENANCE.md) | Updates, tuning, teardown, cost, troubleshooting. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, component interactions, data flows. |

## Usage example

A user can send free-form text instead of filling out a form manually. For example:

```text
User: MEDEVAC at grid AB 1234 5678. Two litter patients, urgent priority.
      No special equipment. Possible enemy activity. Marked by green smoke.

Bot:  I identified a 9-Line MEDEVAC request and extracted the available fields.
      Review the report, then choose YES to deliver it or NO to discard it.

User: YES
Bot:  Report confirmed and delivered to the configured destinations.
```

The exact confirmation card includes every field and marks missing values as
`[Not provided]`. See [docs/USAGE.md](docs/USAGE.md) for configuration commands, supported
report types, correction behavior, and delivery destinations.

## Repository layout

```
bot/                    Bot source (Node.js, runs inside the Wickr IO container)
  bot.js                Entry point: lifecycle and message dispatch
  services/             Message router, Bedrock detection/extraction, delivery, transcription
  forms/                Declarative form definitions -- add a file here to add a report type
  test/                 Unit and property-based tests
bin/, lib/              AWS CDK application (TypeScript): VPC, ECS Fargate, IAM, S3
test/                   CDK stack assertion tests
mocks/                  Test doubles for wickrio-bot-api / wickrio_addon
Dockerfile              Container build (pinned Wickr IO base image, Node.js 24)
start-bot.sh            Container entrypoint (credential resolution, WickrIOSvr, node bypass)
build-and-push-image.sh Image build/push script (Linux or macOS)
config.example.yaml     Deployment configuration template
docs/                   Deployment, usage, extending, security, maintenance, architecture
diagrams/               Architecture diagram (drawio)
```

## Deploying, in one paragraph

You need a Wickr bot account that is a room moderator, its credentials in Secrets Manager,
Bedrock model access enabled, an ECR repository holding an image you build with
`build-and-push-image.sh`, CDK bootstrapped, and a network egress path. Then copy
`config.example.yaml` to `config.yaml`, fill it in, and run `npx cdk synth`, `npx cdk diff`,
`npx cdk deploy`. Start with [docs/PREREQUISITES.md](docs/PREREQUISITES.md), then pick a path.

The stack does not build the image and does not create the ECR repository.

## Tests

```bash
cd bot && npm install && npm test && npm run test:property   # 305 unit + 21 property
npm install && npx jest                                      # 29 CDK assertions
```

No AWS access required for any of them.

## Security posture

- Task role is least privilege: Secrets Manager scoped to one secret ARN, Bedrock scoped to
  foundation-model and inference-profile ARNs in the current partition, S3 scoped to the
  reports bucket. Transcribe `StartTranscriptionJob` has no resource type, so it keeps `*` but is
  conditioned on `transcribe:OutputBucketName` = the reports bucket; `GetTranscriptionJob` is
  scoped to transcription-job ARNs in this account and Region. ECS Exec permissions exist only when `isDevelopmentEnv: true`.
- Egress-only security group (TCP 443, UDP 16384-16584), no inbound rules. Tasks run in
  private subnets with no public IP in every configuration except
  `create-dev-vpc` + `useNatGateway: false`, which is development-only and documented in
  [docs/PREREQUISITES.md](docs/PREREQUISITES.md#6-collect-the-network-values).
- The IAM partition is resolved at synth time (`stack.partition`), so the same code produces
  correct ARNs in GovCloud (`aws-us-gov`) and commercial (`aws`).
- Logging redacts personally identifiable information: sender identities are hashed and a
  blocklist strips sensitive keys. See `bot/services/logger.js`.
- Reports bucket is encrypted, versioned, SSL-enforced, public access blocked, and retained
  on stack deletion. Transcription scratch prefixes expire after 7 days.

Gaps to close before production -- most importantly that the delivery-configuration commands
are not access controlled -- are documented in
[docs/SECURITY-CONSIDERATIONS.md](docs/SECURITY-CONSIDERATIONS.md). One accepted `npm audit`
finding is documented in [docs/MAINTENANCE.md](docs/MAINTENANCE.md#known-accepted-finding).

## License

MIT No Attribution. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
