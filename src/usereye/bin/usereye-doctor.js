#!/usr/bin/env node
'use strict';

/**
 * `usereye doctor` (roadmap M7, Phase 5).
 *
 * Setup friction — "which Node?", "is chromium installed?", "why is my config
 * ignored?", "can the runner even reach the target?" — used to be discovered
 * halfway through a CI run, as a stack trace. Doctor answers all of it up
 * front, in one pass, and exits with the standard contract:
 *
 *   0  everything required is in place (warnings may still be printed)
 *   2  at least one required check failed
 *
 * `--json` prints a machine-readable report for CI annotations.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const packageDir = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const { loadConfig, LOG_LEVELS } = require('../config');

const USAGE = `Usage: usereye doctor [options]

  --url <href>       Also check that this target answers
  --project <dir>    Project whose config should be validated (default: .)
  --config <path>    Explicit config file
  --json             Machine-readable report
  --update-check     Ask the npm registry whether a newer usereye exists
  -h, --help

Exit codes: 0 healthy · 2 at least one required check failed.
`;

/** Compare two semver-ish strings. @returns {number} -1 | 0 | 1 */
function compareVersions(a, b) {
  const parse = value =>
    String(value)
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map(part => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}

/** Minimum Node from `engines.node` (`>=20.11` -> `20.11`). */
function minimumNode() {
  const range = pkg.engines?.node || '>=20';
  const match = /(\d+(?:\.\d+)*)/.exec(range);
  return match ? match[1] : '20';
}

/** Which Playwright browsers have a downloaded build on this machine. */
function installedBrowsers(cacheDir) {
  const root =
    cacheDir ||
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
        : path.join(os.homedir(), '.cache', 'ms-playwright'));
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return { root, found: [] };
  }
  const found = new Set();
  for (const entry of entries) {
    if (/^chromium/.test(entry)) found.add('chromium');
    if (/^firefox/.test(entry)) found.add('firefox');
    if (/^webkit/.test(entry)) found.add('webkit');
  }
  return { root, found: [...found] };
}

