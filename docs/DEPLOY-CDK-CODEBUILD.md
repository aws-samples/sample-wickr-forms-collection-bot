# Deploy to ECS Fargate, image built in AWS CodeBuild

Use this path when you cannot build the container image on your own machine -- either you have
no Docker installation, or you are on Windows, where a locally created tarball loses the execute
bit on the bot's shell scripts and the Wickr IO integration then fails silently at container
start. CodeBuild runs on Linux, so that cannot happen.

Complete [PREREQUISITES.md](PREREQUISITES.md) first. This guide assumes you have a Wickr bot
account, its credentials in AWS Secrets Manager, Amazon Bedrock access verified, CDK bootstrapped, and a
decision about which partition you are deploying into.

For building on your own machine instead, see
[DEPLOY-CDK-LOCAL-DOCKER.md](DEPLOY-CDK-LOCAL-DOCKER.md). Both paths produce the same running
service.

## How it works

You upload the bot source to S3 as `source.zip`. CodeBuild builds the image on a Linux host and
pushes it to ECR. You read the resulting tag out of the build record and put it in
`config.yaml`, then deploy the CDK stack.

Two files drive it:

- `infrastructure/codebuild.yaml` -- creates the CodeBuild project, an S3 bucket to upload to,
  a CloudWatch log group, and an IAM role scoped to pushing one ECR repository.
- `buildspec.yml` -- the build itself. Packages `bot/`, sets the execute bit, verifies the
  archive, then builds and pushes.

## Shell requirements

Run these commands in **bash**. On Windows use Git Bash.

PowerShell will not work for several steps: the `--query` arguments contain backticks, which are
literal inside bash single quotes but are escape characters in PowerShell.

Git Bash ships `tar` and `unzip`, but **do not assume a working `zip`.** Some Git for Windows
installs put a `zip` on `PATH` that exits 127 when executed, so `command -v zip` finds it and it
still cannot create an archive. `package-source.sh` detects that and falls back to the bsdtar at
`C:\Windows\System32\tar.exe`, which writes correct forward-slash paths, so step 3 works either
way. It only matters if you package by hand.

---

## 1. Working directory

Everything runs from **this repository's root** -- the directory containing `bot/`,
`Dockerfile`, and `buildspec.yml`. If the repo sits inside a larger workspace folder, that
parent is not the root, and the first command fails with
`Invalid template path infrastructure/codebuild.yaml`.

```bash
cd <path-to-this-repository>
ls bot Dockerfile buildspec.yml infrastructure/codebuild.yaml
```

## 2. Deploy the build stack (once per account)

```bash
STACK=wickr-form-collection-bot-build
REGION=<region>

# Export the region too, not just set it. Every AWS CLI call in this guide passes --region
# explicitly, but the CDK steps at the end have no such flag, and `cdk synth` has to make an
# AWS call to resolve availability zones. With no region in the environment it fails with:
#   Need to perform AWS calls for account <id>, but no credentials have been configured
# That message names credentials, so it sends you to check your keys when the region is what
# is missing. In GovCloud it is worse: the SDK can fall back to a commercial default, and your
# GovCloud session token is then rejected cross-partition, producing the same message.
export AWS_REGION="$REGION"
export AWS_DEFAULT_REGION="$REGION"

aws cloudformation deploy \
  --template-file infrastructure/codebuild.yaml \
  --stack-name "$STACK" \
  --capabilities CAPABILITY_IAM \
  --region "$REGION"
```

`CAPABILITY_IAM` is required because the template creates the build service role. Under two
minutes.

The `BuildImage` parameter defaults to `aws/codebuild/standard:7.0`. Managed image availability
varies by region, and GovCloud generally lags commercial, so confirm it before deploying rather
than debugging a `CREATE_FAILED` afterwards:

```bash
aws codebuild list-curated-environment-images --region "$REGION" \
  --query 'platforms[].languages[].images[].name' --output text \
  | tr '\t' '\n' | sort -u | grep standard
```

