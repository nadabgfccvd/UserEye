#!/usr/bin/env node
'use strict';

/**
 * Coverage gate (roadmap item 1.4).
 *
 * Runs the full node:test suite with --experimental-test-coverage and enforces:
 *   - per-file floor for the CLI/config/report layer (default >= 70% lines);
 *   - aggregate floor for the browser engine layer (default >= 40% lines,
 *     measured as the mean line coverage across engine files — today ~10%);
 *   - overall floor for first-party source (default >= 45%).
 *
 * Environment:
 *   USEREYE_SKIP_BROWSER_TESTS=1            engine tests skip (no browser);
 *   USEREYE_COVERAGE_ALLOW_SKIPPED_ENGINE=1 gate tolerates that and only
 *                                           enforces non-engine floors;
 *   USEREYE_COVERAGE_MARKDOWN=<file>        also write a Markdown table (CI job
 *                                           summary / PR annotation).
 *
 * Usage: node scripts/check-coverage.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const CORE_FILES = ['config.js', 'report.js', 'sarif.js', 'bin/usereye.js'];
const ENGINE_FILES = [
  'user-eye.js',
  'adaptive-browser.js',
  'adaptive-explorer.js',
  'browser-gaze.js',
  'browser-human.js',
  'browser-perception.js',
  'browser-recorder.js',
  'browser-vitals.js',
  'misclick-engine.js',
  'patience.js',
  'perception.js',
  'user-gaze.js',
  'user-human.js',
  'user-plan.js',
  'artifact-store.js',
  'protocol-runner.js',
  'parallel-scheduler.js',
  'execution-plan.js',
  'protocols/browser.js',
  'protocols/experience.js',
  'protocols/file.js',
  'protocols/helpers.js',
  'protocols/human.js',
  'protocols/input.js',
  'protocols/network.js',
];

/**
 * 7.5.1 (roadmap 7.5.0 Phase 1): files whose measured number used to LIE or that had
 * no dedicated test, now held to their own floor so the fix cannot silently regress.
 *
 *   - The browser-injected collectors run inside jsdom via tests/helpers/browser-env.js.
 *     Until 7.5.1 the harness eval'd their source as an anonymous string, so V8 credited
 *     the lines to nothing and the report showed 0.8–2.6% for files exercised by ~60
 *     tests. The harness now compiles them against their real file URL; a drop back
 *     under the floor means the attribution broke, not (only) that tests were removed.
 *   - `run-diff.js` (basis of --compare) had 11.69% and no direct test.
 *   - `adaptive-explorer.js`: its authentication block (the path that types
 *     credentials) was entirely uncovered.
 *   - `misclick-engine.js`: the two policies' remaining branches were untested.
 */
const HONEST_FLOORS = {
  'browser-perception.js': 85,
  'browser-human.js': 85,
  'browser-gaze.js': 85,
  'browser-recorder.js': 75,
  'browser-vitals.js': 75,
  'adaptive-browser.js': 85,
  'run-diff.js': 90,
  'misclick-engine.js': 75,
  'adaptive-explorer.js': 60,
};

const CORE_FLOOR = 70;
const ENGINE_FLOOR = 40;
const OVERALL_FLOOR = 45;

