'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { loadConfig } = require('../config');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-config-feat-'));
}

async function loadWith(body) {
  const project = tempProject();
  fs.writeFileSync(path.join(project, 'usereye.config.cjs'), body);
  return loadConfig({ cwd: project, env: {} });
}

test('consent normalises with strict/selectors/minWallArea defaults', async () => {
  const config = await loadWith(`module.exports = {
    consent: { strict: true, selectors: ['#onetrust', '[class*=cookie]'], minWallArea: 0.3 },
  };`);
  assert.deepEqual(config.consent, {
    strict: true,
    selectors: ['#onetrust', '[class*=cookie]'],
    minWallArea: 0.3,
  });
});

test('consent default is non-strict, no selectors, minWallArea 0.18', async () => {
  const config = await loadWith(`module.exports = {};`);
  assert.deepEqual(config.consent, { strict: false, selectors: [], minWallArea: 0.18 });
});

test('zoomMode validates values and defaults to css', async () => {
  assert.equal((await loadWith(`module.exports = { zoomMode: 'viewport' };`)).zoomMode, 'viewport');
  assert.equal((await loadWith(`module.exports = {};`)).zoomMode, 'css');
  await assert.rejects(() => loadWith(`module.exports = { zoomMode: 'bogus' };`), /Invalid zoomMode/);
});

test('ready normalises strategy/selector/timeout and infers selector', async () => {
  const explicit = await loadWith(
    `module.exports = { ready: { strategy: 'network-almost-idle', selector: '#app', timeoutMs: 5000 } };`,
  );
  assert.deepEqual(explicit.ready, {
    strategy: 'network-almost-idle',
    selector: '#app',
    timeoutMs: 5000,
  });
  const inferred = await loadWith(`module.exports = { ready: { selector: '#shell' } };`);
  assert.equal(inferred.ready.strategy, 'selector');
  assert.equal(inferred.ready.selector, '#shell');
  const quiet = await loadWith(`module.exports = {};`);
  assert.deepEqual(quiet.ready, { strategy: 'quiet', selector: null, timeoutMs: 10000 });
});

test('diveIntoIframes only accepts same-origin, default off', async () => {
  assert.equal(
    (await loadWith(`module.exports = { diveIntoIframes: 'same-origin' };`)).diveIntoIframes,
    'same-origin',
  );
  assert.equal((await loadWith(`module.exports = { diveIntoIframes: 'on' };`)).diveIntoIframes, 'off');
  assert.equal((await loadWith(`module.exports = {};`)).diveIntoIframes, 'off');
});
