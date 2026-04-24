// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const WickrIOBotAPI = require('wickrio-bot-api');
const bot = new WickrIOBotAPI.WickrIOBot();
const logger = require('./services/logger');

let isShuttingDown = false;

// ── Lazy service loaders ───────────────────────────────────────────────────────
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
  if (isShuttingDown) {
    logger.info('bot', 'message_skipped_shutting_down', { pid: process.pid });
    return;
  }

  // Log every raw message at the earliest possible point
  logger.info('bot', 'raw_message_received', {
    pid: process.pid,
    rawLength: rawMessage ? rawMessage.length : 0,
    rawPreview: rawMessage ? rawMessage.substring(0, 200) : '<null>'
  });

  let parsed;
  try {
    parsed = bot.parseMessage(rawMessage);
  } catch (err) {
    logger.error('bot', 'parse_failed', { pid: process.pid, error: err });
    return;
  }

  // Discard null/malformed messages
  if (!parsed) {
    logger.info('bot', 'message_discarded_null', { pid: process.pid });
    return;
  }

  // Discard messages with no sender
  const sender = parsed.userEmail;
  if (!sender) {
    logger.info('bot', 'message_discarded_no_sender', {
      pid: process.pid,
      msgtype: parsed.msgtype,
      vgroupid: parsed.vgroupid
    });
    return;
  }

  // Property 9: discard own messages
  if (sender === process.env.BOT_USERNAME) {
    logger.info('bot', 'message_discarded_self', {
      pid: process.pid,
      sender,
      BOT_USERNAME: process.env.BOT_USERNAME
    });
    return;
  }

  logger.info('bot', 'message_accepted', {
    pid: process.pid,
    sender,
    vgroupid: parsed.vgroupid,
    msgtype: parsed.msgtype,
    convotype: parsed.convotype,
    textPreview: (parsed.message || '').substring(0, 100),
    isFile: !!parsed.isFile,
    isVoiceMemo: !!parsed.isVoiceMemo
  });

  const vgroupid = parsed.vgroupid;
  const wickrAPI = bot.getWickrIOAddon();

  const reply = (targetVgroupid, message, messagemeta) =>
    sendReply(targetVgroupid, message, messagemeta);

  try {
    const text = (parsed.message || '').trim();

    // ── File messages ────────────────────────────────────────────────────────
    if (parsed.isFile || parsed.msgtype === 'file') {
      logger.info('bot', 'routing_to_file_handler', { pid: process.pid, sender });
      await getMessageRouter().handleNonCommand(parsed, reply, wickrAPI);
      return;
    }

    // ── Command routing ──────────────────────────────────────────────────────
    const isCommand = text.startsWith('/');
    const command = isCommand ? text.split(/\s+/)[0].toLowerCase() : null;

    if (isCommand) {
      logger.info('bot', 'routing_command', { pid: process.pid, command, sender });
    } else {
      logger.info('bot', 'routing_non_command', { pid: process.pid, sender, textPreview: text.substring(0, 80) });
    }

    switch (command) {
      case '/help': {
        const forms = getRegistry().getAll();
        const formHelp = forms.filter(f => f.command)
          .map(f => f.command + ' help - ' + f.name + ' commands').join('\n');
        await sendReply(
          vgroupid,
          'Available commands:\n' + formHelp +
          '\n/set-rooms - Set this room as broadcast room for all (or selected) forms' +
          '\n/status - Show delivery configuration for all forms' +
          '\n/help - Show this message\n\n' +
          'Send any text or voice memo to submit a report.\n' +
          'The bot will auto-detect the report type.'
        );
        break;
      }

      case '/set-rooms': {
        if (!vgroupid || !vgroupid.startsWith('S')) {
          await sendReply(vgroupid, 'Error: /set-rooms must be run from within the target room, not a DM.');
          break;
        }
        const args = text.substring('/set-rooms'.length).trim();
        const forms = getRegistry().getAll();
        const roomOutputs = [];

        if (args) {
          // User specified form IDs: /set-rooms SALUTE MEDEVAC CAS
          const requestedIds = args.toUpperCase().split(/[\s,]+/);
          for (const id of requestedIds) {
            const formDef = getRegistry().getById(id);
            if (!formDef) {
              await sendReply(vgroupid, `Unknown form type: ${id}. Skipping.`);
              continue;
            }
            const roomOut = (formDef.outputs || []).find(o => o.type === 'wickr-room');
            if (roomOut) roomOutputs.push({ formDef, roomOut });
          }
        } else {
          // No args: set all forms
          for (const formDef of forms) {
            const roomOut = (formDef.outputs || []).find(o => o.type === 'wickr-room');
            if (roomOut) roomOutputs.push({ formDef, roomOut });
          }
        }

        if (roomOutputs.length === 0) {
          await sendReply(vgroupid, 'No forms with Wickr room output found.');
          break;
        }

        const results = [];
        for (const { formDef, roomOut } of roomOutputs) {
          await getDeliveryService().saveConfig(wickrAPI, roomOut.kvKey, vgroupid);
          results.push(formDef.name);
        }
        await sendReply(vgroupid,
          `Broadcast room set for ${results.length} form(s):\n` +
          results.map(n => `  - ${n}`).join('\n') +
          `\n\nThis room (${vgroupid}) will receive confirmed reports.`);
        break;
      }

      case '/status': {
        const forms = getRegistry().getAll();
        const lines = ['=== Delivery Status ===', ''];
        for (const formDef of forms) {
          lines.push(`${formDef.name} (${formDef.id}):`);
          for (const output of (formDef.outputs || [])) {
            switch (output.type) {
              case 'wickr-room': {
                const room = getDeliveryService().getConfig(output.kvKey);
                lines.push(`  Room: ${room || '(not configured)'}`);
                break;
              }
              case 's3': {
                const bucket = process.env[output.bucketEnvVar];
                lines.push(`  S3: ${bucket ? bucket + '/' + (output.prefix || '') : '(not configured)'}`);
                break;
              }
              case 'webhook': {
                const url = getDeliveryService().getConfig(output.kvKey);
                lines.push(`  Webhook: ${url || '(not configured)'}`);
                break;
              }
            }
          }
          lines.push('');
        }
        await sendReply(vgroupid, lines.join('\n'));
        break;
      }

      default:
        if (isCommand) {
          await getMessageRouter().route(parsed, reply, wickrAPI);
        } else {
          logger.info('bot', 'calling_handleNonCommand', { pid: process.pid, sender });
          await getMessageRouter().handleNonCommand(parsed, reply, wickrAPI);
          logger.info('bot', 'handleNonCommand_returned', { pid: process.pid, sender });
        }
        break;
    }
  } catch (error) {
    logger.error('bot', 'message_handling_error', { pid: process.pid, error });
  }
}

