'use strict';

/**
 * 7.5.1 (roadmap 7.5.0 item 2.3): optional local retention of previous runs.
 * `keepLast: 0` keeps the CI behaviour (outDir cleared per run); `keepLast: n`
 * moves the previous run to `<outDir>-history/<stamp>` and prunes to n.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { rotateArtifactDir } = require('../artifact-store');
const { DEFAULT_CONFIG, loadConfig } = require('../config');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeRun(outDir, finishedAt) {
  fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'screenshots', 'a.jpg'), 'x');
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ finishedAt }));
}

test('keepLast 0 (default) clears outDir and creates no history', () => {
  const root = tmp('usereye-keep0-');
  const outDir = path.join(root, 'usereye');
  fakeRun(outDir, '2026-09-06T10:00:00.000Z');
  const rotation = rotateArtifactDir(outDir, 0);
  assert.equal(fs.existsSync(outDir), false);
  assert.equal(fs.existsSync(`${outDir}-history`), false);
  assert.deepEqual(rotation, { moved: null, historyDir: null, kept: [] });
  assert.equal(DEFAULT_CONFIG.keepLast, 0);
});

test('keepLast n moves the previous run into <outDir>-history/<finishedAt> and prunes to n', () => {
  const root = tmp('usereye-keepn-');
  const outDir = path.join(root, 'usereye');
  const history = `${outDir}-history`;
  const stamps = ['2026-09-06T10:00:00.000Z', '2026-09-06T11:00:00.000Z', '2026-09-06T12:00:00.000Z'];
  let last = null;
  for (const stamp of stamps) {
    fakeRun(outDir, stamp);
    last = rotateArtifactDir(outDir, 2);
    assert.equal(fs.existsSync(outDir), false, 'outDir is empty for the new run');
  }
  assert.equal(last.historyDir, history);
  assert.equal(path.basename(last.moved), '2026-09-06T12-00-00Z', 'stamp = finishedAt, filesystem-safe');
  assert.deepEqual(
    fs.readdirSync(history).sort(),
    ['2026-09-06T11-00-00Z', '2026-09-06T12-00-00Z'],
    'oldest pruned',
  );
  assert.deepEqual(last.kept, ['2026-09-06T11-00-00Z', '2026-09-06T12-00-00Z']);
  assert.ok(
    fs.existsSync(path.join(history, '2026-09-06T12-00-00Z', 'screenshots', 'a.jpg')),
    'contents moved intact',
  );
  // A previous run without result.json still rotates (mtime stamp), and a stamp
  // collision gets a numeric suffix instead of overwriting evidence.
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, 'partial.txt'), 'crashed run');
  const partial = rotateArtifactDir(outDir, 5);
  assert.ok(partial.moved && fs.existsSync(path.join(partial.moved, 'partial.txt')));
  fakeRun(outDir, '2026-09-06T12:00:00.000Z');
  const collision = rotateArtifactDir(outDir, 5);
  assert.equal(path.basename(collision.moved), '2026-09-06T12-00-00Z-2');
  // An empty outDir is not archived.
  fs.mkdirSync(outDir);
  const empty = rotateArtifactDir(outDir, 5);
  assert.equal(empty.moved, null);
  assert.equal(fs.readdirSync(history).length, 4);
});

test('keepLast: config and --keep-last accept non-negative integers only', async () => {
  const cwd = tmp('usereye-keep-config-');
  assert.equal((await loadConfig({ cwd, argv: [], env: {} })).keepLast, 0);
  assert.equal((await loadConfig({ cwd, argv: ['--keep-last', '3'], env: {} })).keepLast, 3);
  await assert.rejects(loadConfig({ cwd, argv: ['--keep-last', '-1'], env: {} }), /--keep-last must be/);
  await assert.rejects(loadConfig({ cwd, argv: ['--keep-last', 'many'], env: {} }), /--keep-last must be/);
  fs.writeFileSync(path.join(cwd, 'usereye.config.js'), `module.exports = { keepLast: 4 };`);
  assert.equal((await loadConfig({ cwd, argv: [], env: {} })).keepLast, 4);
  fs.writeFileSync(path.join(cwd, 'usereye.config.js'), `module.exports = { keepLast: 'lots' };`);
  assert.equal((await loadConfig({ cwd, argv: [], env: {} })).keepLast, 0, 'junk degrades to no retention');
});

// ---------------------------------------------------------------------------
// 7.5.1 (roadmap 7.5.0 item 2.5): artifacts.totalBytes in result.json + dashboard.
// ---------------------------------------------------------------------------

const { measureArtifacts, writeResultJson } = require('../artifact-store');
const { discoverRuns } = require('../dashboard');

test('artifacts.totalBytes: counts every file including result.json itself, lists the largest', () => {
  const dir = tmp('usereye-bytes-');
  fs.mkdirSync(path.join(dir, 'screenshots'));
  fs.writeFileSync(path.join(dir, 'screenshots', 'big.jpg'), Buffer.alloc(5000));
  fs.writeFileSync(path.join(dir, 'report.html'), Buffer.alloc(3000));
  fs.writeFileSync(path.join(dir, 'actions.json'), Buffer.alloc(100));
  fs.writeFileSync(path.join(dir, 'result.json'), '{}'); // a stale one must not be counted twice

  const measured = measureArtifacts(dir);
  assert.equal(measured.totalBytes, 8100);
  assert.equal(measured.files, 3);
  assert.deepEqual(
    measured.largest.map(file => file.path),
    ['screenshots/big.jpg', 'report.html', 'actions.json'],
  );

  const result = { summary: { issues: 0 }, artifacts: { screenshots: ['screenshots/big.jpg'] } };
  const written = writeResultJson(result, dir);
  const onDisk = fs.statSync(written).size;
  assert.equal(result.artifacts.files, 4);
  assert.equal(result.artifacts.totalBytes, 8100 + onDisk, 'total includes the final result.json size');
  const reread = JSON.parse(fs.readFileSync(written, 'utf8'));
  assert.equal(
    reread.artifacts.totalBytes,
    result.artifacts.totalBytes,
    'the number on disk is the settled one',
  );
  assert.equal(reread.artifacts.largest[0].bytes, 5000);

  // Dashboard surfaces it.
  const root = tmp('usereye-bytes-dash-');
  fs.cpSync(dir, path.join(root, 'run-a'), { recursive: true });
  const runs = discoverRuns(root);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].summary.totalBytes, result.artifacts.totalBytes);
});
