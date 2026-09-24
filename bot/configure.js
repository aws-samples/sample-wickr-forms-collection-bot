// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
//
// Interactive configuration for the EC2 / Wickr IO console deployment path
// (docs/DEPLOY-EC2.md). The console runs configure.sh, which runs this file.
//
// It prompts for each token declared in configTokens.json and writes the answers into
// processes.json, which is what WickrIOSvr reads when it starts the bot. The CDK/ECS paths
// do not use this file at all -- there the same values arrive as container environment
// variables set by the stack.

const WickrIOBotAPI = require('wickrio-bot-api');

// Loads .env.configure, which configure.sh writes when you pass it a file of pre-seeded
// answers. This is NOT redundant with configure.sh sourcing that file: `.` sets shell
// variables, and a plain `FOO=bar` without `export` is never inherited by this process.
require('dotenv').config({
  path: '.env.configure',
});

let wickrIOConfigure;

process.stdin.resume();

function exitHandler(options, err) {
  try {
    if (err) {
      process.kill(process.pid);
      process.exit();
    }
    if (options.exit) {
      process.exit();
    } else if (options.pid) {
      process.kill(process.pid);
    }
  } catch (err) {
    console.log(err);
  }
}

process.on('SIGINT', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR1', exitHandler.bind(null, { pid: true }));
process.on('SIGUSR2', exitHandler.bind(null, { pid: true }));
process.on('uncaughtException', exitHandler.bind(null, {
  exit: true,
  reason: 'uncaughtException',
}));

main();

async function main() {
  const tokens = require('./configTokens.json');
  const fullName = process.cwd() + '/processes.json';
  wickrIOConfigure = new WickrIOBotAPI.WickrIOConfigure(
    tokens.tokens,
    fullName,
    tokens.supportAdministrators,
    tokens.supportVerification
  );

  await wickrIOConfigure.configureYourBot(tokens.integration);
  process.exit();
}
