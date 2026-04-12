// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const { mock } = require('node:test');

const _mockWickrAPI = {
  cmdSendRoomMessage: mock.fn(async () => {}),
  cmdGetKeyValue: mock.fn(() => ''),
  cmdSetKeyValue: mock.fn(() => {}),
  cmdStopAsyncRecvMessages: mock.fn(async () => {}),
  closeClient: mock.fn(async () => {}),
  _reset() {
    this.cmdSendRoomMessage.mock.resetCalls();
    this.cmdGetKeyValue.mock.resetCalls();
    this.cmdSetKeyValue.mock.resetCalls();
    this.cmdStopAsyncRecvMessages.mock.resetCalls();
    this.closeClient.mock.resetCalls();
  },
};

const _mockBot = {
  parseMessage: mock.fn(() => null),
  start: mock.fn(async () => {}),
  startListening: mock.fn(() => {}),
  getWickrIOAddon: mock.fn(() => _mockWickrAPI),
  close: mock.fn(async () => {}),
};

class WickrIOBot {
  constructor() {
    return _mockBot;
  }
}

class WickrIOConfigure {
  constructor() {}
  async configureYourBot() {}
}

module.exports = {
  WickrIOBot,
  WickrIOConfigure,
  _mockBot,
  _mockWickrAPI,
};
