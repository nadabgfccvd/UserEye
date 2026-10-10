'use strict';

/**
 * Unit tests for `run-diff.js` → `compareResults` (roadmap 7.5.0 item 1.2 / A1).
 *
 * This module is the basis of `--compare` and of the Action's baseline handling, yet
 * until 7.5.1 it had no dedicated test: `regression-gates.test.js` injects synthetic
 * diffs into `evaluateQualityGates` and never exercises the real function (11.69%
 * measured coverage). Everything below runs the real thing.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { compareResults } = require('../run-diff');

function issue(overrides = {}) {
  return {
    id: 'issue-1',
    code: 'contrast-low',
    severity: 'major',
    title: 'Low contrast',
    confidence: 'high',
    kind: 'defect',
    fingerprint: 'fp-1',
    // Fields the delta must NOT copy (evidence blobs stay in result.json).
    evidence: { screenshot: 'huge.png' },
    surfaced: true,
    ...overrides,
  };
}

const slim = ['id', 'severity', 'title', 'confidence', 'kind', 'code', 'fingerprint'];

test('run-diff: introduced / resolved / persisted are keyed by fingerprint', () => {
  const previous = {
    issues: [issue({ fingerprint: 'stay' }), issue({ id: 'gone', fingerprint: 'gone' })],
  };
  const current = {
    issues: [
      // Same fingerprint, different id and title: still the SAME finding (persisted).
      issue({ id: 'renamed', title: 'Contrast still low', fingerprint: 'stay' }),
      issue({ id: 'new', fingerprint: 'new', severity: 'critical' }),
    ],
  };
  const diff = compareResults(previous, current);

  assert.deepEqual(
    diff.issues.introduced.map(entry => entry.fingerprint),
    ['new'],
  );
  assert.deepEqual(
    diff.issues.resolved.map(entry => entry.fingerprint),
    ['gone'],
  );
  assert.deepEqual(
    diff.issues.persisted.map(entry => entry.fingerprint),
    ['stay'],
  );
  assert.equal(diff.issues.introducedCount, 1);
  assert.equal(diff.issues.resolvedCount, 1);
  assert.equal(diff.issues.persistedCount, 1);

  // The persisted entry describes the CURRENT run (fresh id/title), not the baseline.
  assert.equal(diff.issues.persisted[0].id, 'renamed');
  assert.equal(diff.issues.persisted[0].title, 'Contrast still low');
  // The resolved entry can only come from the baseline.
  assert.equal(diff.issues.resolved[0].id, 'gone');
});

test('run-diff: delta entries carry classification only, never evidence', () => {
  const diff = compareResults({ issues: [] }, { issues: [issue()] });
  const [entry] = diff.issues.introduced;
  assert.deepEqual(Object.keys(entry).sort(), [...slim].sort());
  assert.equal(entry.severity, 'major');
  assert.equal(entry.confidence, 'high');
  assert.equal(entry.kind, 'defect');
  assert.equal(entry.code, 'contrast-low');
  assert.equal('evidence' in entry, false);
  assert.equal('surfaced' in entry, false);
});

test('run-diff: entries without a fingerprint fall back to id, then code (old baselines)', () => {
  // A 7.0-era baseline had no fingerprints; a hand-written one may have neither
  // fingerprint nor id. The fallback chain keeps `--compare` usable across schemas.
  const previous = {
    issues: [
      { id: 'by-id', severity: 'minor', title: 'Keyed by id' },
      { code: 'by-code', severity: 'minor', title: 'Keyed by code' },
    ],
  };
  const current = {
    issues: [
      { id: 'by-id', severity: 'minor', title: 'Keyed by id (again)' },
      { code: 'by-code', severity: 'minor', title: 'Keyed by code (again)' },
      { code: 'fresh', severity: 'minor', title: 'Brand new, code-only' },
    ],
  };
  const diff = compareResults(previous, current);
  assert.deepEqual(
    diff.issues.persisted.map(entry => entry.title),
    ['Keyed by id (again)', 'Keyed by code (again)'],
  );
  assert.deepEqual(
    diff.issues.introduced.map(entry => entry.code),
    ['fresh'],
  );
  assert.equal(diff.issues.resolvedCount, 0);
});

test('run-diff: a fingerprint takes precedence over a matching id', () => {
  // Same id, different fingerprint => the finding moved (different element/page):
  // report it as resolved + introduced rather than silently "persisted".
  const previous = { issues: [issue({ id: 'same', fingerprint: 'fp-a' })] };
  const current = { issues: [issue({ id: 'same', fingerprint: 'fp-b' })] };
  const diff = compareResults(previous, current);
  assert.equal(diff.issues.persistedCount, 0);
  assert.equal(diff.issues.introducedCount, 1);
  assert.equal(diff.issues.resolvedCount, 1);
});

test('run-diff: missing or empty issue lists compare cleanly', () => {
  for (const [previous, current] of [
    [{}, {}],
    [{ issues: undefined }, { issues: null }],
    [{ issues: [] }, {}],
  ]) {
    const diff = compareResults(previous, current);
    assert.deepEqual(diff.issues, {
      introduced: [],
      resolved: [],
      persisted: [],
      introducedCount: 0,
      resolvedCount: 0,
      persistedCount: 0,
    });
  }
  // Defaults for both arguments.
  assert.equal(compareResults().issues.introducedCount, 0);
});

test('run-diff: primary CTA change is detected via name, falling back to text', () => {
  const same = compareResults(
    { firstImpression: { primaryCta: { name: 'Start' } } },
    { firstImpression: { primaryCta: { text: 'Start' } } },
  );
  assert.equal(same.firstImpression.previousCta, 'Start');
  assert.equal(same.firstImpression.currentCta, 'Start');
  assert.equal(same.firstImpression.ctaChanged, false);

  const changed = compareResults(
    { firstImpression: { primaryCta: { name: 'Start' }, headline: { text: 'Welcome' } } },
    { firstImpression: { primaryCta: { name: 'Buy now' }, headline: { text: 'Welcome back' } } },
  );
  assert.equal(changed.firstImpression.ctaChanged, true);
  assert.equal(changed.firstImpression.previousHeadline, 'Welcome');
  assert.equal(changed.firstImpression.currentHeadline, 'Welcome back');

  // Name wins over text when both exist.
  const nameWins = compareResults(
    { firstImpression: { primaryCta: { name: 'Accessible name', text: 'Visible text' } } },
    {},
  );
  assert.equal(nameWins.firstImpression.previousCta, 'Accessible name');
  assert.equal(nameWins.firstImpression.currentCta, null);
  assert.equal(nameWins.firstImpression.ctaChanged, true, 'a CTA that disappeared counts as a change');

  const none = compareResults({}, {});
  assert.equal(none.firstImpression.previousCta, null);
  assert.equal(none.firstImpression.currentCta, null);
  assert.equal(none.firstImpression.ctaChanged, false, 'no CTA on either side is not a change');
  assert.equal(none.firstImpression.previousHeadline, null);
});

test('run-diff: score delta prefers adaptive quality, falls back to patience, null when absent', () => {
  const both = compareResults(
    { adaptive: { quality: { score: 80 } }, patience: { score: 10 } },
    { adaptive: { quality: { score: 95 } }, patience: { score: 99 } },
  );
  assert.deepEqual(both.scores, { previous: 80, current: 95, delta: 15 });

  const patienceOnly = compareResults({ patience: { score: 70 } }, { patience: { score: 65 } });
  assert.deepEqual(patienceOnly.scores, { previous: 70, current: 65, delta: -5 });

  const zeroIsAScore = compareResults(
    { adaptive: { quality: { score: 0 } } },
    { adaptive: { quality: { score: 0 } } },
  );
  assert.deepEqual(
    zeroIsAScore.scores,
    { previous: 0, current: 0, delta: 0 },
    '0 must not be treated as missing',
  );

  const previousMissing = compareResults({}, { adaptive: { quality: { score: 90 } } });
  assert.deepEqual(previousMissing.scores, { previous: null, current: 90, delta: null });

  const currentMissing = compareResults({ adaptive: { quality: { score: 90 } } }, {});
  assert.deepEqual(currentMissing.scores, { previous: 90, current: null, delta: null });
});

test('run-diff: timestamps are copied through and comparedAt is a valid ISO date', () => {
  const before = Date.now();
  const diff = compareResults(
    { finishedAt: '2026-09-01T10:00:00.000Z' },
    { finishedAt: '2026-09-06T10:00:00.000Z' },
  );
  assert.equal(diff.previousFinishedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(diff.currentFinishedAt, '2026-09-06T10:00:00.000Z');
  const comparedAt = Date.parse(diff.comparedAt);
  assert.ok(Number.isFinite(comparedAt) && comparedAt >= before - 1000);
  assert.equal(compareResults({}, {}).previousFinishedAt, null);
  assert.equal(compareResults({}, {}).currentFinishedAt, null);
});

test('run-diff: output is JSON-serializable and stable in shape (run-diff.json contract)', () => {
  const diff = compareResults({ issues: [issue()] }, { issues: [issue({ fingerprint: 'fp-2' })] });
  const roundTrip = JSON.parse(JSON.stringify(diff));
  assert.deepEqual(roundTrip, diff);
  assert.deepEqual(Object.keys(diff), [
    'comparedAt',
    'previousFinishedAt',
    'currentFinishedAt',
    'issues',
    'firstImpression',
    'scores',
  ]);
});
