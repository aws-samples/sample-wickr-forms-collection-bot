// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface ImportedVpcProps {
  readonly vpcId: string;
}

export class ImportedVpc extends Construct {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: ImportedVpcProps) {
    super(scope, id);

    this.vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
      vpcId: props.vpcId,
    });
  }
}
