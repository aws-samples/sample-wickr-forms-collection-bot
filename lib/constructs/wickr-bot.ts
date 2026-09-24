// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface WickrBotProps {
  readonly vpc: ec2.IVpc;
  /**
   * Explicit subnets for the task. Passed straight through to the service rather than
   * selected by SubnetType -- SCCA subnets route to a Transit Gateway, not a NAT
   * gateway, so type-based selection does not match them.
   */
  readonly subnets: ec2.ISubnet[];
  /**
   * Assign a public IP to the task. Required only for the dev VPC without a NAT gateway,
   * where the task sits in a public subnet -- Fargate there cannot reach the internet
   * without one. Always false for `imported` (SCCA) networks and for the NAT-backed dev
   * VPC, both of which run the task in private subnets.
   *
   * The security group has no inbound rules regardless, so a public IP does not make the
   * task reachable from the internet.
   */
  readonly assignPublicIp?: boolean;
  readonly cluster: ecs.ICluster;
  readonly credentialsArn: string;
  readonly isDevelopmentEnv: boolean;
  readonly reportsBucket: s3.IBucket;
  /** ECR repository holding the bot image built by build-and-push-image.sh. */
  readonly ecrRepositoryName: string;
  /**
   * Full ARN of the ECR repository, for pulling from an account or region other than
   * the one being deployed into. Omit to resolve `ecrRepositoryName` in the deploying
   * account and region.
   *
   * Cross-account pulls also require a repository policy on the source repository
   * granting this account `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`. This
   * stack cannot create that policy because it does not own the repository -- see the
   * README. Cross-partition pulls (GovCloud to commercial, or the reverse) are not
   * possible at all; build and push the image into the target partition instead.
   */
  readonly ecrRepositoryArn?: string;
  /** Image tag to deploy. Prefer an immutable tag over "latest". */
  readonly imageTag: string;
  /** Wickr integration name. Must match the tarball path staged in the image. */
  readonly integrationName: string;
  /** Bedrock model ID or inference profile ID used for detection/extraction. */
  readonly bedrockModelId: string;
  readonly logLevel: string;
}

export class WickrBot extends Construct {
  /** Task security group, so VPC endpoints can allow 443 from it. */
  public readonly securityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: WickrBotProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const region = stack.region;
    // Resolve the partition at synth time. Hardcoding "aws" breaks GovCloud, where the
    // partition is "aws-us-gov" -- IAM statements would match nothing and Bedrock,
    // Transcribe, and Secrets Manager calls would all be denied.
    const partition = stack.partition;

    // Security group: egress-only, no inbound rules. TCP 443 covers Wickr messaging
    // and every AWS API call (whether via VPC endpoints or via the Transit Gateway).
    // UDP 16384-16584 is Wickr calling/media -- the bot does not place calls, but the
    // range is kept so the same security group works for call-capable bots.
    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Wickr forms collection bot - egress only, no inbound',
      allowAllOutbound: false,
    });
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS for Wickr messaging and AWS service APIs',
    );
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udpRange(16384, 16584),
      'UDP for Wickr calling and media',
    );
    this.securityGroup = securityGroup;

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS task role for the Wickr forms collection bot runtime',
    });

    // Secrets Manager: scoped to the single credentials secret.
    taskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BotCredentials',
      actions: ['secretsmanager:GetSecretValue'],
      resources: [props.credentialsArn],
    }));

    // Bedrock: the Converse API authorizes via bedrock:InvokeModel. Scoped to
    // foundation models and inference profiles in the current partition. GovCloud
    // requires newer Anthropic models to be invoked through an inference profile,
    // so both resource shapes are needed.
    taskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BedrockInference',
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:${partition}:bedrock:*::foundation-model/*`,
        `arn:${partition}:bedrock:*:*:inference-profile/*`,
      ],
    }));

    // S3: PutObject for report delivery, GetObject to read Transcribe output,
    // DeleteObject to clean up uploaded audio and transcripts.
    taskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ReportsAndTranscripts',
      actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
      resources: [`${props.reportsBucket.bucketArn}/*`],
    }));

    // Transcribe: StartTranscriptionJob defines no resource type, so it needs Resource "*",
    // but the transcribe:OutputBucketName condition limits it to jobs writing into the
    // reports bucket. GetTranscriptionJob is scoped to transcription-job ARNs in this
    // account and Region. StartStreamTranscription is deliberately absent because streaming
    // does not accept Wickr's voice memo audio format.
    taskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'TranscriptionStart',
      actions: ['transcribe:StartTranscriptionJob'],
      resources: ['*'],
      conditions: {
        StringEquals: { 'transcribe:OutputBucketName': props.reportsBucket.bucketName },
      },
    }));
    taskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'TranscriptionRead',
      actions: ['transcribe:GetTranscriptionJob'],
      resources: [stack.formatArn({
        service: 'transcribe',
        resource: 'transcription-job',
        resourceName: '*',
      })],
    }));

    // ECS Exec: only for development environments (interactive shell into the task).
    if (props.isDevelopmentEnv) {
      taskRole.addToPolicy(new iam.PolicyStatement({
        sid: 'EcsExec',
        actions: [
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        resources: ['*'],
      }));
    }

    // The container image is built and pushed by build-and-push-image.sh (see README).
    // Referencing ECR rather than a DockerImageAsset keeps `cdk synth` free of a Docker
    // dependency and matches how this bot is actually released.
    // fromRepositoryName resolves in the deploying account and region, so an explicit
    // ARN is the only way to reference a repository owned elsewhere.
    const repository = props.ecrRepositoryArn
      ? ecr.Repository.fromRepositoryAttributes(this, 'BotImageRepo', {
          repositoryArn: props.ecrRepositoryArn,
          repositoryName: props.ecrRepositoryName,
        })
      : ecr.Repository.fromRepositoryName(this, 'BotImageRepo', props.ecrRepositoryName);

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
    });

    taskDefinition.addContainer('WickrBot', {
      image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'wickr-bot',
        logGroup,
      }),
      environment: {
        CREDENTIALS_ARN: props.credentialsArn,
        INTEGRATION_NAME: props.integrationName,
        REPORTS_BUCKET: props.reportsBucket.bucketName,
        TRANSCRIPTION_S3_BUCKET: props.reportsBucket.bucketName,
        AWS_REGION: region,
        BEDROCK_MODEL_ID: props.bedrockModelId,
        LOG_LEVEL: props.logLevel,
      },
      // WickrIOSvr spawns wickrio_bot; its presence is the liveness signal. The bot
      // needs time to authenticate and extract the integration, hence the start period.
      healthCheck: {
        command: ['CMD-SHELL', 'pgrep -l wickrio_bot || exit 1'],
        interval: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(10),
        startPeriod: cdk.Duration.seconds(180),
        retries: 3,
      },
    });

    // desiredCount is intentionally 1: two tasks would log in as the same Wickr bot
    // user. maximumPercent=100 with AZ rebalancing disabled forces stop-then-start on
    // deployment so the two never overlap.
    new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: props.assignPublicIp ?? false,
      securityGroups: [securityGroup],
      enableExecuteCommand: props.isDevelopmentEnv,
      vpcSubnets: { subnets: props.subnets },
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.DISABLED,
    });
  }
}
