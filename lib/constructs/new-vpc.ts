// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class NewVpc extends Construct {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    NagSuppressions.addResourceSuppressions(vpc, [
      { id: 'AwsSolutions-VPC7', reason: 'VPC flow logs are a deployment-time decision' },
    ], true);

    this.vpc = vpc;
  }
}
