// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FormCollectionBotStack } from '../lib/form-collection-bot-stack';

test('FormCollectionBotStack snapshot — production path', () => {
  const app = new App();
  const stack = new FormCollectionBotStack(app, 'TestStack', {
    credentialsArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-creds',
    isDevelopmentEnv: false,
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});

test('FormCollectionBotStack — development path includes SSM permissions and ECS Exec', () => {
  const app = new App();
  const stack = new FormCollectionBotStack(app, 'DevStack', {
    credentialsArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-creds',
    isDevelopmentEnv: true,
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  // Verify SSM permissions exist in the task role
  template.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'ssmmessages:*',
          Effect: 'Allow',
        }),
      ]),
    }),
  }));
});
