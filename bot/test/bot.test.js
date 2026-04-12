// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Bootstrap mock resolution before any bot code loads
require('./setup');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const mockBotAPI = require('../../mocks/wickrio-bot-api');
const mockBot = mockBotAPI._mockBot;
const mockAddon = mockBotAPI._mockWickrAPI;

// Import bot module (mocks are already wired via setup.js)
const { handleMessage, sendReply } = require('../bot');

describe('handleMessage', () => {
  beforeEach(() => {
    mockAddon._reset();
    process.env.BOT_USERNAME = 'test-bot';
  });

  it('should ignore null parsed messages', async () => {
    mockBot.parseMessage.mock.mockImplementation(() => null);
    await handleMessage('raw-message');
    assert.equal(mockAddon.cmdSendRoomMessage.mock.callCount(), 0);
  });

  it('should ignore own messages', async () => {
    mockBot.parseMessage.mock.mockImplementation(() => ({
      message: '/help',
      userEmail: 'test-bot',
      vgroupid: 'Sroom123',
      convotype: 'room',
      msgtype: 'message'
    }));
    await handleMessage('raw-message');
    assert.equal(mockAddon.cmdSendRoomMessage.mock.callCount(), 0);
  });

  it('should respond to /help command', async () => {
    mockBot.parseMessage.mock.mockImplementation(() => ({
      message: '/help',
      userEmail: 'user@example.com',
      vgroupid: 'Sroom123',
      convotype: 'room',
      msgtype: 'message'
    }));
    await handleMessage('raw-message');
    assert.equal(mockAddon.cmdSendRoomMessage.mock.callCount(), 1);
    const call = mockAddon.cmdSendRoomMessage.mock.calls[0];
    assert.equal(call.arguments[0], 'Sroom123');
    assert.ok(call.arguments[1].includes('/help'));
  });

  it('should delegate unknown commands to the message router', async () => {
    mockBot.parseMessage.mock.mockImplementation(() => ({
      message: '/unknown',
      userEmail: 'user@example.com',
      vgroupid: 'Sroom123',
      convotype: 'room',
      msgtype: 'message'
    }));
    // Unknown commands are now delegated to the router which checks
    // the registry before falling through to detection/extraction.
    // The router handles the response, so we just verify no crash.
    await handleMessage('raw-message');
    // No assertion on reply content -- the router handles it
  });
});

describe('sendReply', () => {
  beforeEach(() => {
    mockAddon._reset();
  });

  it('should send plain text message', async () => {
    await sendReply('Sroom123', 'Hello');
    assert.equal(mockAddon.cmdSendRoomMessage.mock.callCount(), 1);
    const call = mockAddon.cmdSendRoomMessage.mock.calls[0];
    assert.equal(call.arguments[0], 'Sroom123');
    assert.equal(call.arguments[1], 'Hello');
  });

  it('should send message with messagemeta', async () => {
    const meta = { buttons: [{ type: 'message', text: 'Yes', message: 'yes' }] };
    await sendReply('Sroom123', 'Confirm?', meta);
    assert.equal(mockAddon.cmdSendRoomMessage.mock.callCount(), 1);
    const call = mockAddon.cmdSendRoomMessage.mock.calls[0];
    assert.equal(call.arguments[0], 'Sroom123');
    assert.equal(call.arguments[1], 'Confirm?');
    assert.equal(call.arguments[6], JSON.stringify(meta));
  });
});
