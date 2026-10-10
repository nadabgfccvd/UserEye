'use strict';

/**
 * Tests for the plugin system and the shipped example plugin (roadmap item 6.2):
 * local paths, npm-style ids, ESM plugins, factory functions and the afterRun
 * artifact contract.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { loadPlugin, loadPlugins } = require('../plugins');

const root = path.resolve(__dirname, '..');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('plugins: the shipped example plugin has the documented shape', async () => {
  const plugin = await loadPlugin('./examples/plugins/run-logger.js', root);
  assert.equal(plugin.id, 'run-logger-example');
  assert.equal(plugin.protocols.length, 1);
  const protocol = plugin.protocols[0];
  assert.equal(protocol.id, 'example-title-check');
  assert.equal(typeof protocol.run, 'function');
  assert.deepEqual(protocol.modes, ['quick', 'standard', 'deep']);
  assert.equal(typeof plugin.afterRun, 'function');
});

test('plugins: example afterRun writes its artifact into the run directory', async () => {
  const plugin = await loadPlugin('./examples/plugins/run-logger.js', root);
  const artifactDir = tmpDir('usereye-plugin-example-');
  await plugin.afterRun(
    {
      application: { name: 'Demo' },
      summary: { issues: 3, severity: { blocker: 1 }, unexpectedBrowserErrors: 0 },
      qualityGates: { passed: false },
    },
    { config: {}, artifactDir },
  );
  const written = JSON.parse(fs.readFileSync(path.join(artifactDir, 'plugin-run-logger.json'), 'utf8'));
  assert.equal(written.plugin, 'run-logger-example');
  assert.equal(written.application, 'Demo');
  assert.equal(written.issues, 3);
  assert.equal(written.qualityGatesPassed, false);
  assert.ok(written.generatedAt);
});

test('plugins: the result-insights example (item 5.5) is pure and writes its artifact', async () => {
  const plugin = await loadPlugin('./examples/plugins/result-insights.js', root);
  assert.equal(plugin.id, 'result-insights-example');
  const artifactDir = tmpDir('usereye-ray-plugin-');
  const result = {
    application: { name: 'Demo' },
    adaptive: { quality: { score: 91 } },
    performance: { metrics: { lcp: { value: 2340 } } },
    summary: { issues: 2 },
    qualityGates: { passed: true },
  };
  const insights = await plugin.afterRun(result, { config: {}, artifactDir });
  assert.equal(insights.score, 91);
  assert.equal(insights.lcpMs, 2340);
  const written = JSON.parse(fs.readFileSync(path.join(artifactDir, 'plugin-result-insights.json'), 'utf8'));
  assert.equal(written.plugin, 'result-insights-example');
  assert.equal(written.issues, 2);
  assert.equal(written.qualityGatesPassed, true);
  // afterRun runs BEFORE result.json is written (auto flow), so the payload in
  // memory is the contract; the plugin must not depend on the file.
  assert.equal(fs.existsSync(path.join(artifactDir, 'result.json')), false);
});

test('plugins: inline objects pass through and get a derived id', async () => {
  const inline = await loadPlugin({ afterRun() {} }, root);
  assert.ok(inline.id, 'inline plugins receive an id');
});

test('plugins: ESM plugins and factory functions are supported', async () => {
  const dir = tmpDir('usereye-plugin-esm-');
  fs.writeFileSync(
    path.join(dir, 'esm-plugin.mjs'),
    `export default { id: 'esm-example', afterRun: async () => {} };\n`,
  );
  const esm = await loadPlugin('./esm-plugin.mjs', dir);
  assert.equal(esm.id, 'esm-example');

  fs.writeFileSync(
    path.join(dir, 'factory.cjs'),
    `module.exports = async () => ({ id: 'factory-example', protocols: [] });\n`,
  );
  const factory = await loadPlugin('./factory.cjs', dir);
  assert.equal(factory.id, 'factory-example');
});

test('plugins: invalid references fail loudly', async () => {
  await assert.rejects(loadPlugin('./missing-plugin.js', root), /Cannot find module|Invalid UserEye plugin/);
  const dir = tmpDir('usereye-plugin-bad-');
  fs.writeFileSync(path.join(dir, 'bad.cjs'), `module.exports = 42;\n`);
  await assert.rejects(loadPlugin('./bad.cjs', dir), /Invalid UserEye plugin/);
});

test('plugins: loadPlugins resolves every reference relative to the config directory', async () => {
  const dir = tmpDir('usereye-plugin-multi-');
  fs.writeFileSync(path.join(dir, 'a.cjs'), `module.exports = { id: 'a' };\n`);
  fs.writeFileSync(path.join(dir, 'b.cjs'), `module.exports = { id: 'b' };\n`);
  const loaded = await loadPlugins(['./a.cjs', './b.cjs', { id: 'inline' }], dir);
  assert.deepEqual(
    loaded.map(plugin => plugin.id),
    ['a', 'b', 'inline'],
  );
});
