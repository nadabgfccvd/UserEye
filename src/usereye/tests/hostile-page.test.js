'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { runObserve } = require('../usereye-observe');

function browserReady() {
  if (process.env.USEREYE_SKIP_BROWSER_TESTS === '1') return false;
  try {
    const { chromium } = require('playwright');
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const skipBrowser = { skip: !browserReady() && 'Chromium not installed (npx playwright install chromium)' };

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test(
  'observe: CSP that blocks scripts still writes result.json (axe becomes a signal, not exit 2)',
  skipBrowser,
  async t => {
    const server = await listen((request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
      response.end(
        '<!doctype html><html lang="en"><title>CSP wall</title><body><h1>Hello</h1></body></html>',
      );
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-csp-'));
    const run = await runObserve([
      '--url',
      url,
      '--out',
      out,
      '--axe',
      '--fail-on',
      'never',
      '--no-video',
      '--trace',
      'never',
      '--wait',
      '50',
    ]);
    assert.ok(fs.existsSync(path.join(out, 'result.json')), 'hostile pages must still produce result.json');
    assert.notEqual(run.exitCode, 2, `setup/usage exit would mean the tool died: ${run.exitCode}`);
    const result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
    const axeSkip = (result.issues || []).find(issue => issue.code === 'axe-unavailable');
    assert.ok(axeSkip, 'blocked axe-core must be recorded as axe-unavailable, not thrown');
  },
);

test('observe: perception failure degrades instead of aborting', () => {
  const { capturePerception } = require('../perception');
  const fakePage = {
    url: () => 'http://hostile.test/',
    title: async () => 'gone',
    evaluate: async () => {
      throw new Error('Execution context was destroyed');
    },
  };
  return capturePerception(fakePage).then(snapshot => {
    assert.equal(snapshot.degraded, true);
    assert.equal(snapshot.controls.length, 0);
    assert.equal(snapshot.findings[0].code, 'perception-failed');
  });
});
