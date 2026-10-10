'use strict';

/**
 * 7.4 browser-extension effect battery. Serves a fixture that exercises the
 * categories: it depends on an ad/tracker request, has a login form WITHOUT
 * autocomplete (so the password-manager probe should WARN), real DOM content and
 * scrollable height (full-page-capture + React mount root), an <audio> element
 * (volume booster), and a price (coupon helper). The dark-reader probe needs
 * enough content to run perception. Assert the probes report the intended status
 * against a real browser, and that the battery is off by default.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');
const { UserEye } = require('../user-eye');
const { ProtocolRunner } = require('../protocol-runner');

const INDEX = `<!doctype html>
<html lang="en"><head><title>Extension fixture</title>
<style>body{font-family:system-ui;color:#111;background:#fff;margin:0}.spacer{height:2400px}
.price{font-weight:700}.item{border:1px solid #ccc;padding:12px;max-width:400px;margin:12px}</style>
</head><body>
<div id="root">
  <main><h1>Shop demo</h1>
  <section class="item"><h2>Wireless headset</h2><p class="price">R$ 349,90</p>
    <button>Add to cart</button><a href="https://ads.example.net/banner">ad</a></section>
  <h2>Sign in to sync</h2>
  <form id="login"><input type="text" name="login"><input type="password" name="password">
    <button type="submit">Entrar</button></form>
  <audio controls preload="none"><source src="/song.mp3" type="audio/mpeg"></audio>
  <div class="spacer"></div>
  </main>
</div></body></html>`;

let server = null;
let base = '';
let extCfg = null;

before(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/song.mp3') {
      response.writeHead(404, { 'content-type': 'audio/mpeg' }).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(INDEX);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  extCfg = {
    enabled: true,
    categories: {
      adBlocker: true,
      darkReader: true,
      passwordManager: true,
      translator: true,
      couponHelper: true,
      fullPageCapture: true,
      reactDevtools: true,
      volumeBooster: true,
    },
  };
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

async function runExt(t, cfg) {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-ext-'));
  const eye = new UserEye({ artifactDir, recordVideo: false, extensions: cfg });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  const runner = new ProtocolRunner(eye, {
    baseURL: base,
    mode: 'standard',
    protocols: 'auto',
    timeoutMs: 15000,
    extensions: cfg,
  });
  const result = await runner.run();
  const byId = new Map(result.protocols.map(p => [p.id, p]));
  const status = id => (byId.get(id) || {}).status;
  const details = id => (byId.get(id) || {}).details || {};
  return { status, details };
}

test('extension battery runs against a live fixture with intended statuses', async t => {
  const { status, details } = await runExt(t, extCfg);
  assert.equal(status('ext-ad-blocker'), 'passed', JSON.stringify(details('ext-ad-blocker')));
  // Login form lacks autocomplete -> password-manager WARN.
  assert.equal(status('ext-password-manager'), 'warning', JSON.stringify(details('ext-password-manager')));
  assert.ok(details('ext-password-manager').passwordFields >= 1);
  // DOM content + scrollable -> full-page capture PASS; price present -> coupon helper runs.
  assert.equal(status('ext-full-page-capture'), 'passed', JSON.stringify(details('ext-full-page-capture')));
  assert.notEqual(status('ext-coupon-helper'), 'skipped');
  assert.ok(details('ext-coupon-helper').pricesFoundInDOM >= 1, 'price detected for coupon helper');
  // volume booster sees the <audio>.
  assert.equal(status('ext-volume-booster'), 'passed');
  assert.ok(details('ext-volume-booster').audio === true);
  // translator + dark reader are informational/safe on the fixture.
  assert.notEqual(status('ext-translator'), 'skipped');
  assert.notEqual(status('ext-dark-reader'), 'failed');
});

test('extension battery is OFF by default (no probes registered)', async t => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-ext-off-'));
  const eye = new UserEye({ artifactDir, recordVideo: false }); // no extensions
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  const runner = new ProtocolRunner(eye, {
    baseURL: base,
    mode: 'standard',
    protocols: 'auto',
    timeoutMs: 15000,
  });
  const registry = runner.registry();
  assert.ok(!registry.some(p => p.id.startsWith('ext-')), 'no extension probes when disabled');
});
