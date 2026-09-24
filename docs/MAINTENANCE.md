# Maintenance and Operations

Day-two guide: routine changes, tuning, teardown, and troubleshooting. Assumes the bot is
already deployed per `PREREQUISITES.md` and one of the DEPLOY-* guides.

## Routine change: updating the bot code

Phase 1 setup steps never repeat. A code change is:

1. Edit code under `bot/`.
2. Run the tests (see below).
3. Rebuild and push the image with a **new** immutable tag:
   ```bash
   AWS_ACCOUNT_ID=<account> AWS_REGION=<region> IMAGE_TAG=<new-tag> ./build-and-push-image.sh
   ```
4. Update `imageTag` in `config.yaml`.
5. `npx cdk diff` then `npx cdk deploy`.

Never reuse a tag. ECS caches by tag, so redeploying the same tag may leave the old code
running and you will chase a phantom bug.

**Each deployment causes a 2-3 minute outage by design.** The service runs one task and
deploys stop-then-start (`maximumPercent: 100`) because two tasks sharing one Wickr identity
would fight over the session. The old task must exit before the new one starts.

## Routine change: infrastructure only

Changes to `config.yaml` that do not touch the image -- log level, Amazon Bedrock model, network
endpoints -- need only `npx cdk diff` and `npx cdk deploy`. No rebuild.

## Adding a report type

Form definitions are declarative, one file per report type in `bot/forms/`. Add a file
there, add a test, rebuild the image, and deploy. No infrastructure change. Startup logs
confirm the count:

```
registry_loaded  formCount: 8
```

## Switching the Bedrock model

Change `bedrockModelId` in `config.yaml` and deploy. No rebuild -- the value is passed to the
container as `BEDROCK_MODEL_ID` and all Bedrock calls go through the provider-agnostic
Converse API, so any Converse-capable model works.

Verify the new model is actually invocable in your account first, using the `converse` check
in `PREREQUISITES.md` step 4. A model can appear in `list-inference-profiles` while
your account lacks access.

## Tuning the transcription timeout

Voice memos are transcribed with the Amazon Transcribe **batch** job API. The bot uploads the audio
to the reports bucket under `transcriptions/`, starts a job, polls every 2 seconds, fetches
the transcript, and deletes both objects.

`TRANSCRIBE_POLL_TIMEOUT_MS` bounds the wait. Default 60000. This is a ceiling, not a target:
polling returns as soon as the job completes, so raising it costs nothing when jobs are fast.
Hitting the ceiling discards the user's voice memo unrecoverably.

Observed job durations for a ~290 KB memo: about 8 seconds in a warmed-up account, about 28
seconds for the very first job in a brand new account, where Transcribe capacity appears to
be cold. Later jobs in the same account returned to single digits.

Transcribe Streaming is **not** supported. It does not accept the audio format Wickr produces
for voice memos. The code path, its IAM permission, and its VPC endpoint were all removed;
there is no mode switch.

## Rotating bot credentials

Update the secret value in place -- the ARN stays the same, so no stack change is needed:

```bash
aws secretsmanager put-secret-value \
  --secret-id wickr-form-collection-bot-creds \
  --secret-string '{"username":"<bot-username>","password":"<new-password>"}' \
  --region <region>
```

The container reads the secret at start, so force a new task to pick it up:

```bash
aws ecs update-service --cluster <cluster> --service <service> \
  --force-new-deployment --region <region>
```

## Teardown

```bash
npx cdk destroy
```

**Retained on purpose, not deleted:** the reports bucket (`RemovalPolicy.RETAIN`, because
reports are operational records) and the CloudWatch log group. Repeated deploy/destroy
cycles therefore leave orphaned buckets and log groups behind. Clean them up manually if
they are test artifacts.

Anything created in Phase 1 also survives: the ECR repository and its images, the Secrets
Manager secret, and the `CDKToolkit` bootstrap stack.

## Cost notes

