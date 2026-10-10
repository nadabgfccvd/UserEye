'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const test = require('node:test');
const pkg = require('../package.json');
const { runSelfTest } = require('../bin/usereye-self-test');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin', 'usereye.js');

test('usereye --self-test passes in-process', async () => {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    const result = await runSelfTest([]);
    assert.equal(
      result.exitCode,
      0,
      JSON.stringify(
        result.report?.checks.filter(c => !c.ok),
        null,
        2,
      ),
    );
    assert.ok(result.report.passed > 20);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test('CLI --self-test and --version agree with package.json', () => {
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), pkg.version);
  const selfTest = spawnSync(process.execPath, [cli, '--self-test', '--json'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  const report = JSON.parse(selfTest.stdout);
  assert.equal(report.failed, 0);
  assert.equal(report.version, pkg.version);
});