async function sendReply(vgroupid, message, messagemeta) {
  logger.info('bot', 'sendReply_called', {
    pid: process.pid,
    vgroupid,
    messagePreview: (message || '').substring(0, 100),
    hasMeta: !!messagemeta
  });
  try {
    const wickrAPI = bot.getWickrIOAddon();
    if (messagemeta) {
      const metaStr = JSON.stringify(messagemeta);
      await wickrAPI.cmdSendRoomMessage(vgroupid, message, '', '', '', [], metaStr);
    } else {
      await wickrAPI.cmdSendRoomMessage(vgroupid, message);
    }
    logger.info('bot', 'sendReply_success', { pid: process.pid, vgroupid });
  } catch (error) {
    logger.error('bot', 'send_failed', { pid: process.pid, vgroupid, error });
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
  logger.info('bot', 'process_info', {
    pid: process.pid,
    ppid: process.ppid,
    argv: process.argv,
    execPath: process.execPath
  });
  logger.info('bot', 'env_dump', {
    BOT_USERNAME: process.env.BOT_USERNAME || '<not set>',
    AWS_REGION: process.env.AWS_REGION || '<not set>',
    BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID || '<not set>',
    REPORTS_BUCKET: process.env.REPORTS_BUCKET || '<not set>',
    LOG_LEVEL: process.env.LOG_LEVEL || '<not set>'
  });

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
  logger.info('bot', 'bot_ready', { pid: process.pid, startupDurationMs: startupTimer.elapsed() });
}

process.on('SIGTERM', async () => {
  logger.info('bot', 'bot_shutdown', { reason: 'SIGTERM', pid: process.pid });
  isShuttingDown = true;
  try {
    await bot.close();
  } catch (e) {
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
