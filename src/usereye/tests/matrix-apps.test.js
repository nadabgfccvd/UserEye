'use strict';

/**
 * Roadmap 7.5.0 item 5.3 — multi-app matrix (config.apps), end to end.
 *
 * Uses the dedicated fixture under tests/fixtures/matrix/: two static apps that
 * the project adapter serves itself (python http.server, like fixtures/static).
 * The config shape is copied into a temp dir so no artifacts land in the repo.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { runAuto } = require('../usereye-auto');

const root = path.resolve(__dirname, '..');
const FIXTURE = path.join(root, 'tests', 'fixtures', 'matrix');

test('matrix: runs two configured apps and aggregates the summary', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-matrix-e2e-'));
  const output = path.join(project, 'matrix-out');
  fs.writeFileSync(
    path.join(project, 'usereye.config.cjs'),
    `module.exports = {
      outDir: ${JSON.stringify(output)},
      mode: 'quick',
      apps: [
        { name: 'app-a', projectDir: ${JSON.stringify(path.join(FIXTURE, 'app-a'))} },
        { name: 'app-b', projectDir: ${JSON.stringify(path.join(FIXTURE, 'app-b'))} },
      ],
    };`,
  );

  const result = await runAuto([], { cwd: project, env: {} });
  assert.equal(result.exitCode, 0, JSON.stringify(result.matrix));

  const summary = result.matrix;
  assert.equal(summary.apps.length, 2);
  assert.equal(summary.tool, 'UserEye matrix');
  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 0);
  assert.deepEqual(
    summary.apps.map(app => app.name),
    ['app-a', 'app-b'],
  );

  const written = JSON.parse(fs.readFileSync(path.join(output, 'matrix-summary.json'), 'utf8'));
  assert.equal(written.schemaVersion, 1);
  assert.equal(written.apps.length, 2);

  const report = fs.readFileSync(path.join(output, 'matrix-report.html'), 'utf8');
  assert.match(report, /<title>UserEye — matrix<\/title>/);
  for (const app of summary.apps) {
    const appDir = path.join(output, app.artifactDir);
    assert.ok(fs.existsSync(path.join(appDir, 'result.json')), `${app.name} result.json`);
    assert.ok(fs.existsSync(path.join(appDir, 'report.html')), `${app.name} report.html`);
    assert.match(report, new RegExp(app.name));
  }
});

test('matrix: a failing app is recorded and aggregated without aborting siblings', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-matrix-fail-'));
  const output = path.join(project, 'matrix-out');
  fs.writeFileSync(
    path.join(project, 'usereye.config.cjs'),
    `module.exports = {
      outDir: ${JSON.stringify(output)},
      mode: 'quick',
      apps: [
        { name: 'good', projectDir: ${JSON.stringify(path.join(FIXTURE, 'app-a'))} },
        { name: 'bad', url: 'http://127.0.0.1:1', startupTimeoutMs: 2000 },
      ],
    };`,
  );

  const result = await runAuto([], { cwd: project, env: {} });
  // The unreachable app fails (setup class, exit 2); the sibling still ran and
  // the matrix aggregates the worst exit code and records both apps.
  assert.equal(result.exitCode, Math.max(...result.matrix.apps.map(app => app.exitCode)));
  assert.equal(result.matrix.apps.length, 2);
  assert.equal(result.matrix.failed, 1);
  assert.equal(result.matrix.passed, 1);
  const bad = result.matrix.apps.find(app => app.name === 'bad');
  assert.notEqual(bad.exitCode, 0, 'the unreachable app reports its failure');
  const good = result.matrix.apps.find(app => app.name === 'good');
  assert.ok(
    fs.existsSync(path.join(output, good.artifactDir, 'result.json')),
    'the good sibling produced evidence',
  );
  const written = JSON.parse(fs.readFileSync(path.join(output, 'matrix-summary.json'), 'utf8'));
  assert.equal(written.failed, 1);
  assert.equal(written.passed, 1);
});
