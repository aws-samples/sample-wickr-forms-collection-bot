# Deploy to ECS Fargate, image built locally with Docker

Use this path when your workstation already runs Docker on Linux or macOS. You build the
container image yourself, push it to ECR, then deploy the CDK stack.

Complete [PREREQUISITES.md](PREREQUISITES.md) first. This guide assumes you have a Wickr bot
account, its credentials in AWS Secrets Manager, Amazon Bedrock access verified, CDK bootstrapped, and a
decision about which partition you are deploying into.

If you cannot run Docker locally, or you are on Windows, use
[DEPLOY-CDK-CODEBUILD.md](DEPLOY-CDK-CODEBUILD.md) instead. Both paths produce the same running
service.

## Requirements specific to this path

- **Docker on Linux or macOS.** Windows Subsystem for Linux (WSL) counts.
- Not native Windows. A tarball created there loses the execute bit on the bot's shell scripts,
  and the Wickr IO console then declines to run `install.sh` and `start.sh` with no useful error
  -- the container starts and the bot never runs. `build-and-push-image.sh` repacks with
  `chmod 755` to guard against this, but it has to run on a filesystem that carries the mode
  bit.

Deploying itself needs no Docker. Only the image build does.

---

## 1. Working directory

Run everything from **this repository's root** -- the directory containing `bot/`, `Dockerfile`,
and `build-and-push-image.sh`.

```bash
cd <path-to-this-repository>
ls bot Dockerfile build-and-push-image.sh
```

## 2. Create the ECR repository

Unlike the CodeBuild path, nothing creates this for you. The CDK stack references the repository
by name and does not create it.

```bash
REGION=<region>

# Export the region too, not just set it. The AWS CLI calls here pass --region explicitly, but
# the CDK steps at the end have no such flag, and `cdk synth` has to make an AWS call to
# resolve availability zones. With no region in the environment it fails with:
#   Need to perform AWS calls for account <id>, but no credentials have been configured
# That message names credentials, so it sends you to check your keys when the region is what
# is missing. In GovCloud it is worse: the SDK can fall back to a commercial default, and your
# GovCloud session token is then rejected cross-partition, producing the same message.
export AWS_REGION="$REGION"
export AWS_DEFAULT_REGION="$REGION"

aws ecr create-repository \
  --repository-name wickr-form-collection-bot \
  --region "$REGION"
```

The bare command above leaves the repository with **mutable tags and no image scanning**, which
means a re-pushed tag can silently replace the image ECS is running. Apply the tighter contract:

```bash
aws ecr put-image-tag-mutability \
  --repository-name wickr-form-collection-bot --image-tag-mutability IMMUTABLE \
  --region "$REGION"

aws ecr put-image-scanning-configuration \
  --repository-name wickr-form-collection-bot --image-scanning-configuration scanOnPush=true \
  --region "$REGION"
```

Note that no lifecycle policy is set either. Every build adds another image, roughly 1 GB, that
is never removed. Decide on a retention rule before this becomes routine.

## 3. Build and push the image

```bash
AWS_ACCOUNT_ID=<your-account-id> \
AWS_REGION="$REGION" \
IMAGE_TAG=<immutable-tag> \
  ./build-and-push-image.sh
```

Use an immutable tag such as `20260730-1`. The script rejects `latest`: ECS caches by tag, so a
mutable tag makes deployments non-reproducible and can leave the service running old code.

**Deploying into commercial AWS?** Add `BASE_IMAGE`. The `Dockerfile` defaults to the
**GovCloud** base image repository, and omitting this produces a build that succeeds while
baking the wrong base image -- no error, just a container that misbehaves later:

```bash
AWS_ACCOUNT_ID=<your-account-id> \
AWS_REGION="$REGION" \
IMAGE_TAG=<immutable-tag> \
BASE_IMAGE=public.ecr.aws/x3s2s6k3/wickrio/bot-cloud@sha256:<commercial-digest> \
  ./build-and-push-image.sh
```

Resolve the current digest with:

```bash
aws ecr-public describe-image-tags \
  --repository-name x3s2s6k3/wickrio/bot-cloud --region us-east-1
```

Validate any digest end to end before treating it as production-pinned. The base image's Node.js
runtime, the `wickrio-bot-api` version pinned in `bot/package.json`, and its `zeromq`/`deasync`
prebuilds form one compatibility set.

The script prints the forms it packaged and ends with `BUILD_COMPLETE` and the full image URI.
Confirm the image landed:

```bash
aws ecr describe-images --repository-name wickr-form-collection-bot --region "$REGION" \
  --query 'sort_by(imageDetails,&imagePushedAt)[-1].[imageTags,imagePushedAt,imageSizeInBytes]'
```

### If the Docker host cannot reach your checkout

For example an EC2 build box reached over AWS Systems Manager Session Manager. Stage the inputs
in S3 and point the script at them:

```bash
STAGING_S3_URI=s3://<your-bucket>/<prefix>
```

Run the script with no environment variables set to print the full option list.

## 4. Write your config

```bash
cp config.example.yaml config.yaml    # skip if you already did this during bootstrap
```

Fill in every `<placeholder>`. Every option is documented inline in the file.

