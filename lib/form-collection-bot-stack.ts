// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { NewVpc } from './constructs/new-vpc';
import { ImportedVpc } from './constructs/imported-vpc';
import { EcsCluster } from './constructs/ecs-cluster';
import { WickrBot } from './constructs/wickr-bot';

export interface FormCollectionBotStackProps extends cdk.StackProps {
  readonly credentialsArn: string;
  readonly vpcId?: string;
  readonly isDevelopmentEnv: boolean;
}

export class FormCollectionBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FormCollectionBotStackProps) {
    super(scope, id, props);

    // VPC: create new or import existing based on config
    const vpcConstruct = props.vpcId
      ? new ImportedVpc(this as any, 'ImportedVpc', { vpcId: props.vpcId })
      : new NewVpc(this as any, 'NewVpc');

    // ECS cluster
    const ecsCluster = new EcsCluster(this as any, 'EcsCluster', {
      vpc: vpcConstruct.vpc,
    });

    // S3 bucket for form reports
    const reportsBucket = new s3.Bucket(this as any, 'ReportsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    NagSuppressions.addResourceSuppressions(reportsBucket, [
      {
        id: 'AwsSolutions-S1',
        reason: 'Server access logging is a deployment-time decision for this sample',
      },
    ]);

    // Wickr bot ECS service
    new WickrBot(this as any, 'WickrBot', {
      vpc: vpcConstruct.vpc,
      cluster: ecsCluster.cluster,
      credentialsArn: props.credentialsArn,
      isDevelopmentEnv: props.isDevelopmentEnv,
      reportsBucket,
    });
  }
}
