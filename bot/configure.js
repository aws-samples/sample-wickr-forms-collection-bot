// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const WickrIOBotAPI = require('wickrio-bot-api');

const { exec, execSync, execFileSync } = require('child_process');

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
