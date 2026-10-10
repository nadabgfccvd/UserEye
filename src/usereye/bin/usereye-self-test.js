#!/usr/bin/env node
'use strict';

/**
 * `usereye --self-test` / `usereye self-test` / `usereye diag`
 *
 * In-process sanity suite for operators. It does not launch a browser and does
 * not replace `npm test`. Assertions here are the ones that used to live only
 * as redundant “does the CLI even load?” checks.
 */

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const USAGE = `Usage: usereye --self-test | usereye self-test | usereye diag [options]

  --json    Machine-readable report
  --help

Exit codes: 0 all assertions passed · 2 at least one assertion failed.
Does not launch a browser. For environment preflight use \`usereye doctor\`.
`;

const CORE_MODULES = [
  'index.js',
  'user-eye.js',
  'config.js',
  'usereye-auto.js',
  'usereye-observe.js',
  'dashboard.js',
  'issue-export.js',
  'adaptive-explorer.js',
  'protocol-runner.js',
  'report.js',
  'findings.js',
  'axe-hints.js',
  'artifact-gc.js',
  'logger.js',
  'command-runner.js',
  'bin/usereye.js',
  'bin/usereye-doctor.js',
  'bin/usereye-init.js',
  'bin/usereye-auth.js',
];

function capture(fn) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalOutWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  console.log = (...args) => stdout.push(args.map(String).join(' '));
  console.error = (...args) => stderr.push(args.map(String).join(' '));
  console.warn = (...args) => stderr.push(args.map(String).join(' '));
  process.stdout.write = (chunk, encoding, callback) => {
    stdout.push(String(chunk));
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };
  process.stderr.write = (chunk, encoding, callback) => {
    stderr.push(String(chunk));
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };
  return Promise.resolve()
    .then(fn)
    .then(
      value => ({ value, stdout: stdout.join('\n'), stderr: stderr.join('\n'), error: null }),
      error => ({
        value: 2,
        stdout: stdout.join('\n'),
        stderr: `${stderr.join('\n')}\n${error && error.message ? error.message : error}`,
        error,
      }),
    )
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      process.stdout.write = originalOutWrite;
      process.stderr.write = originalErrWrite;
    });
}