function parseCoverage(stdout) {
  const entries = new Map();
  let overall = null;
  for (const line of stdout.split('\n')) {
    if (!line.includes('|')) continue;
    const cleaned = line.replace(/^#\s?/, '');
    const columns = cleaned.split('|').map(column => column.trim());
    if (columns.length < 4) continue;
    const file = columns[0];
    const linePct = Number.parseFloat(columns[1]);
    if (!Number.isFinite(linePct)) continue;
    if (file === 'all files') {
      overall = linePct;
      continue;
    }
    if (file === 'file' || file.startsWith('---')) continue;
    entries.set(file, linePct);
  }
  return { entries, overall };
}

function normalize(file) {
  // Coverage paths are relative to the process cwd (the project root).
  const cleaned = file.replace(/\\/g, '/');
  if (cleaned.startsWith('../') || cleaned.startsWith('/')) return null; // outside project
  if (cleaned.startsWith('tests/') || cleaned.startsWith('node_modules/')) return null;
  return cleaned;
}

function main() {
  const allowSkippedEngine = process.env.USEREYE_COVERAGE_ALLOW_SKIPPED_ENGINE === '1';
  const skippingBrowser = process.env.USEREYE_SKIP_BROWSER_TESTS === '1';
  if (skippingBrowser && !allowSkippedEngine) {
    console.error(
      'coverage-gate: FAIL — USEREYE_SKIP_BROWSER_TESTS=1 would gut engine coverage. ' +
        'Install browsers (npx playwright install chromium) or set ' +
        'USEREYE_COVERAGE_ALLOW_SKIPPED_ENGINE=1 to enforce non-engine floors only.',
    );
    process.exit(1);
  }

  const run = spawnSync(
    process.execPath,
    // Pass the directory: spawnSync does not expand globs without a shell,
    // and node --test discovers *.test.js files recursively.
    ['--test', '--experimental-test-coverage', 'tests/'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  process.stdout.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
  if (run.status !== 0) {
    console.error(`coverage-gate: FAIL — test suite exited ${run.status}.`);
    process.exit(run.status || 1);
  }

  const { entries } = parseCoverage(run.stdout || '');
  const perFile = new Map();
  for (const [file, pct] of entries) {
    const normalized = normalize(file);
    if (normalized) perFile.set(normalized, pct);
  }

  const problems = [];
  const report = [];

  for (const file of CORE_FILES) {
    const pct = perFile.get(file);
    if (pct === undefined) {
      problems.push(`core file ${file} missing from coverage report`);
      continue;
    }
    report.push(`  core   ${file.padEnd(28)} ${pct.toFixed(2).padStart(6)}% (floor ${CORE_FLOOR}%)`);
    if (pct < CORE_FLOOR) {
      problems.push(`core file ${file} at ${pct.toFixed(2)}% < ${CORE_FLOOR}% floor`);
    }
  }

  for (const [file, floor] of Object.entries(HONEST_FLOORS)) {
    const pct = perFile.get(file);
    if (pct === undefined) {
      if (!skippingBrowser) problems.push(`file ${file} missing from coverage report`);
      continue;
    }
    report.push(`  honest ${file.padEnd(28)} ${pct.toFixed(2).padStart(6)}% (floor ${floor}%)`);
    // The browser-injected floors depend on jsdom only; the explorer/misclick ones need a
    // real browser for part of their suite, so they are relaxed when browsers are skipped.
    const needsBrowser = file === 'adaptive-explorer.js';
    if (pct < floor && !(skippingBrowser && needsBrowser)) {
      problems.push(
        `${file} at ${pct.toFixed(2)}% < ${floor}% floor (see HONEST_FLOORS in scripts/check-coverage.js)`,
      );
    }
  }

  const engineMeasured = ENGINE_FILES.map(file => [file, perFile.get(file)]).filter(
    ([, pct]) => pct !== undefined,
  );
  if (engineMeasured.length < ENGINE_FILES.length - 2) {
    problems.push(
      `only ${engineMeasured.length}/${ENGINE_FILES.length} engine files appear in coverage output`,
    );
  }
  const engineAverage = engineMeasured.length
    ? engineMeasured.reduce((sum, [, pct]) => sum + pct, 0) / engineMeasured.length
    : 0;
  report.push(
    `  engine aggregate (${engineMeasured.length} files)`.padEnd(35) +
      ` ${engineAverage.toFixed(2).padStart(6)}% (floor ${ENGINE_FLOOR}%)`,
  );
  if (!skippingBrowser && engineAverage < ENGINE_FLOOR) {
    problems.push(
      `browser-engine aggregate line coverage ${engineAverage.toFixed(2)}% < ${ENGINE_FLOOR}% floor`,
    );
  }
  if (skippingBrowser && allowSkippedEngine) {
    report.push('  engine floors NOT enforced (USEREYE_COVERAGE_ALLOW_SKIPPED_ENGINE=1).');
  }

  const firstParty = [...perFile.entries()].filter(
    ([file]) => !file.startsWith('scripts/') && !file.includes('fixtures/'),
  );
  const overall = firstParty.length
    ? firstParty.reduce((sum, [, pct]) => sum + pct, 0) / firstParty.length
    : 0;
  report.push(
    `  overall first-party (${firstParty.length} files)`.padEnd(35) +
      ` ${overall.toFixed(2).padStart(6)}% (floor ${OVERALL_FLOOR}%)`,
  );
  if (overall < OVERALL_FLOOR) {
    problems.push(`overall first-party line coverage ${overall.toFixed(2)}% < ${OVERALL_FLOOR}% floor`);
  }

  console.log('coverage-gate: measured line coverage');
  for (const line of report) console.log(line);
  const worstEngine = [...engineMeasured].sort((a, b) => a[1] - b[1]).slice(0, 5);
  if (worstEngine.length) {
    console.log('  lowest engine files:');
    for (const [file, pct] of worstEngine) {
      console.log(`    ${file.padEnd(30)} ${pct.toFixed(2).padStart(6)}%`);
    }
  }

  // 7.5.1 (roadmap item 1.5): a Markdown table for the CI job summary / PR annotation.
  if (process.env.USEREYE_COVERAGE_MARKDOWN) {
    const lines = [
      '### Coverage (line %)',
      '',
      '| Layer | File | Lines | Floor |',
      '| --- | --- | ---: | ---: |',
    ];
    for (const file of CORE_FILES) {
      lines.push(`| core | \`${file}\` | ${(perFile.get(file) ?? 0).toFixed(2)} | ${CORE_FLOOR} |`);
    }
    for (const [file, floor] of Object.entries(HONEST_FLOORS)) {
      lines.push(`| honest | \`${file}\` | ${(perFile.get(file) ?? 0).toFixed(2)} | ${floor} |`);
    }
    lines.push(
      `| engine | aggregate (${engineMeasured.length} files) | ${engineAverage.toFixed(2)} | ${ENGINE_FLOOR} |`,
    );
    lines.push(
      `| overall | first-party (${firstParty.length} files) | ${overall.toFixed(2)} | ${OVERALL_FLOOR} |`,
    );
    lines.push(
      '',
      problems.length ? `**${problems.length} floor(s) violated.**` : 'All floors satisfied.',
      '',
    );
    fs.writeFileSync(process.env.USEREYE_COVERAGE_MARKDOWN, `${lines.join('\n')}\n`);
  }

  if (problems.length) {
    for (const problem of problems) console.error(`coverage-gate: FAIL — ${problem}`);
    process.exit(1);
  }
  console.log('coverage-gate: OK — all floors satisfied.');
}

if (require.main === module) main();
module.exports = { HONEST_FLOORS, CORE_FILES, ENGINE_FILES, parseCoverage, normalize };