The estimates below use on-demand prices returned by the AWS Price List API on 2026-09-08
for `us-gov-west-1`, 730 hours per month, and the default 1 vCPU / 2 GB Fargate task. Prices
change, so replace these assumptions in the [AWS Pricing Calculator](https://calculator.aws/)
before approving a deployment.

Representative workloads:

- **Short-lived demo:** 100 reports per month, 4,000 input and 1,000 output Amazon Bedrock
  tokens per report across classification and extraction, 10 one-minute voice memos, 1 GB of
  CloudWatch Logs ingestion, 1 GB of S3 storage, and 10 GB through one NAT gateway.
- **Production pilot:** 1,000 reports, the same token mix, 100 one-minute voice memos, 5 GB of
  logs, 10 GB of S3 storage, imported networking with no NAT gateway, and six interface VPC
  endpoints in two Availability Zones when the environment does not already provide them.

| Service | On-demand unit price used | Short-lived demo | Production pilot |
|---|---:|---:|---:|
| AWS Fargate | $0.0486 per vCPU-hour + $0.0053 per GB-hour | `(1 x $0.0486 + 2 x $0.0053) x 730` = **$43.22** | **$43.22** |
| NAT gateway | $0.054 per gateway-hour + $0.054 per GB processed | `$0.054 x 730 + $0.054 x 10` = **$39.96** | **$0** in `imported` mode |
| Interface VPC endpoints | $0.0125 per endpoint-hour, plus data processing | **$0** when disabled | `6 x 2 x $0.0125 x 730` = **$109.50** |
| Amazon Bedrock | $3.60 per 1M input tokens + $18 per 1M output tokens for the priced model tier | `0.4M x $3.60 + 0.1M x $18` = **$3.24** | `4M x $3.60 + 1M x $18` = **$32.40** |
| Amazon Transcribe | $0.0001 per audio second | `600 x $0.0001` = **$0.06** | `6,000 x $0.0001` = **$0.60** |
| Amazon CloudWatch Logs | $0.675 per GB ingested | **$0.68** | **$3.38** |
| Amazon S3 | Storage and request pricing varies by object size and request count | **$1 allowance** | **$1 allowance** |
| **Estimated monthly total** | Excludes taxes and data transfer | **about $88** | **about $190** |

The endpoint line is the main production variable. If shared interface endpoints already exist,
remove $109.50 from the pilot total, reducing the application-specific estimate to about **$81
per month**. Setting `network.useNatGateway: false` removes the demo NAT charge, but places the
task in a public subnet with a public IP; use that only for short-lived development accounts.

These estimates exclude interface-endpoint data processing, internet and Transit Gateway data
transfer, KMS keys and CodeBuild resources from the optional image-build stack, retained log and
bucket growth, support plans, and any organization-owned network inspection costs. Confirm the
selected model's current token price because `bedrockModelId` is configurable. See the official
[AWS Fargate](https://aws.amazon.com/fargate/pricing/),
[Amazon VPC](https://aws.amazon.com/vpc/pricing/),
[Amazon Bedrock](https://aws.amazon.com/bedrock/pricing/),
[Amazon Transcribe](https://aws.amazon.com/transcribe/pricing/),
[Amazon S3](https://aws.amazon.com/s3/pricing/), and
[Amazon CloudWatch](https://aws.amazon.com/cloudwatch/pricing/) pricing pages.

## Tests

```bash
# Bot: unit tests + property-based tests (no AWS access needed)
cd bot && npm install && npm test && npm run test:property

# CDK: stack assertion tests
npm install && npx jest
```

Current counts: 305 bot unit tests, 21 property tests, 29 CDK assertion tests.

The CDK tests pin behavior that is easy to break silently: IAM partition resolution, the
secret ARN scoping, absence of streaming transcription permissions, single-task
stop-then-start deployment, endpoint count, and bucket retention.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Bot responds to direct messages but ignores room messages | Not a room moderator | Make the bot a moderator in that room. Wickr does not deliver room text messages to non-moderator bots. |
| Bot responds intermittently, seems to miss messages | Two tasks sharing one Wickr identity | Confirm `desiredCount` is 1 and that no second service or local container uses the same credentials. |
| `cdk deploy` hangs for a very long time on the ECS service | Task cannot start; usually a wrong or missing `imageTag` | Check ECS service events and the task's stopped reason. Cancel the stack update rather than waiting -- no circuit breaker is configured, so the wait can reach three hours. |
| `AccessDeniedException: You don't have access to the model with the specified model ID` | Bedrock model access not enabled for the account | Enable it in the [Amazon Bedrock console](https://console.aws.amazon.com/bedrock/home#/modelaccess), then verify with the `converse` check in `PREREQUISITES.md` step 4. Not an IAM problem -- Admin credentials fail the same way. |
| `Transcription job timed out` | Job exceeded `TRANSCRIBE_POLL_TIMEOUT_MS` | Raise the value. Check the job's real duration with `aws transcribe get-transcription-job`, comparing `StartTime` to `CompletionTime`, which excludes network entirely. |
| Task starts then exits, no useful bot logs | Wickr authentication failed | Verify the secret's JSON shape is exactly `{"username":..., "password":...}` and that the bot account is not locked in the Wickr admin console. |
| `Creating user` then `Failed to create or login new user!`, `Validation Error`, `User provisioning seemed to fail for unknown reason! code=6`, then `Load client config failed!` | The bot account does not exist on the Wickr network this image serves. AWS Wickr networks are separate per partition (`PREREQUISITES.md` step 1), so a commercial bot account cannot register against a `bot-cloud-govcloud` image, nor a GovCloud account against `bot-cloud`. | Use credentials for a bot on the matching Wickr network. Update the secret with `put-secret-value`; no rebuild or redeploy is needed, since ECS reads the secret at task start. Distinguish from a wrong password, which instead says `Either the username or password you entered was invalid`. Confirmed in us-gov-east-1 on 2026-08-21: changing only the credentials, with the same image and task definition, went from this failure to a clean boot. |
| `[start-bot] Still waiting... (Ns)` climbing to 300s, then the task restarts | Downstream of any failure that stops `wickrio_bot` from starting, not a fault itself | Look above it for the real error. `start-bot.sh` waits `MAX_WAIT=300` for `wickrio_bot` plus an extracted `bot.js`, then kills WickrIOSvr and exits 1, so ECS cycles the task about every 5-6 minutes. |
| `config.yaml not found` from `cdk bootstrap` | Bootstrap runs the CDK app | Create `config.yaml` first, then bootstrap. |
| `Cloud assembly schema version mismatch: Maximum schema version supported is <N>, but found <M>` | You ran a globally installed `cdk` instead of `npx cdk`. The global CLI is older than the `aws-cdk-lib` in this repo, and a CLI cannot read a manifest newer than itself. | Always use `npx cdk`, which runs the version pinned in `package.json`. Note the earlier commands may have succeeded because they used `npx` -- the failure appears the moment one command omits it. Upgrading the global CLI also works but drifts again. |
| `current credentials could not be used to assume 'arn:...:role/cdk-hnb659fds-*-role-...', but are for the right account. Proceeding anyway.` | The bootstrap roles do not exist in that account and region yet | Not a credentials problem. It precedes the real error, `SSM parameter /cdk-bootstrap/hnb659fds/version not found`. Bootstrap that account and region. Bootstrapping is per region, so a previously bootstrapped region does not cover a new one. |
| `AccessDenied` on `iam:CreateRole` at deploy, after bootstrap succeeded | Org requires a permissions boundary on new roles. `cdk bootstrap --custom-permissions-boundary` covers only the bootstrap role, not the stack's task and execution roles. | Set `permissionsBoundaryArn` in `config.yaml` to the approved boundary ARN. Verify with `npx cdk synth \| grep PermissionsBoundary`. |
| `ecrRepositoryArn names repository "x" but ecrRepositoryName is "y"` | Mismatched cross-account image config | Make the repository name in the ARN match `ecrRepositoryName`. |
| Image pull fails on a cross-account ECR repository | Source repository policy missing | Apply the `set-repository-policy` command in `DEPLOY-CDK-LOCAL-DOCKER.md`. Cross-partition pulls are impossible regardless. |
| Bot cannot reach Wickr even with VPC endpoints enabled | Endpoints cover AWS APIs only | Wickr needs internet egress on TCP 443, via NAT or TGW to the VDSS. No PrivateLink endpoint exists for Wickr. |
| Orphaned JSON accumulating under `transcripts/` | Transcription timeout races cleanup: the bot deletes the transcript, then the job completes and rewrites it | Harmless; a 7-day lifecycle rule expires the prefix. Raising the timeout reduces occurrences. |

### Log locations

- Bot and container logs: CloudWatch log group created by the stack, stream prefix
  `wickr-bot`.
- Inside the container, if using ECS Exec: the Wickr IO integration lives at
  `/opt/WickrIO/clients/<bot-username>/integration/<integration-name>/`.

ECS Exec is only available when `isDevelopmentEnv: true`, which grants `ssmmessages:*` to
the task role. Leave it `false` in production.

## Known accepted finding

`npm audit` reports one high finding in the root development dependency tree:
`brace-expansion` 5.0.7 is bundled inside `aws-cdk-lib` 2.268.0 and is affected by
GHSA-mh99-v99m-4gvg and GHSA-rgw5-rvv9-x895 (denial of service through unbounded expansion).
The root override pins every non-bundled copy to 5.0.9, but npm overrides cannot replace a
package bundled inside another published package. Version 2.268.0 is the latest
`aws-cdk-lib` release available as of 2026-09-08 and still contains 5.0.7, so no upgrade path
currently exists.

The affected library runs only during `cdk synth`, `cdk diff`, and `cdk deploy` on a developer
or build host processing repository-controlled paths. It is not included in the deployed bot
container. Re-run `npm audit` when upgrading CDK and remove this acceptance as soon as a release
bundles `brace-expansion` 5.0.9 or later.
