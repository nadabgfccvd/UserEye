#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const pkg = require('../package.json');

const SUPPORTED_INSTALL_TARGETS = ['chromium', 'firefox', 'webkit'];

const COMMANDS = Object.freeze([
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
]);

const HELP = `UserEye ${pkg.version} — project-agnostic browser exploration

Usage:
  usereye observe [url] [options]
  usereye auto [options]
  usereye analyze [options]
  usereye <command> [options]
  usereye --version
  usereye --self-test
  usereye --help

Commands (every name is a real dispatcher branch; none are aliases except self-test/diag/--self-test):
  observe [url]              Single-page observation. Does not explore or start a repo.
                             Key flags: --url --axe --fail-on --out --browser --mobile
                             --viewport --headed --wait --trace --video|--video-on-failure|--no-video
                             --report-locale --report-format --log-level --log-json --config
                             Exit: 0 clean; 1 findings (see --fail-on); 2 usage/setup.
  auto [options]             Adaptive exploration of a URL or repository; evidence + gates.
                             Key flags: --url --project --mode quick|standard|deep
                             --review-mode normal|perf-seo|flows|a11y-strict
                             --allow-project-commands <list>  (default: none, static-only)
                             --dry-run --compare --misclick-policy --trace --video*
                             --log-level --timings --out --config
                             Exit: 0 gates pass; 1 quality fail; 2 setup; 130/143 signal.
  analyze [options]          Detection + plan.json only (auto --analyze). No browser.
                             Key flags: --project --url --out --mode --allow-project-commands
                             Exit: 0 wrote the plan; 2 usage/setup.
  doctor [options]           Environment preflight. Does not replace --self-test.
                             Flags: --url --project --config --json --update-check
                             Required checks: node, playwright, chromium, config, artifacts
                             (and target if --url). --update-check is advisory only.
                             Exit: 0 healthy; 2 a required check failed.
  install-browsers [engine]  chromium | firefox | webkit | all  (default: chromium)
                             --help prints usage and does not download.
                             Exit: 0 installed; 2 unknown engine or CLI missing.
  gc [artifacts-dir]         Delete only UserEye run dirs older than a retention age.
                             Required: --older-than 7d. Optional: --dry-run.
  dashboard [artifacts-dir]  Read-only HTTP index of previous runs (result.json).
                             Flags: --port (default 4174) --host (default 127.0.0.1)
  export-issues <result>     GitHub / Jira / Linear payloads from result.json.
                             Flags: --format github|jira|linear --severity --project --labels --out
  init [dir]                 Scaffold usereye.config.js (+ .gitignore, + CI with --workflow)
                             Refuses to overwrite an existing config (exit 2).
  auth save --url <app>      Capture Playwright storageState (SSO/2FA friendly).
                             Flags: --out --email --username --password --headed|--headless
                             --submit --navigate-to --wait-ms --browser --timeout
                             --help does not require --url.
  self-test | diag           In-process sanity assertions (no browser).
  --self-test                Same as self-test. Flag: --json

Global:
  -h, --help                 This menu; after a command, that command's own help
  -v, --version              Print ${pkg.version} (package.json) and exit 0

Library (require("usereye") — not extra CLI commands):
  UserEye, AdaptiveExplorer, ProjectAdapter, ProtocolRunner, CodeQualityAnalyzer
  loadConfig, sanitizeConfig, writeResolvedConfig, DEFAULT_CONFIG
  loadPatterns, writeReports, buildSarif, writeSarif
  buildExecutionPlan, buildIssuePayloads
  safeName, TOOL_VERSION, SUPPORTED_BROWSERS, MODES, classifyPage, mergeBudget

Run "usereye <command> --help" for the full flag list, examples and expected output.
Exit codes: 0 success; 1 completed with quality failures; 2 setup/usage failure; 130/143 signal.
`;

const INSTALL_USAGE = `Usage: usereye install-browsers [chromium|firefox|webkit|all ...]

Downloads Playwright browser builds used by observe/auto/auth.
With no arguments, installs chromium. \`all\` installs every supported engine.

Options:
  -h, --help

Exit codes: 0 installed; 2 unknown engine or Playwright CLI not found.
`;

