// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface NewVpcProps {
  /**
   * Create a NAT gateway so the task can run in a private subnet with no public IP.
   *
   * When false, no NAT gateway is created and the task must run in a public subnet with a
   * public IP address to reach the internet. That is cheaper -- a NAT gateway bills hourly
   * plus data processing -- but it puts the task on a public subnet, so it is only
   * appropriate for a development or demo account.
   *
   * Neither option is valid in an SCCA environment; use `imported` network mode there.
   */
  readonly withNatGateway: boolean;
}

/**
 * Development/demo VPC. Not valid in an SCCA environment, where NAT gateways are not
 * permitted and egress goes through a Transit Gateway to the VDSS.
 */
export class NewVpc extends Construct {
  public readonly vpc: ec2.IVpc;

  /**
   * Subnets the task should run in: private when a NAT gateway provides egress, public
   * when it does not.
   */
  public readonly taskSubnets: ec2.ISubnet[];

  /**
   * Whether the task needs a public IP address. Fargate in a public subnet cannot reach
   * the internet without one -- image pulls and Wickr login both fail silently otherwise.
   */
  public readonly assignPublicIp: boolean;

  constructor(scope: Construct, id: string, props: NewVpcProps) {
    super(scope, id);

    // A PRIVATE_WITH_EGRESS subnet requires a NAT gateway to have egress at all, so when
    // there is no NAT gateway the VPC is public-subnets-only. Declaring a private subnet
    // with zero NAT gateways would create subnets with no route to the internet.
    const subnetConfiguration: ec2.SubnetConfiguration[] = props.withNatGateway
      ? [
          { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
          { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        ]
      : [{ name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }];

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: props.withNatGateway ? 1 : 0,
      subnetConfiguration,
    });

    this.vpc = vpc;
    this.taskSubnets = vpc.selectSubnets({
      subnetType: props.withNatGateway
        ? ec2.SubnetType.PRIVATE_WITH_EGRESS
        : ec2.SubnetType.PUBLIC,
    }).subnets;
    this.assignPublicIp = !props.withNatGateway;
  }
}