If `standard:7.0` is absent, pass whatever version is listed, for example
`--parameter-overrides BuildImage=aws/codebuild/standard:6.0`. The build only needs `docker`,
`tar`, and the AWS CLI, so any current standard image works.

The stack creates the ECR repository for you. If you already created it yourself, add
`--parameter-overrides CreateEcrRepository=false`, otherwise the stack fails with
`RepositoryAlreadyExistsException`.

### Two parameters worth setting deliberately

**`NotificationEmail`** -- leave it unset and **nothing tells you a build failed.** CodeBuild
notifies no one, so you find out by polling build status or noticing the image never appeared.
Set it and the stack creates an SNS topic and an EventBridge rule on `FAILED`/`STOPPED`:

```bash
  --parameter-overrides NotificationEmail=you@example.com
```

AWS emails a subscription confirmation you must accept before anything arrives. The topic ARN
is a stack output, so you can subscribe Slack via AWS Chatbot or a webhook to it as well.

**`MaxTaggedImages`** -- defaults to 20. Each build pushes roughly 1 GB and tags are immutable,
so without a cap the repository grows without bound. The lifecycle policy also deletes untagged
images after a day, which is free of risk since nothing references them.

Be careful lowering it. Expiring an image does **not** disturb a task that is already running,
but it does break that task's next restart, scale-out, or replacement — and the resulting ECS
pull failure looks unrelated to an ECR cleanup that happened weeks earlier. Keep the count
comfortably above the number of builds you run between deployments.

Both only apply when this stack creates the repository. With `CreateEcrRepository=false` you
own retention on the existing repository yourself — see
[DEPLOY-CDK-LOCAL-DOCKER.md](DEPLOY-CDK-LOCAL-DOCKER.md#2-create-the-ecr-repository).

**Deploying into commercial AWS?** Add the base image override now, so it applies to every
build and there is nothing to remember later:

```bash
  --parameter-overrides \
      BaseImage=public.ecr.aws/x3s2s6k3/wickrio/bot-cloud@sha256:<commercial-digest>
```

The `Dockerfile` defaults to the **GovCloud** base image repository. Omitting this override in
commercial produces a build that succeeds while baking the wrong base image -- no error, just a
container that misbehaves later. Resolve the current digest with:

```bash
aws ecr-public describe-image-tags \
  --repository-name x3s2s6k3/wickrio/bot-cloud --region us-east-1
```

Validate any digest end to end before treating it as production-pinned. The base image's
Node.js runtime, the `wickrio-bot-api` version pinned in `bot/package.json`, and its
`zeromq`/`deasync` prebuilds form one compatibility set.

Then capture the stack outputs. Later commands use them, and reading them from the stack keeps
this working if you changed `ProjectName`:

```bash
PROJECT=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ProjectName`].OutputValue' --output text)
BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`SourceBucketName`].OutputValue' --output text)

echo "project=$PROJECT bucket=$BUCKET"
```

Both must be non-empty before continuing.

## 3. Package the source

The archive needs four members at its root: `bot/`, `Dockerfile`, `start-bot.sh`, and
`buildspec.yml`. Nothing else is read.

Zip the **contents** of those paths, not a folder containing them. CodeBuild extracts the
archive and looks for `buildspec.yml` at the top level; zip the repository folder itself and
everything lands one directory deeper, failing with
`YAML_FILE_ERROR: YAML file does not exist`.

```bash
./package-source.sh
```

If that script is not present, do it by hand:

```bash
set -euo pipefail
REPO="$PWD"
STAGING=$(mktemp -d)
cp Dockerfile start-bot.sh buildspec.yml "$STAGING/"
mkdir -p "$STAGING/bot"
tar -c --exclude=node_modules -C bot . | tar -x -C "$STAGING/bot"
rm -f "$REPO/source.zip"
( cd "$STAGING" && zip -qr "$REPO/source.zip" . )
rm -rf "$STAGING"

