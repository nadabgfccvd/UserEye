'use strict';

/**
 * Package-size regression guard (roadmap item 3.4): the published tarball
 * must stay small (ceiling 290 kB packed) and must contain every runtime
 * file while excluding tests, workflows and stale tarballs.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const packageRoot = path.join(__dirname, '..');
const pkg = require('../package.json');

// Raised for 7.5.1 feedback hardening. The new retention GC, axe hinting, flow
// helpers, accepted-pattern metadata, and documentation bring a clean package to about
// 285 kB packed / 1.023 MB unpacked. Keep the release below 300 kB packed and 1.05 MB
// unpacked; `scripts/check-package.js` carries the same packed ceiling, and the test
// below fails if the two packed limits ever drift apart.
const PACKED_CEILING_BYTES = 290_000;
const UNPACKED_CEILING_BYTES = 1_050_000;
const FILE_COUNT_CEILING = 90; // 66 in use — this one still has room, so it stands.

const REQUIRED_FILES = [
  'package.json',
  'index.js',
  'user-eye.js',
  'config.js',
  'adaptive-explorer.js',
  'protocol-runner.js',
  'artifact-store.js',
  'plugins.js',
  'dashboard.js',
  'issue-export.js',
  'execution-plan.js',
  'bin/usereye.js',
  'types/index.d.ts',
  'patterns/en.json',
  'patterns/pt.json',
  'patterns/es.json',
  'patterns/fr.json',
  'README.md',
  'HISTORY.md',
];

const FORBIDDEN_PATTERNS = [/^tests\//, /^\.github\//, /\.tgz$/, /^node_modules\//, /\.map$/, /^\.git\//];

function npmPackDryRun() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = spawnSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `npm pack --dry-run failed: ${run.stderr}`);
  const combined = `${run.stdout}\n${run.stderr}`;
  const start = combined.indexOf('[');
  assert.ok(start >= 0, 'npm pack --dry-run --json produced no JSON payload');
  return JSON.parse(combined.slice(start))[0];
}

test('packaging: the tarball stays under the size ceilings', () => {
  const entry = npmPackDryRun();
  assert.equal(entry.filename, `usereye-${pkg.version}.tgz`);
  assert.ok(
    entry.size <= PACKED_CEILING_BYTES,
    `packed size ${entry.size} B exceeds the ${PACKED_CEILING_BYTES} B ceiling — did large fixtures leak into "files"?`,
  );
  assert.ok(
    entry.unpackedSize <= UNPACKED_CEILING_BYTES,
    `unpacked size ${entry.unpackedSize} B exceeds the ${UNPACKED_CEILING_BYTES} B ceiling`,
  );
  assert.ok(
    entry.files.length <= FILE_COUNT_CEILING,
    `file count ${entry.files.length} exceeds ${FILE_COUNT_CEILING}`,
  );
});

test('packaging: every runtime file ships and no development junk does', () => {
  const entry = npmPackDryRun();
  const paths = entry.files.map(file => file.path);
  for (const required of REQUIRED_FILES) {
    assert.ok(paths.includes(required), `${required} must be part of the published package`);
  }
  for (const packed of paths) {
    for (const forbidden of FORBIDDEN_PATTERNS) {
      assert.ok(!forbidden.test(packed), `${packed} must not be published`);
    }
  }
  // The Dockerfile ships so the pinned Playwright image stays reproducible.
  assert.ok(paths.includes('Dockerfile'), 'Dockerfile must ship (pinned Playwright image)');
});

test('packaging: the packed ceiling is not duplicated into two drifting numbers', () => {
  // check-package.js (the release gate) and this test (the suite) both enforce the
  // packed ceiling. Two copies of a number are two chances to raise only one of them,
  // so the value is cross-read here the same way check-playwright-version.js
  // cross-reads the pinned Playwright version across package.json/lockfile/Dockerfile.
  const gate = fs.readFileSync(path.join(packageRoot, 'scripts', 'check-package.js'), 'utf8');
  const declared = gate.match(/let maxPackedBytes = ([\d_]+);/);
  assert.ok(declared, 'check-package.js must declare maxPackedBytes as a literal');
  assert.equal(
    Number(declared[1].replace(/_/g, '')),
    PACKED_CEILING_BYTES,
    'scripts/check-package.js and tests/package-size.test.js disagree about the packed ceiling',
  );
});
