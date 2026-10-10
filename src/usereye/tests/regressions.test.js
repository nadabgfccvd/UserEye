'use strict';

/**
 * Dedicated regression tests for the two bugs fixed during the 7.0.0 audit
 * (roadmap item 1.3), plus the dry-run execution plan (item 4.3) and the
 * install-browsers resolver hardening (item 3.1).
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const test = require('node:test');
const {
  dispatch,
  installBrowsers,
  resolvePlaywrightCli,
  resolvePlaywrightCliFrom,
} = require('../bin/usereye.js');
const { runAuto } = require('../usereye-auto');
const playwright = require('playwright');

function browserReady() {
  if (process.env.USEREYE_SKIP_BROWSER_TESTS === '1') return false;
  try {
    return fs.existsSync(playwright.chromium.executablePath());
  } catch {
    return false;
  }
}
const skipBrowserRun = {
  skip: !browserReady() && 'chromium not installed (npx playwright install chromium)',
};

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// install-browsers: the exports-map regression (CHANGES.md bug #1)
// ---------------------------------------------------------------------------

test('regression: require.resolve("playwright/cli") still throws on modern playwright (bug precondition)', () => {
  assert.throws(
    () => require.resolve('playwright/cli'),
    error => error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || error.code === 'MODULE_NOT_FOUND',
    'the historical crash path must remain documented by this test',
  );
});

test('regression: the installed playwright CLI resolves through the exported package.json', () => {
  const cli = resolvePlaywrightCli();
  assert.ok(cli, 'resolvePlaywrightCli must find the CLI of the installed playwright');
  assert.ok(fs.existsSync(cli));
  assert.equal(path.basename(cli), 'cli.js');
});

test('regression: resolvePlaywrightCliFrom survives restrictive exports maps', () => {
  const dir = tmpDir('usereye-fake-playwright-');
  // Simulate a playwright package whose exports map only exposes "." and
  // "./package.json" — exactly the shape that broke require.resolve('playwright/cli').
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'playwright', bin: { playwright: 'cli.js' } }),
  );
  fs.writeFileSync(path.join(dir, 'cli.js'), '// fake cli');
  assert.equal(resolvePlaywrightCliFrom({ bin: { playwright: 'cli.js' } }, dir), path.join(dir, 'cli.js'));
  // bin as a plain string
  assert.equal(resolvePlaywrightCliFrom({ bin: 'cli.js' }, dir), path.join(dir, 'cli.js'));
  // no bin entry: falls back to cli.js next to package.json
  assert.equal(resolvePlaywrightCliFrom({}, dir), path.join(dir, 'cli.js'));
  // bin entry pointing elsewhere wins when the file exists
  fs.writeFileSync(path.join(dir, 'custom-cli.js'), '// custom');
  assert.equal(
    resolvePlaywrightCliFrom({ bin: { playwright: 'custom-cli.js' } }, dir),
    path.join(dir, 'custom-cli.js'),
  );
  // nothing resolvable → null (caller falls back to npx)
  assert.equal(
    resolvePlaywrightCliFrom({ bin: { playwright: 'missing.js' } }, tmpDir('usereye-empty-')),
    null,
  );
  assert.equal(resolvePlaywrightCliFrom(null, null), null);
});

test('regression: dispatch(install-browsers) spawns the resolved CLI without throwing', async t => {
  const calls = [];
  const original = childProcess.spawnSync;
  // Simulate the restricted-exports environment: resolution succeeds via
  // package.json, and the spawned install exits 0.
  childProcess.spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: '', stderr: '' };
  };
  t.after(() => {
    childProcess.spawnSync = original;
  });

  const code = await dispatch(['install-browsers']);
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.equal(path.basename(calls[0].args[0]), 'cli.js');
  assert.deepEqual(calls[0].args.slice(1), ['install', 'chromium']);

  // Explicit targets and "all"
  assert.equal(await dispatch(['install-browsers', 'firefox']), 0);
  assert.deepEqual(calls[1].args.slice(1), ['install', 'firefox']);
  assert.equal(await dispatch(['install-browsers', 'all']), 0);
  assert.deepEqual(calls[2].args.slice(1), ['install', 'chromium', 'firefox', 'webkit']);

  // Unknown engine → usage failure without spawning
  const before = calls.length;
  assert.equal(await dispatch(['install-browsers', 'netscape']), 2);
  assert.equal(calls.length, before);

  // A failing install maps to exit code 2
  childProcess.spawnSync = () => ({ status: 1, stdout: '', stderr: 'download failed' });
  assert.equal(installBrowsers([]), 2);
});

// ---------------------------------------------------------------------------
// --command + --url silent confusion guard (CHANGES.md guardrail #2)
// ---------------------------------------------------------------------------

test('regression: --command combined with --url warns and prefers the URL', async () => {
  const project = tmpDir('usereye-command-url-');
  const out = path.join(project, 'out');
  const warnings = [];
  const originalWarn = console.warn;
  const originalLog = console.log;
  console.warn = message => warnings.push(String(message));
  console.log = () => {};
  let output;
  try {
    output = await runAuto(
      ['--url', 'http://127.0.0.1:59999/', '--command', 'node never-start-me.js', '--dry-run', '--out', out],
      { cwd: project, env: {} },
    );
  } finally {
    console.warn = originalWarn;
    console.log = originalLog;
  }
  assert.equal(output.exitCode, 0);
  assert.ok(
    warnings.some(message => /--command is ignored/.test(message)),
    `expected the guardrail warning, got: ${JSON.stringify(warnings)}`,
  );
});

// ---------------------------------------------------------------------------
// dry-run execution plan (item 4.3)
// ---------------------------------------------------------------------------

test('dry-run: plan.json describes protocols, budget, seeds, safety and gates without a browser', async () => {
  const project = tmpDir('usereye-dryrun-');
  const out = path.join(project, 'out');
  const originalLog = console.log;
  const printed = [];
  console.log = message => printed.push(String(message));
  let output;
  try {
    output = await runAuto(
      [
        '--url',
        'http://127.0.0.1:4173',
        '--dry-run',
        '--out',
        out,
        '--mode',
        'quick',
        '--protocols',
        'http-document,keyboard-navigation',
        '--seed',
        '/login',
        '--block-path',
        '/billing',
        '--min-delay',
        '250',
        '--browser',
        'firefox',
      ],
      { cwd: project, env: {} },
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(output.exitCode, 0);
  assert.ok(output.plan, 'runAuto returns the plan for programmatic use');
  const planPath = path.join(out, 'plan.json');
  assert.ok(fs.existsSync(planPath));
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

  assert.equal(plan.dryRun, true);
  assert.equal(plan.browser, 'firefox');
  assert.equal(plan.mode, 'quick');
  assert.equal(plan.target.url, 'http://127.0.0.1:4173');
  assert.equal(plan.protocols.selected, 2);
  assert.deepEqual(plan.protocols.ids.map(item => item.id).sort(), ['http-document', 'keyboard-navigation']);
  assert.deepEqual(plan.seedPaths, ['/login']);
  assert.deepEqual(plan.safety.blockPaths, ['/billing']);
  assert.equal(plan.safety.allowWrite, false);
  assert.equal(plan.safety.authentication, 'none detected');
  assert.equal(plan.resilience.minActionDelayMs, 250);
  assert.equal(plan.resilience.retries, 1);
  assert.equal(plan.budget.maxStates, 6, 'quick budget is exposed in the plan');
  assert.ok(plan.gates && plan.gates.minAdaptiveScore === 70);
  assert.ok(
    printed.some(line => line.includes('dry run')),
    'the plan is printed to the console',
  );
  assert.ok(printed.some(line => line.includes('http-document')));
  // No browser artifacts exist: dry-run must not launch anything.
  assert.ok(!fs.existsSync(path.join(out, 'result.json')));
  assert.ok(!fs.existsSync(path.join(out, 'screenshots')));
});

test('dry-run: protocol selection mirrors the real runner for auto/core/v5/all', () => {
  const { buildExecutionPlan } = require('../execution-plan');
  const base = {
    mode: 'standard',
    protocols: 'auto',
    patternPack: ['en'],
    patterns: {},
    seedPaths: [],
    blockPaths: [],
    blockNamePatterns: [],
    gates: {},
    projectDir: tmpDir('usereye-plan-'),
  };
  const auto = buildExecutionPlan({ ...base, protocols: 'auto' });
  const core = buildExecutionPlan({ ...base, protocols: 'core' });
  const all = buildExecutionPlan({ ...base, protocols: 'all' });
  const v5 = buildExecutionPlan({ ...base, protocols: 'v5' });
  assert.ok(auto.protocols.selected > 0);
  assert.ok(core.protocols.selected <= all.protocols.selected);
  assert.ok(v5.protocols.selected <= all.protocols.selected);
  assert.ok(all.protocols.selected >= auto.protocols.selected);
});

// ---------------------------------------------------------------------------
// auto: successful runs must not be reported as startup failures
// ---------------------------------------------------------------------------

test(
  'regression: a successful auto run exits 0 and writes a report, not startup-error.json',
  skipBrowserRun,
  async () => {
    const out = tmpDir('usereye-success-');
    const output = await runAuto([
      '--project',
      path.join(__dirname, 'fixtures', 'static'),
      '--mode',
      'quick',
      '--out',
      out,
      '--no-video',
    ]);

    // `eye.close()` nulls `eye.browser` by design, so the post-run branch must
    // not use it to infer that the browser never launched.
    assert.equal(output.exitCode, 0, 'a clean run uses the success exit code');
    assert.ok(!fs.existsSync(path.join(out, 'startup-error.json')), 'no startup-error.json on success');
    assert.ok(fs.existsSync(path.join(out, 'result.json')), 'result.json is written');
    assert.ok(fs.existsSync(path.join(out, 'report.md')), 'report.md is written');
  },
);

test('regression: a genuine startup failure still exits 2 and writes startup-error.json', async () => {
  const out = tmpDir('usereye-startup-fail-');
  const output = await runAuto([
    '--project',
    path.join(__dirname, 'fixtures', 'django'),
    '--mode',
    'quick',
    '--out',
    out,
  ]);

  assert.equal(output.exitCode, 2, 'setup failures keep the setup exit code');
  assert.ok(fs.existsSync(path.join(out, 'startup-error.json')), 'startup-error.json is written');
  assert.ok(!fs.existsSync(path.join(out, 'result.json')), 'no result.json when nothing ran');
});
