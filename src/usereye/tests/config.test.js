'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { loadConfig, sanitizeConfig, writeResolvedConfig } = require('../config');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-config-'));
}

test('defaults are neutral and safe', async () => {
  const project = tempProject();
  const config = await loadConfig({ cwd: project, env: {} });
  assert.equal(config.locale, 'en-US');
  assert.equal(config.timezoneId, 'UTC');
  assert.equal(config.colorScheme, 'light');
  assert.equal(config.allowWrite, false);
  assert.equal(config.allowDestructive, false);
  assert.equal(config.allowDownloads, false);
  assert.deepEqual(config.patternPack, ['en']);
});

test('config, environment and CLI precedence is deterministic', async () => {
  const project = tempProject();
  fs.writeFileSync(
    path.join(project, 'usereye.config.cjs'),
    `module.exports = {
    mode: 'quick', locale: 'fr-FR', credentials: { email: 'file@example.test', password: 'file-secret' },
    gates: { minAdaptiveScore: 55 }, profiles: { mobile: { mode: 'standard', viewport: { width: 390, height: 844 } } }
  };`,
  );
  const config = await loadConfig({
    cwd: project,
    argv: ['--profile', 'mobile', '--mode', 'deep', '--password', 'cli-secret', '--min-score', '81'],
    env: { USEREYE_MODE: 'standard', USEREYE_EMAIL: 'env@example.test' },
  });
  assert.equal(config.mode, 'deep');
  assert.equal(config.locale, 'fr-FR');
  assert.equal(config.credentials.email, 'env@example.test');
  assert.equal(config.credentials.password, 'cli-secret');
  assert.deepEqual(config.viewport, { width: 390, height: 844 });
  assert.equal(config.gates.minAdaptiveScore, 81);
});

test('discovers JSON, package.json and explicit ESM config', async () => {
  const jsonProject = tempProject();
  fs.writeFileSync(path.join(jsonProject, 'usereye.config.json'), JSON.stringify({ mode: 'quick' }));
  assert.equal((await loadConfig({ cwd: jsonProject, env: {} })).mode, 'quick');

  const packageProject = tempProject();
  fs.writeFileSync(
    path.join(packageProject, 'package.json'),
    JSON.stringify({ usereye: { reportLocale: 'pt' } }),
  );
  assert.equal((await loadConfig({ cwd: packageProject, env: {} })).reportLocale, 'pt');

  const explicitProject = tempProject();
  const configPath = path.join(explicitProject, 'custom.mjs');
  fs.writeFileSync(configPath, `export default { mode: 'deep', colorScheme: 'dark' };`);
  const resolved = await loadConfig({ cwd: explicitProject, argv: ['--config', 'custom.mjs'], env: {} });
  assert.equal(resolved.mode, 'deep');
  assert.equal(resolved.colorScheme, 'dark');
  assert.equal(resolved.configFile, configPath);
});

test('resolved config redacts credentials and secret-like environment keys', async () => {
  const project = tempProject();
  const config = {
    credentials: { email: 'visible@example.test', password: 'do-not-write' },
    env: { PUBLIC_VALUE: 'visible', API_TOKEN: 'do-not-write-either' },
    hooks: { login: async function login() {} },
  };
  const clean = sanitizeConfig(config);
  assert.equal(clean.credentials.email, 'visible@example.test');
  assert.equal(clean.credentials.password, '[REDACTED]');
  assert.equal(clean.env.API_TOKEN, '[REDACTED]');
  assert.match(clean.hooks.login, /Function login/);
  const file = writeResolvedConfig(config, project);
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /do-not-write/);
  assert.match(text, /REDACTED/);
});

test('CLI mode overrides config mode and repeated policy flags are preserved', async () => {
  const project = tempProject();
  fs.writeFileSync(path.join(project, 'usereye.config.json'), JSON.stringify({ mode: 'quick' }));
  const config = await loadConfig({
    cwd: project,
    argv: ['--mode', 'deep', '--block-path', '/billing/cancel', '--block-path', '/admin', '--seed', '/app'],
    env: {},
  });
  assert.equal(config.mode, 'deep');
  assert.deepEqual(config.blockPaths, ['/billing/cancel', '/admin']);
  assert.deepEqual(config.seedPaths, ['/app']);
});
