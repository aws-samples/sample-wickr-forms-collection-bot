// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const NOT_PROVIDED = '[Not provided]';
const LABEL_SEP = ': ';

const formsById = new Map();
const formsByCommand = new Map();

function loadForms(formsDir) {
  formsById.clear();
  formsByCommand.clear();
  const dir = formsDir || path.join(__dirname, '..', 'forms');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const def = require(path.join(dir, file));
    if (!def.id || !def.fields) {
      logger.error('registry', 'invalid_form_definition', { definitionFile: file });
      continue;
    }
    formsById.set(def.id, def);
    if (def.command) formsByCommand.set(def.command, def);
    logger.info('registry', 'form_registered', { formId: def.id });
  }
}

function getById(formId) { return formsById.get(formId) || null; }
function getByCommand(command) { return formsByCommand.get(command) || null; }
function getAll() { return Array.from(formsById.values()); }
function getAllIds() { return Array.from(formsById.keys()); }

function formatReport(formDef, report) {
  if (formDef._formatOverride) return formDef._formatOverride(report);
  const lines = [formDef.formatHeader];
  for (const field of formDef.fields) {
    if (field.optional && (report[field.key] == null)) continue;
    const value = report[field.key] != null ? report[field.key] : NOT_PROVIDED;
    lines.push(field.label + LABEL_SEP + value);
  }
  lines.push(formDef.formatFooter);
  return lines.join('\n');
}

function formatBroadcast(formDef, report, sender, timestamp) {
  if (formDef._formatBroadcastOverride) return formDef._formatBroadcastOverride(report, sender, timestamp);
  const parts = [formDef.formatHeader, 'Submitted by: ' + sender, 'Timestamp: ' + timestamp, ''];
  for (const field of formDef.fields) {
    if (field.optional && (report[field.key] == null)) continue;
    const value = report[field.key] != null ? report[field.key] : NOT_PROVIDED;
    parts.push(field.label + LABEL_SEP + value);
  }
  parts.push(formDef.formatFooter);
  return parts.join('\n');
}

function parseReport(formDef, text) {
  if (formDef._parseOverride) return formDef._parseOverride(text);
  const result = {};
  for (const field of formDef.fields) { result[field.key] = null; }
  if (!text) return result;
  for (const rawLine of text.split('\n')) {
    for (const field of formDef.fields) {
      const prefix = field.label + LABEL_SEP;
      if (rawLine.startsWith(prefix)) {
        const value = rawLine.slice(prefix.length);
        result[field.key] = (value === '' || value === NOT_PROVIDED) ? null : value;
        break;
      }
    }
  }
  return result;
}

function createReport(formDef, fields) {
  const report = {};
  for (const field of formDef.fields) {
    report[field.key] = (fields && fields[field.key] !== undefined) ? fields[field.key] : null;
  }
  return report;
}

function isValidReport(formDef, report) {
  if (!report || typeof report !== 'object') return false;
  for (const field of formDef.fields) {
    if (field.type === 'enum' && report[field.key] != null && report[field.key] !== NOT_PROVIDED) {
      if (!field.validValues.includes(report[field.key])) return false;
    }
  }
  return true;
}

/**
 * Returns an array of required fields that are missing (value is NOT_PROVIDED or null).
 * Fields with optional: true are skipped.
 * @param {object} formDef
 * @param {object} report
 * @returns {Array<{key: string, label: string}>}
 */
function getMissingRequiredFields(formDef, report) {
  if (!report || typeof report !== 'object') return [];
  const missing = [];
  for (const field of formDef.fields) {
    if (field.optional) continue;
    const val = report[field.key];
    if (val == null || val === NOT_PROVIDED || (typeof val === 'string' && val.trim() === '')) {
      missing.push({ key: field.key, label: field.label });
    }
  }
  return missing;
}

function normalizeReport(formDef, raw) {
  const r = raw || {};
  const report = {};
  for (const field of formDef.fields) {
    const val = r[field.key];
    if (field.type === 'enum') {
      if (!val || typeof val !== 'string') { report[field.key] = NOT_PROVIDED; continue; }
      const upper = val.trim().toUpperCase();
      report[field.key] = field.validValues.includes(upper) ? upper : NOT_PROVIDED;
    } else {
      if (!val || typeof val !== 'string' || val.trim() === '') {
        report[field.key] = field.optional ? null : NOT_PROVIDED;
      } else {
        report[field.key] = val.trim();
      }
    }
  }
  return report;
}

module.exports = {
  loadForms, getById, getByCommand, getAll, getAllIds,
  formatReport, formatBroadcast, parseReport, createReport,
  isValidReport, getMissingRequiredFields, normalizeReport, NOT_PROVIDED, LABEL_SEP,
  _formsById: formsById, _formsByCommand: formsByCommand,
};
