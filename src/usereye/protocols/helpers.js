'use strict';

const { loadPatterns } = require('../patterns');

// Kept for the v5 compatibility surface. New protocols use runner.patterns.
const DANGER = loadPatterns({ packs: ['en', 'pt'] }).dangerous;

function fnv(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return String(value >>> 0);
}

module.exports = { DANGER, fnv };
