'use strict';

/**
 * Pure-logic unit tests: configuration resolution (config.js), the --dry-run
 * execution plan (execution-plan.js, roadmap item 4.3), budget merging and
 * page classification (adaptive-explorer.js). No browser is launched.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const {
  DEFAULT_CONFIG,
  mergeConfig,
  parseArgv,
  loadConfig,
  sanitizeConfig,
  writeResolvedConfig,
} = require('../config');
const { buildExecutionPlan, printExecutionPlan } = require('../execution-plan');
const { MODES, mergeBudget, classifyPage } = require('../adaptive-explorer');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// config.js — mergeConfig
// ---------------------------------------------------------------------------

test('config: mergeConfig deep-merges plain objects without mutating inputs', () => {
  const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] };
  const overlay = { nested: { y: 3 }, b: 2, list: [9], skipped: undefined };
  const merged = mergeConfig(base, overlay);
  assert.deepEqual(merged, { a: 1, nested: { x: 1, y: 3 }, list: [9], b: 2 });
  assert.deepEqual(base.nested, { x: 1, y: 2 }, 'base is never mutated');
  assert.ok(!('skipped' in merged), 'undefined overlay values are ignored');
});

// ---------------------------------------------------------------------------
// config.js — parseArgv
// ---------------------------------------------------------------------------

test('config: parseArgv handles values, booleans, =syntax, accumulators and positionals', () => {
  const parsed = parseArgv([
    '--url',
    'http://a.test',
    '--mode=deep',
    '--dry-run',
    '--seed',
    '/one',
    '--seed',
    '/two',
    'http://positional.test',
  ]);
  assert.equal(parsed.values.url, 'http://a.test');
  assert.equal(parsed.values.mode, 'deep');
  assert.equal(parsed.values['dry-run'], true);
  assert.deepEqual(parsed.values.seed, ['/one', '/two']);
  assert.deepEqual(parsed.positionals, ['http://positional.test']);
  assert.ok(parsed.explicit.has('dry-run'));

  assert.throws(() => parseArgv(['--nonsense']), /Unknown option: --nonsense/);
  assert.throws(() => parseArgv(['--url']), /requires a value/);
  assert.throws(() => parseArgv(['--url', '--mode']), /requires a value/);
});

// ---------------------------------------------------------------------------
// config.js — loadConfig precedence: defaults < file < profile < env < CLI
// ---------------------------------------------------------------------------

test('config: loadConfig merges file, profile, environment and CLI in the documented order', async () => {
  const dir = tmpDir('usereye-loadconfig-');
  fs.writeFileSync(
    path.join(dir, 'usereye.config.js'),
    `module.exports = {
      mode: 'standard',
      baseURL: 'http://file.test',
      patternPack: 'pt',
      profiles: { deepish: { mode: 'deep', retries: 5 } },
    };\n`,
  );
  const config = await loadConfig({
    argv: [
      '--profile',
      'deepish',
      '--url',
      'http://cli.test',
      '--retries',
      '3',
      '--min-delay',
      '50',
      '--dry-run',
      '--browser',
      'firefox',
      '--seed',
      '/a',
      '--seed',
      '/b',
      '--viewport',
      '1440x900',
    ],
    cwd: dir,
    env: { USEREYE_MODE: 'quick', USEREYE_EMAIL: 'person@example.test' },
  });

  assert.equal(config.baseURL, 'http://cli.test', 'CLI beats file');
  assert.equal(config.mode, 'quick', 'environment beats profile/file');
  assert.equal(config.profile, 'deepish');
  assert.equal(config.retries, 3, 'CLI numeric wins over profile and is coerced');
  assert.equal(config.minActionDelayMs, 50);
  assert.equal(config.dryRun, true);
  assert.equal(config.browser, 'firefox');
  assert.deepEqual(config.seedPaths, ['/a', '/b']);
  assert.deepEqual(config.viewport, { width: 1440, height: 900 });
  assert.deepEqual(config.credentials, { email: 'person@example.test' });
  assert.deepEqual(config.patternPack, ['pt'], 'string patternPack is split');
  assert.equal(config.configFile, path.join(dir, 'usereye.config.js'));
  assert.deepEqual(config.gates, {
    minAdaptiveScore: 70,
    maxBlocker: 0,
    maxCritical: 0,
    maxUnexpectedBrowserErrors: 0,
  });
  assert.ok(path.isAbsolute(config.outDir));
  assert.equal(config.navigationTimeoutMs, DEFAULT_CONFIG.navigationTimeoutMs ?? 15000);
});

test('config: loadConfig rejects unknown profiles, modes, browsers and viewports', async () => {
  const dir = tmpDir('usereye-loadconfig-bad-');
  fs.writeFileSync(path.join(dir, 'usereye.config.js'), 'module.exports = { profiles: {} };\n');
  await assert.rejects(
    loadConfig({ argv: ['--profile', 'nope'], cwd: dir, env: {} }),
    /Unknown UserEye profile: nope/,
  );
  await assert.rejects(loadConfig({ argv: ['--mode', 'turbo'], cwd: dir, env: {} }), /Invalid mode: turbo/);
  await assert.rejects(
    loadConfig({ argv: ['--browser', 'netscape'], cwd: dir, env: {} }),
    /Invalid browser: netscape/,
  );
  await assert.rejects(
    loadConfig({ argv: ['--viewport', 'big'], cwd: dir, env: {} }),
    /--viewport must use WIDTHxHEIGHT/,
  );
});

// ---------------------------------------------------------------------------
// config.js — sanitizeConfig / writeResolvedConfig
// ---------------------------------------------------------------------------

test('config: sanitizeConfig redacts secrets and survives functions, regexes and cycles', () => {
  const circular = { name: 'loop' };
  circular.self = circular;
  const sanitized = sanitizeConfig({
    password: 'hunter2',
    nested: { apiKey: 'abc123', keep: 'visible' },
    pattern: /^usereye$/i,
    handler: function startServer() {},
    circular,
    list: [{ token: 'xyz' }, { ok: 1 }],
  });
  assert.equal(sanitized.password, '[REDACTED]');
  assert.equal(sanitized.nested.apiKey, '[REDACTED]');
  assert.equal(sanitized.nested.keep, 'visible');
  assert.equal(sanitized.pattern, '/^usereye$/i');
  assert.match(sanitized.handler, /^\[Function startServer\]$/);
  assert.equal(sanitized.circular.self, '[Circular]');
  assert.equal(sanitized.list[0].token, '[REDACTED]');
  assert.equal(sanitized.list[1].ok, 1);
  assert.doesNotThrow(() => JSON.stringify(sanitized));
});

test('config: writeResolvedConfig persists a sanitized resolved-config.json', () => {
  const dir = tmpDir('usereye-resolved-');
  const file = writeResolvedConfig({ mode: 'quick', credentials: { password: 'p4ss' } }, dir);
  assert.equal(file, path.join(dir, 'resolved-config.json'));
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.mode, 'quick');
  assert.equal(written.credentials.password, '[REDACTED]');
});

// ---------------------------------------------------------------------------
// adaptive-explorer.js — mergeBudget / classifyPage
// ---------------------------------------------------------------------------

test('explorer: mergeBudget applies mode presets with overrides and a standard fallback', () => {
  assert.deepEqual(mergeBudget('quick'), MODES.quick);
  assert.equal(mergeBudget('quick', { maxStates: 2 }).maxStates, 2);
  assert.equal(mergeBudget('quick', { maxStates: 2 }).maxActions, MODES.quick.maxActions);
  assert.deepEqual(mergeBudget('nonexistent-mode'), MODES.standard);
  assert.ok(MODES.deep.maxStates > MODES.standard.maxStates);
  assert.ok(MODES.standard.maxStates > MODES.quick.maxStates);
});

test('explorer: classifyPage maps observations and facts onto page classes', () => {
  const classify = (title, visibleText, facts) =>
    classifyPage(
      { title, visibleText },
      {
        controls: 0,
        passwordInputs: 0,
        forms: 0,
        inputs: 0,
        tables: 0,
        navigation: 0,
        headings: 0,
        cards: 0,
        ...facts,
      },
    );

  assert.equal(classify('Page not found', '404 error', { controls: 2 }), 'error');
  assert.equal(
    classify('Sign in', 'Enter your password', { passwordInputs: 1, forms: 1, inputs: 2 }),
    'authentication',
  );
  assert.equal(
    classify('Create account', 'Register with email and password', {
      passwordInputs: 1,
      forms: 1,
      inputs: 3,
    }),
    'registration/setup',
  );
  assert.equal(classify('Contact', 'Tell us more', { forms: 1, inputs: 2 }), 'form');
  assert.equal(classify('Orders', 'All orders', { tables: 1 }), 'table/list');
  assert.equal(classify('Home', 'Welcome', { navigation: 3, headings: 2 }), 'dashboard/content');
  assert.equal(classify('Gallery', 'Items', { cards: 4 }), 'collection/empty');
  assert.equal(classify('Search', 'No results for your query', {}), 'collection/empty');
  assert.equal(classify('About', 'Our story in plain prose', {}), 'content');
});

// ---------------------------------------------------------------------------
// execution-plan.js — buildExecutionPlan / printExecutionPlan
// ---------------------------------------------------------------------------

function baseConfig(overrides = {}) {
  return {
    mode: 'quick',
    baseURL: 'http://plan.test',
    projectDir: '/tmp/plan-project',
    browser: 'chromium',
    retries: 2,
    retryBackoffMs: 400,
    navigationTimeoutMs: 15000,
    dialogTimeoutMs: 5000,
    minActionDelayMs: 0,
    recordVideo: false,
    axe: true,
    codeQuality: false,
    seedPaths: ['/login'],
    blockPaths: ['/admin'],
    blockNamePatterns: ['delete'],
    gates: { minAdaptiveScore: 70, maxBlocker: 0, maxCritical: 0, maxUnexpectedBrowserErrors: 0 },
    reportFormat: 'html,json',
    ...overrides,
  };
}

test('plan: buildExecutionPlan describes a quick run without a browser', () => {
  const plan = buildExecutionPlan(baseConfig(), { startCommand: 'npm start', stack: 'react' });
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.browser, 'chromium');
  assert.equal(plan.mode, 'quick');
  assert.equal(plan.target.url, 'http://plan.test');
  assert.equal(plan.target.startCommand, 'npm start');
  assert.equal(plan.target.stack, 'react');
  assert.deepEqual(plan.seedPaths, ['/login']);

  // Budget mirrors MODES.quick unless overridden.
  for (const key of [
    'maxStates',
    'maxActions',
    'maxDepth',
    'actionsPerState',
    'coverageTarget',
    'screenshots',
    'axeStates',
  ]) {
    assert.equal(plan.budget[key], MODES.quick[key], `quick budget ${key}`);
  }

  // Protocols are selected through the real ProtocolRunner.
  assert.ok(plan.protocols.selected > 0, 'the default selection picks protocols');
  assert.ok(Array.isArray(plan.protocols.ids));
  for (const entry of plan.protocols.ids) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.category, 'string');
    assert.equal(typeof entry.serial, 'boolean');
  }

  // Safety defaults.
  assert.equal(plan.safety.allowWrite, false);
  assert.equal(plan.safety.allowDestructive, false);
  assert.equal(plan.safety.authentication, 'none detected');
  assert.deepEqual(plan.safety.blockPaths, ['/admin']);

  // Resilience mirrors items 4.1/4.2/4.4.
  assert.deepEqual(plan.resilience, {
    retries: 2,
    retryBackoffMs: 400,
    navigationTimeoutMs: 15000,
    dialogTimeoutMs: 5000,
    minActionDelayMs: 0,
  });

  // Outputs list the artifacts a real run would produce.
  assert.ok(plan.outputs.includes('result.json'));
  assert.ok(plan.outputs.includes('report (html)'));
  assert.ok(plan.outputs.includes('report (json)'));
});

test('plan: budget overrides, protocol subsets, auth detection and command/url interplay', () => {
  const full = buildExecutionPlan(baseConfig());
  const oneId = full.protocols.ids[0].id;

  const subset = buildExecutionPlan(baseConfig({ protocols: [oneId] }));
  assert.equal(subset.protocols.selected, 1);
  assert.equal(subset.protocols.ids[0].id, oneId);

  const overridden = buildExecutionPlan(baseConfig({ maxStates: 2, mode: 'deep' }));
  assert.equal(overridden.budget.maxStates, 2, 'explicit maxStates beats the mode preset');
  assert.equal(overridden.budget.maxActions, MODES.deep.maxActions);

  const withCredentials = buildExecutionPlan(
    baseConfig({ credentials: { email: 'e@x.test', password: 'p' } }),
  );
  assert.equal(withCredentials.safety.authentication, 'form');

  const withState = buildExecutionPlan(
    baseConfig({ storageState: '/tmp/state.json', credentials: { email: 'e' } }),
  );
  assert.equal(withState.safety.authentication, 'storageState');

  const withCommand = buildExecutionPlan(baseConfig({ command: 'npm run dev' }), {
    startCommand: 'npm run dev',
  });
  assert.equal(
    withCommand.target.commandIgnoredBecauseUrlGiven,
    true,
    'a start command is ignored when a URL is configured (regression guard)',
  );
  const commandOnly = buildExecutionPlan(baseConfig({ baseURL: null, command: 'npm run dev' }), {
    startCommand: 'npm run dev',
  });
  assert.equal(commandOnly.target.commandIgnoredBecauseUrlGiven, false);
  assert.equal(commandOnly.target.url, null);
});

test('plan: printExecutionPlan writes a human-readable dry-run summary', () => {
  const plan = buildExecutionPlan(baseConfig());
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    printExecutionPlan(plan, '/tmp/some-artifacts');
  } finally {
    console.log = original;
  }
  const text = lines.join('\n');
  assert.match(text, /=== UserEye dry run — no browser will be launched ===/);
  assert.match(text, /Target: http:\/\/plan\.test/);
  assert.match(text, /mode quick/);
  assert.match(text, /retries 2/);
  assert.match(text, /Protocols: \d+ selected/);
  assert.match(text, /writes no · destructive no/);
  assert.match(text, /score >= 70/);
  assert.match(text, /plan\.json/);
});
