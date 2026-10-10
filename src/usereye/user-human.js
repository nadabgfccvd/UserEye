'use strict';

const { collectHumanSignals } = require('./browser-human');
const { findingStrings } = require('./i18n');

async function captureHuman(page, options = {}) {
  return page.evaluate(collectHumanSignals, {
    profile: options.profile || 'desktop',
    strings: findingStrings(options.locale || 'en'),
    consent: options.consent || {},
  });
}

function thirdPartyInventory(requests = [], pageUrl = '') {
  let pageOrigin = '';
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    pageOrigin = '';
  }
  const byOrigin = new Map();
  for (const request of requests) {
    let origin = '';
    try {
      origin = new URL(request.url).origin;
    } catch {
      continue;
    }
    if (!origin || origin === pageOrigin || origin === 'null') {
      continue;
    }
    const current = byOrigin.get(origin) || { origin, count: 0, types: {} };
    current.count += 1;
    const type = request.resourceType || 'other';
    current.types[type] = (current.types[type] || 0) + 1;
    byOrigin.set(origin, current);
  }
  return {
    pageOrigin,
    origins: [...byOrigin.values()].sort((first, second) => second.count - first.count).slice(0, 24),
  };
}

module.exports = { captureHuman, thirdPartyInventory };
