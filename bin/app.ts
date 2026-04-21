// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import * as yaml from 'js-yaml';
import { FormCollectionBotStack } from '../lib/form-collection-bot-stack';

interface AppConfig {
  account: string;
  region: string;
  credentialsArn: string;
  vpcId?: string;
  isDevelopmentEnv?: boolean;
}

let configData: string;
try {
  configData = fs.readFileSync('config.yaml', 'utf8');
} catch {
  throw new Error(
    'config.yaml not found. Copy config.example.yaml to config.yaml and fill in your values.',
  );
}

const config = yaml.load(configData) as AppConfig;

// Validate required fields
const missing: string[] = [];
if (!config.account) missing.push('account');
if (!config.region) missing.push('region');
if (!config.credentialsArn) missing.push('credentialsArn');
if (missing.length > 0) {
  throw new Error(`config.yaml is missing required field(s): ${missing.join(', ')}`);
}

const app = new cdk.App();

new FormCollectionBotStack(app, 'FormCollectionBotStack', {
  credentialsArn: config.credentialsArn,
  vpcId: config.vpcId,
  isDevelopmentEnv: config.isDevelopmentEnv ?? true,
  env: {
    account: config.account,
    region: config.region,
  },
} as any);
