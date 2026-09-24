// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FormCollectionBotStack } from '../lib/form-collection-bot-stack';

const GOV_CREDS_ARN =
  'arn:aws-us-gov:secretsmanager:us-gov-west-1:111122223333:secret:test-creds';

const BASE = {
  credentialsArn: GOV_CREDS_ARN,
  isDevelopmentEnv: false,
  ecrRepositoryName: 'wickr-form-collection-bot',
  imageTag: '20260727-converse-node24',
  integrationName: 'wickr-form-collection-bot',
  bedrockModelId: 'us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0',
  logLevel: 'INFO',
  networkMode: 'imported' as const,
  vpcId: 'vpc-0cccccccccccccccc',
  subnetIds: ['subnet-0aaaaaaaaaaaaaaaa', 'subnet-0bbbbbbbbbbbbbbbb'],
  createVpcEndpoints: false,
  env: { account: '111122223333', region: 'us-gov-west-1' },
};

function synth(overrides: Record<string, unknown> = {}) {
  const app = new App();
  const stack = new FormCollectionBotStack(app, 'TestStack', {
    ...BASE,
    ...overrides,
  } as any);
  return Template.fromStack(stack);
}

describe('network: imported mode (Army SCCA)', () => {
  it('creates no VPC, no NAT gateway, and no internet gateway', () => {
    const t = synth();
    t.resourceCountIs('AWS::EC2::VPC', 0);
    t.resourceCountIs('AWS::EC2::NatGateway', 0);
    t.resourceCountIs('AWS::EC2::InternetGateway', 0);
    t.resourceCountIs('AWS::EC2::Subnet', 0);
    t.resourceCountIs('AWS::EC2::RouteTable', 0);
  });

  it('places the service in the exact subnet IDs supplied, not a subnet selector', () => {
    const t = synth();
    t.hasResourceProperties('AWS::ECS::Service', {
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({
          Subnets: ['subnet-0aaaaaaaaaaaaaaaa', 'subnet-0bbbbbbbbbbbbbbbb'],
          AssignPublicIp: 'DISABLED',
        }),
      },
    });
  });

  it('fails fast when subnetIds are not supplied', () => {
    expect(() => synth({ subnetIds: [] })).toThrow(/subnetIds must list at least one/);
  });

  it('fails fast when vpcId is not supplied', () => {
    expect(() => synth({ vpcId: undefined })).toThrow(/vpcId is required/);
  });

  it('creates no VPC endpoints by default', () => {
    const t = synth();
    t.resourceCountIs('AWS::EC2::VPCEndpoint', 0);
  });
});

describe('network: optional VPC endpoints', () => {
  it('creates an interface endpoint for every AWS service the bot calls', () => {
    const t = synth({ createVpcEndpoints: true });
    t.resourceCountIs('AWS::EC2::VPCEndpoint', 6);
    for (const svc of [
      'bedrock-runtime',
      'transcribe',
      'secretsmanager',
      'logs',
      'ecr.api',
      'ecr.dkr',
    ]) {
      t.hasResourceProperties('AWS::EC2::VPCEndpoint', {
        VpcEndpointType: 'Interface',
        ServiceName: Match.stringLikeRegexp(svc.replace('.', '\\.')),
      });
    }
  });

  it('creates no gateway endpoint: route tables are owned by the network team', () => {
    const t = synth({ createVpcEndpoints: true });
    const endpoints = Object.values(t.findResources('AWS::EC2::VPCEndpoint')) as any[];
    for (const ep of endpoints) {
      expect(ep.Properties.VpcEndpointType).toBe('Interface');
    }
    t.resourceCountIs('AWS::EC2::Route', 0);
  });

  it('endpoint security group admits 443 only from the bot task security group', () => {
    const t = synth({ createVpcEndpoints: true });
    t.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      FromPort: 443,
      ToPort: 443,
      SourceSecurityGroupId: Match.anyValue(),
    });
  });
});

describe('network: create-dev-vpc without a NAT gateway', () => {
  const noNat = { networkMode: 'create-dev-vpc', useNatGateway: false };

  it('creates no NAT gateway and no EIP', () => {
    const t = synth(noNat);
    t.resourceCountIs('AWS::EC2::NatGateway', 0);
    t.resourceCountIs('AWS::EC2::EIP', 0);
  });

  it('still creates an internet gateway for egress', () => {
    const t = synth(noNat);
    t.resourceCountIs('AWS::EC2::InternetGateway', 1);
  });

  it('assigns a public IP, without which Fargate in a public subnet has no egress', () => {
    const t = synth(noNat);
    t.hasResourceProperties('AWS::ECS::Service', {
      NetworkConfiguration: Match.objectLike({
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }),
      }),
    });
  });

  it('keeps the security group inbound-free even with a public IP', () => {
    const sgs = Object.values(
      synth(noNat).findResources('AWS::EC2::SecurityGroup'),
    ) as any[];
    for (const sg of sgs) {
      expect(sg.Properties.SecurityGroupIngress).toBeUndefined();
    }
  });
});

