// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const WickrIOBotAPI = require('wickrio-bot-api');
const bot = new WickrIOBotAPI.WickrIOBot();
const logger = require('./services/logger');

let isShuttingDown = false;

// ── Lazy service loaders ───────────────────────────────────────────────────────
// Services are required lazily (on first use) so that test files can pre-populate
// require.cache with stubs BEFORE the first message is handled, without needing
// to stub AWS SDK packages at test setup time.

function getMessageRouter() {
  return require('./services/message-router');
}

function getRegistry() {
  return require('./services/form-registry');
}

function getDeliveryService() {
  return require('./services/delivery-service');
}


async function handleMessage(rawMessage) {
  if (isShuttingDown) return;

  let parsed;
  try {
    parsed = bot.parseMessage(rawMessage);
  } catch (err) {
    logger.error('bot', 'parse_failed', { error: err });
    return;
  }

  // Discard null/malformed messages and messages with no sender
  if (!parsed || !parsed.userEmail) return;

  // Build a bound sendReply closure for this conversation
  const reply = (targetVgroupid, message, messagemeta) =>
    sendReply(targetVgroupid, message, messagemeta);

  // All routing (self-message filtering, commands, files, confirmation flow)
  // lives in the message router -- single place to trace.
  try {
    await getMessageRouter().route(parsed, reply, bot.getWickrIOAddon());
  } catch (error) {
    logger.error('bot', 'message_handling_error', { error });
  }
}

async function sendReply(vgroupid, message, messagemeta) {
  try {
    const wickrAPI = bot.getWickrIOAddon();
    if (messagemeta) {
      const metaStr = JSON.stringify(messagemeta);
      await wickrAPI.cmdSendRoomMessage(vgroupid, message, '', '', '', [], metaStr);
    } else {
      await wickrAPI.cmdSendRoomMessage(vgroupid, message);
    }
  } catch (error) {
    logger.error('bot', 'send_failed', { error });
  }
}

async function main() {
  const username = process.env.BOT_USERNAME;
  if (!username) {
    logger.error('bot', 'missing_env', { variable: 'BOT_USERNAME' });
    process.exit(1);
  }

  const startupTimer = logger.startTimer();
  logger.info('bot', 'bot_starting', { botUsername: username, nodeVersion: process.version, pid: process.pid });
  await bot.start(username);

  // Load form registry
  getRegistry().loadForms();
  const formIds = getRegistry().getAllIds();
  logger.info('bot', 'registry_loaded', { formCount: formIds.length, formIds });

  const wickrAPI = bot.getWickrIOAddon();

  // Load delivery configs for all registered forms
  for (const formDef of getRegistry().getAll()) {
    try {
      await getDeliveryService().loadOutputConfigs(wickrAPI, formDef);
    } catch (err) {
      logger.error('bot', 'delivery_config_load_failed', { formId: formDef.id, error: err });
    }
  }

  bot.startListening(handleMessage);
  logger.info('bot', 'bot_ready', { startupDurationMs: startupTimer.elapsed() });
}

process.on('SIGTERM', async () => {
  logger.info('bot', 'bot_shutdown', { reason: 'SIGTERM' });
  isShuttingDown = true;
  try {
    await bot.close();
  } catch (e) {
    // bot.close() may not exist in all environments — fall back to raw addon calls
    try {
      const wickrAPI = bot.getWickrIOAddon();
      await wickrAPI.cmdStopAsyncRecvMessages();
      await wickrAPI.closeClient();
    } catch (_) {
      // Ignore all shutdown errors
    }
  }
  process.exit(0);
});

// Only auto-start when run directly (not when required by tests)
if (require.main === module) {
  main().catch(function (err) {
    logger.error('bot', 'bot_fatal', { error: err });
    process.exit(1);
  });
}

module.exports = { handleMessage, sendReply, bot, main };
