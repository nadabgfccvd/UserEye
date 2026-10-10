'use strict';

const fs = require('fs');
const path = require('path');

const CATEGORIES = [
  'auth',
  'authPage',
  'setupPage',
  'dangerous',
  'write',
  'navigation',
  'utility',
  'skipLink',
  'copy',
  'errorPage',
  'emptyPage',
];

function readPack(reference, baseDir = process.cwd()) {
  const builtIn = path.join(__dirname, `${reference}.json`);
  const filePath = fs.existsSync(builtIn) ? builtIn : path.resolve(baseDir, reference);
  if (!fs.existsSync(filePath)) throw new Error(`Pattern pack not found: ${reference}`);
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return value;
}

function fragment(value) {
  if (value instanceof RegExp) return { source: value.source, flags: value.flags };
  const string = String(value || '');
  const literal = string.match(/^\/(.*)\/([a-z]*)$/i);
  return literal ? { source: literal[1], flags: literal[2] } : { source: string, flags: 'i' };
}

function compile(values, fallback = '(?!)') {
  const items = (Array.isArray(values) ? values : [values]).filter(
    value => value !== undefined && value !== null && value !== '',
  );
  if (!items.length) return new RegExp(fallback, 'i');
  const pieces = items.map(fragment);
  const flags = pieces.some(item => item.flags.includes('u')) ? 'iu' : 'i';
  return new RegExp(pieces.map(item => `(?:${item.source})`).join('|'), flags);
}

function serializePatterns(patterns) {
  return Object.fromEntries(
    Object.entries(patterns).map(([key, value]) => [
      key,
      {
        source: value.source,
        flags: value.flags,
      },
    ]),
  );
}

function loadPatterns({ packs = ['en'], custom = {}, baseDir = process.cwd() } = {}) {
  const merged = Object.fromEntries(CATEGORIES.map(category => [category, []]));
  for (const packName of packs || ['en']) {
    const pack = readPack(packName, baseDir);
    for (const category of CATEGORIES) {
      if (pack[category] !== undefined)
        merged[category].push(...(Array.isArray(pack[category]) ? pack[category] : [pack[category]]));
    }
  }
  for (const category of CATEGORIES) {
    if (custom?.[category] !== undefined) {
      merged[category].push(...(Array.isArray(custom[category]) ? custom[category] : [custom[category]]));
    }
  }
  return Object.fromEntries(CATEGORIES.map(category => [category, compile(merged[category])]));
}

module.exports = { CATEGORIES, readPack, compile, loadPatterns, serializePatterns };
