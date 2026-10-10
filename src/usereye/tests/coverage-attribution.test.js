'use strict';

/**
 * Regression gate for the coverage attribution of browser-injected files
 * (roadmap 7.5.0 item 1.1 / A2).
 *
 * The harness in tests/helpers/browser-env.js compiles each browser-context
 * function as its own script under the collector's REAL file URL. Node's coverage
 * reader merges those scripts range by range — unless the process' source-map
 * cache is non-empty, in which case it keeps only the last script per URL and the
 * whole-file top-level range of that script marks every line as covered. That
 * happened once: jsdom's dependencies carry `//# sourceMappingURL` comments, and
 * with NODE_V8_COVERAGE set the loader cached them. The report then showed
 * adaptive-browser.js at 32% or 100% depending on which test ran last.
 *
 * This test runs a tiny suite in a child process with NODE_V8_COVERAGE and checks
 * the raw V8 output: (1) no source-map cache is recorded, (2) the attributed scripts
 * of one file carry per-function block ranges, and (3) a function that was NOT
 * exercised is reported with count 0 — the property the gate in
 * scripts/check-coverage.js relies on.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

test('coverage attribution: attributed scripts merge per function, no source-map cache', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-cov-'));
  const probe = path.join(dir, 'probe.test.js');
  fs.writeFileSync(
    probe,
    `'use strict';
const test = require('node:test');
const { createBrowserEnv } = require(${JSON.stringify(path.join(ROOT, 'tests', 'helpers', 'browser-env.js'))});
const { collectFormFields } = require(${JSON.stringify(path.join(ROOT, 'adaptive-browser.js'))});
test('only collectFormFields runs', () => {
  const env = createBrowserEnv('<!doctype html><html><body><form><input name="q" data-rect="0,0,100,20"></form></body></html>');
  env.evaluate(collectFormFields, {});
});
`,
  );
  const coverageDir = path.join(dir, 'v8');
  // Strip the parent runner's context: with NODE_TEST_CONTEXT inherited, the child
  // `--test` believes it is being run recursively and skips its files.
  const env = { ...process.env, NODE_V8_COVERAGE: coverageDir };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', probe], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(run.status, 0, `probe suite failed:\n${run.stdout}\n${run.stderr}`);
  assert.ok(fs.existsSync(coverageDir), `no coverage dir:\n${run.stdout}\n${run.stderr}`);

  const target = path.join(ROOT, 'adaptive-browser.js');
  const reports = fs
    .readdirSync(coverageDir)
    .filter(name => name.startsWith('coverage-') && name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(coverageDir, name), 'utf8')))
    .filter(report =>
      report.result.some(
        script => script.url.endsWith('/adaptive-browser.js') || script.url.endsWith(target),
      ),
    );
  assert.ok(reports.length >= 1, 'the test worker wrote a coverage report mentioning adaptive-browser.js');

  for (const report of reports) {
    assert.equal(
      report['source-map-cache'],
      undefined,
      'no source-map cache: with one present Node keeps only the last script per URL (see header)',
    );
    const scripts = report.result.filter(script => script.url.endsWith('adaptive-browser.js'));
    // One script for `require` (module), one attributed script for the function that ran.
    assert.ok(scripts.length >= 2, `expected the module + ≥1 attributed script, got ${scripts.length}`);
    const attributed = scripts.filter(script =>
      script.functions.some(
        fn => fn.functionName === 'collectFormFields' && fn.isBlockCoverage && fn.ranges[0].count > 0,
      ),
    );
    assert.equal(attributed.length, 1, 'exactly one attributed script executed collectFormFields');
    const untouched = attributed[0].functions.find(fn => fn.functionName === 'collectAdaptiveFacts');
    assert.ok(
      !untouched || untouched.ranges[0].count === 0,
      'a function that never ran must not be credited by the attributed script',
    );
    // The module script (from `require`) must not claim the collectors ran either.
    const moduleScript = scripts.find(script =>
      script.functions.some(fn => fn.functionName === 'collectAdaptiveFacts' && !fn.isBlockCoverage),
    );
    assert.ok(moduleScript, 'the plain module script is present');
    for (const fn of moduleScript.functions.filter(fn => fn.functionName.startsWith('collect'))) {
      assert.equal(fn.ranges[0].count, 0, `${fn.functionName} not executed by require()`);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
