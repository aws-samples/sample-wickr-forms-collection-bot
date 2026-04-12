// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const logger = require('./logger');
const deliveryService = require('./delivery-service');

async function handle(formDef, parsed, args, vgroupid, sendReply, wickrAPI, options) {
  const correlationId = options && options.correlationId;
  const parts = (args || '').trim().split(/\s+/);
  const subcommand = (parts[0] || '').toLowerCase();
  const subArgs = parts.slice(1).join(' ').trim();

  switch (subcommand) {
    case 'help':
      await handleHelp(formDef, vgroupid, sendReply);
      break;
    case 'set-room':
      await handleSetRoom(formDef, vgroupid, sendReply, wickrAPI);
      break;
    case 'set-webhook':
      await handleSetWebhook(formDef, subArgs, vgroupid, sendReply, wickrAPI, correlationId);
      break;
    case 'status':
      await handleStatus(formDef, vgroupid, sendReply);
      break;
    default:
      await sendReply(vgroupid,
        subcommand
          ? `Unknown ${formDef.command} sub-command: "${subcommand}". Type "${formDef.command} help".`
          : `Missing sub-command. Type "${formDef.command} help".`);
      break;
  }
}

async function handleHelp(formDef, vgroupid, sendReply) {
  const lines = [`${formDef.name} -- Help`, ''];

  // Show fields
  lines.push('Fields:');
  for (const field of formDef.fields) {
    const typeTag = field.type === 'enum' ? ` (${field.validValues.join(', ')})` : '';
    const optTag = field.optional ? ' [optional]' : '';
    lines.push(`  ${field.label}${typeTag}${optTag}`);
  }
  lines.push('');

  // Show example input if defined
  if (formDef.exampleInput) {
    lines.push('Example input:');
    lines.push(`  "${formDef.exampleInput}"`);
    lines.push('');
  }

  // Show admin commands
  lines.push('Admin Commands:');
  lines.push(`  ${formDef.command} help`, `    Show this help message.`);
  lines.push(`  ${formDef.command} status`, `    Show configuration status.`);

  const hasRoom = (formDef.outputs || []).some(o => o.type === 'wickr-room');
  const hasWebhook = (formDef.outputs || []).some(o => o.type === 'webhook');

  if (hasRoom) {
    lines.push(`  ${formDef.command} set-room`,
      `    Set the current room as the broadcast room.`);
  }
  if (hasWebhook) {
    lines.push(`  ${formDef.command} set-webhook <url>`,
      `    Set the webhook URL for delivery.`);
  }
  await sendReply(vgroupid, lines.join('\n').trimEnd());
}

async function handleSetRoom(formDef, vgroupid, sendReply, wickrAPI) {
  const roomOutput = (formDef.outputs || []).find(o => o.type === 'wickr-room');
  if (!roomOutput) {
    await sendReply(vgroupid, `${formDef.name} does not have a Wickr room output configured.`);
    return;
  }
  if (!vgroupid || !vgroupid.startsWith('S')) {
    await sendReply(vgroupid,
      `Error: "${formDef.command} set-room" must be run from within the target room, not a DM.`);
    return;
  }
  await deliveryService.saveConfig(wickrAPI, roomOutput.kvKey, vgroupid);
  await sendReply(vgroupid,
    `${formDef.name} broadcast room configured. This room (${vgroupid}) will receive confirmed reports.`);
}

async function handleSetWebhook(formDef, urlArg, vgroupid, sendReply, wickrAPI, correlationId) {
  const webhookOutput = (formDef.outputs || []).find(o => o.type === 'webhook');
  if (!webhookOutput) {
    await sendReply(vgroupid, `${formDef.name} does not have a webhook output configured.`);
    return;
  }
  // Extract URL from the full message text to handle Wickr's URL encoding
  // urlArg may contain mangled text -- search the entire args for an https:// URL
  const fullArgs = (urlArg || '').trim();
  if (!fullArgs) {
    const current = deliveryService.getConfig(webhookOutput.kvKey);
    await sendReply(vgroupid,
      current ? `${formDef.name} webhook URL: ${current}` : `${formDef.name} webhook URL: (not configured)`);
    return;
  }
  // Log URL parsing attempt without raw hex bytes or the URL itself (PII)
  logger.debug('form-cmd', 'set_webhook_parse', { correlationId, argsLength: fullArgs.length });

  // Wickr auto-links URLs in chat, injecting markdown-style link syntax like:
  //   https://example.com/path](https://example.com/path)
  // The regex must stop at ] ( ) and other markdown/invisible chars to capture
  // only the first clean URL occurrence.
  const match = fullArgs.match(/https?:\/\/[^\s<>"'\]\[\(\)\u200b-\u200f\ufeff]+/i);
  const cleanUrl = match
    ? match[0].replace(/[^\x20-\x7E]/g, '').replace(/\/+$/, '').trim()
    : fullArgs.replace(/[^\x20-\x7E]/g, '').trim();
  logger.debug('form-cmd', 'set_webhook_resolved', { correlationId, hasCleanUrl: !!cleanUrl });

  if (!cleanUrl) {
    await sendReply(vgroupid, `Could not extract a URL from your message. Raw text received: "${fullArgs}"`);
    return;
  }

  // Validate that the resolved value is an HTTP(S) URL
  if (!/^https?:\/\//i.test(cleanUrl)) {
    await sendReply(vgroupid, `Invalid URL: "${cleanUrl}". Webhook URL must start with http:// or https://.`);
    return;
  }

  await deliveryService.saveConfig(wickrAPI, webhookOutput.kvKey, cleanUrl);
  await sendReply(vgroupid, `${formDef.name} webhook configured: ${cleanUrl}`);
}

async function handleStatus(formDef, vgroupid, sendReply) {
  const lines = [`${formDef.name} -- Status`, '',
    `Bot Username: ${process.env.BOT_USERNAME || '(unknown)'}`, ''];
  for (const output of (formDef.outputs || [])) {
    switch (output.type) {
      case 'wickr-room': {
        const room = deliveryService.getConfig(output.kvKey);
        lines.push(`Wickr Room: ${room || '(not configured)'}`);
        break;
      }
      case 's3': {
        const bucket = process.env[output.bucketEnvVar];
        lines.push(`S3 Bucket: ${bucket || '(not configured)'}`);
        lines.push(`S3 Prefix: ${output.prefix || '(none)'}`);
        break;
      }
      case 'webhook': {
        const url = deliveryService.getConfig(output.kvKey);
        lines.push(`Webhook URL: ${url || '(not configured)'}`);
        break;
      }
    }
  }
  await sendReply(vgroupid, lines.join('\n'));
}

module.exports = { handle };
