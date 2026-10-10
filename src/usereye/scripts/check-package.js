#!/usr/bin/env node
'use strict';

/**
 * Published-package composition guard (roadmap items 3.4 / distribution):
 *   - packed size must stay under the configured ceiling (default 290 kB);
 *   - development-only files must never be published;
 *   - required runtime files must always be present.
 *
 * Usage: node scripts/check-package.js [--max-packed-kb N]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const FORBIDDEN = [
  /^artifacts\//,
  /(^|\/)verify-server\.js$/,
  /(^|\/)tests\//,
  /(^|\/)scripts\//,
  /(^|\/)examples\//,
  /(^|\/)\.github\//,
  /(^|\/)\.changeset\//,
  /(^|\/)node_modules\//,
  /\.tgz$/,
  /(^|\/)CHANGELOG\.md$/,
];

const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE',
  'index.js',
  'user-eye.js',
  'config.js',
  'bin/usereye.js',
  'types/index.d.ts',
  'types/usereye-config.d.ts',
  'action.yml',
  'Dockerfile',
  'patterns/index.js',
  'locales/en.json',
];

function main() {
  const argv = process.argv.slice(2);
  // Roadmap item 3.4 ceiling. Raised 200 kB -> 260 kB on 2026-09-06 (R3): the package
  // measured 192.7 kB, i.e. 96.3% of the old ceiling, so any single new module would
  // have failed the release rather than warned anyone. 290 kB allows the review-mode runners, retention GC, and axe hinting while keeping the package sub-300 kB.
  // Keep in step with PACKED_CEILING_BYTES in tests/package-size.test.js — a test there
  // reads this file and fails if the two drift apart.
  let maxPackedBytes = 290_000;
  const flagIndex = argv.indexOf('--max-packed-kb');
  if (flagIndex >= 0) {
    const kb = Number(argv[flagIndex + 1]);
    if (!Number.isFinite(kb) || kb <= 0) {
      console.error('package-check: FAIL — --max-packed-kb requires a positive number.');
      process.exit(2);
    }
    maxPackedBytes = kb * 1000;
  }
  // 7.5.1 (roadmap item 3.5): no `shell:` anywhere — drive the npm CLI file
  // through process.execPath so it works identically on Windows.
  const npmCli =
    (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath) && process.env.npm_execpath) ||
    [
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ].find(candidate => fs.existsSync(candidate));
  if (!npmCli) {
    console.error('package-check: FAIL — npm CLI not resolvable without a shell.');
    process.exit(1);
  }
  const run = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    console.error(`package-check: FAIL — npm pack --dry-run exited ${run.status}\n${run.stderr}`);
    process.exit(1);
  }
  let pack;
  try {
    const parsed = JSON.parse(run.stdout);
    pack = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (error) {
    console.error(`package-check: FAIL — cannot parse npm pack JSON: ${error.message}`);
    process.exit(1);
  }
  const files = (pack.files || []).map(file => file.path.replace(/^\.\//, ''));
  const problems = [];

  if (pack.size > maxPackedBytes) {
    problems.push(
      `packed size ${(pack.size / 1000).toFixed(1)} kB exceeds ceiling ${(maxPackedBytes / 1000).toFixed(0)} kB`,
    );
  }
  for (const file of files) {
    if (FORBIDDEN.some(pattern => pattern.test(file))) {
      problems.push(`forbidden file would be published: ${file}`);
    }
  }
  for (const required of REQUIRED) {
    if (!files.includes(required)) {
      problems.push(`required file missing from package: ${required}`);
    }
  }

  if (problems.length) {
    for (const problem of problems) console.error(`package-check: FAIL — ${problem}`);
    process.exit(1);
  }
  console.log(
    `package-check: OK — ${files.length} files, packed ${(pack.size / 1000).toFixed(1)} kB (ceiling ${(maxPackedBytes / 1000).toFixed(0)} kB), unpacked ${(pack.unpackedSize / 1000).toFixed(1)} kB.`,
  );
}

main();
