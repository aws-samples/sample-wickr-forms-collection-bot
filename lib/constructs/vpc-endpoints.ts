// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface BotVpcEndpointsProps {
  readonly vpc: ec2.IVpc;
  /** Subnets to place the interface endpoints in (same subnets as the task). */
  readonly subnets: ec2.ISubnet[];
  /** Security group of the workload allowed to reach the endpoints on 443. */
  readonly clientSecurityGroup: ec2.ISecurityGroup;
}

/**
 * Interface and gateway VPC endpoints for every AWS service the bot calls.
 *
 * In an SCCA environment all egress leaves through the Transit Gateway and is inspected
 * by the VDSS. Keeping AWS service traffic on VPC endpoints avoids hairpinning that
 * volume (notably Transcribe audio and S3 objects) through the inspection stack, and
 * keeps it off the public internet path entirely.
 *
 * Only create these when the environment does not already provide them -- duplicate
 * interface endpoints for the same service are permitted but wasteful, and a VPC
 * supports only one S3 gateway endpoint per route table.
 */
export class BotVpcEndpoints extends Construct {
  constructor(scope: Construct, id: string, props: BotVpcEndpointsProps) {
    super(scope, id);

    const endpointSg = new ec2.SecurityGroup(this, 'EndpointSecurityGroup', {
      vpc: props.vpc,
      description: 'VPC interface endpoints for the Wickr forms collection bot',
      allowAllOutbound: false,
    });
    endpointSg.addIngressRule(
      props.clientSecurityGroup,
      ec2.Port.tcp(443),
      'HTTPS from the bot task only',
    );

    const subnetSelection: ec2.SubnetSelection = { subnets: props.subnets };

    const interfaceServices: Array<[string, ec2.InterfaceVpcEndpointAwsService]> = [
      // Bedrock Converse (classification and field extraction)
      ['BedrockRuntime', ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME],
      // Voice memo transcription: batch job API
      ['Transcribe', ec2.InterfaceVpcEndpointAwsService.TRANSCRIBE],
      // Bot credentials at container start
      ['SecretsManager', ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER],
      // Container logs
      ['CloudWatchLogs', ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS],
      // Image pull (ECR API + Docker registry); both are required
      ['EcrApi', ec2.InterfaceVpcEndpointAwsService.ECR],
      ['EcrDocker', ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER],
    ];

    for (const [name, service] of interfaceServices) {
      new ec2.InterfaceVpcEndpoint(this, name, {
        vpc: props.vpc,
        service,
        subnets: subnetSelection,
        securityGroups: [endpointSg],
        privateDnsEnabled: true,
        // `open: true` (the default) would auto-allow the whole VPC CIDR to the
        // endpoint, which both requires importing the CIDR and is broader than needed.
        // Access is granted explicitly from the bot task security group above.
        open: false,
      });
    }

    // S3 is deliberately NOT created here.
    //
    // The recommended endpoint for S3 (report delivery, transcription scratch, and the
    // ECR image layers, which are stored in S3) is a *gateway* endpoint: it is free and
    // is what AWS recommends. But a gateway endpoint works by adding routes to the
    // subnets' route tables, and in this deployment model the route tables belong to the
    // team that owns the VPC and the Transit Gateway attachment. CDK cannot add those
    // routes without importing route table IDs, and doing so would put this stack back
    // in the business of reasoning about a topology it does not own.
    //
    // Action for the deployer: ask the network team to create an S3 gateway endpoint on
    // the route tables serving these subnets. Without it, S3 traffic egresses through
    // the Transit Gateway and is inspected by the VDSS -- functional, but it hairpins
    // report and audio payloads through the inspection stack.
  }
}
