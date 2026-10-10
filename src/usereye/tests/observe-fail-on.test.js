'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const test = require('node:test');
const { observeExitCode } = require('../usereye-observe');
const { loadConfig } = require('../config');

const cli = path.join(__dirname, '..', 'bin', 'usereye.js');

function resultWith(issues = [], unexpectedBrowserErrors = 0) {
  return {
    summary: { issues: issues.length, unexpectedBrowserErrors },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Roadmap 7.5.0 item 3.4: `observe --fail-on <severity>` makes observe usable as
// a gate. Default must stay exactly the historical contract.
// ---------------------------------------------------------------------------

test('fail-on: default (null) keeps the historical contract — any issue exits 1', () => {
  assert.equal(observeExitCode(resultWith([]), null), 0);
  assert.equal(observeExitCode(resultWith([{ severity: 'minor' }]), null), 1);
  assert.equal(observeExitCode(resultWith([{ severity: 'major' }]), null), 1);
  assert.equal(observeExitCode(resultWith([], 1), null), 1, 'unexpected browser errors always fail');
});

test('fail-on: severity thresholds only fail at or above the chosen level', () => {
  const issues = [
    { severity: 'blocker' },
    { severity: 'critical' },
    { severity: 'major' },
    { severity: 'minor' },
  ];
  assert.equal(observeExitCode(resultWith(issues, 0), 'blocker'), 1);
  assert.equal(observeExitCode(resultWith(issues, 0), 'critical'), 1);
  assert.equal(observeExitCode(resultWith(issues, 0), 'major'), 1);
  assert.equal(observeExitCode(resultWith(issues, 0), 'minor'), 1);
  assert.equal(observeExitCode(resultWith([{ severity: 'minor' }], 0), 'major'), 0);
  assert.equal(observeExitCode(resultWith([{ severity: 'major' }], 0), 'critical'), 0);
  assert.equal(observeExitCode(resultWith([{ severity: 'critical' }], 0), 'blocker'), 0);
  assert.equal(observeExitCode(resultWith([{ severity: 'minor' }], 0), 'critical'), 0);
  assert.equal(
    observeExitCode(resultWith([{ severity: 'critical' }], 1), 'blocker'),
    1,
    'errors win over the gate',
  );
});

test('fail-on: never means findings never fail; browser errors still do', () => {
  assert.equal(observeExitCode(resultWith([{ severity: 'blocker' }]), 'never'), 0);
  assert.equal(observeExitCode(resultWith([]), 'never'), 0);
  assert.equal(observeExitCode(resultWith([], 1), 'never'), 1);
});

test('fail-on: the CLI accepts the flag, rejects unknown values with exit 2', () => {
  const accepted = spawnSync(process.execPath, [cli, 'observe', '--help'], { encoding: 'utf8' });
  assert.equal(accepted.status, 0);
  assert.match(accepted.stdout, /--fail-on <level>/);
  const rejected = spawnSync(process.execPath, [cli, 'observe', '--fail-on', 'nope'], { encoding: 'utf8' });
  assert.equal(rejected.status, 2, rejected.stderr);
  assert.match(rejected.stderr, /--fail-on must be/);
});

test('fail-on: loadConfig resolves the flag and defaults to null', async () => {
  const config = await loadConfig({ argv: ['--fail-on', 'blocker'], cwd: process.cwd(), env: {} });
  assert.equal(config.failOn, 'blocker');
  const plain = await loadConfig({ argv: [], cwd: process.cwd(), env: {} });
  assert.equal(plain.failOn, null);
  // Unrecognized CLI values are a usage error, like --trace/--misclick-policy.
  await assert.rejects(
    loadConfig({ argv: ['--fail-on', 'loud'], cwd: process.cwd(), env: {} }),
    /--fail-on must be/,
  );
});
