'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserEnv } = require('./helpers/browser-env');
const { collectHumanSignals } = require('../browser-human');

function human(html, consent) {
  const env = createBrowserEnv(html);
  return env.evaluate(collectHumanSignals, { profile: 'desktop', consent });
}

function codes(result) {
  return Array.from(result.findings, finding => finding.code);
}

const BANNER = (inner = 'We use cookies to improve your experience.') =>
  `<div data-rect="0,450,1440,450" style="position:fixed">${inner}</div>`;

test('consent: default flags a real fixed full-layer cookie banner', () => {
  const result = human(BANNER('We use cookies. <button>Accept all</button>'));
  assert.ok(codes(result).includes('consent-wall'));
  assert.ok(result.consentWalls.length >= 1);
});

test('consent: default flags a fixed layer even without an explicit control', () => {
  // Back-compat: a big fixed banner with consent copy is still a wall by default.
  const result = human(BANNER('We use cookies to improve your experience. Accept all'));
  assert.ok(codes(result).includes('consent-wall'));
});

test('consent: static (non-layer) marketing copy is NOT a wall', () => {
  // A large in-flow section that merely mentions cookies is not an overlay.
  const result = human(
    `<section data-rect="0,100,1440,500">We use cookies to improve your experience. Read our privacy policy here.</section>`,
  );
  assert.ok(!codes(result).includes('consent-wall'));
});

test('consent: strict mode requires an accept/reject control', () => {
  const noControl = human(BANNER('We use cookies to improve your experience. Accept all'), {
    strict: true,
  });
  assert.ok(!codes(noControl).includes('consent-wall'), 'no interactive control -> not strict-flagged');

  const withControl = human(BANNER('We use cookies. <button>Accept all</button>'), {
    strict: true,
  });
  assert.ok(codes(withControl).includes('consent-wall'), 'control present -> strict-flagged');
});

test('consent: minWallArea override can relax or tighten the threshold', () => {
  // Half-screen layer (0.5 ratio): not a wall when the threshold is raised to 0.7.
  const tight = human(BANNER('We use cookies. <button>Accept all</button>'), { minWallArea: 0.7 });
  assert.ok(!codes(tight).includes('consent-wall'));
  const loose = human(BANNER('We use cookies. <button>Accept all</button>'), { minWallArea: 0.2 });
  assert.ok(codes(loose).includes('consent-wall'));
});