unzip -l source.zip | grep -E ' (buildspec.yml|bot/bot.js)$'
```

Both grep lines must appear. `set -o pipefail` matters on the `tar | tar` line: without it a
failure in the reading `tar` is masked by the writing `tar` succeeding, and you package an
incomplete `bot/`.

If `zip` does not run (see [Shell requirements](#shell-requirements)), swap that one line for the
Windows bsdtar, which needs Windows-style paths and explicit members so entries come out as
`bot/bot.js` rather than `./bot/bot.js`:

```bash
/c/Windows/System32/tar.exe -a -cf "$(cygpath -w "$REPO/source.zip")" \
  -C "$(cygpath -w "$STAGING")" bot Dockerfile start-bot.sh buildspec.yml
```

The GNU `tar` already on your `PATH` in Git Bash cannot do this -- it does not write zip -- so
call the Windows one by absolute path.

**On Windows, do not use PowerShell's `Compress-Archive`.** Windows PowerShell 5.1 -- still the
default on Windows 10 and 11 -- writes zip entries with backslash separators, storing
`bot/bot.js` as `bot\bot.js`. Linux extracts that as a single file with a literal backslash in
its name rather than a directory, and the build fails with `YAML_FILE_ERROR`. Confirmed on
PowerShell 5.1.22621: a nested entry stored as `sub\nested.txt`. Check with:

```bash
unzip -Z1 source.zip | grep '\\' && echo "BAD: backslash paths" || echo "ok: forward slashes"
```

## 4. Upload and start the build

```bash
VERSION=$(aws s3api put-object \
  --bucket "$BUCKET" --key source.zip --body source.zip --region "$REGION" \
  --query VersionId --output text)

BUILD_ID=$(aws codebuild start-build \
  --project-name "$PROJECT" --region "$REGION" \
  --source-version "$VERSION" \
  --query 'build.id' --output text)

echo "build=$BUILD_ID source_version=$VERSION"
```

The object key must be `source.zip` -- that exact key is what the project reads. Because the key
is fixed and reused, `--source-version` is what makes a build reproducible: it pins the build to
the object version you just uploaded rather than whatever is current when the build starts. Skip
it and two people uploading around the same time can each build the other's source.
`s3api put-object` is used instead of `s3 cp` because it returns the version ID directly.

Anyone able to write this object and call `StartBuild` can put arbitrary code into a production
image, since `buildspec.yml` itself comes from the archive. Treat that pair of permissions as
deployment authority.

Watch it finish, roughly 4 to 8 minutes, most of it pulling the Wickr base image:

```bash
aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$REGION" \
  --query 'builds[0].buildStatus' --output text
