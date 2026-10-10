'use strict';

/**
 * Phase 3 + Phase 6 acceptance (roadmap M6 / M7 / M9).
 *
 * Phase 3: Core Web Vitals become recordable metrics. The critical property is
 * that they are a SIGNAL by default — a noisy measurement taken mid-exploration
 * must never be able to fail a build unless the operator explicitly opts in.
 *
 * Phase 6: structured logging, phase timings, `usereye doctor`, and the
 * explorer modules extracted out of the 1279-line monolith.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { Logger } = require('../logger');
const { summarizeVitals, performanceChecks, rate } = require('../performance');
const { loadConfig } = require('../config');
const { collectDiagnostics, compareVersions, minimumNode } = require('../bin/usereye-doctor');
const { MODES, budgetExhausted, mergeBudget, wallClockExceeded } = require('../explorer/budget');
const { blockedName, blockedUrl, canonicalUrl, matchesConfigured } = require('../explorer/targeting');
const { coverageKey, hashMaterial, quickHash } = require('../explorer/state');
const { buildGates, scoreGates } = require('../explorer/audit');

// --------------------------------------------------------------------------
// Phase 3 — performance
// --------------------------------------------------------------------------

test('vitals are summarized by worst state, not averaged away', () => {
  const summary = summarizeVitals([
    { lcp: 900, cls: 0.01, url: 'http://app/fast' },
    { lcp: 5200, cls: 0.44, url: 'http://app/slow' },
  ]);
  assert.equal(summary.samples, 2);
  assert.equal(summary.metrics.lcp.value, 5200, 'a fast state must not hide a slow one');
  assert.equal(summary.metrics.lcp.rating, 'poor');
  assert.equal(summary.worstStates.lcp, 'http://app/slow');
  assert.equal(summary.metrics.cls.rating, 'poor');
  assert.equal(summary.measurement, 'exploratory');
});

test('missing vitals degrade to unknown instead of zero', () => {
  const summary = summarizeVitals([]);
  assert.equal(summary.samples, 0);
  assert.equal(summary.metrics.lcp.value, null);
  assert.equal(summary.metrics.lcp.rating, 'unknown');
  assert.equal(rate('lcp', null), 'unknown');
});

test('no performance gate exists unless a budget is configured', () => {
  const summary = summarizeVitals([{ lcp: 9000 }]);
  assert.deepEqual(performanceChecks(summary, {}), []);
});

test('a configured budget is a SIGNAL by default and cannot fail the run', () => {
  const summary = summarizeVitals([{ lcp: 9000, cls: 0.8 }]);
  const checks = performanceChecks(summary, { maxLcpMs: 2500, maxCls: 0.1 });
  assert.equal(checks.length, 2);
  for (const check of checks) {
    assert.equal(check.mode, 'signal');
    assert.equal(check.experimental, true);
    assert.equal(check.passed, true, 'signal mode must never fail the run');
    assert.equal(check.within, false, 'but the breach must still be visible');
  }
});

test('performanceMode "gate" makes the same budget blocking', () => {
  const summary = summarizeVitals([{ lcp: 9000 }]);
  const [check] = performanceChecks(summary, { maxLcpMs: 2500, performanceMode: 'gate' });
  assert.equal(check.mode, 'gate');
  assert.equal(check.passed, false);
  assert.equal(check.actual, 9000);
});

test('a run with no measurement never fails a performance gate', () => {
  const [check] = performanceChecks(summarizeVitals([]), { maxLcpMs: 2500, performanceMode: 'gate' });
  assert.equal(check.passed, true, 'absence of data is not evidence of slowness');
});

test('performance gate keys are only materialized when configured', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-perf-'));
  const bare = await loadConfig({ cwd: project, env: {} });
  assert.equal('maxLcpMs' in bare.gates, false, 'default gates must keep their 7.4.1 shape');

  fs.writeFileSync(
    path.join(project, 'usereye.config.cjs'),
    'module.exports = { gates: { maxLcpMs: 3000, performanceMode: "gate" } };\n',
  );
  const configured = await loadConfig({ cwd: project, env: {} });
  assert.equal(configured.gates.maxLcpMs, 3000);
  assert.equal(configured.gates.performanceMode, 'gate');
});

// --------------------------------------------------------------------------
// Phase 6 — observability
// --------------------------------------------------------------------------

function captureSink() {
  const lines = [];
  const push = message => lines.push(String(message));
  return { lines, sink: { log: push, warn: push, error: push } };
}

test('log level filters quieter messages', () => {
  const { lines, sink } = captureSink();
  const logger = new Logger({ level: 'warn', sink });
  logger.error('boom');
  logger.warn('careful');
  logger.info('fyi');
  logger.debug('noise');
  assert.deepEqual(lines, ['error: boom', 'warn: careful']);
});

test('info output keeps the plain 7.4.1 human format', () => {
  const { lines, sink } = captureSink();
  new Logger({ sink }).info('Project: demo');
  assert.deepEqual(lines, ['Project: demo'], 'no prefix may be added at the default level');
});

test('--log-json emits one parseable object per line', () => {
  const { lines, sink } = captureSink();
  const logger = new Logger({ json: true, sink, now: () => 0 });
  logger.info('started', { mode: 'quick' });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'started');
  assert.equal(parsed.mode, 'quick');
  assert.equal(parsed.ts, new Date(0).toISOString());
});

test('phase timings are recorded in order with real durations', async () => {
  let clock = 0;
  const logger = new Logger({ sink: captureSink().sink, now: () => clock });
  logger.startPhase('startup');
  clock = 120;
  logger.endPhase('startup');
  await logger.phase('explore', async () => {
    clock = 500;
  });
  const timings = logger.timings();
  assert.deepEqual(
    timings.phases.map(phase => phase.name),
    ['startup', 'explore'],
  );
  assert.equal(timings.phases[0].durationMs, 120);
  assert.equal(timings.totalMs, 500);
});

test('ending an unstarted phase is a no-op, never a crash', () => {
  const logger = new Logger({ sink: captureSink().sink });
  assert.equal(logger.endPhase('never-started'), null);
  assert.deepEqual(logger.timings().phases, []);
});

test('--log-level and --timings flow through the config layer', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-log-'));
  const config = await loadConfig({
    argv: ['--log-level', 'debug', '--timings', '--log-json'],
    cwd: project,
    env: {},
  });
  assert.equal(config.logLevel, 'debug');
  assert.equal(config.timings, true);
  assert.equal(config.logJson, true);

  await assert.rejects(
    () => loadConfig({ argv: ['--log-level', 'shout'], cwd: project, env: {} }),
    /Invalid logLevel/,
  );
});

// --------------------------------------------------------------------------
// Phase 5/6 — doctor
// --------------------------------------------------------------------------

test('doctor reports a healthy environment and never invents a failure', async () => {
  const report = await collectDiagnostics([], { fetchImpl: async () => ({ ok: false }) });
  const ids = report.checks.map(check => check.id);
  for (const expected of ['node-version', 'playwright-installed', 'config-loads', 'artifacts-writable']) {
    assert.ok(ids.includes(expected), `doctor must check ${expected}`);
  }
  assert.equal(typeof report.healthy, 'boolean');
  // Only `required` checks may affect the verdict.
  const failedRequired = report.checks.filter(check => check.level === 'required' && !check.ok);
  assert.equal(report.healthy, failedRequired.length === 0);
});

test('doctor surfaces the code-execution boundary so an operator can see it', async () => {
  const report = await collectDiagnostics([]);
  const boundary = report.checks.find(check => check.id === 'code-execution-boundary');
  assert.ok(boundary);
  assert.match(boundary.detail, /npmScripts=false/);
});

test('doctor fails when the target URL does not answer', async () => {
  const report = await collectDiagnostics(['--url', 'http://127.0.0.1:1/'], {
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  const target = report.checks.find(check => check.id === 'target-reachable');
  assert.equal(target.ok, false);
  assert.equal(report.healthy, false);
});

test('doctor update-check compares versions correctly', async () => {
  assert.equal(compareVersions('7.5.0', '7.4.1'), 1);
  assert.equal(compareVersions('7.4.1', '7.4.1'), 0);
  assert.equal(compareVersions('v7.4.0', '7.4.1'), -1);
  assert.match(minimumNode(), /^\d+/);

  const report = await collectDiagnostics(['--update-check'], {
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }),
  });
  const update = report.checks.find(check => check.id === 'update-check');
  assert.equal(update.ok, false);
  assert.equal(update.level, 'advisory', 'a new release must never fail doctor');
  const requiredFailed = report.checks.filter(check => check.level === 'required' && !check.ok);
  assert.ok(!requiredFailed.some(check => check.id === 'update-check'));
  assert.equal(report.healthy, requiredFailed.length === 0);
});

// --------------------------------------------------------------------------
// Phase 6 — extracted explorer modules
// --------------------------------------------------------------------------

test('budget module reproduces the documented mode budgets', () => {
  assert.deepEqual(Object.keys(MODES), ['quick', 'standard', 'deep']);
  assert.equal(mergeBudget('quick').maxStates, 6);
  assert.equal(mergeBudget('deep').maxDepth, 6);
  assert.equal(mergeBudget('nonsense').maxStates, MODES.standard.maxStates, 'unknown mode falls back');
  assert.equal(mergeBudget('quick', { maxStates: 99 }).maxStates, 99);
});

test('budget exhaustion and wall clock are pure predicates', () => {
  const budget = { maxStates: 3, maxActions: 5 };
  assert.equal(budgetExhausted({ states: 2, actions: 4 }, budget), false);
  assert.equal(budgetExhausted({ states: 3, actions: 0 }, budget), true);
  assert.equal(budgetExhausted({ states: 0, actions: 5 }, budget), true);
  assert.equal(wallClockExceeded(1000, null, 999_999), false, 'null means unlimited');
  assert.equal(wallClockExceeded(1000, 500, 1400), false);
  assert.equal(wallClockExceeded(1000, 500, 1500), true);
});

test('targeting blocks paths, hosts and names exactly as configured', () => {
  const options = {
    baseURL: 'http://app.test/',
    blockPaths: ['/admin', '/\\/danger\\/\\d+/'],
    blockNamePatterns: ['Delete'],
    allowedHosts: [],
  };
  assert.equal(blockedUrl('http://app.test/admin/users', options), true);
  assert.equal(blockedUrl('http://app.test/danger/42', options), true);
  assert.equal(blockedUrl('http://app.test/safe', options), false);
  assert.equal(blockedName('Delete account', options), true);
  assert.equal(blockedName('Save', options), false);
  assert.equal(matchesConfigured(/^ok$/, 'ok'), true);
});

test('an allow-list keeps the explorer inside the intended origins', () => {
  const options = { baseURL: 'http://app.test/', allowedHosts: ['cdn.test'], blockPaths: [] };
  assert.equal(blockedUrl('http://app.test/page', options), false, 'base host is always allowed');
  assert.equal(blockedUrl('http://cdn.test/asset', options), false);
  assert.equal(blockedUrl('http://evil.test/steal', options), true);
});

test('URL canonicalization collapses states as configured', () => {
  const options = { baseURL: 'http://app.test/', ignoreQueryParams: true, ignoreHash: true };
  assert.equal(canonicalUrl('/list?page=2#top', options), 'http://app.test/list');
  const strict = { baseURL: 'http://app.test/', ignoreQueryParams: false, ignoreHash: false };
  assert.equal(canonicalUrl('/list?page=2', strict), 'http://app.test/list?page=2');
});

test('state hashing is stable, and reuses the engine hash when nothing is ignored', () => {
  const state = {
    materialHash: 'engine-hash',
    url: 'http://app.test/x?a=1',
    title: 't',
    textHash: 'th',
    dialogs: 0,
    alerts: 0,
    controlCount: 3,
  };
  assert.equal(
    quickHash(state, {}, url => url),
    'engine-hash',
    '7.4.1 fingerprints must not move',
  );

  const canonical = url => url.split('?')[0];
  const first = quickHash(state, { ignoreQueryParams: true }, canonical);
  const second = quickHash(
    { ...state, url: 'http://app.test/x?a=2' },
    { ignoreQueryParams: true },
    canonical,
  );
  assert.equal(first, second, 'query-only differences must collapse to one state');
  assert.equal(first.length, 20);
  assert.notEqual(hashMaterial({ a: 1 }), hashMaterial({ a: 2 }));
  assert.equal(
    coverageKey('http://app.test/x', { selector: '#a', name: 'Save' }),
    'http://app.test/x|#a|Save',
  );
});

test('audit module scores a run out of its weighted gates', () => {
  assert.equal(
    scoreGates([
      { passed: true, weight: 50 },
      { passed: true, weight: 50 },
    ]),
    100,
  );
  assert.equal(
    scoreGates([
      { passed: true, weight: 30 },
      { passed: false, weight: 70 },
    ]),
    30,
  );
  assert.equal(scoreGates([]), 100, 'no gates means nothing failed');

  const explorer = {
    states: [{ url: 'http://a', pageType: 'content' }],
    stateByHash: new Map([['h', 1]]),
    responsiveAudits: [{ status: 'completed' }],
    axeStateHashes: new Set(['h']),
    skipped: [],
    discoveredCandidates: new Map(),
    accountedCandidates: new Set(),
    misclickAudit: [{}],
    firstImpression: {},
    auth: { detected: false, attempted: false },
    budget: { coverageTarget: 65, misclickTargets: 1 },
    options: { axe: true, allowDestructive: false },
    eye: { telemetry: {} },
  };
  const gates = buildGates(explorer, { coveragePercent: 100 });
  assert.equal(gates.length, 10);
  assert.ok(
    gates.every(gate => gate.passed),
    'a complete run must score every gate',
  );
  assert.equal(scoreGates(gates), 100);
});

// ---------------------------------------------------------------------------
// 7.5.1 (roadmap 7.5.0 item 2.4): step lines go through the logger.
// ---------------------------------------------------------------------------

test('logger.step: byte-identical to the legacy stdout line at info, silent at error, structured in json', () => {
  const step = { number: 3, name: 'Open target application', status: 'passed', durationMs: 375 };
  const legacy = `[PASS] ${String(step.number).padStart(2, '0')} ${step.name} (${step.durationMs} ms)`;

  const plain = captureSink();
  new Logger({ sink: plain.sink }).step(step);
  assert.deepEqual(plain.lines, [legacy]);

  const warn = captureSink();
  new Logger({ sink: warn.sink }).step({ ...step, status: 'warning' });
  assert.deepEqual(warn.lines, ['[WARN] 03 Open target application (375 ms)']);
  const fail = captureSink();
  new Logger({ sink: fail.sink }).step({ ...step, status: 'failed' });
  assert.deepEqual(fail.lines, ['[FAIL] 03 Open target application (375 ms)']);

  const quiet = captureSink();
  new Logger({ level: 'error', sink: quiet.sink }).step(step);
  assert.deepEqual(quiet.lines, [], '--log-level error silences step lines');

  const json = captureSink();
  new Logger({ json: true, sink: json.sink, now: () => 0 }).step(step);
  assert.equal(json.lines.length, 1);
  const parsed = JSON.parse(json.lines[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.event, 'step');
  assert.equal(parsed.message, legacy);
  assert.deepEqual(parsed.step, step);
});

test('UserEye.step() writes through options.logger (default: console logger at info)', async () => {
  const { UserEye } = require('../user-eye');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const artifactDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-step-log-')), 'run');
  const { lines, sink } = captureSink();
  const logger = new Logger({ sink });
  const eye = new UserEye({ artifactDir, recordVideo: false, logger });
  assert.equal(eye.logger, logger);
  // step() without a launched browser: the body runs, no screenshot is attempted.
  await eye.step('Pure step', async () => {}, { screenshot: false });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[PASS\] 01 Pure step \(\d+ ms\)$/);

  const quiet = captureSink();
  const silent = new UserEye({
    artifactDir,
    recordVideo: false,
    logger: new Logger({ level: 'error', sink: quiet.sink }),
  });
  await silent.step('Silent step', async () => {}, { screenshot: false });
  assert.deepEqual(quiet.lines, []);

  const bare = new UserEye({ artifactDir, recordVideo: false });
  assert.equal(typeof bare.logger.step, 'function', 'default logger is a console Logger');
  assert.equal(bare.logger.level, 'info');
});
