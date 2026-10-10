'use strict';

/**
 * Phase 5 acceptance — config governance (roadmap M4).
 *
 * `normalizeConfig` used to accept any key silently, so `recordVido: true` (or
 * `misclickPolicy` instead of `misclick.policy`) looked like it worked and did
 * nothing. These tests pin the diagnostic behaviour and the generated schema.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  DEFAULT_CONFIG,
  KNOWN_CONFIG_KEYS,
  configSchema,
  loadConfig,
  unknownConfigKeys,
  validateConfig,
} = require('../config');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-governance-'));
}

test('unknown config keys are detected and a correction is suggested', () => {
  const problems = unknownConfigKeys({ recordVido: true, mode: 'quick' });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].key, 'recordVido');
  assert.equal(problems[0].suggestion, 'recordVideo');
});

test('every DEFAULT_CONFIG key is considered known', () => {
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(KNOWN_CONFIG_KEYS.includes(key), `${key} must be in KNOWN_CONFIG_KEYS`);
  }
  assert.deepEqual(unknownConfigKeys(DEFAULT_CONFIG), []);
});

test('type errors are reported with the accepted values', () => {
  const problems = validateConfig({ recordVideo: 'yes', mode: 'turbo', logLevel: 'loud' });
  assert.equal(problems.length, 3);
  assert.ok(problems.some(problem => /recordVideo/.test(problem) && /on-failure/.test(problem)));
  assert.ok(problems.some(problem => /mode/.test(problem)));
  assert.ok(problems.some(problem => /logLevel/.test(problem)));
});

test('a typo warns by default and is surfaced on the resolved config', async () => {
  const project = tempProject();
  fs.writeFileSync(
    path.join(project, 'usereye.config.cjs'),
    'module.exports = { recordVido: true, mode: "quick" };\n',
  );
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    const config = await loadConfig({ cwd: project, env: {} });
    assert.equal(config.mode, 'quick', 'valid keys must still apply');
    assert.equal(config.configWarnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some(warning => /recordVido/.test(warning)));
});

test('USEREYE_STRICT_CONFIG=1 turns a typo into a usage error', async () => {
  const project = tempProject();
  fs.writeFileSync(path.join(project, 'usereye.config.cjs'), 'module.exports = { recordVido: true };\n');
  await assert.rejects(
    () => loadConfig({ cwd: project, env: { USEREYE_STRICT_CONFIG: '1' } }),
    /UserEye config is invalid/,
  );
});

test('the generated JSON schema describes the real defaults', () => {
  const schema = configSchema();
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.mode.enum, ['quick', 'standard', 'deep']);
  assert.deepEqual(schema.properties.browser.enum, ['chromium', 'firefox', 'webkit']);
  assert.deepEqual(schema.properties.logLevel.enum, ['error', 'warn', 'info', 'debug', 'trace']);
  assert.equal(schema.properties.codeExecution.properties.npmScripts.default, false);
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(schema.properties[key], `schema is missing ${key}`);
  }
});

test('the committed config docs and schema match the generator output', () => {
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, ['scripts/generate-config-docs.js', '--check'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