describe('network: create-dev-vpc mode', () => {
  it('creates a VPC with a NAT gateway (dev/demo only, invalid under SCCA)', () => {
    const t = synth({ networkMode: 'create-dev-vpc' });
    t.resourceCountIs('AWS::EC2::VPC', 1);
    t.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  it('defaults to a NAT gateway and no public IP on the task', () => {
    // Absent useNatGateway, the safer of the two dev layouts must be chosen.
    const t = synth({ networkMode: 'create-dev-vpc' });
    t.hasResourceProperties('AWS::ECS::Service', {
      NetworkConfiguration: Match.objectLike({
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'DISABLED' }),
      }),
    });
  });
});

describe('service and task configuration', () => {
  it('runs exactly one Fargate task', () => {
    const t = synth();
    t.resourceCountIs('AWS::ECS::Service', 1);
    t.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1, LaunchType: 'FARGATE' });
  });

  it('forces stop-then-start deployment so two bot clients never overlap', () => {
    const t = synth();
    t.hasResourceProperties('AWS::ECS::Service', {
      DeploymentConfiguration: { MaximumPercent: 100, MinimumHealthyPercent: 0 },
      AvailabilityZoneRebalancing: 'DISABLED',
    });
  });

  it('passes the configured Bedrock model ID to the container', () => {
    const t = synth();
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            {
              Name: 'BEDROCK_MODEL_ID',
              Value: 'us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0',
            },
          ]),
        }),
      ]),
    });
  });
});

describe('IAM', () => {
  it('scopes Bedrock permissions to the deploying partition, not hardcoded aws', () => {
    const rendered = JSON.stringify(synth().findResources('AWS::IAM::Policy'));
    expect(rendered).not.toContain('arn:aws:bedrock');
    expect(rendered).toContain('bedrock:InvokeModel');
    expect(rendered).toContain('AWS::Partition');
  });

  it('grants Secrets Manager access only to the supplied credentials ARN', () => {
    const t = synth();
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'secretsmanager:GetSecretValue',
            Resource: GOV_CREDS_ARN,
          }),
        ]),
      },
    });
  });

  it('does not grant streaming transcription permissions', () => {
    // Transcribe Streaming does not accept Wickr's voice memo audio format, so the code
    // path was removed. The permission must not reappear.
    const rendered = JSON.stringify(synth().findResources('AWS::IAM::Policy'));
    expect(rendered).toContain('transcribe:StartTranscriptionJob');
    expect(rendered).not.toContain('transcribe:StartStreamTranscription');
  });

  it('does not grant ECS Exec permissions in a non-development environment', () => {
    const rendered = JSON.stringify(synth().findResources('AWS::IAM::Policy'));
    expect(rendered).not.toContain('ssmmessages:CreateControlChannel');
  });

  it('grants ECS Exec permissions when isDevelopmentEnv is true', () => {
    const rendered = JSON.stringify(
      synth({ isDevelopmentEnv: true }).findResources('AWS::IAM::Policy'),
    );
    expect(rendered).toContain('ssmmessages:CreateControlChannel');
  });
});

describe('storage and logging', () => {
  it('task security group allows no inbound traffic', () => {
    const t = synth();
    const sgs = t.findResources('AWS::EC2::SecurityGroup');
    for (const sg of Object.values(sgs) as any[]) {
      const ingress = sg.Properties?.SecurityGroupIngress;
      expect(ingress === undefined || ingress.length === 0).toBe(true);
    }
  });

  it('creates a hardened reports bucket when none is imported', () => {
    const t = synth({ reportsBucketName: undefined });
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('imports an existing reports bucket without creating a new one', () => {
    const t = synth({ reportsBucketName: 'existing-reports-bucket' });
    t.resourceCountIs('AWS::S3::Bucket', 0);
  });

  it('retains the log group rather than destroying operational logs', () => {
    const t = synth();
    t.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Retain' });
  });
});

describe('container image source', () => {
  // Deliberately different from the deploying account (111122223333 in BASE) so these
  // assertions can tell the two apart.
  const IMAGE_ACCOUNT = '444455556666';
  const CROSS_ACCOUNT_ARN =
    `arn:aws-us-gov:ecr:us-gov-west-1:${IMAGE_ACCOUNT}:repository/wickr-form-collection-bot`;

  it('resolves the repository in the deploying account when no ARN is supplied', () => {
    const rendered = JSON.stringify(synth().findResources('AWS::ECS::TaskDefinition'));
    expect(rendered).toContain('wickr-form-collection-bot:20260727-converse-node24');
    expect(rendered).not.toContain(IMAGE_ACCOUNT);
  });

  it('pulls from the supplied repository ARN when it is in another account', () => {
    const rendered = JSON.stringify(
      synth({ ecrRepositoryArn: CROSS_ACCOUNT_ARN }).findResources('AWS::ECS::TaskDefinition'),
    );
    expect(rendered).toContain(IMAGE_ACCOUNT);
    expect(rendered).toContain('wickr-form-collection-bot:20260727-converse-node24');
  });

  it('grants the execution role pull permissions on the cross-account repository', () => {
    const rendered = JSON.stringify(
      synth({ ecrRepositoryArn: CROSS_ACCOUNT_ARN }).findResources('AWS::IAM::Policy'),
    );
    expect(rendered).toContain('ecr:BatchGetImage');
    expect(rendered).toContain(IMAGE_ACCOUNT);
  });
});
