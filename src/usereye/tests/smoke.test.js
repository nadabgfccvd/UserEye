'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const { runAuto } = require('../usereye-auto');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin', 'usereye.js');
const pkg = require('../package.json');

test('CLI --version matches package.json (single source of truth)', () => {
  const run = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(run.stdout.trim(), pkg.version);
});

test('analyze performs detection only and exits zero', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-analyze-'));
  const run = spawnSync(
    process.execPath,
    [cli, 'analyze', '--project', path.join(root, 'tests', 'fixtures', 'next-app'), '--out', output],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const analysis = JSON.parse(fs.readFileSync(path.join(output, 'project-analysis.json'), 'utf8'));
  assert.equal(analysis.stack, 'Next.js');
});

test('matrix mode combines multiple app analyses', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-matrix-'));
  const output = path.join(project, 'matrix-output');
  fs.writeFileSync(
    path.join(project, 'usereye.config.cjs'),
    `module.exports = {
    outDir: ${JSON.stringify(output)}, dryRun: true,
    apps: [
      { name: 'Static', projectDir: ${JSON.stringify(path.join(root, 'tests', 'fixtures', 'static'))} },
      { name: 'Next', projectDir: ${JSON.stringify(path.join(root, 'tests', 'fixtures', 'next-app'))} }
    ]
  };`,
  );
  const result = await runAuto([], { cwd: project, env: {} });
  assert.equal(result.exitCode, 0);
  assert.equal(result.matrix.apps.length, 2);
  assert.ok(fs.existsSync(path.join(output, 'matrix-report.html')));
});

test('invalid arguments use setup/usage exit code 2', () => {
  const run = spawnSync(process.execPath, [cli, 'auto', '--not-a-real-option'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Unknown option/);
});
