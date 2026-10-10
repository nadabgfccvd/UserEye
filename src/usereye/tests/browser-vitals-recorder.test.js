'use strict';

/**
 * Unit tests for the browser-context vitals collector and the DOM interaction
 * recorder (roadmap item 1.1), executed inside jsdom exactly like
 * addInitScript would execute them.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserEnv } = require('./helpers/browser-env');
const { installUserEyeVitals, rateVitals } = require('../browser-vitals');
const { installUserEyeRecorder } = require('../browser-recorder');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('vitals: installs safely without PerformanceObserver support and collects a snapshot', () => {
  const env = createBrowserEnv('<!doctype html><html><body><p>vitals</p></body></html>', {
    url: 'http://localhost/vitals',
  });
  assert.equal(
    env.window.PerformanceObserver,
    undefined,
    'jsdom has no PerformanceObserver — the install must survive it',
  );
  env.evaluateInit(installUserEyeVitals);
  assert.equal(env.window.__userEyeVitalsInstalled, true);
  const snapshot = env.window.__userEyeCollectVitals();
  assert.equal(snapshot.url, 'http://localhost/vitals');
  assert.equal(snapshot.cls, 0);
  assert.equal(snapshot.lcp, null);
  assert.equal(snapshot.inp, null);
  assert.ok(snapshot.collectedAt);
  // Idempotent: a second install must not reset state.
  env.window.__userEyeVitals.cls = 0.5;
  env.evaluateInit(installUserEyeVitals);
  assert.equal(env.window.__userEyeVitals.cls, 0.5);
});

test('vitals: rateVitals applies Core Web Vitals thresholds', () => {
  const good = rateVitals({ lcp: 1200, fcp: 800, inp: 90, cls: 0.02, ttfb: 200, longTasks: 0 });
  assert.equal(good.lcp.rating, 'good');
  assert.equal(good.inp.rating, 'good');
  assert.deepEqual(good.findings, []);

  const borderline = rateVitals({ lcp: 3000, fcp: 2200, inp: 300, cls: 0.15, ttfb: 1000 });
  assert.equal(borderline.lcp.rating, 'needs-improvement');
  assert.equal(borderline.cls.rating, 'needs-improvement');
  assert.ok(borderline.findings.every(finding => finding.severity === 'minor'));
  assert.ok(borderline.findings.some(finding => finding.code === 'vital-lcp'));

  const poor = rateVitals({ lcp: 6500, fcp: 4000, inp: 900, cls: 0.6, ttfb: 2500 });
  assert.equal(poor.lcp.rating, 'poor');
  assert.equal(poor.cls.rating, 'poor');
  assert.ok(poor.findings.some(finding => finding.severity === 'major' && finding.code === 'vital-lcp'));

  const unknown = rateVitals({ lcp: null, cls: undefined });
  assert.equal(unknown.lcp.rating, 'unknown');
  assert.equal(unknown.lcp.value, null);
  assert.equal(unknown.cls.rating, 'unknown');
  assert.deepEqual(unknown.findings, []);

  const longTasks = rateVitals({ longTasks: 4 });
  assert.equal(longTasks.longTasks, 4);
});

function recorderEnv(html) {
  const env = createBrowserEnv(html, { url: 'http://localhost/app' });
  const events = [];
  env.window.__userEyeRecord = payload => {
    events.push(payload);
  };
  env.evaluateInit(installUserEyeRecorder);
  return { env, events };
}

function fire(env, type, target, init = {}) {
  const EventCtor =
    type === 'keydown'
      ? env.window.KeyboardEvent
      : type.startsWith('pointer') || type === 'click'
        ? env.window.MouseEvent
        : env.window.Event;
  const event = new EventCtor(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

test('recorder: clicks are recorded with target descriptors', () => {
  const { env, events } = recorderEnv(
    `<!doctype html><html><body>
       <button id="save" class="btn primary" data-rect="20,20,120,44">Save changes</button>
     </body></html>`,
  );
  const button = env.document.querySelector('#save');
  fire(env, 'click', button);
  const click = events.find(event => event.kind === 'click');
  assert.ok(click, 'click event recorded');
  assert.equal(click.target.tag, 'button');
  assert.equal(click.target.id, 'save');
  assert.equal(click.target.name, 'Save changes');
  assert.deepEqual([...click.target.classes], ['btn', 'primary']);
  assert.equal(click.target.sensitive, false);
  assert.equal(click.trusted, false);
  assert.deepEqual({ ...click.viewport }, { width: 1440, height: 900 });
});

test('recorder: password inputs are marked sensitive, and values are never captured', () => {
  const { env, events } = recorderEnv(
    `<!doctype html><html><body><input id="pw" type="password" data-rect="20,20,200,44"></body></html>`,
  );
  const input = env.document.querySelector('#pw');
  input.value = 'hunter2-secret';
  fire(env, 'input', input);
  const recorded = events.find(event => event.kind === 'input');
  assert.equal(recorded.target.sensitive, true);
  assert.equal(recorded.valueLength, 'hunter2-secret'.length);
  assert.ok(!JSON.stringify(events).includes('hunter2-secret'), 'the value itself must never be recorded');
});

test('recorder: pointerdown starts a ux interaction and flush settles it', async () => {
  const { env, events } = recorderEnv(
    `<!doctype html><html><body><button id="go" data-rect="20,20,120,44">Go</button></body></html>`,
  );
  env.window.__userEyeNextPurpose = 'exploration';
  const button = env.document.querySelector('#go');
  fire(env, 'pointerdown', button);
  const start = events.find(event => event.kind === 'ux-interaction-start');
  assert.ok(start);
  assert.equal(start.purpose, 'exploration');
  assert.equal(start.source, 'pointer');
  assert.equal(env.window.__userEyeNextPurpose, null, 'purpose is consumed once');

  // A DOM change is perceived as visual feedback.
  const feedback = env.document.createElement('span');
  feedback.textContent = 'Saved!';
  env.document.body.appendChild(feedback);
  await tick();
  const visual = events.find(event => event.kind === 'ux-visual-feedback');
  assert.ok(visual, 'mutation observer reports feedback');
  assert.equal(visual.signal, 'dom-change');

  env.window.__userEyeFlushExperience();
  const settled = events.find(event => event.kind === 'ux-interaction-settled');
  assert.ok(settled);
  assert.equal(settled.reason, 'flush');
  assert.equal(settled.token, start.token);
  assert.ok(settled.totalMs >= 0);
});

test('recorder: loading indicators are detected during an interaction', async () => {
  const { env, events } = recorderEnv(
    `<!doctype html><html><body><button id="go" data-rect="20,20,120,44">Go</button></body></html>`,
  );
  fire(env, 'pointerdown', env.document.querySelector('#go'));
  const spinner = env.document.createElement('div');
  spinner.className = 'spinner';
  spinner.setAttribute('data-rect', '20,80,40,40');
  spinner.textContent = 'Loading…';
  env.document.body.appendChild(spinner);
  await tick();
  const loading = events.find(event => event.kind === 'ux-loading-indicator');
  assert.ok(loading, 'spinner is detected');
  assert.equal(loading.indicator.tag, 'div');
  env.window.__userEyeFlushExperience();
  const settled = events.find(event => event.kind === 'ux-interaction-settled');
  assert.equal(settled.loadingDetected, true);
});

test('recorder: keyboard, change, submit and drop events are captured', () => {
  const { env, events } = recorderEnv(
    `<!doctype html><html><body>
       <form id="f" data-rect="10,10,400,300">
         <input id="t" type="text" data-rect="20,20,200,44">
         <input id="c" type="checkbox" data-rect="20,80,20,20">
       </form>
     </body></html>`,
  );
  const form = env.document.querySelector('#f');
  const text = env.document.querySelector('#t');
  const checkbox = env.document.querySelector('#c');

  fire(env, 'keydown', text, { key: 'Tab' });
  fire(env, 'keydown', text, { key: 'a' }); // not notable → ignored
  fire(env, 'keydown', text, { key: 'k', ctrlKey: true });
  text.value = 'abc';
  fire(env, 'input', text);
  checkbox.checked = true;
  fire(env, 'change', checkbox);
  fire(env, 'submit', form);
  fire(env, 'drop', form);

  const keydowns = events.filter(event => event.kind === 'keydown');
  assert.equal(keydowns.length, 2, 'Tab and Ctrl+k are notable, plain "a" in a field is not');
  assert.deepEqual({ ...keydowns[1].modifiers }, { alt: false, ctrl: true, meta: false, shift: false });
  const change = events.find(event => event.kind === 'change');
  assert.equal(change.checked, true);
  const input = events.find(event => event.kind === 'input');
  assert.equal(input.valueLength, 3);
  assert.ok(events.some(event => event.kind === 'submit'));
  const drop = events.find(event => event.kind === 'drop');
  assert.deepEqual([...drop.files], []);
});

test('recorder: Enter on a button starts a keyboard ux interaction', () => {
  const { env, events } = recorderEnv(
    `<!doctype html><html><body><button id="go" data-rect="20,20,120,44">Go</button></body></html>`,
  );
  fire(env, 'keydown', env.document.querySelector('#go'), { key: 'Enter' });
  const start = events.find(event => event.kind === 'ux-interaction-start');
  assert.ok(start);
  assert.equal(start.source, 'keyboard');
  assert.equal(start.purpose, 'user');
});

test('recorder: closest control wins when a child node is clicked; double install is a no-op', () => {
  const { env, events } = recorderEnv(
    `<!doctype html><html><body>
       <button aria-label="Save" data-rect="20,20,120,44"><span id="inner" data-rect="30,30,60,20">Save</span></button>
     </body></html>`,
  );
  fire(env, 'click', env.document.querySelector('#inner'));
  const click = events.find(event => event.kind === 'click');
  assert.equal(click.target.tag, 'button');
  assert.equal(click.target.name, 'Save');

  const before = events.length;
  env.evaluateInit(installUserEyeRecorder);
  fire(env, 'click', env.document.querySelector('#inner'));
  const clicksAfter = events.filter(event => event.kind === 'click').length;
  assert.equal(clicksAfter, 2, 'exactly one listener set is installed, second install is a no-op');
  assert.ok(before >= 1);
});

test('recorder: emit survives a missing __userEyeRecord binding', () => {
  const env = createBrowserEnv(
    `<!doctype html><html><body><button data-rect="20,20,120,44">x</button></body></html>`,
  );
  env.evaluateInit(installUserEyeRecorder);
  assert.doesNotThrow(() => fire(env, 'click', env.document.querySelector('button')));
});
