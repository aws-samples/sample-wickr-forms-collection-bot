// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Opt-in AWS SDK stubs for tests that load services with lazy AWS SDK imports.
// Keep this separate from setup.js because transcription-service.test.js installs
// specialized S3 and Transcribe fakes of its own.
require('./setup');

const Module = require('module');

const stubKeys = {
  '@aws-sdk/client-bedrock-runtime': '__aws_bedrock_runtime_stub__',
  '@aws-sdk/client-s3': '__aws_s3_stub__',
  '@aws-sdk/client-transcribe': '__aws_transcribe_stub__',
};

let lastPutObjectParams = null;
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  if (stubKeys[request]) return stubKeys[request];
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

function makeStub(name, exports) {
  return {
    id: name,
    filename: name,
    loaded: true,
    exports,
    parent: null,
    children: [],
    paths: [],
  };
}

class Command {
  constructor(input) {
    this.input = input;
    this.params = input;
  }
}

class StubClient {
  async send() {
    throw new Error('Inject a test client before invoking an AWS operation');
  }
}

require.cache[stubKeys['@aws-sdk/client-bedrock-runtime']] = makeStub(
  stubKeys['@aws-sdk/client-bedrock-runtime'],
  {
    BedrockRuntimeClient: StubClient,
    ConverseCommand: Command,
  }
);

require.cache[stubKeys['@aws-sdk/client-s3']] = makeStub(
  stubKeys['@aws-sdk/client-s3'],
  {
    S3Client: class { async send() {} },
    PutObjectCommand: class extends Command {
      constructor(input) {
        super(input);
        lastPutObjectParams = input;
      }
    },
    GetObjectCommand: Command,
    DeleteObjectCommand: Command,
  }
);

require.cache[stubKeys['@aws-sdk/client-transcribe']] = makeStub(
  stubKeys['@aws-sdk/client-transcribe'],
  {
    TranscribeClient: class { async send() {} },
    StartTranscriptionJobCommand: Command,
    GetTranscriptionJobCommand: Command,
  }
);

module.exports = {
  getLastPutObjectParams: () => lastPutObjectParams,
  reset: () => { lastPutObjectParams = null; },
};
