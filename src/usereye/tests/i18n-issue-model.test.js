'use strict';

/**
 * i18n-issue-model — the issue model (title prefixes and expected/actual
 * strings written by `UserEye.addIssue`) must follow `reportLocale`, exactly
 * like findings, scan lines, plan steps, patience and misclick strings do.
 *
 * Historically these six strings were hard-coded English inside user-eye.js
 * (e.g. "The rendered interface does not present this problem."), so a
 * `--report-locale pt` report localized the table header ("Esperado") but the
 * cell below it stayed English. This suite pins the fix.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { section, t } = require('../i18n');

const KEYS = [
  'visualPerceptionExpected',
  'elementVisibleExpected',
  'elementVisiblePass',
  'elementVisibleFail',
  'flowExpected',
  'verificationExpected',
  'verificationFailed',
  'axeExpected',
  'axeAffected',
  'firstImpression',
];

test('i18n: every pack declares the issue-model section with the same keys', () => {
  for (const pack of ['en', 'pt', 'es', 'fr']) {
    const strings = section(pack, 'issue');
    for (const key of KEYS) {
      assert.ok(strings[key], `${pack}.issue.${key} must exist`);
    }
  }
});

test('i18n: pt issue-model strings are translated, not the en text', () => {
  const en = section('en', 'issue');
  const pt = section('pt', 'issue');
  for (const key of KEYS) {
    assert.notEqual(pt[key], en[key], `issue.${key} must be translated in pt`);
  }
});

test('i18n: issue-model templates format their placeholders', () => {
  const en = section('en', 'issue');
  assert.equal(t(en, 'axeExpected', { id: 'color-contrast' }), 'No violation of axe rule “color-contrast”.');
  assert.equal(t(en, 'axeAffected', { count: 3 }), '3 affected element(s).');
});
