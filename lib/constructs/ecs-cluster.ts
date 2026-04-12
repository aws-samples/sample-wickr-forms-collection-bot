// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

export interface EcsClusterProps {
  readonly vpc: ec2.IVpc;
}

export class EcsCluster extends Construct {
  public readonly cluster: ecs.ICluster;

  constructor(scope: Construct, id: string, props: EcsClusterProps) {
    super(scope, id);

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      containerInsights: true,
    });
  }
}
