# Changelog

## 4.1.0 - 2026-09-24

### Security
- Voice memo transcription no longer falls back to a hard-coded S3 bucket name
  (`nine-line-transcription`) that another account could register. With
  `TRANSCRIPTION_S3_BUCKET` unset, transcription fails with a clear error. CDK always sets it.
- Transcribe task-role permissions narrowed: `StartTranscriptionJob` (no resource type) is
  conditioned on `transcribe:OutputBucketName` being the reports bucket, and
  `GetTranscriptionJob` is scoped to transcription-job ARNs in the stack's account and Region.
- `infrastructure/codebuild.yaml`: access-logs bucket now versioned, noncurrent versions
  expire after 30 days; self-logging suppression documented.

### Changed
- `awscli` pinned (`AWSCLI_VERSION=1.46.1` build argument in the `Dockerfile`) and
  `fast-check` pinned to `3.23.2`.
- Documentation placeholders: `<your-build-bucket>`, `soldier@example.com`.
- Both `package.json` files now carry the release version (previously stuck at `1.0.0`).

  Test counts: 305 bot unit tests, 29 CDK assertion tests.

## 4.0.0 - 2026-07-30

### Removed
- Four site-specific range control forms (`RANGE_OPEN`, `RANGE_GO_HOT`, `RANGE_CLOSE`,
  `RANGE_CLEAR`, commands `/openrange`, `/gohot`, `/closerange`, `/clearrange`). They were
  written for one training site and are not generally applicable. Seven general-purpose
  forms remain: MEDEVAC, CAS, SALUTE, PERSTAT, INCIDENT, FLIGHT, GROUND.

  Breaking for anyone using those commands. No code depended on them -- the registry loads
  `bot/forms/` dynamically and `formCount` is computed, so removal required no other change.

### Added
- `docs/USAGE.md` -- post-deploy configuration and the full command reference. A freshly
  deployed bot classifies and extracts correctly but delivers nowhere until a delivery target
  is configured, which previously looked like a defect.
- `docs/EXTENDING.md` -- the form definition schema, output types, and prompt-writing
  guidance for adding a report type.
- `docs/SECURITY-CONSIDERATIONS.md` -- security posture and the gaps to close before
  production. Most notably: `/<form> set-webhook`, `/<form> set-room`, and `/set-rooms` have
  no sender authorization, so any user who can message the bot can redirect a form's reports
  to an endpoint they control.
- `license` field (`MIT-0`) added to both `package.json` files. Both previously omitted it,
  leaving npm metadata inconsistent with `LICENSE`.

## 3.1.0 - 2026-07-30

### Added
- Optional `network.useNatGateway` (default `true`), meaningful only in `create-dev-vpc`
  mode. Set `false` to skip the NAT gateway: the VPC is then public-subnets-only and the
  task runs with a public IP, since Fargate in a public subnet has no internet route
  without one. Cheaper for short-lived dev and demo stacks; a weaker posture, so
  development accounts only. The security group remains inbound-free either way, and a
  stack assertion test pins that. Ignored in `imported` mode, which creates no network
  resources.
- `TRANSCRIBE_POLL_TIMEOUT_MS` to tune the Transcribe batch polling ceiling without
  rebuilding the image.

### Changed
- Transcribe polling ceiling raised from 28,000 ms to 60,000 ms by default. The old value
  was chosen to sit under a 30-second responsiveness target, but polling returns as soon as
  the job completes, so the ceiling only bounds the worst case and a higher one costs
  nothing when jobs are fast. Hitting it discards the user's voice memo unrecoverably.
  Measured job durations for a ~290 KB memo: ~8s in a warmed-up account, ~28s for the first
  job in a brand new account, which the old ceiling lost by under a second.
- Documentation reorganized for handover: a brief `README.md` plus `docs/DEPLOYMENT.md`
  (prerequisites and deployment) and `docs/MAINTENANCE.md` (updates, tuning, teardown, cost,
  troubleshooting). All account-specific identifiers replaced with placeholders, and the
  build script (`build-and-push-image.sh`, formerly `govcloud-build.sh`) parameterized via
  environment variables with an added local-build mode.
- Bedrock prerequisite verification now uses an actual `converse` call. `list-inference-profiles`
  reporting a profile as `ACTIVE` does not prove the account has model access; that failure
  otherwise surfaces only at runtime as `AccessDeniedException`.

### Fixed
- Added a 7-day lifecycle rule for the `transcripts/` prefix. On a transcription timeout the
  cleanup delete races the Transcribe job: cleanup runs first, then the job completes and
  writes the object anyway. Those orphans contain transcribed message content and previously
  had no expiry. Observed in testing.

## 3.0.0 - 2026-07-29

### Removed
- **Streaming transcription.** Amazon Transcribe Streaming does not accept the audio format
  Wickr produces for voice memos, so the streaming path could never succeed in practice.
  Removed rather than left as a trap for the next operator. Voice memos are transcribed
  with the Transcribe batch job API, which is unchanged.

  This is a breaking configuration change: the `transcribeMode` option and the
  `TRANSCRIBE_MODE` container environment variable no longer exist. A `config.yaml`
  carrying `transcribeMode` is silently ignored rather than rejected, since unknown keys
  are not validated -- remove the line to avoid confusion.

  Also removed as a consequence:
  - `transcribe:StartStreamTranscription` from the task role. A stack assertion test now
    pins its absence.
  - The `transcribestreaming` interface VPC endpoint. `createVpcEndpoints: true` now
    creates 6 endpoints instead of 7.
  - The `@aws-sdk/client-transcribe-streaming` dependency from `bot/package.json`.
  - `resolveMode()`, `detectFormat()`, and `streamPipeline()` from
    `bot/services/transcription-service.js`, along with the magic-bytes format map and
    chunk-size constant that existed only to serve them.
  - `bot/test/transcription-streaming.test.js` and
    `bot/test/property/transcription-streaming.property.test.js`.

  Test counts after removal: 305 bot unit tests, 21 property tests, 24 CDK assertion tests.

