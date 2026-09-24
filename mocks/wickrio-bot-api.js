// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Mock for wickrio-bot-api used by the test suite. test/setup.js redirects
// require('wickrio-bot-api') to this file so tests never load the real native
// addon (which only works inside the Wickr IO container).
//
// Reset between tests with:
//   const mockBotAPI = require('../../mocks/wickrio-bot-api');
//   mockBotAPI._mockWickrAPI._reset();

const { mock } = require('node:test');

// Low-level addon API stubs (returned by bot.getWickrIOAddon())
const _mockWickrAPI = {
  cmdSendRoomMessage: mock.fn(async () => {}),
  cmdSend1to1Message: mock.fn(async () => {}),
  cmdSendRoomAttachment: mock.fn(async () => {}),
  cmdSend1to1Attachment: mock.fn(async () => {}),
  cmdGetKeyValue: mock.fn(() => 'Failure'),
  cmdAddKeyValue: mock.fn(() => {}),
  cmdDeleteKeyValue: mock.fn(() => {}),
  cmdGetRoom: mock.fn(() => '{}'),
  cmdGetRooms: mock.fn(() => '[]'),
  cmdStopAsyncRecvMessages: mock.fn(async () => {}),
  closeClient: mock.fn(async () => {}),
  _reset() {
    for (const key of Object.keys(this)) {
      if (key !== '_reset' && this[key] && this[key].mock) {
        this[key].mock.resetCalls();
      }
    }
  },
};

// High-level bot framework stubs
const _mockBot = {
  start: mock.fn(async () => {}),
  startListening: mock.fn(() => {}),
  getWickrIOAddon: mock.fn(() => _mockWickrAPI),
  parseMessage: mock.fn(() => null),
  getTokenValue: mock.fn(() => ''),
  getMyUser: mock.fn(() => 'test-bot@example.com'),
  close: mock.fn(async () => {}),
};

class WickrIOBot {
  constructor() {
    return _mockBot;
  }
}

module.exports = {
  WickrIOBot,
  _mockBot,
  _mockWickrAPI,
};
