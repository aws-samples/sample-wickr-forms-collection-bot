# Prerequisites

Everything you need before deploying, regardless of which deployment path you pick. Do these
once per target AWS account.

Assumes no prior familiarity with this project. Every command is copy-paste ready; replace
values in `<angle brackets>`.

When you finish here, pick a path:

| Path | Use it when | Guide |
|---|---|---|
| ECS Fargate, image built in AWS CodeBuild | Production. You cannot run Docker locally, or you are on Windows | [DEPLOY-CDK-CODEBUILD.md](DEPLOY-CDK-CODEBUILD.md) |
| ECS Fargate, image built locally | Production. Your workstation already runs Docker on Linux or macOS | [DEPLOY-CDK-LOCAL-DOCKER.md](DEPLOY-CDK-LOCAL-DOCKER.md) |
| EC2 with Docker and the Wickr IO console | Development, first bring-up, quick iteration | [DEPLOY-EC2.md](DEPLOY-EC2.md) |

The two ECS paths produce the same running service and differ only in how the container image
gets built. The EC2 console path builds no image at all -- it imports the bot into the stock
Wickr IO container as an integration.

**If you are taking the EC2 path, two steps below do not apply.** You need no ECR repository,
because nothing is pushed, and no Secrets Manager secret, because the console prompts for the
bot password interactively. You do need an EC2 instance profile granting the bot Amazon Bedrock, Amazon S3,
and Amazon Transcribe access, plus one extra setting covered in that guide: a bridge-networked
container cannot reach the instance metadata service unless the IMDSv2 hop limit is raised
to 2.

## Terms

Amazon Elastic Container Service (ECS), Amazon Elastic Container Registry (ECR),
AWS Cloud Development Kit (CDK), AWS Identity and Access Management (IAM),
Secure Cloud Computing Architecture (SCCA), Virtual Datacenter Security Stack (VDSS),
Transit Gateway (TGW), Availability Zone (AZ), Virtual Private Cloud (VPC).

## What gets deployed

One ECS Fargate service running exactly one task: the Wickr IO container with the bot inside
it. Supporting resources are an ECS cluster, a task role and execution role, an egress-only
security group, a CloudWatch log group, and an S3 reports bucket. Optionally a VPC (dev mode
only) and interface VPC endpoints.

The stack does **not** build the container image and does **not** create the ECR repository.
Those belong to the path guides.

## Tooling

- Node.js 20 or later, and npm.
- The AWS CLI, authenticated to the target account.
- Docker is required only for the local-build path. The CodeBuild path needs nothing but the
  AWS CLI, because the image is built on a Linux host in AWS.

Deploying itself never requires Docker. The stack references an image already in ECR, which
keeps `cdk synth` and `cdk deploy` free of a Docker dependency and lets you redeploy
infrastructure without rebuilding the bot.

---

## 1. Decide which partition you are deploying into

This determines three values later, and getting it wrong produces a **successful deployment
that misbehaves at runtime** rather than an error. Settle it now.

| | GovCloud (the default) | Commercial |
|---|---|---|
| Wickr IO base image repository | `bot-cloud-govcloud` | `bot-cloud` |
| ARN prefix in `config.yaml` | `arn:aws-us-gov:` | `arn:aws:` |
| Bedrock inference profile prefix | `us-gov.` | `us.` |
| Wickr network | GovCloud Wickr | Commercial Wickr |

The last row is the one that is not a configuration change. **AWS Wickr networks are separate
per partition.** A commercial deployment needs a bot account on a commercial Wickr network
with its own credentials; GovCloud bot credentials will not authenticate against it, and vice
versa.

Cross-partition image pulls are also impossible: an image in GovCloud (`aws-us-gov`) cannot be
pulled into commercial (`aws`). Build and push into the partition you are deploying to.

## 2. Create a Wickr bot account

Provision a bot user on your AWS Wickr network and record its username and password.

**The bot must be a room moderator in every room where it should receive messages.** Without
moderator status the Wickr client delivers direct messages and control messages but does *not*
deliver room text messages to the bot. This is the most common cause of a bot that appears
healthy but never responds in a room.

Use a bot account dedicated to this deployment. Two ECS tasks running with the same Wickr
credentials fight over the session, which presents as a bot that responds intermittently.

## 3. Store the credentials in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name wickr-form-collection-bot-creds \
  --secret-string '{"username":"<bot-username>","password":"<bot-password>"}' \
  --region <region> \
  --query ARN --output text
```

Record the ARN it prints. Secrets Manager appends a random 6-character suffix, so the ARN
cannot be predicted, and the task role policy is scoped to it exactly. The bot's username and
password go **only** into this secret -- never into `config.yaml`.

## 4. Enable Amazon Bedrock model access

The default model is `us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0` in GovCloud, or
`us.anthropic.claude-sonnet-4-5-20250929-v1:0` in commercial.

Listing inference profiles is **not** a sufficient check. A profile can appear `ACTIVE` while
your account still lacks access, and the failure only surfaces at runtime as
`AccessDeniedException: You don't have access to the model with the specified model ID`.
Verify by actually invoking it:

```bash
cat > /tmp/conv.json <<'EOF'
{"messages":[{"role":"user","content":[{"text":"reply with the single word: ok"}]}],"inferenceConfig":{"maxTokens":16}}
EOF

aws bedrock-runtime converse \
  --region <region> \
  --model-id <model-id-with-your-partition-prefix> \
  --cli-input-json file:///tmp/conv.json
```

