// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as yaml from 'js-yaml';
import { FormCollectionBotStack, NetworkMode } from '../lib/form-collection-bot-stack';

interface AppConfig {
  account: string;
  region: string;
  stackName?: string;
  credentialsArn: string;
  permissionsBoundaryArn?: string;
  isDevelopmentEnv?: boolean;
  ecrRepositoryName?: string;
  ecrRepositoryArn?: string;
  imageTag?: string;
  integrationName?: string;
  bedrockModelId?: string;
  logLevel?: string;
  reportsBucketName?: string;
  network?: {
    mode?: NetworkMode;
    useNatGateway?: boolean;
    vpcId?: string;
    subnetIds?: string[];
    createVpcEndpoints?: boolean;
  };
}

let configData: string;
try {
  configData = fs.readFileSync('config.yaml', 'utf8');
} catch {
  throw new Error(
    'config.yaml not found. Copy config.example.yaml to config.yaml and fill in your values.',
  );
}

/**
 * Strips leading and trailing whitespace from every string in the parsed config, including
 * inside nested objects and string arrays.
 *
 * YAML keeps whatever whitespace a paste happened to include, and a trailing space inside
 * quotes is invisible in an editor. On an ARN it survives synth and deploy, then scopes an IAM
 * statement to a resource that does not exist -- surfacing much later as an opaque permission
 * or lookup failure. Normalizing here means every validation below sees the intended value.
 */
function deepTrim(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(deepTrim);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = deepTrim(record[key]);
    }
  }
  return value;
}

const config = deepTrim(yaml.load(configData)) as AppConfig;

const missing: string[] = [];
if (!config.account) missing.push('account');
if (!config.region) missing.push('region');
if (!config.credentialsArn) missing.push('credentialsArn');
if (missing.length > 0) {
  throw new Error(`config.yaml is missing required field(s): ${missing.join(', ')}`);
}

// The task role is scoped to this exact ARN and ECS resolves the secret at task start, so a
// well-formed-but-wrong value costs a full deploy before failing. Three things must hold, and
// each has been observed going wrong: it must be a Secrets Manager secret ARN, and it must
// name the same region and account this stack deploys into.
const credentialsArnParts = config.credentialsArn.split(':');
const [arnLiteral, , credService, credRegion, credAccount, credResourceType] =
  credentialsArnParts;

if (arnLiteral !== 'arn' || credService !== 'secretsmanager' || credResourceType !== 'secret') {
  throw new Error(
    `credentialsArn is not a Secrets Manager secret ARN: "${config.credentialsArn}". ` +
      'Expected arn:<partition>:secretsmanager:<region>:<account>:secret:<name>-<suffix>. ' +
      'Note Secrets Manager appends a random 6-character suffix that must be included.',
  );
}

if (credRegion !== config.region) {
  throw new Error(
    `credentialsArn is in region "${credRegion}" but this stack deploys to "${config.region}". ` +
      'ECS resolves the secret at task start and cannot read one from another region. ' +
      'A partition mismatch lands here too: a commercial "arn:aws:" secret cannot be used ' +
      'from GovCloud, nor an "arn:aws-us-gov:" secret from commercial.',
  );
}

if (credAccount !== config.account) {
  throw new Error(
    `credentialsArn is in account "${credAccount}" but this stack deploys to ` +
      `"${config.account}". A cross-account secret would also need a resource policy on the ` +
      'secret itself, which this stack cannot create because it does not own it.',
  );
}

// Default to the imported-network mode: production targets supply an externally owned
// VPC. Creating a VPC with a NAT gateway is dev-only and not permitted in SCCA.
const networkMode: NetworkMode = config.network?.mode ?? 'imported';

if (networkMode === 'imported') {
  const netMissing: string[] = [];
  if (!config.network?.vpcId) netMissing.push('network.vpcId');
  if (!config.network?.subnetIds || config.network.subnetIds.length === 0) {
    netMissing.push('network.subnetIds');
  }
  if (netMissing.length > 0) {
    throw new Error(
      `network.mode is "imported" so config.yaml requires: ${netMissing.join(', ')}. ` +
        'Ask the team that owns the VPC for these values.',
    );
  }
}