/** Ask the npm registry for the latest published version. */
async function latestPublishedVersion(fetchImpl, timeoutMs = 4000) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json())?.version || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Probe a URL with a short timeout. */
async function probeUrl(url, fetchImpl, timeoutMs = 5000) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') return { ok: false, detail: 'no fetch available' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(url, { signal: controller.signal, redirect: 'follow' });
    return { ok: true, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run every diagnostic. Pure enough to test: all I/O entry points are injectable.
 *
 * @param {string[]} argv
 * @param {{fetchImpl?: Function, cacheDir?: string, nodeVersion?: string, cwd?: string, env?: object}} [runtime]
 */
async function collectDiagnostics(argv = [], runtime = {}) {
  const env = runtime.env || process.env;
  const cwd = runtime.cwd || process.cwd();
  const checks = [];
  const add = (id, level, ok, detail, hint) => checks.push({ id, level, ok, detail, hint: hint || null });

  // --- runtime -------------------------------------------------------------
  const nodeVersion = (runtime.nodeVersion || process.version).replace(/^v/, '');
  const minimum = minimumNode();
  add(
    'node-version',
    'required',
    compareVersions(nodeVersion, minimum) >= 0,
    `Node ${nodeVersion} (engines: ${pkg.engines?.node})`,
    `Install Node >= ${minimum}.`,
  );

  // --- playwright ----------------------------------------------------------
  let playwrightVersion = null;
  try {
    playwrightVersion = require('playwright/package.json').version;
  } catch {}
  add(
    'playwright-installed',
    'required',
    Boolean(playwrightVersion),
    playwrightVersion ? `playwright ${playwrightVersion}` : 'playwright is not resolvable',
    'Run `npm install` in the project that depends on usereye.',
  );
  const pinned = pkg.dependencies?.playwright;
  if (playwrightVersion && pinned) {
    add(
      'playwright-pinned',
      'advisory',
      playwrightVersion === pinned,
      `installed ${playwrightVersion}, pinned ${pinned}`,
      'Browser builds are matched to the pinned Playwright; a mismatch can fail launches.',
    );
  }

  const browsers = installedBrowsers(runtime.cacheDir || env.PLAYWRIGHT_BROWSERS_PATH);
  add(
    'browser-chromium',
    'required',
    browsers.found.includes('chromium'),
    browsers.found.length ? `installed: ${browsers.found.join(', ')}` : `no browsers under ${browsers.root}`,
    'Run `npx usereye install-browsers chromium` (add firefox webkit for the full matrix).',
  );
  add(
    'browser-matrix',
    'advisory',
    ['chromium', 'firefox', 'webkit'].every(name => browsers.found.includes(name)),
    `installed: ${browsers.found.join(', ') || 'none'}`,
    'Run `npx usereye install-browsers all` to exercise every engine.',
  );

  // --- configuration -------------------------------------------------------
  let config = null;
  let configError = null;
  try {
    const configArgv = [];
    const projectIndex = argv.indexOf('--project');
    if (projectIndex >= 0 && argv[projectIndex + 1]) configArgv.push('--project', argv[projectIndex + 1]);
    const configIndex = argv.indexOf('--config');
    if (configIndex >= 0 && argv[configIndex + 1]) configArgv.push('--config', argv[configIndex + 1]);
    config = await loadConfig({ argv: configArgv, cwd, env });
  } catch (error) {
    configError = error.message;
  }
  add(
    'config-loads',
    'required',
    Boolean(config),
    config ? `resolved (${config.configFile || 'defaults only'})` : configError,
    'Fix the config file so it exports a plain object.',
  );
  if (config) {
    const problems = config.configWarnings || [];
    add(
      'config-keys',
      'advisory',
      problems.length === 0,
      problems.length ? problems.join('; ') : 'no unknown keys or type errors',
      'Set USEREYE_STRICT_CONFIG=1 in CI to turn these into hard failures.',
    );
    add(
      'code-execution-boundary',
      'advisory',
      true,
      `npmScripts=${config.codeExecution.npmScripts} binaries=${config.codeExecution.binaries} install=${config.codeExecution.install}`,
      'Any `true` here means UserEye may execute code from the TARGET repository.',
    );
    add('log-level', 'advisory', LOG_LEVELS.includes(config.logLevel), `logLevel=${config.logLevel}`, null);
  }

  // --- writability ---------------------------------------------------------
  const outDir = config?.outDir || path.join(cwd, 'artifacts', 'usereye');
  let writable = false;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const probe = path.join(outDir, '.usereye-doctor');
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    writable = true;
  } catch {}
  add('artifacts-writable', 'required', writable, outDir, 'Grant write access to the artifact directory.');

  // --- target reachability -------------------------------------------------
  const urlIndex = argv.indexOf('--url');
  const url = urlIndex >= 0 ? argv[urlIndex + 1] : null;
  if (url) {
    const probe = await probeUrl(url, runtime.fetchImpl);
    add('target-reachable', 'required', probe.ok, `${url} — ${probe.detail}`, 'Start the app first.');
  }

  // --- update check --------------------------------------------------------
  if (argv.includes('--update-check')) {
    const latest = await latestPublishedVersion(runtime.fetchImpl);
    add(
      'update-check',
      'advisory',
      !latest || compareVersions(latest, pkg.version) <= 0,
      latest ? `installed ${pkg.version}, latest ${latest}` : 'registry unreachable',
      latest && compareVersions(latest, pkg.version) > 0 ? `Upgrade: npm i -D ${pkg.name}@${latest}` : null,
    );
  }

  const failed = checks.filter(check => check.level === 'required' && !check.ok);
  return { version: pkg.version, packageDir, checks, healthy: failed.length === 0, failed: failed.length };
}

async function runDoctor(argv = [], runtime = {}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return { exitCode: 0, help: true };
  }
  const report = await collectDiagnostics(argv, runtime);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return { exitCode: report.healthy ? 0 : 2, report };
  }
  const rule = '-'.repeat(64);
  console.log(rule);
  console.log(`UserEye doctor — ${pkg.name}@${report.version}`);
  console.log(rule);
  for (const check of report.checks) {
    const mark = check.ok ? 'ok  ' : check.level === 'required' ? 'FAIL' : 'warn';
    console.log(`  [${mark}] ${check.id}: ${check.detail}`);
    if (!check.ok && check.hint) console.log(`         -> ${check.hint}`);
  }
  console.log(rule);
  console.log(report.healthy ? 'All required checks passed.' : `${report.failed} required check(s) failed.`);
  return { exitCode: report.healthy ? 0 : 2, report };
}

module.exports = {
  USAGE,
  collectDiagnostics,
  compareVersions,
  installedBrowsers,
  latestPublishedVersion,
  minimumNode,
  runDoctor,
};
