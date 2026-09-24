// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { NewVpc } from './constructs/new-vpc';
import { ImportedNetwork } from './constructs/imported-network';
import { EcsCluster } from './constructs/ecs-cluster';
import { WickrBot } from './constructs/wickr-bot';
import { BotVpcEndpoints } from './constructs/vpc-endpoints';

/**
 * How the task's network is supplied.
 *
 * - `imported` (production / Army SCCA): the VPC, subnets, Transit Gateway attachment,
 *   and routing are owned externally. This stack creates no network infrastructure --
 *   no VPC, no internet gateway, no NAT gateway (none are permitted).
 * - `create-dev-vpc` (demo and development only): builds a VPC with public subnets and
 *   a NAT gateway for egress. Not valid in an SCCA environment.
 */
export type NetworkMode = 'imported' | 'create-dev-vpc';

export interface FormCollectionBotStackProps extends cdk.StackProps {
  readonly credentialsArn: string;
  readonly isDevelopmentEnv: boolean;
  readonly ecrRepositoryName: string;
  /**
   * Optional full ECR repository ARN, for pulling the image from another account or
   * region. Omit to resolve `ecrRepositoryName` in the deploying account and region.
   */
  readonly ecrRepositoryArn?: string;
  readonly imageTag: string;
  readonly integrationName: string;
  readonly bedrockModelId: string;
  readonly logLevel: string;
  readonly reportsBucketName?: string;

  readonly networkMode: NetworkMode;
  /**
   * Only meaningful when networkMode is 'create-dev-vpc'. Defaults to true.
   *
   * true  -- create a NAT gateway; the task runs in a private subnet with no public IP.
   * false -- no NAT gateway; the task runs in a public subnet with a public IP. Cheaper,
   *          weaker posture, development accounts only.
   *
   * Ignored in 'imported' mode, which creates no network resources at all.
   */
  readonly useNatGateway?: boolean;
  /** Required when networkMode is 'imported'. */
  readonly vpcId?: string;
  /** Required when networkMode is 'imported'. */
  readonly subnetIds?: string[];
  /**
   * Create interface/gateway endpoints for the AWS services the bot calls. Leave false
   * when the environment already provides them, or when AWS API traffic is permitted to
   * hairpin through the VDSS.
   */
  readonly createVpcEndpoints: boolean;
}

export class FormCollectionBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FormCollectionBotStackProps) {
    super(scope, id, props);

    let vpc: ec2.IVpc;
    let subnets: ec2.ISubnet[];
    let assignPublicIp = false;

    if (props.networkMode === 'imported') {
      if (!props.vpcId) {
        throw new Error('network.vpcId is required when network.mode is "imported".');
      }
      const network = new ImportedNetwork(this, 'Network', {
        vpcId: props.vpcId,
        subnetIds: props.subnetIds ?? [],
      });
      vpc = network.vpc;
      subnets = network.subnets;
    } else {
      // Dev/demo only, not permitted in an SCCA environment.
      // With a NAT gateway the task runs in a private subnet with no public IP. Without
      // one it runs in a public subnet with a public IP, which is cheaper but a weaker
      // posture -- see NewVpcProps.
      const created = new NewVpc(this, 'NewVpc', {
        withNatGateway: props.useNatGateway ?? true,
      });
      vpc = created.vpc;
      subnets = created.taskSubnets;
      assignPublicIp = created.assignPublicIp;
    }

    const ecsCluster = new EcsCluster(this, 'EcsCluster', { vpc });

    // Reports bucket: import when an existing bucket is supplied (the deployed
    // environment already holds historical reports), otherwise create one.
    const reportsBucket: s3.IBucket = props.reportsBucketName
      ? s3.Bucket.fromBucketName(this, 'ReportsBucket', props.reportsBucketName)
      : new s3.Bucket(this, 'ReportsBucket', {
          encryption: s3.BucketEncryption.S3_MANAGED,
          enforceSSL: true,
          versioned: true,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          serverAccessLogsPrefix: 'access-logs/',
          lifecycleRules: [
            {
              // Uploaded audio is transient; the bot deletes it, this is a backstop for
              // orphans left by a crash mid-transcription.
              id: 'expire-transcription-scratch',
              prefix: 'transcriptions/',
              expiration: cdk.Duration.days(7),
            },
            {
              // Transcribe's JSON output, plus the .write_access_check_file.temp probe it
              // writes. The bot deletes the transcript in its cleanup path, but on a
              // transcription timeout that delete races the job: cleanup runs first, then
              // the job completes and writes the object anyway, orphaning it. Those
              // orphans contain transcribed message content, so they must not persist.
              id: 'expire-transcript-output',
              prefix: 'transcripts/',
              expiration: cdk.Duration.days(7),
            },
          ],
          // Reports are operational records -- do not auto-delete the bucket.
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

    const bot = new WickrBot(this, 'WickrBot', {
      vpc,
      subnets,
      assignPublicIp,
      cluster: ecsCluster.cluster,
      credentialsArn: props.credentialsArn,
      isDevelopmentEnv: props.isDevelopmentEnv,
      reportsBucket,
      ecrRepositoryName: props.ecrRepositoryName,
      ecrRepositoryArn: props.ecrRepositoryArn,
      imageTag: props.imageTag,
      integrationName: props.integrationName,
      bedrockModelId: props.bedrockModelId,
      logLevel: props.logLevel,
    });

    if (props.createVpcEndpoints) {
      new BotVpcEndpoints(this, 'VpcEndpoints', {
        vpc,
        subnets,
        clientSecurityGroup: bot.securityGroup,
      });
    }
  }
}
