'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const childProcess = require('child_process');
const test = require('node:test');
const { installBrowsers, resolveNpmCli } = require('../bin/usereye');

// ---------------------------------------------------------------------------
// Roadmap 7.5.0 item 3.5: `install-browsers` must never need a shell, not even
// on Windows (the fallback used `shell: process.platform === 'win32'`).
// ---------------------------------------------------------------------------

/** Make playwright unresolvable for the duration of `fn`. */
function withoutPlaywright(fn) {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (String(request) === 'playwright/package.json') {
      const error = new Error('simulated: playwright not resolvable');
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return originalResolve.call(this, request, ...rest);
  };
  try {
    return fn();
  } finally {
    Module._resolveFilename = originalResolve;
  }
}

test('install-browsers: unknown targets are a usage error', () => {
  const originalError = console.error;
  const errors = [];
  console.error = message => errors.push(String(message));
  let code;
  try {
    code = installBrowsers(['iexplore']);
  } finally {
    console.error = originalError;
  }
  assert.equal(code, 2);
  assert.ok(errors.some(message => /Unknown browser: iexplore/.test(message)));
});

test('install-browsers: without a resolvable playwright, npm CLI via process.execPath — never a shell', () => {
  const originalSpawn = childProcess.spawnSync;
  const calls = [];
  childProcess.spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: '', stderr: '' };
  };
  let code;
  try {
    code = withoutPlaywright(() => installBrowsers(['firefox']));
  } finally {
    childProcess.spawnSync = originalSpawn;
  }
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath, 'the npm CLI is driven through process.execPath');
  assert.match(calls[0].args[0], /npm-cli\.js$/, 'argv[0] is the resolved npm CLI file');
  assert.deepEqual(calls[0].args.slice(1), ['exec', '--no', '--', 'playwright', 'install', 'firefox']);
  assert.ok(!calls[0].options.shell, 'no shell option may be set');
});

test('install-browsers: Windows last resort is cmd.exe with a fixed argv, no shell option', () => {
  const originalSpawn = childProcess.spawnSync;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalComSpec = process.env.ComSpec;
  const calls = [];
  childProcess.spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: '', stderr: '' };
  };
  // Hide every npm-cli.js file and pretend we are on Windows.
  const originalExists = fs.existsSync;
  fs.existsSync = function (candidate, ...rest) {
    if (/npm-cli\.js$/.test(String(candidate))) return false;
    return originalExists.call(this, candidate, ...rest);
  };
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
  let code;
  try {
    code = withoutPlaywright(() => installBrowsers(['chromium']));
  } finally {
    childProcess.spawnSync = originalSpawn;
    fs.existsSync = originalExists;
    Object.defineProperty(process, 'platform', originalPlatform);
    if (originalComSpec === undefined) delete process.env.ComSpec;
    else process.env.ComSpec = originalComSpec;
  }
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(calls[0].args, [
    '/d',
    '/s',
    '/c',
    'npx',
    '--no-install',
    'playwright',
    'install',
    'chromium',
  ]);
  assert.ok(!calls[0].options.shell, 'cmd.exe replaces the shell option — no shells are enabled');
});

test('install-browsers: a failing last resort maps to exit 2', () => {
  const originalSpawn = childProcess.spawnSync;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalComSpec = process.env.ComSpec;
  const originalExists = fs.existsSync;
  fs.existsSync = function (candidate, ...rest) {
    if (/npm-cli\.js$/.test(String(candidate))) return false;
    return originalExists.call(this, candidate, ...rest);
  };
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
  childProcess.spawnSync = () => ({ status: 1, stdout: '', stderr: 'install failed' });
  let code;
  try {
    code = withoutPlaywright(() => installBrowsers(['webkit']));
  } finally {
    childProcess.spawnSync = originalSpawn;
    fs.existsSync = originalExists;
    Object.defineProperty(process, 'platform', originalPlatform);
    if (originalComSpec === undefined) delete process.env.ComSpec;
    else process.env.ComSpec = originalComSpec;
  }
  assert.equal(code, 2);
});

test('resolveNpmCli: finds an existing npm CLI file when available', () => {
  const npmCli = resolveNpmCli();
  if (npmCli) {
    assert.ok(fs.existsSync(npmCli), `expected an existing npm CLI file, got ${npmCli}`);
    assert.match(npmCli, /npm-cli\.js$/);
  }
});