/**
 * Resolve Playwright's CLI entry point without depending on non-exported
 * subpaths. `playwright/package.json` IS part of the package's public
 * `exports` map, and its `bin` field points at the CLI file the package
 * itself ships, so this keeps working across `exports` map changes.
 *
 * @param {{bin?: string|Record<string,string>}} [playwrightPackageJson] Parsed
 *   playwright package.json (injectable for tests).
 * @param {string} [packageDir] Directory containing that package.json.
 * @returns {string|null} Absolute path to the CLI script, or null when it
 *   cannot be found (callers fall back to `npx --no-install playwright`).
 */
function resolvePlaywrightCliFrom(playwrightPackageJson, packageDir) {
  if (!playwrightPackageJson || !packageDir) {
    return null;
  }
  const bin = playwrightPackageJson.bin;
  const binEntry = typeof bin === 'string' ? bin : bin && bin.playwright;
  const candidates = [];
  if (binEntry) {
    candidates.push(path.join(packageDir, binEntry));
  }
  candidates.push(path.join(packageDir, 'cli.js'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Resolve the CLI from the actually-installed playwright package. */
function resolvePlaywrightCli() {
  try {
    // playwright's "exports" map only exposes "." and "./package.json", so
    // require.resolve('playwright/cli') fails on modern playwright releases.
    const pkgPath = require.resolve('playwright/package.json');
    return resolvePlaywrightCliFrom(require(pkgPath), path.dirname(pkgPath));
  } catch {
    return null;
  }
}

/**
 * Locate the npm CLI as an installable *file* so it can be driven through
 * `process.execPath` — the npx fallback used to enable a shell on Windows.
 * Candidates cover the common layouts: npm scripts (npm_execpath), the official
 * nodejs.org installers (npm beside node) and distro layouts (lib/share).
 */
function resolveNpmCli() {
  const candidates = [];
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath);
  const nodeDir = path.dirname(process.execPath);
  candidates.push(
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'share', 'nodejs', 'npm', 'bin', 'npm-cli.js'),
  );
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function wantsHelp(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

function isUsageError(error) {
  if (!error) return false;
  if (error.name === 'UsageError') return true;
  const message = String(error.message || error);
  return (
    /^Unknown (command|option|auth option|dashboard option|export-issues option)/.test(message) ||
    /requires --url/.test(message) ||
    /requires a value/.test(message) ||
    /must be /.test(message) ||
    /not found:/.test(message) ||
    /Refusing to overwrite/.test(message) ||
    /A target URL is required/.test(message) ||
    /A result\.json file/.test(message) ||
    /Unsupported browser/.test(message) ||
    /Conflicting video flags/.test(message) ||
    /UserEye config/.test(message)
  );
}

function printUsageError(error) {
  const message = error && error.message ? error.message : String(error);
  console.error(message);
}

function installBrowsers(args) {
  if (wantsHelp(args)) {
    console.log(INSTALL_USAGE);
    return 0;
  }
  const requested = args.filter(arg => !arg.startsWith('--'));
  let targets = requested.length ? requested : ['chromium'];
  if (targets.includes('all')) {
    targets = SUPPORTED_INSTALL_TARGETS;
  }
  for (const target of targets) {
    if (!SUPPORTED_INSTALL_TARGETS.includes(target)) {
      console.error(`Unknown browser: ${target}. Use ${SUPPORTED_INSTALL_TARGETS.join(', ')}, or all.`);
      return 2;
    }
  }
  const cli = resolvePlaywrightCli();
  if (cli) {
    const output = childProcess.spawnSync(process.execPath, [cli, 'install', ...targets], {
      stdio: 'inherit',
    });
    return output.status === 0 ? 0 : 2;
  }
  // 7.5.1 (roadmap item 3.5): the previous last resort ran `npx` through a
  // Windows-only shell flag. It is now resolved without any shell at all:
  // process.execPath + the npm CLI, `npm exec --no` (the npx --no-install
  // semantics: nothing is installed on demand).
  const npmCli = resolveNpmCli();
  if (npmCli) {
    const viaNpm = childProcess.spawnSync(
      process.execPath,
      [npmCli, 'exec', '--no', '--', 'playwright', 'install', ...targets],
      { stdio: 'inherit' },
    );
    if (viaNpm.status !== null && viaNpm.status !== 0) return 2;
    if (viaNpm.status === 0) return 0;
  }
  // Absolute last resort, Windows only: cmd.exe with a *fixed* argv — the npx
  // command and the allow-listed browser targets are written by this tool, no
  // user input is ever interpreted. No shell option is enabled anywhere.
  if (process.platform === 'win32') {
    const npx = childProcess.spawnSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', 'npx', '--no-install', 'playwright', 'install', ...targets],
      { stdio: 'inherit' },
    );
    if (npx.error) {
      console.error(`Could not locate the Playwright CLI: ${npx.error.message}`);
      return 2;
    }
    return npx.status === 0 ? 0 : 2;
  }
  console.error('Could not locate the Playwright CLI.');
  return 2;
}

async function runSelfTestCommand(args) {
  const { runSelfTest } = require('./usereye-self-test');
  return (await runSelfTest(args)).exitCode;
}

async function dispatch(argv = process.argv.slice(2)) {
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    console.log(pkg.version);
    return 0;
  }
  if (argv[0] === '--self-test') {
    return runSelfTestCommand(argv.slice(1));
  }
  if (!argv.length || (wantsHelp(argv) && !COMMANDS.includes(argv[0]))) {
    console.log(HELP);
    return 0;
  }
  const command = argv[0];
  const args = argv.slice(1);
  if (command === 'observe') {
    const { runObserve } = require('../usereye-observe');
    return (await runObserve(args)).exitCode;
  }
  if (command === 'auto' || command === 'analyze') {
    const { runAuto } = require('../usereye-auto');
    return (await runAuto(command === 'analyze' ? [...args, '--analyze'] : args)).exitCode;
  }
  if (command === 'doctor') {
    const { runDoctor } = require('./usereye-doctor');
    return (await runDoctor(args)).exitCode;
  }
  if (command === 'install-browsers') {
    return installBrowsers(args);
  }
  if (command === 'gc') {
    const { runGc } = require('../artifact-gc');
    return (await runGc(args)).exitCode;
  }
  if (command === 'dashboard') {
    const { runDashboard } = require('../dashboard');
    const session = await runDashboard(args);
    if (session.help) {
      return 0;
    }
    console.log(`UserEye dashboard: ${session.url} (serving ${session.root})`);
    console.log('Press Ctrl+C to stop.');
    await session.untilClosed();
    return 0;
  }
  if (command === 'export-issues') {
    const { runExportIssues } = require('../issue-export');
    return (await runExportIssues(args)).exitCode;
  }
  if (command === 'init') {
    const { runInit } = require('./usereye-init');
    return (await runInit(args)).exitCode;
  }
  if (command === 'auth') {
    const { runAuth } = require('./usereye-auth');
    return (await runAuth(args)).exitCode;
  }
  if (command === 'self-test' || command === 'diag') {
    return runSelfTestCommand(args);
  }
  console.error(`Unknown command: ${command}`);
  console.error('');
  console.error(HELP);
  return 2;
}

module.exports = {
  HELP,
  COMMANDS,
  INSTALL_USAGE,
  SUPPORTED_INSTALL_TARGETS,
  dispatch,
  resolvePlaywrightCli,
  resolvePlaywrightCliFrom,
  resolveNpmCli,
  installBrowsers,
  wantsHelp,
  isUsageError,
};

if (require.main === module) {
  const shutdown = () => process.exit(process.exitCode || 0);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  dispatch()
    .then(code => {
      process.exitCode = code;
    })
    .catch(error => {
      if (isUsageError(error)) {
        printUsageError(error);
      } else {
        console.error(error.stack || error);
      }
      process.exitCode = 2;
    });
}