## 2.1.0 - 2026-07-29

### Added
- Optional `ecrRepositoryArn` in `config.yaml`, for pulling the container image from an
  ECR repository in a different account or region than the deployment target. When set,
  the stack uses `Repository.fromRepositoryAttributes` instead of
  `fromRepositoryName`, which only ever resolves in the deploying account and region.
  CDK grants the task execution role `ecr:BatchGetImage` and
  `ecr:GetDownloadUrlForLayer` scoped to that repository automatically.

  Cross-account pulls additionally require a repository policy on the *source*
  repository granting the deploying account those two actions. This stack cannot create
  it, since it does not own the repository -- see the README.

  Cross-partition pulls (GovCloud to commercial or the reverse) remain impossible; the
  image must be built and pushed into the target partition.
- `bin/app.ts` now validates that the repository name embedded in `ecrRepositoryArn`
  matches `ecrRepositoryName`. `fromRepositoryAttributes` takes both and does not
  cross-check them, so a mismatch previously produced a task definition pointing at a
  nonexistent image URI, surfacing only as an opaque pull failure at task start.

## 2.0.0 - 2026-07-27

### Changed
- Migrated all Amazon Bedrock calls from per-provider `InvokeModel` request marshalling to
  the provider-agnostic Converse API (`bot/services/model-config.js`,
  `extraction-engine.js`, `form-detector.js`). Model swaps are now a single
  `BEDROCK_MODEL_ID` change. Default model: `us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0`.
- Base container image bumped to the current Wickr IO GovCloud release
  (digest `sha256:3ba2b33c...`, console v6.66.2.1, Ubuntu 24.04, Node.js 24.15.0).
  The Node.js runtime is now resolved via nvm at container start instead of a hardcoded
  path baked into the image `PATH`.
- `wickrio-bot-api` pinned 7.1.6 -> 7.1.10 (transitive `wickrio_addon` 7.1.9), verified to
  install and load under Node.js 24.
- Consolidated all message routing into `services/message-router.js`; `bot.js` is now
  lifecycle + send only. Global commands `/set-rooms` and `/status` moved into the router.
- ECS deployment switched to stop-then-start (`maximumPercent: 100`, AZ rebalancing
  disabled) so two tasks never run concurrently with the same Wickr credentials.

### Added
- AWS CDK application (`bin/`, `lib/`, `test/`) for the ECS Fargate deployment, adapted
  from the aws-samples public variant with GovCloud partition support
  (`stack.partition` instead of hardcoded `arn:aws:` ARNs), ECR image reference instead
  of a local Docker asset, configurable model/log/transcribe settings, and optional
  import of an existing reports bucket.
- Network modes for Army/DISA SCCA environments, where NAT gateways are not permitted and
  egress goes through a Transit Gateway to the VDSS for inspection:
  - `imported` (default): creates no VPC, internet gateway, or NAT gateway. Takes an
    explicit `vpcId` and `subnetIds` and passes the subnets directly to the service.
    Subnet *type* selection is deliberately avoided -- CDK classifies TGW-routed subnets
    as isolated, so a `PRIVATE_WITH_EGRESS` selector matches nothing and fails at deploy.
  - `create-dev-vpc`: the previous NAT-based VPC, retained for demo/lab use only.
  - Optional interface endpoints (Bedrock, Transcribe batch + streaming, Secrets Manager,
    CloudWatch Logs, ECR api + dkr) with 443 restricted to the task security group, so
    AWS service traffic stays off the inspection path. `open: false` avoids needing to
    import the VPC CIDR. The S3 gateway endpoint is explicitly left to the network team
    because it requires route table changes outside this stack's ownership.
- CDK stack assertion tests (20) covering IAM scoping, partition correctness,
  single-task deployment safety, security group posture, both network modes, absence of
  NAT/IGW/route resources in imported mode, and endpoint creation.

### Fixed (infrastructure)
- `containerInsights` (deprecated boolean) replaced with `containerInsightsV2`.
- `mocks/` test doubles for `wickrio-bot-api`/`wickrio_addon` (required by the bot test
  suite's module resolution).
- Repository hygiene: README, LICENSE/NOTICE, SECURITY.md, CONTRIBUTING.md, .gitignore.

### Fixed
- Per-form `help` subcommand now lists itself in the admin command help.
- `set-webhook` rejects input containing no extractable URL instead of storing
  sanitized garbage as the webhook target.
- Dependency findings: `js-yaml` bumped to 4.3.0 (merge-key DoS advisories),
  `jest` chain bumped to 30.x, `brace-expansion` forced to 5.0.8 via npm overrides.
  One accepted finding remains (bundled copy inside aws-cdk-lib -- see README).

### Removed
- Stale root build artifacts (`software.tar.gz`, `software-update.tar.gz`) carrying an
  older variant of the bot. The deployable artifact is always built fresh from `bot/` --
  see README Step 1.