A reply means you are set. `AccessDeniedException` means model access is not enabled -- enable
it in the [Amazon Bedrock console](https://console.aws.amazon.com/bedrock/home#/modelaccess) under Model access, then re-run this check.

The bot calls Bedrock through the Converse API, which is provider-agnostic, so any
Converse-capable model works (Anthropic, Nova, Llama, and others) subject to what your account
has enabled. Change `bedrockModelId` and redeploy to switch models.

## 5. Bootstrap CDK

`cdk bootstrap` executes the CDK app before it does anything else, so the app's dependencies
and `config.yaml` must exist first -- even though bootstrap itself reads neither. Run all
three from the repository root:

```bash
npm install
cp config.example.yaml config.yaml
npx cdk bootstrap aws://<your-account-id>/<region>
```

The placeholder values in the copied `config.yaml` are fine here. Bootstrap targets the
account and region given on the command line, not the ones in the file. You fill the file in
during your chosen path guide.

Skip `npm install` and `npx` fetches a floating CDK CLI from the registry instead of the
version this project pins.

Skip the `cp` and you get this, which reads like a broken repository but is only the app
refusing to load:

```
Error: config.yaml not found. Copy config.example.yaml to config.yaml and fill in your values.
    at Object.<anonymous> (.../bin/app.ts:34:9)
npx ts-node --prefer-ts-exts bin/app.ts: Subprocess exited with error 1
```

The same error appears if you run from a subdirectory, because the app reads `config.yaml`
relative to the working directory.

Bootstrap deploys a stack named `CDKToolkit` holding the S3 bucket, ECR repository, and IAM
roles CDK uses to deploy. That ECR repository is for CDK's own assets and is unrelated to the
bot image.

### If your organization requires a permissions boundary on new IAM roles

Bootstrap takes the boundary as a flag:

```bash
npx cdk bootstrap aws://<your-account-id>/<region> \
  --custom-permissions-boundary <boundary-policy-name>
```

That flag is not sufficient on its own. It attaches the boundary to the bootstrap
`CloudFormationExecutionRole` only, and does **not** reach the two roles this stack creates
(the ECS task role and the task execution role). Bootstrap therefore succeeds and the deploy
later fails with `AccessDenied` on `iam:CreateRole`, which looks like a new problem but is the
same guardrail.

Set `permissionsBoundaryArn` in `config.yaml` as well, and the synthesized template gives both
roles a `PermissionsBoundary` property:

```yaml
permissionsBoundaryArn: "arn:aws-us-gov:iam::<your-account-id>:policy/<boundary-name>"
```

Use the full ARN, not the name. Boundary policies often live under an IAM path, which a bare
name cannot express. Confirm with `npx cdk synth` before deploying:

```bash
npx cdk synth | grep -A1 PermissionsBoundary
```

Two roles should appear. If none do, the value is not being read.

## 6. Collect the network values

Required only when `network.mode` is `imported` (the default, and required for SCCA). Ask the
team that owns the VPC for:

| Value | What it is |
|---|---|
| `network.vpcId` | The spoke VPC ID |
| `network.subnetIds` | Explicit subnet IDs with a default route to the Transit Gateway. Two or more, in different AZs. |

Confirm two things with that team before deploying:

1. **Wickr egress is permitted.** The bot must reach the AWS Wickr service on TCP 443 outbound
   through the VDSS. This is a hard dependency -- the bot cannot function without it, and no
   VPC endpoint exists for Wickr.
2. **An S3 gateway endpoint exists** on the route tables serving your subnets. This stack does
   not create one: gateway endpoints work by modifying route tables, which the network team
   owns. Without it, report and audio payloads hairpin through the VDSS.

For a lab or test account with no Transit Gateway attachment, set
`network.mode: create-dev-vpc` and skip this step. That mode builds its own VPC and is **not
valid in an SCCA environment**. It has two layouts, chosen with `network.useNatGateway`:

| | `useNatGateway: true` (default) | `useNatGateway: false` |
|---|---|---|
| NAT gateway | 1 | none |
| Task subnet | private | public |
| Task public IP | no | **yes** |
| Cost | NAT bills hourly plus data | no NAT charge |
| Use for | dev work mirroring production's private-subnet posture | short-lived demos where the NAT charge is not worth it |

Without a NAT gateway the task must have a public IP, because Fargate in a public subnet has
no route to the internet otherwise -- image pulls and Wickr login both fail. The security group
has no inbound rules either way, so nothing on the internet can open a connection to the task,
but it does have a public address. Development accounts only.

### Network configuration reference

`network.createVpcEndpoints: true` creates 6 interface endpoints -- `bedrock-runtime`,
`transcribe`, `secretsmanager`, `logs`, `ecr.api`, `ecr.dkr` -- with private DNS enabled and
443 restricted to the task security group. Set it `false` when the environment already provides
them; duplicates are wasteful, and a VPC supports only one S3 gateway endpoint per route table.

Endpoints are not a substitute for egress. They cover AWS service APIs only. The bot's
connection to AWS Wickr is ordinary internet egress on TCP 443 and there is no PrivateLink
endpoint for it, so a route to the internet, or to the VDSS via TGW, is always required.

Subnet IDs are passed to the service directly rather than selected by subnet type, because CDK
classifies TGW-routed subnets as isolated rather than private-with-egress.

---

## Next

Prerequisites done. Pick your path:

- [DEPLOY-CDK-CODEBUILD.md](DEPLOY-CDK-CODEBUILD.md) -- build the image in AWS. No local
  Docker needed; works from Windows.
- [DEPLOY-CDK-LOCAL-DOCKER.md](DEPLOY-CDK-LOCAL-DOCKER.md) -- build the image on your own
  machine. Requires Docker on Linux or macOS.
- [DEPLOY-EC2.md](DEPLOY-EC2.md) -- import into the stock Wickr IO container on EC2 via the
  interactive console. No image build. Development use.