| Key | Value |
|---|---|
| `account`, `region` | Your target account and region |
| `credentialsArn` | The ARN from prerequisites step 3. Partition prefix must match. |
| `imageTag` | The `IMAGE_TAG` you built in step 3 |
| `ecrRepositoryName` | `wickr-form-collection-bot` unless you changed it |
| `integrationName` | Must match what the image was built with, default `wickr-form-collection-bot` |
| `bedrockModelId` | `us.` prefix in commercial, `us-gov.` in GovCloud |
| `network.*` | From prerequisites step 6 |

`config.yaml` is gitignored because it holds account-specific identifiers.

`integrationName` must match the value baked into the image. WickrIOSvr looks for the bot code
at `/usr/lib/wickr/integrations/software/<integrationName>/software.tar.gz`; if the two disagree
the container starts and the bot never runs, with no useful error. The script passes this through
as `INTEGRATION_NAME` and defaults it, so they match unless you overrode one of them.

## 5. Deploy

```bash
npx cdk synth    # validates config, renders the template, touches nothing
npx cdk diff     # review before deploying
npx cdk deploy
```

`synth` catches configuration mistakes with an explicit message -- a missing required field, or
an `ecrRepositoryArn` whose repository name disagrees with `ecrRepositoryName`. It does not catch
a wrong-but-well-formed `credentialsArn`; that surfaces at runtime.

Read the `diff`. On a first deployment everything appears as an addition. If you expected an
update and instead see a full set of additions, the stack you are deploying is not the one
managing the running service -- stop and reconcile, or you end up with two services competing for
the same Wickr identity.

`deploy` asks no configuration questions; everything comes from `config.yaml`. There is exactly
one interactive prompt, because the stack creates IAM roles, IAM policies, and a security group.
Expected changes: the task role limited to one secret ARN, Bedrock scoped to foundation-model and
inference-profile ARNs, Amazon S3 scoped to the reports bucket, Amazon Transcribe start limited by a `transcribe:OutputBucketName` condition
to the reports bucket and get scoped to job ARNs, and a security group with egress only and no inbound
rules. `ssmmessages:*` appears only when `isDevelopmentEnv: true`.

`--require-approval never` skips the prompt; appropriate in CI where a human reviewed the diff,
not in a manual production runbook. `--no-execute` creates the change set without executing it.

Typical deploy time is 5-6 minutes.

## 6. Verify

```bash
aws ecs describe-services --cluster <cluster> --services <service> --region "$REGION" \
  --query 'services[*].[status,desiredCount,runningCount]'
```

Expect `ACTIVE 1 1`. Then check CloudWatch Logs for the startup sequence:

```
bot_starting          botUsername, nodeVersion
isConnected: finally we are connected
registry_loaded       formCount: 7
bot_ready
Bot message listener set successfully!
[start-bot] Entering monitor loop...
```

Send the bot a direct message and confirm it replies, then a voice memo to exercise the
Transcribe path.

If the task never reaches running, the most common cause is an image tag that does not exist in
ECR. That does not fail `synth` or `deploy` -- ECS retries the pull while CloudFormation waits,
and with no deployment circuit breaker configured that wait can last up to three hours. Watch
service events and cancel the update rather than waiting.

A deployed bot delivers nowhere until configured. Continue with [USAGE.md](USAGE.md).

---

## Rebuilding after a change

Repeat step 3 with a new `IMAGE_TAG`, update `imageTag` in `config.yaml`, and redeploy. The
repository rejects a re-pushed tag if you applied `IMAGE_TAG_MUTABILITY=IMMUTABLE` in step 2, so
always move the tag forward rather than reusing one.

## Troubleshooting

**Build fails on the `FROM` line.** The `Dockerfile` pulls the base image from `public.ecr.aws`,
which is **not hosted in GovCloud**, though it can be pulled from there when the host has
outbound internet access. If your build host has none, mirror the base image into a private ECR
repository in this account and pass it as `BASE_IMAGE`. Mirroring needs a host that can reach
both registries; cross-partition ECR pull-through cache is not supported.

A private base image alone may still not be enough: the `Dockerfile` also runs `apt-get update`,
installs `python3-pip`, and runs `pip3 install awscli==<AWSCLI_VERSION>` (pinned by the
`AWSCLI_VERSION` build argument in the `Dockerfile`), so the build needs reachable Ubuntu and
PyPI mirrors even after `FROM` resolves locally.

**`chmod`/permission problems, or the bot never starts despite a healthy container.** Confirm the
build ran on Linux or macOS, not native Windows. Check the packaged modes:

```bash
tar -tvzf software.tar.gz | grep -E '\./[a-z]*\.sh$'
```

Expect `-rwxr-xr-x`. If they are `-rw-r--r--`, the Wickr IO console will not execute them.

**Cross-account image pulls.** To pull from a repository in a different account, set
`ecrRepositoryArn` in `config.yaml`. The repository name inside that ARN must match
`ecrRepositoryName` or the app fails fast at synth. The **source** repository must also grant the specific ECS task execution role in the
deploying account permission to pull. Use the role ARN from the deployed task definition, not
the account root:

```bash
aws ecr set-repository-policy \
  --repository-name wickr-form-collection-bot --region "$REGION" \
  --policy-text '{"Version":"2012-10-17","Statement":[{"Sid":"AllowCrossAccountPull","Effect":"Allow","Principal":{"AWS":"arn:aws:iam::<deploying-account-id>:role/<task-execution-role-name>"},"Action":["ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"]}]}'
```

Cross-**partition** pulls are impossible. Build and push into the target partition.

See [MAINTENANCE.md](MAINTENANCE.md) for the full troubleshooting table.