async function collectAssertions() {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) });

  add('package-version', /^\d+\.\d+\.\d+/.test(pkg.version), `${pkg.name}@${pkg.version}`);
  add('engines-node', pkg.engines && pkg.engines.node, `engines.node=${pkg.engines?.node}`);

  const nodeVersion = process.version.replace(/^v/, '');
  const { compareVersions, minimumNode, USAGE: doctorUsage } = require('./usereye-doctor');
  add(
    'node-meets-engines',
    compareVersions(nodeVersion, minimumNode()) >= 0,
    `Node ${nodeVersion} vs minimum ${minimumNode()}`,
  );

  const { HELP, COMMANDS, dispatch } = require('./usereye');
  const requiredCommands = [
    'observe',
    'auto',
    'analyze',
    'doctor',
    'install-browsers',
    'gc',
    'dashboard',
    'export-issues',
    'init',
    'auth',
    'self-test',
    'diag',
  ];
  const missingFromRegistry = requiredCommands.filter(name => !COMMANDS.includes(name));
  add(
    'command-registry',
    missingFromRegistry.length === 0,
    missingFromRegistry.length ? `missing: ${missingFromRegistry.join(', ')}` : COMMANDS.join(', '),
  );

  const missingFromHelp = requiredCommands.filter(name => {
    if (name === 'self-test') return !/--self-test/.test(HELP) && !/self-test/.test(HELP);
    return !HELP.includes(name);
  });
  add(
    'help-lists-commands',
    missingFromHelp.length === 0,
    missingFromHelp.length ? `not in HELP: ${missingFromHelp.join(', ')}` : 'HELP covers every command',
  );

  add('help-lists-observe', /usereye observe/.test(HELP), 'top-level help names usereye observe');
  add('help-exit-codes', /Exit codes: 0/.test(HELP), 'top-level help documents 0 | 1 | 2');

  const root = path.resolve(__dirname, '..');
  for (const relative of CORE_MODULES) {
    const filePath = path.join(root, relative);
    let ok = false;
    let detail = filePath;
    try {
      ok = fs.existsSync(filePath);
      if (ok) require(filePath);
      detail = ok ? `loaded ${relative}` : `missing ${relative}`;
    } catch (error) {
      ok = false;
      detail = `${relative}: ${error.message}`;
    }
    add(`load:${relative}`, ok, detail);
  }

  const { DEFAULT_CONFIG, VALUE_FLAGS, BOOLEAN_FLAGS, parseArgv } = require('../config');
  add('calm-video', DEFAULT_CONFIG.recordVideo === 'on-failure', `recordVideo=${DEFAULT_CONFIG.recordVideo}`);
  add('calm-trace', DEFAULT_CONFIG.trace === 'on-failure', `trace=${DEFAULT_CONFIG.trace}`);
  add(
    'calm-misclick',
    DEFAULT_CONFIG.misclick?.policy === 'stable-only',
    `misclick.policy=${DEFAULT_CONFIG.misclick?.policy}`,
  );
  add(
    'calm-findings',
    DEFAULT_CONFIG.findings?.minConfidence === 'medium' && DEFAULT_CONFIG.findings?.gateConfidence === 'high',
    `minConfidence=${DEFAULT_CONFIG.findings?.minConfidence} gateConfidence=${DEFAULT_CONFIG.findings?.gateConfidence}`,
  );
  add('flag-log-level', VALUE_FLAGS.has('log-level'), '--log-level is a value flag');
  add('flag-fail-on', VALUE_FLAGS.has('fail-on'), '--fail-on is a value flag');
  add('flag-help', BOOLEAN_FLAGS.has('help'), '--help is a boolean flag');

  let parseOk = false;
  let parseDetail = '';
  try {
    parseArgv(['--help']);
    parseOk = true;
    parseDetail = 'parseArgv(--help) accepted';
  } catch (error) {
    parseDetail = error.message;
  }
  add('parse-help-flag', parseOk, parseDetail);

  const { observeExitCode, USAGE: observeUsage } = require('../usereye-observe');
  add(
    'observe-exit-any-issue',
    observeExitCode(
      { summary: { issues: 1, unexpectedBrowserErrors: 0 }, issues: [{ severity: 'minor' }] },
      null,
    ) === 1,
    'historical observe contract: any issue exits 1',
  );
  add(
    'observe-exit-never',
    observeExitCode(
      { summary: { issues: 3, unexpectedBrowserErrors: 0 }, issues: [{ severity: 'blocker' }] },
      'never',
    ) === 0,
    '--fail-on never keeps findings from failing the run',
  );
  add(
    'observe-exit-browser-error',
    observeExitCode({ summary: { issues: 0, unexpectedBrowserErrors: 1 }, issues: [] }, 'never') === 1,
    'unexpected browser errors always exit 1',
  );
  add('observe-usage', /Usage: usereye observe/.test(observeUsage), 'observe --help documents the command');

  const { USAGE: autoUsage, ANALYZE_USAGE, evaluateQualityGates } = require('../usereye-auto');
  add('auto-usage', /Usage: usereye auto/.test(autoUsage), 'auto --help documents the command');
  add('auto-review-mode', /--review-mode/.test(autoUsage), 'auto --help documents --review-mode');
  add(
    'auto-allow-project-commands',
    /--allow-project-commands/.test(autoUsage),
    'auto --help documents the code-execution boundary',
  );
  add('analyze-usage', /Usage: usereye analyze/.test(ANALYZE_USAGE), 'analyze --help is not the auto menu');
  add(
    'analyze-usage-no-browser',
    /Does not launch a browser/.test(ANALYZE_USAGE),
    'analyze help states no browser',
  );

  let gatesOk = false;
  let gatesDetail = '';
  try {
    const gates = evaluateQualityGates(
      { summary: { unexpectedBrowserErrors: 0 }, issues: [] },
      { quality: { score: 100 } },
      { minAdaptiveScore: 70, maxBlocker: 0, maxCritical: 0, maxUnexpectedBrowserErrors: 0 },
    );
    gatesOk = gates.passed === true && Array.isArray(gates.checks);
    gatesDetail = `passed=${gates.passed} checks=${gates.checks.length}`;
  } catch (error) {
    gatesDetail = error.message;
  }
  add('quality-gates-empty-run', gatesOk, gatesDetail);

  const api = require('../index');
  const requiredExports = [
    'UserEye',
    'AdaptiveExplorer',
    'loadConfig',
    'DEFAULT_CONFIG',
    'writeReports',
    'buildSarif',
    'buildExecutionPlan',
    'buildIssuePayloads',
  ];
  const missingExports = requiredExports.filter(name => typeof api[name] !== 'function' && api[name] == null);
  add(
    'library-exports',
    missingExports.length === 0 && typeof api.UserEye === 'function',
    missingExports.length ? `missing: ${missingExports.join(', ')}` : requiredExports.join(', '),
  );
  add('help-lists-library', /require\("usereye"\)/.test(HELP), 'top-level help lists library exports');

  add('compare-versions', compareVersions('7.5.1', '7.5.0') === 1, 'compareVersions orders semver');
  add(
    'init-template-docs-index',
    !require('./usereye-init').CONFIG_TEMPLATE.includes('EXECUTION-PLAN-NEXT'),
    'init template points at docs/README.md, not a removed file',
  );

  const { SUPPORTED_FORMATS } = require('../issue-export');
  add(
    'export-formats',
    SUPPORTED_FORMATS.includes('github') &&
      SUPPORTED_FORMATS.includes('jira') &&
      SUPPORTED_FORMATS.includes('linear'),
    SUPPORTED_FORMATS.join(', '),
  );

  const { DASHBOARD_USAGE } = require('../dashboard');
  add(
    'dashboard-usage',
    /Usage: usereye dashboard/.test(DASHBOARD_USAGE),
    'dashboard --help documents the command',
  );
  const { EXPORT_USAGE } = require('../issue-export');
  add(
    'export-usage',
    /Usage: usereye export-issues/.test(EXPORT_USAGE),
    'export-issues --help documents the command',
  );
  const { INIT_USAGE } = require('./usereye-init');
  add('init-usage', /Usage: usereye init/.test(INIT_USAGE), 'init --help documents the command');
  const { AUTH_USAGE, parseAuthArgv } = require('./usereye-auth');
  add('auth-usage', /Usage: usereye auth save/.test(AUTH_USAGE), 'auth --help documents the command');
  add('doctor-usage', /Usage: usereye doctor/.test(doctorUsage), 'doctor --help documents the command');

  let authHelpOk = false;
  let authHelpDetail = '';
  try {
    const parsed = parseAuthArgv(['save', '--help']);
    authHelpOk = parsed.help === true;
    authHelpDetail = authHelpOk ? 'auth save --help does not require --url' : 'help flag not set';
  } catch (error) {
    authHelpDetail = error.message;
  }
  add('auth-help-without-url', authHelpOk, authHelpDetail);

  const helpCommands = [
    ['observe', /Usage: usereye observe/],
    ['auto', /Usage: usereye auto/],
    ['analyze', /Usage: usereye analyze/],
    ['doctor', /Usage: usereye doctor/],
    ['init', /Usage: usereye init/],
    ['auth', /Usage: usereye auth/],
    ['dashboard', /Usage: usereye dashboard/],
    ['export-issues', /Usage: usereye export-issues/],
    ['install-browsers', /Usage: usereye install-browsers/],
    ['gc', /Usage: usereye gc/],
    ['self-test', /Usage: usereye --self-test/],
    ['diag', /Usage: usereye --self-test/],
  ];
  for (const [command, pattern] of helpCommands) {
    const captured = await capture(() => dispatch([command, '--help']));
    add(
      `subcommand-help:${command}`,
      captured.value === 0 && pattern.test(captured.stdout),
      captured.value === 0
        ? `${command} --help exit 0`
        : `${command} --help exit ${captured.value}: ${captured.stderr}`,
    );
  }

  const unknown = await capture(() => dispatch(['not-a-real-command']));
  add(
    'unknown-command-exit-2',
    unknown.value === 2 && /Unknown command/.test(unknown.stderr),
    `exit=${unknown.value}`,
  );

  const versionOut = await capture(() => dispatch(['--version']));
  add(
    'version-matches-package',
    versionOut.value === 0 && versionOut.stdout.trim() === pkg.version,
    `cli=${versionOut.stdout.trim()} package=${pkg.version}`,
  );

  const unknownFlag = await capture(() => dispatch(['auto', '--not-a-real-option']));
  add(
    'unknown-option-exit-2',
    unknownFlag.value === 2 && /Unknown option/.test(unknownFlag.stderr),
    `exit=${unknownFlag.value}`,
  );

  const observeHelp = await capture(() => dispatch(['observe', '--help']));
  add(
    'observe-help-fail-on',
    observeHelp.value === 0 && /--fail-on/.test(observeHelp.stdout),
    'observe --help documents --fail-on',
  );

  return {
    version: pkg.version,
    checks,
    passed: checks.filter(check => check.ok).length,
    failed: checks.filter(check => !check.ok).length,
  };
}

function printReport(report) {
  const width = 64;
  const line = '-'.repeat(width);
  console.log(line);
  console.log(`UserEye self-test — ${pkg.name}@${report.version}`);
  console.log(line);
  for (const check of report.checks) {
    const mark = check.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${check.id}`);
    console.log(`         ${check.detail}`);
  }
  console.log(line);
  console.log(
    report.failed === 0
      ? `All ${report.passed} assertion(s) passed.`
      : `${report.failed} assertion(s) failed · ${report.passed} passed.`,
  );
}

async function runSelfTest(argv = []) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return { exitCode: 0, help: true };
  }
  const report = await collectAssertions();
  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
  return { exitCode: report.failed === 0 ? 0 : 2, report };
}

module.exports = { USAGE, collectAssertions, runSelfTest };

if (require.main === module) {
  runSelfTest(process.argv.slice(2))
    .then(result => {
      process.exitCode = result.exitCode;
    })
    .catch(error => {
      console.error(error.stack || error);
      process.exitCode = 2;
    });
}
