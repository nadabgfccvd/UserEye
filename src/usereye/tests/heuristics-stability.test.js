'use strict';

/**
 * Roadmap 7.5.0 item 5.1 — stability of documented heuristics. Each of the
 * three decisions below has a dedicated fixture under tests/fixtures/heuristics/
 * and its rationale in docs/HEURISTICS.md. Changing behavior = changing the
 * fixture, the decision page and these tests, in the same commit.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createBrowserEnv } = require('./helpers/browser-env');
const { collectHumanSignals } = require('../browser-human');
const { collectBrowserPerception } = require('../browser-perception');
const { findingStrings } = require('../i18n');
const { MisclickEngine } = require('../misclick-engine');
const http = require('http');
const os = require('os');
const { UserEye } = require('../user-eye');
const { ProtocolRunner } = require('../protocol-runner');

const FIXTURES = path.join(__dirname, 'fixtures', 'heuristics');
const fixture = name => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

// Mirrors MisclickEngine.quickUserState's serialization: url, dialogs, alerts and
// a material hash over the visible text. The fixture drives the delta.
function snapshot(env) {
  return env.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0.01 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const normalize = value =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    const text = normalize(document.body.innerText || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return {
      url: location.href,
      dialogs: [...document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"]')].filter(visible)
        .length,
      alerts: [...document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')].filter(visible)
        .length,
      materialHash: String(hash),
    };
  });
}

test('heuristic: a focus-revealed control is harmful (aggressive) but confusing (stable-only)', () => {
  const env = createBrowserEnv(fixture('focus-reveal.html'));
  const before = snapshot(env);
  env.window.document.getElementById('skip').focus();
  const after = snapshot(env);

  // The material changed (lazy-rendered helper panel); URL/dialogs/alerts did not.
  assert.notEqual(after.materialHash, before.materialHash);
  assert.equal(after.url, before.url);
  assert.equal(after.dialogs, before.dialogs);
  assert.equal(after.alerts, before.alerts);
  assert.ok(env.window.document.getElementById('panel'), 'focus inserted the panel');

  const hit = {
    interactive: { name: 'Skip to knowledge base', tag: 'a' },
    insideTarget: false,
    dangerous: false,
  };
  const engine = new MisclickEngine({ options: { reportLocale: 'en' } });
  const aggressive = engine.outcome(hit, before, after, { stableOnly: false });
  const stableOnly = engine.outcome(hit, before, after, { stableOnly: true });
  assert.equal(aggressive.outcome, 'harmful', JSON.stringify(aggressive));
  assert.equal(stableOnly.outcome, 'confusing', JSON.stringify(stableOnly));
  assert.match(aggressive.effect, /Skip to knowledge base/);
});

test('heuristic: consent wall regex flags a real fixed consent layer (default and strict)', () => {
  const env = createBrowserEnv(fixture('consent-wall.html'));
  const codes = Array.from(env.evaluate(collectHumanSignals, { profile: 'desktop' }).findings, f => f.code);
  assert.ok(codes.includes('consent-wall'), codes.join(', '));

  const strict = env.evaluate(collectHumanSignals, { profile: 'desktop', consent: { strict: true } });
  assert.ok(Array.from(strict.findings, f => f.code).includes('consent-wall'));

  // Decision knob: raise the fold-area threshold and the layer is no longer a wall.
  const sparse = env.evaluate(collectHumanSignals, {
    profile: 'desktop',
    consent: { minWallArea: 0.9 },
  });
  assert.ok(!Array.from(sparse.findings, f => f.code).includes('consent-wall'));
});

test('heuristic: consent copy in normal flow is never a wall (layer gating)', () => {
  const env = createBrowserEnv(fixture('consent-copy-not-layer.html'));
  const codes = Array.from(env.evaluate(collectHumanSignals, { profile: 'desktop' }).findings, f => f.code);
  assert.ok(!codes.includes('consent-wall'), codes.join(', '));
});

test('heuristic: zoom-200 protocol (viewport mode) reports the fixture overflow at runtime', async t => {
  const server = http.createServer((request, response) => {
    const file = request.url === '/fit' ? fixture('zoom-fit.html') : fixture('zoom-overflow.html');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(file);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function probe(url) {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-zoom-'));
    const eye = new UserEye({ artifactDir, recordVideo: false, zoomMode: 'viewport' });
    t.after(() => eye.close().catch(() => {}));
    await eye.launch();
    const runner = new ProtocolRunner(eye, {
      baseURL: url,
      mode: 'standard',
      protocols: 'zoom-200',
      timeoutMs: 15000,
    });
    const result = await runner.run();
    return result.protocols.find(item => item.id === 'zoom-200') || {};
  }

  const overflow = await probe(base);
  assert.equal(overflow.status, 'warning', JSON.stringify(overflow));
  assert.equal(overflow.details.zoomMode, 'viewport');
  assert.ok(overflow.details.overflow > 80, `expected overflow, got ${overflow.details.overflow}`);

  const fit = await probe(`${base}/fit`);
  assert.equal(fit.status, 'passed', JSON.stringify(fit));
});

test('heuristic: zoom-200 perception detects the overflow the fixture was built for', () => {
  const settings = {
    profile: 'zoom-200',
    touchTarget: 44,
    maxText: 5000,
    maxControls: 180,
    strings: findingStrings('en'),
  };
  const overflow = createBrowserEnv(fixture('zoom-overflow.html'), { width: 1280, height: 800 });
  const perception = overflow.evaluate(collectBrowserPerception, settings);
  assert.ok(
    perception.horizontalOverflow >= 680,
    `expected >= 680px overflow, got ${perception.horizontalOverflow}`,
  );
  assert.ok(Array.from(perception.findings, f => f.code).includes('horizontal-overflow'));

  const fit = createBrowserEnv(fixture('zoom-fit.html'), { width: 1280, height: 800 });
  const control = fit.evaluate(collectBrowserPerception, settings);
  assert.equal(control.horizontalOverflow, 0);
  assert.ok(!Array.from(control.findings, f => f.code).includes('horizontal-overflow'));
});