const ecrRepositoryName = config.ecrRepositoryName ?? 'wickr-form-collection-bot';

// fromRepositoryAttributes takes the ARN and the name separately and does not
// cross-check them. A mismatch deploys a task definition pointing at an image URI that
// does not exist, which surfaces only as an opaque pull failure at task start.
if (config.ecrRepositoryArn) {
  const arnRepoName = config.ecrRepositoryArn.split(':repository/')[1];
  if (!arnRepoName) {
    throw new Error(
      `ecrRepositoryArn is not a valid ECR repository ARN: ${config.ecrRepositoryArn}. ` +
        'Expected the form arn:<partition>:ecr:<region>:<account>:repository/<name>.',
    );
  }
  if (arnRepoName !== ecrRepositoryName) {
    throw new Error(
      `ecrRepositoryArn names repository "${arnRepoName}" but ecrRepositoryName is ` +
        `"${ecrRepositoryName}". They must match.`,
    );
  }
}

if (config.permissionsBoundaryArn && !config.permissionsBoundaryArn.includes(':policy/')) {
  throw new Error(
    `permissionsBoundaryArn is not a valid IAM managed policy ARN: ` +
      `${config.permissionsBoundaryArn}. Expected the form ` +
      `arn:<partition>:iam::<account>:policy/<name>.`,
  );
}

const app = new cdk.App({
  defaultStackSynthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
});

// The construct ID stays 'FormCollectionBotStack' regardless of config.stackName. Resource
// logical IDs are derived from the construct path, so keeping the ID fixed means renaming the
// deployed stack does not renumber every resource inside it.
//
// Set stackName to deploy more than one instance into the same account and region -- for
// example a test stack alongside an existing one, which also avoids inheriting a failed or
// mismatched update from a same-named stack deployed earlier.
const stack = new FormCollectionBotStack(app, 'FormCollectionBotStack', {
  stackName: config.stackName,
  credentialsArn: config.credentialsArn,
  isDevelopmentEnv: config.isDevelopmentEnv ?? false,
  ecrRepositoryName: ecrRepositoryName,
  ecrRepositoryArn: config.ecrRepositoryArn,
  imageTag: config.imageTag ?? 'latest',
  integrationName: config.integrationName ?? 'wickr-form-collection-bot',
  // GovCloud requires newer Anthropic models to be invoked through an inference
  // profile, hence the "us-gov." prefix rather than a bare model ID.
  bedrockModelId: config.bedrockModelId ?? 'us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0',
  logLevel: config.logLevel ?? 'INFO',
  reportsBucketName: config.reportsBucketName,
  networkMode,
  useNatGateway: config.network?.useNatGateway ?? true,
  vpcId: config.network?.vpcId,
  subnetIds: config.network?.subnetIds,
  createVpcEndpoints: config.network?.createVpcEndpoints ?? false,
  env: {
    account: config.account,
    region: config.region,
  },
});

// Some organizations deny iam:CreateRole unless the new role carries an approved
// permissions boundary. `cdk bootstrap --custom-permissions-boundary` attaches the
// boundary only to the bootstrap CloudFormationExecutionRole -- it does NOT reach the
// roles this stack creates, so bootstrapping succeeds and the deploy then fails on
// CreateRole. Applying it here puts a PermissionsBoundary property on both the task role
// and the task execution role. Referenced by ARN rather than name because boundary
// policies frequently live under an IAM path, which fromManagedPolicyName cannot express.
if (config.permissionsBoundaryArn) {
  iam.PermissionsBoundary.of(stack).apply(
    iam.ManagedPolicy.fromManagedPolicyArn(
      stack,
      'PermissionsBoundary',
      config.permissionsBoundaryArn,
    ),
  );
}
