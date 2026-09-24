// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface ImportedNetworkProps {
  readonly vpcId: string;
  /** Explicit subnet IDs to place the task in. Must be routable to the Transit Gateway. */
  readonly subnetIds: string[];
}

/**
 * Imports an externally owned VPC and an explicit list of subnets.
 *
 * Why explicit subnet IDs rather than `Vpc.fromLookup` + `SubnetType` selection:
 * in a DISA Secure Cloud Computing Architecture (SCCA) environment the spoke VPC has
 * no internet gateway and no NAT gateway -- the default route points at a Transit
 * Gateway attachment and egress is inspected by the Virtual Datacenter Security Stack
 * (VDSS). `Vpc.fromLookup` classifies a subnet as PRIVATE_WITH_EGRESS only when it
 * finds a NAT gateway route, so SCCA subnets are classified as isolated and any
 * `subnetType: PRIVATE_WITH_EGRESS` selector silently matches nothing and fails at
 * synth or deploy time.
 *
 * This construct therefore creates no network resources and makes no assumptions about
 * topology. The VPC, the Transit Gateway attachment, and all routing are owned by the
 * network team.
 */
export class ImportedNetwork extends Construct {
  public readonly vpc: ec2.IVpc;
  public readonly subnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props: ImportedNetworkProps) {
    super(scope, id);

    if (!props.subnetIds || props.subnetIds.length === 0) {
      throw new Error(
        'network.subnetIds must list at least one subnet ID when network.mode is "imported". ' +
          'These are supplied by the team that owns the VPC.',
      );
    }

    this.subnets = props.subnetIds.map((subnetId, i) =>
      ec2.Subnet.fromSubnetId(this, `Subnet${i + 1}`, subnetId),
    );

    // fromVpcAttributes performs no context lookup and no route table inspection.
    // Availability zones are resolved at deploy time; the value is unused because
    // subnet placement is explicit.
    this.vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: cdk.Fn.getAzs(),
      privateSubnetIds: props.subnetIds,
    });
  }
}
