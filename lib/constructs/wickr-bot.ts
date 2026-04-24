// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';

export interface WickrBotProps {
  readonly vpc: ec2.IVpc;
  readonly cluster: ecs.ICluster;
  readonly credentialsArn: string;
  readonly isDevelopmentEnv: boolean;
  readonly reportsBucket: s3.IBucket;
}

export class WickrBot extends Construct {
  constructor(scope: Construct, id: string, props: WickrBotProps) {
    super(scope, id);

    const region = cdk.Stack.of(this).region;

    // Security group: egress-only
    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Wickr bot security group - egress only',
      allowAllOutbound: false,
    });
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS for Wickr messaging and AWS APIs',
    );
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udpRange(16384, 16584),
      'UDP for Wickr calling and media',
    );

    // CloudWatch log group
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // IAM task role: least-privilege policies
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS task role for Wickr bot runtime permissions',
    });

    // Secrets Manager: scoped to credentials ARN
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [props.credentialsArn],
    }));

    // Bedrock: InvokeModel (wildcard region for cross-region inference profile routing)
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/*',
        'arn:aws:bedrock:*:*:inference-profile/*',
      ],
    }));

    // S3: reports bucket (PutObject for delivery, GetObject for transcripts, DeleteObject for cleanup)
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
      resources: [`${props.reportsBucket.bucketArn}/*`],
    }));

    // Transcribe: actions do not support resource-level permissions
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'transcribe:StartTranscriptionJob',
        'transcribe:GetTranscriptionJob',
        'transcribe:StartStreamTranscription',
      ],
      resources: ['*'],
    }));

    // ECS Exec: conditional, only for development environments
    if (props.isDevelopmentEnv) {
      taskRole.addToPolicy(new iam.PolicyStatement({
        actions: [
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        resources: ['*'],
      }));
    }

    // Docker image asset: builds from bot/ directory
    const dockerImage = new ecr_assets.DockerImageAsset(this, 'BotImage', {
      directory: path.join(__dirname, '../../bot'),
    });

    // Fargate task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
    });

    taskDefinition.addContainer('WickrBot', {
      image: ecs.ContainerImage.fromDockerImageAsset(dockerImage),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'wickr-bot',
        logGroup,
      }),
      environment: {
        CREDENTIALS_ARN: props.credentialsArn,
        INTEGRATION_NAME: 'wickr-form-collection-bot',
        REPORTS_BUCKET: props.reportsBucket.bucketName,
        AWS_REGION: region,
      },
      healthCheck: {
        command: ['CMD-SHELL', 'pgrep -l wickrio_bot || exit 1'],
        interval: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(10),
        startPeriod: cdk.Duration.seconds(180),
        retries: 3,
      },
    });

    // Fargate service
    new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [securityGroup],
      enableExecuteCommand: props.isDevelopmentEnv,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });
  }
}
