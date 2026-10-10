'use strict';

/** Tests for the artifact dashboard viewer (roadmap item 6.3). */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { discoverRuns, parseDashboardArgv, runDashboard } = require('../dashboard');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeRun(root, name, overrides = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const result = {
    tool: 'UserEye UI Test Tool',
    toolVersion: '7.1.0',
    application: { name: `App ${name}` },
    finishedAt: '2026-09-05T12:00:00.000Z',
    summary: { issues: 2, severity: { blocker: 1, critical: 0, major: 1, minor: 0 } },
    qualityGates: { passed: false },
    adaptive: { quality: { score: 61 } },
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result));
  return dir;
}

test('dashboard: discovers runs with result.json in immediate subdirectories', () => {
  const root = tmpDir('usereye-dash-');
  writeRun(root, 'run-a');
  writeRun(root, 'run-b', { qualityGates: { passed: true } });
  fs.mkdirSync(path.join(root, 'no-run'), { recursive: true });
  const runs = discoverRuns(root);
  assert.equal(runs.length, 2);
  const names = runs.map(run => run.name).sort();
  assert.deepEqual(names, ['run-a', 'run-b']);
  const a = runs.find(run => run.name === 'run-a');
  assert.equal(a.summary.issues, 2);
  assert.equal(a.summary.qualityGates, false);
  assert.equal(a.summary.adaptiveScore, 61);
  assert.equal(a.hasReport, false);
});

test('dashboard: serves the index, artifacts, 404s and blocks traversal', async t => {
  const root = tmpDir('usereye-dash-serve-');
  const dirA = writeRun(root, 'run-a', { artifacts: { totalBytes: 1536 * 1024 } });
  fs.writeFileSync(path.join(dirA, 'report.html'), '<!doctype html><title>Report A</title><h1>Report A</h1>');
  fs.writeFileSync(path.join(dirA, 'usereye.sarif'), '{"version":"2.1.0"}');

  const session = await runDashboard([root, '--port', '0']);
  t.after(() => session.close());
  assert.ok(session.port > 0);
  assert.match(session.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const index = await fetch(session.url);
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /UserEye dashboard/);
  assert.match(html, /run-a/);
  assert.match(html, /report\.html/);
  assert.match(html, /sarif/);
  assert.match(html, /FAIL/, 'failing gates are badged');
  assert.match(html, /<th>Artifacts<\/th>/, '7.5.1: artifact cost column');
  assert.match(html, /1\.5 MB/, 'artifacts.totalBytes rendered human-readable');

  const report = await fetch(`${session.url}run-a/report.html`);
  assert.equal(report.status, 200);
  assert.match(report.headers.get('content-type'), /text\/html/);
  assert.match(await report.text(), /Report A/);

  const sarif = await fetch(`${session.url}run-a/usereye.sarif`);
  assert.match(sarif.headers.get('content-type'), /application\/json/);

  const missing = await fetch(`${session.url}run-a/nope.txt`);
  assert.equal(missing.status, 404);

  const traversal = await fetch(`${session.url}%2e%2e%2fpackage.json`);
  assert.equal(traversal.status, 403);
});

test('dashboard: empty directory renders the guidance state', async t => {
  const root = tmpDir('usereye-dash-empty-');
  const session = await runDashboard([root, '--port', '0']);
  t.after(() => session.close());
  const html = await (await fetch(session.url)).text();
  assert.match(html, /No <code>result\.json<\/code> found/);
});

test('dashboard: argument parsing and error paths', async () => {
  assert.deepEqual(
    { ...parseDashboardArgv(['artifacts/x', '--port', '8080', '--host', '0.0.0.0']) },
    { dir: 'artifacts/x', port: 8080, host: '0.0.0.0' },
  );
  assert.throws(() => parseDashboardArgv(['--port', 'not-a-number']), /--port/);
  assert.throws(() => parseDashboardArgv(['--nope']), /Unknown dashboard option/);
  await assert.rejects(runDashboard([path.join(tmpDir('usereye-dash-missing-'), 'nope')]), /not found/);
  const help = await runDashboard(['--help']);
  assert.equal(help.help, true);
});
