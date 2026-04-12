// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Test setup for Wickr IO bot testing.
//
// This module configures mock resolution so that:
//   require('wickrio-bot-api')  -> resolves to ../../mocks/wickrio-bot-api.js
//   require('wickrio_addon')    -> resolves to ../../mocks/wickrio_addon.js
//
// Usage: require this file at the top of every test file:
//   require('./setup');
//
// The mocks use Node.js built-in test runner (node:test) mock functions.
// Reset mocks between tests by calling:
//   const mockBotAPI = require('../../mocks/wickrio-bot-api');
//   mockBotAPI._mockWickrAPI._reset();

const Module = require('module');
const path = require('path');

const mocksDir = path.resolve(__dirname, '..', '..', 'mocks');

const mockMap = {
  'wickrio-bot-api': path.join(mocksDir, 'wickrio-bot-api.js'),
  'wickrio_addon': path.join(mocksDir, 'wickrio_addon.js'),
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (mockMap[request]) {
    return mockMap[request];
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