```

On failure, read the log:

```bash
MSYS_NO_PATHCONV=1 aws logs tail "/aws/codebuild/$PROJECT" --region "$REGION" --since 30m
```

`MSYS_NO_PATHCONV=1` is **mandatory in Git Bash** and harmless elsewhere. Git Bash rewrites any
argument starting with `/` into a Windows path before passing it to `aws.exe`, so the log group
name arrives with a drive letter and colon in it and the call fails with:

```
InvalidParameterException ... Value at 'logGroupName' failed to satisfy constraint:
Member must satisfy regular expression pattern: [\.\-_/#A-Za-z0-9]+
```

That reads like a malformed name, but the name is fine.

If you set `NotificationEmail` in step 2 you get an email on failure. Without it nothing tells
you, and polling the status above is the only way to know.

### Reading the log

CodeBuild echoes the entire build script into the log on failure, so a plain search matches the
`echo "ERROR: ..."` source lines as well as real output. Filter the script out:

```bash
MSYS_NO_PATHCONV=1 aws logs tail "/aws/codebuild/$PROJECT" --region "$REGION" --since 30m \
  | grep -E 'ERROR:|ok:|=== |Step [0-9]+/' | grep -v 'echo'
```

A healthy build prints `=== Build plan ===` with four detail lines, `=== Verifying archive
contents ===` with six `ok:` lines, the form list, then Docker output.

## 5. Read the image tag

The build generates its own tag rather than taking one from you, so a retry never collides with
an existing tag -- the ECR repository is created with immutable tags. The format is
`<UTC timestamp>-<build number>`.

```bash
aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$REGION" \
  --query 'builds[0].exportedEnvironmentVariables' --output table
```

That prints `IMAGE_URI`, `IMAGE_TAG`, `INTEGRATION_NAME`, and `SOURCE_VERSION_ID`. Keep
`IMAGE_TAG` and `SOURCE_VERSION_ID` together -- that pair is your only record of which source
produced which running image.

Confirm the image actually landed:

```bash
aws ecr describe-images --repository-name wickr-form-collection-bot --region "$REGION" \
  --query 'sort_by(imageDetails,&imagePushedAt)[-1].[imageTags,imagePushedAt,imageSizeInBytes]'
```

To build a specific tag instead, override it:

```bash
aws codebuild start-build \
  --project-name "$PROJECT" --region "$REGION" \
  --source-version "$VERSION" \
  --environment-variables-override name=IMAGE_TAG,value=<immutable-tag> \
  --query 'build.id' --output text
```

Overrides are validated by the build and rejected if they contain characters outside what ECR
and the Wickr integration path accept. `latest` is rejected outright: ECS caches by tag, so a
mutable tag makes deployments non-reproducible and can leave the service running old code.

## 6. Write your config

```bash
cp config.example.yaml config.yaml    # skip if you already did this during bootstrap
```

Fill in every `<placeholder>`. Every option is documented inline in the file.

| Key | Value |
|---|---|
| `account`, `region` | Your target account and region |
| `credentialsArn` | The ARN from prerequisites step 3. Partition prefix must match. |
| `imageTag` | `IMAGE_TAG` from step 5 |
| `ecrRepositoryName` | `wickr-form-collection-bot` unless you changed it |
| `integrationName` | Must match what the image was built with, default `wickr-form-collection-bot` |
| `bedrockModelId` | `us.` prefix in commercial, `us-gov.` in GovCloud |
| `network.*` | From prerequisites step 6 |

`config.yaml` is gitignored because it holds account-specific identifiers.

`integrationName` must match the value baked into the image. WickrIOSvr looks for the bot code
at `/usr/lib/wickr/integrations/software/<integrationName>/software.tar.gz`; if the two disagree
the container starts and the bot never runs, with no useful error.

## 7. Deploy

```bash
npx cdk synth    # validates config, renders the template, touches nothing
npx cdk diff     # review before deploying
npx cdk deploy
```

`synth` catches configuration mistakes with an explicit message -- a missing required field, or
an `ecrRepositoryArn` whose repository name disagrees with `ecrRepositoryName`. It does not
catch a wrong-but-well-formed `credentialsArn`; that surfaces at runtime.

Read the `diff`. On a first deployment everything appears as an addition. If you expected an
update and instead see a full set of additions, the stack you are deploying is not the one
managing the running service -- stop and reconcile, or you end up with two services competing
for the same Wickr identity.

`deploy` asks no configuration questions; everything comes from `config.yaml`. There is exactly
one interactive prompt, because the stack creates IAM roles, IAM policies, and a security group.
Expected changes: the task role limited to one secret ARN, Bedrock scoped to foundation-model
and inference-profile ARNs, Amazon S3 scoped to the reports bucket, Amazon Transcribe start limited
by a `transcribe:OutputBucketName` condition to the reports bucket and get scoped to job ARNs, and a security group with egress only and no
inbound rules. `ssmmessages:*` appears only when `isDevelopmentEnv: true`.

`--require-approval never` skips the prompt; appropriate in CI where a human reviewed the diff,
not in a manual production runbook. `--no-execute` creates the change set without executing it.

Typical deploy time is 5-6 minutes.

## 8. Verify

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

Repeat steps 3 and 4, then update `imageTag` in `config.yaml` and redeploy.

**Repackaging is not optional.** `buildspec.yml` is read from inside the uploaded archive, not
from your working tree. Edit it, skip the repackage, and CodeBuild runs the old copy -- producing
a byte-identical error that reads as "the fix didn't work" when the fix was never shipped. If a
change appears to have no effect, verify what you actually uploaded:

```bash
unzip -p source.zip buildspec.yml | diff - buildspec.yml && echo "archive matches working tree"
```

## Troubleshooting

**Build fails on the `FROM` line.** The `Dockerfile` pulls the base image from
`public.ecr.aws`, which is **not hosted in GovCloud**. The project is deliberately created with
no VPC attachment so it runs on AWS-managed networking with outbound internet access, which is
what makes that pull work. In commercial AWS this is rarely an issue.

If your account blocks that egress, mirror the base image into a private ECR repository in this
account. **Two steps, both required** -- the second is easy to miss and produces a confusing
authorization error:

```bash
# 1. Tell the stack about the mirror so the build role may read it. Its pull permissions
#    otherwise cover only the OUTPUT repository.
aws cloudformation deploy \
  --template-file infrastructure/codebuild.yaml \
  --stack-name "$STACK" --capabilities CAPABILITY_IAM --region "$REGION" \
  --parameter-overrides BaseImageRepositoryName=wickr-base

# 2. Point a build at the mirrored image.
aws codebuild start-build \
  --project-name "$PROJECT" --region "$REGION" --source-version "$VERSION" \
  --environment-variables-override \
      name=BASE_IMAGE,value=<account>.dkr.ecr.<region>.amazonaws.com/wickr-base@sha256:<digest>
```

Mirroring needs a host that can reach both registries; cross-partition ECR pull-through cache is
not supported, so the build cannot do it itself.

A private base image alone may still not be enough: the `Dockerfile` also runs `apt-get update`,
installs `python3-pip`, and runs `pip3 install awscli==<AWSCLI_VERSION>` (pinned by the `AWSCLI_VERSION` build argument
in the `Dockerfile`), so the build needs reachable Ubuntu and
PyPI mirrors even after `FROM` resolves locally. In a fully egress-blocked account you also need
internal package mirrors, or a base image with the AWS CLI and `jq` already present.

**`exit status 2` with no output at all.** The build phase failed while parsing, so nothing ran.
Check that `buildspec.yml` still has `shell: bash` under `env`. CodeBuild runs Linux commands in
`/bin/sh` by default, which is dash, and dash rejects `set -o pipefail` outright.

**`cdk synth` reports `Need to perform AWS calls for account <id>, but no credentials have been
configured` while the AWS CLI works fine.** Usually no region in the environment rather than
anything wrong with your credentials. Every CLI command in this guide passes `--region`, which
masks an unset region; `cdk` has no equivalent flag. The call it needs to make is
`DescribeAvailabilityZones`, because `network.mode: create-dev-vpc` builds a VPC with `maxAzs: 2`
and CDK must resolve real AZ names for a stack with a concrete account and region. Confirm and
fix:

```bash
env | grep -E '^AWS_(REGION|DEFAULT_REGION|PROFILE)='   # empty output is the problem
aws sts get-caller-identity                             # note: no --region flag
export AWS_REGION="$REGION"
export AWS_DEFAULT_REGION="$REGION"
```

In GovCloud this also appears when the region is set to a commercial one, because the session
token is rejected across partitions and CDK reports that as missing credentials. Observed in
us-gov-east-1 on 2026-08-21.

**An image you deployed has disappeared from ECR.** The lifecycle policy keeps only the newest
`MaxTaggedImages` (default 20). If you built many times after deploying, the deployed tag can
age out. A running task survives that, but its next restart fails to pull. Raise
`MaxTaggedImages` and rebuild the tag you need.

See [MAINTENANCE.md](MAINTENANCE.md) for the full troubleshooting table.
