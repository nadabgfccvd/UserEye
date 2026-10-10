'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MisclickEngine } = require('../misclick-engine');

function state({ url = 'https://a/1', materialHash = 'abc', dialogs = [], alerts = [] }) {
  return { url, materialHash, dialogs, alerts };
}

// `outcome` only depends on the report locale accessor, so a stub engine suffices.
const engine = { locale: () => 'en' };
const engineInstance = new MisclickEngine(engine);

test('aggressive marks a focus-revealed sibling (material-only) as harmful', () => {
  const hit = { interactive: { name: 'Skip to content' }, insideTarget: false, dangerous: false };
  const before = state({ materialHash: 'aaaa' });
  const after = state({ materialHash: 'bbbb' }); // repaint only, same URL/dialog
  const outcome = engineInstance.outcome(hit, before, after, { stableOnly: false });
  assert.equal(outcome.outcome, 'harmful');
});

test('stable-only downgrades the same material-only reveal to confusing (not harmful)', () => {
  const hit = { interactive: { name: 'Skip to content' }, insideTarget: false, dangerous: false };
  const before = state({ materialHash: 'aaaa' });
  const after = state({ materialHash: 'bbbb' });
  const outcome = engineInstance.outcome(hit, before, after, { stableOnly: true });
  assert.equal(outcome.outcome, 'confusing');
});

test('stable-only still flags a real URL change as harmful', () => {
  const hit = { interactive: { name: 'Destinations' }, insideTarget: false, dangerous: false };
  const before = state({ url: 'https://a/1', materialHash: 'aaaa' });
  const after = state({ url: 'https://a/2', materialHash: 'bbbb' });
  const outcome = engineInstance.outcome(hit, before, after, { stableOnly: true });
  assert.equal(outcome.outcome, 'harmful');
});

test('a click that hits nothing and changes nothing is harmless', () => {
  const hit = { interactive: null, dangerous: false, insideTarget: false };
  const before = state({ materialHash: 'aaaa' });
  const after = state({ materialHash: 'aaaa' });
  for (const stableOnly of [false, true]) {
    const outcome = engineInstance.outcome(hit, before, after, { stableOnly });
    assert.equal(outcome.outcome, 'harmless');
  }
});

// ---------------------------------------------------------------------------
// 7.5.1 (roadmap item 1.4): the remaining branches of both policies, the
// evidence/recovery path and the point geometry — driven with a scripted fake
// page so no browser is needed and every branch is deterministic.
// ---------------------------------------------------------------------------

test('aggressive: a dangerous control activated by a repaint is harmful; stable-only agrees', () => {
  const hit = { interactive: { name: 'Delete' }, insideTarget: false, dangerous: true };
  const before = state({ materialHash: 'aaaa' });
  const after = state({ materialHash: 'bbbb' });
  assert.equal(engineInstance.outcome(hit, before, after, { stableOnly: false }).outcome, 'harmful');
  assert.equal(engineInstance.outcome(hit, before, after, { stableOnly: true }).outcome, 'harmful');
});

test('both policies: a dialog opening is harmful, an alert alone is only confusing', () => {
  const hit = { interactive: null, insideTarget: false, dangerous: false };
  const dialog = engineInstance.outcome(
    hit,
    state({ materialHash: 'a' }),
    state({ materialHash: 'a', dialogs: ['Are you sure?'] }),
    { stableOnly: true },
  );
  assert.equal(dialog.outcome, 'harmful');
  assert.match(dialog.effect, /dialog/i);

  for (const stableOnly of [false, true]) {
    const alert = engineInstance.outcome(
      hit,
      state({ materialHash: 'a' }),
      state({ materialHash: 'a', alerts: ['Saved'] }),
      { stableOnly },
    );
    assert.equal(alert.outcome, 'confusing');
    assert.match(alert.effect, /alert|status/i);
  }
});

test('a near-miss that lands INSIDE the target is confusing (the target itself was activated)', () => {
  const hit = { interactive: { name: 'Save' }, insideTarget: true, dangerous: false };
  const same = state({ materialHash: 'a' });
  const outcome = engineInstance.outcome(hit, same, same, { stableOnly: true });
  assert.equal(outcome.outcome, 'confusing');
  assert.match(outcome.effect, /target/i);
});

test('effect text lists every observed signal and falls back to "none"', () => {
  const hit = { interactive: { tag: 'a' }, insideTarget: false, dangerous: false };
  const busy = engineInstance.outcome(
    hit,
    state({ url: 'https://a/1', materialHash: 'a' }),
    state({ url: 'https://a/2', materialHash: 'b', dialogs: ['d'], alerts: ['x'] }),
    { stableOnly: false },
  );
  assert.equal(busy.effect.split(';').length, 5, 'navigation; dialog; alert; hit; visual');
  assert.match(busy.effect, /\ba\b/, 'falls back to the tag when the hit has no name');

  const quiet = engineInstance.outcome(
    { interactive: null, insideTarget: false, dangerous: false },
    state({}),
    state({}),
    {},
  );
  assert.equal(quiet.outcome, 'harmless');
  assert.ok(quiet.effect.length > 0, 'a harmless click still explains itself');
});

test('outcome is localized through the owning engine locale', () => {
  const pt = new MisclickEngine({ options: { reportLocale: 'pt' } });
  const en = new MisclickEngine({ options: { reportLocale: 'en' } });
  const hit = { interactive: null, insideTarget: false, dangerous: false };
  const before = state({ url: 'https://a/1' });
  const after = state({ url: 'https://a/2' });
  assert.notEqual(pt.outcome(hit, before, after, {}).effect, en.outcome(hit, before, after, {}).effect);
  assert.equal(new MisclickEngine(null).locale(), 'en', 'no owner → English');
});

test('pointMap places the 8 probe points at the requested distance around the box', () => {
  const map = engineInstance.pointMap({ x: 100, y: 200, width: 50, height: 20 }, 6);
  assert.deepEqual(Object.keys(map), [
    'left',
    'right',
    'top',
    'bottom',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ]);
  assert.deepEqual(map.left, { x: 94, y: 210 });
  assert.deepEqual(map.right, { x: 156, y: 210 });
  assert.deepEqual(map.top, { x: 125, y: 194 });
  assert.deepEqual(map.bottom, { x: 125, y: 226 });
  assert.deepEqual(map['bottom-right'], { x: 156, y: 226 });
});

/**
 * A scripted stand-in for UserEye + Playwright: `page.evaluate` returns the
 * pre-programmed states in order, `hitAtPoint` is stubbed per point, and every
 * side effect (issues, screenshots, recover hook, mouse clicks) is recorded.
 */
function fakeEye({ states, hits, options = {} }) {
  const calls = { clicks: [], waits: [], screenshots: [], issues: [], recovered: [] };
  let stateIndex = 0;
  const eye = {
    options: { misclickDistance: 8, misclickPolicy: 'aggressive', reportLocale: 'en', ...options },
    misclicks: [],
    currentStep: { name: 'Step under test' },
    page: {
      viewportSize: () => ({ width: 200, height: 100 }),
      evaluate: async fn => {
        // The purpose marker is a no-op here; state snapshots come from the script.
        if (String(fn).includes('__userEyeNextPurpose')) return undefined;
        const next = states[Math.min(stateIndex, states.length - 1)];
        stateIndex += 1;
        return next;
      },
      mouse: { click: async (x, y) => calls.clicks.push({ x, y }) },
      waitForTimeout: async ms => calls.waits.push(ms),
    },
    _sanitize: value => JSON.parse(JSON.stringify(value)),
    _describeLocator: async () => ({ id: 'save', name: 'Save' }),
    locate: () => locator,
    screenshot: async name => {
      calls.screenshots.push(name);
      return `${name}.png`;
    },
    addIssue: issue => calls.issues.push(issue),
  };
  const locator = {
    first: () => locator,
    boundingBox: async () => ({ x: 20, y: 30, width: 60, height: 20 }),
    // hitAtPoint's evaluate(fn, point): answer from the scripted hits.
    evaluate: async (fn, point) => hits(point),
  };
  const engine = new MisclickEngine(eye);
  return { eye, engine, calls, locator };
}

// `materialHash`/`stateHash` are recomputed by quickUserState from the material fields,
// so scripted states vary `textHash` (material) to signal a repaint.
function snapshot(overrides = {}) {
  return {
    url: 'https://a/1',
    title: 'T',
    textHash: '1',
    dialogs: [],
    alerts: [],
    controlCount: 3,
    active: '',
    materialHash: 'same',
    stateHash: 's',
    ...overrides,
  };
}

test('test(): stable-only via engine default; a repaint next to a target is confusing + recorded as minor', async () => {
  const { engine, eye, calls } = fakeEye({
    states: [snapshot({ textHash: 'a' }), snapshot({ textHash: 'b' })],
    hits: () => ({
      interactive: { name: 'Skip link', tag: 'a' },
      insideTarget: false,
      dangerous: false,
      hit: null,
    }),
    options: { misclickPolicy: 'stable-only' },
  });
  const [record] = await engine.test('#save', {
    points: ['left'],
    addIssues: true,
    screenshotOnProblem: true,
  });
  assert.equal(record.policy, 'stable-only');
  assert.equal(record.outcome, 'confusing');
  assert.equal(record.point, 'left');
  assert.equal(record.step, 'Step under test');
  assert.deepEqual(record.coordinates, { x: 12, y: 40 });
  assert.equal(record.screenshot, 'misclick-left-1.png', 'evidence captured for a non-harmless outcome');
  assert.equal(calls.issues.length, 1);
  assert.equal(calls.issues[0].severity, 'minor');
  assert.equal(calls.issues[0].code, 'confusing');
  assert.equal(calls.issues[0].fingerprint, 'misclick:save:left:confusing');
  assert.equal(eye.misclicks.length, 1);
});

test('test(): aggressive (explicit policy option) turns the same repaint into a harmful major', async () => {
  const { engine, calls } = fakeEye({
    states: [snapshot({ textHash: 'a' }), snapshot({ textHash: 'b' })],
    hits: () => ({
      interactive: { name: 'Skip link', tag: 'a' },
      insideTarget: false,
      dangerous: false,
      hit: null,
    }),
    options: { misclickPolicy: 'stable-only' },
  });
  const [record] = await engine.test('#save', { points: ['right'], policy: 'aggressive', addIssues: true });
  assert.equal(record.policy, 'aggressive');
  assert.equal(record.outcome, 'harmful');
  assert.equal(calls.issues[0].severity, 'major');
  assert.equal(record.screenshot, undefined, 'no screenshot unless screenshotOnProblem');
});

test('test(): dangerous neighbours are skipped (no click) unless allowDangerous, and the recover hook runs', async () => {
  const recovered = [];
  const { engine, calls } = fakeEye({
    states: [snapshot({ textHash: 'a' }), snapshot({ textHash: 'b' })],
    hits: point => ({
      interactive: { name: 'Delete', tag: 'button' },
      insideTarget: false,
      dangerous: point.y < 35, // only the "top" probe lands on the delete button
      hit: null,
    }),
  });
  const results = await engine.test('#save', {
    points: ['top', 'bottom', 'nowhere'],
    recover: async record => recovered.push(record.point),
  });
  assert.equal(results.length, 2, 'unknown point names are ignored');
  const [top, bottom] = results;
  assert.equal(top.outcome, 'skipped-dangerous');
  assert.ok(top.effect.length > 0);
  assert.equal(bottom.outcome, 'harmful', 'aggressive default + unintended interactive + repaint');
  assert.equal(calls.clicks.length, 1, 'the dangerous point was never clicked');
  assert.deepEqual(recovered, ['bottom'], 'recover runs for executed probes only');

  const allowed = fakeEye({
    states: [snapshot({ textHash: 'a' }), snapshot({ textHash: 'a' })],
    hits: () => ({ interactive: { name: 'Delete' }, insideTarget: false, dangerous: true, hit: null }),
  });
  const [forced] = await allowed.engine.test('#save', {
    points: ['top'],
    allowDangerous: true,
    stableOnly: true,
  });
  assert.equal(
    forced.outcome,
    'confusing',
    'clicked, nothing changed materially, but an unintended control was hit',
  );
  assert.equal(allowed.calls.clicks.length, 1);
});

test('test(): probe points are clamped inside the viewport and distance is configurable', async () => {
  const { engine, calls } = fakeEye({
    states: [snapshot(), snapshot()],
    hits: () => ({ interactive: null, insideTarget: false, dangerous: false, hit: null }),
  });
  const [left, right] = await engine.test('#save', { points: ['left', 'right'], distance: 500, waitMs: 5 });
  assert.deepEqual(left.coordinates, { x: 1, y: 40 });
  assert.deepEqual(right.coordinates, { x: 198, y: 40 });
  assert.equal(left.distance, 500);
  assert.equal(left.outcome, 'harmless');
  assert.deepEqual(calls.waits, [5, 5]);
});

test('test(): a target without a bounding box is a usage error', async () => {
  const { engine, locator } = fakeEye({ states: [snapshot()], hits: () => ({}) });
  locator.boundingBox = async () => null;
  await assert.rejects(engine.test(locator), /no visible bounding box/);
  await assert.rejects(engine.testRapid(locator), /no visible bounding box/);
});

test('testRapid(): counts dialogs added by a burst and flags more than one as harmful', async () => {
  const calm = fakeEye({
    states: [snapshot({ textHash: 'a' }), snapshot({ textHash: 'b', dialogs: ['one'] })],
    hits: () => ({}),
  });
  const observed = await calm.engine.testRapid('#save', { count: 4, intervalMs: 2, waitMs: 1 });
  assert.equal(observed.kind, 'rapid-click');
  assert.equal(observed.count, 4);
  assert.equal(calm.calls.clicks.length, 4);
  assert.deepEqual(calm.calls.waits, [2, 2, 2, 2, 1]);
  assert.equal(observed.stateChanged, true);
  assert.equal(observed.dialogsAdded, 1);
  assert.equal(observed.outcome, 'observed');
  assert.equal(calm.eye.misclicks.length, 1);

  const stacked = fakeEye({
    states: [snapshot(), snapshot({ dialogs: ['one', 'two'] })],
    hits: () => ({}),
  });
  const harmful = await stacked.engine.testRapid(stacked.locator);
  assert.equal(harmful.count, 3, 'default burst of 3');
  assert.equal(harmful.dialogsAdded, 2);
  assert.equal(harmful.outcome, 'harmful');
  assert.deepEqual(stacked.calls.waits, [350], 'no interval by default; default settle wait');
});

// ---------------------------------------------------------------------------
// The two browser-side callbacks (quickUserState / hitAtPoint) run in jsdom
// through the attributed harness, so their lines count for misclick-engine.js.
// ---------------------------------------------------------------------------

const { createBrowserEnv } = require('./helpers/browser-env');

function browserBackedEngine(html, options = {}) {
  const env = createBrowserEnv(html, { url: 'http://localhost/page', ...options });
  const eye = {
    options: { reportLocale: 'en' },
    _sanitize: value => JSON.parse(JSON.stringify(value)),
    page: {
      // Mirror page.evaluate(fn, arg) for the inline callbacks of misclick-engine.js.
      evaluate: async (fn, arg) => env.evaluate(fn, arg),
    },
  };
  return { env, engine: new MisclickEngine(eye) };
}

test('quickUserState: hashes the material state and lists visible dialogs/alerts/controls', async () => {
  const { env, engine } = browserBackedEngine(`<!doctype html><html><head><title>Q</title></head><body>
      <button id="ok" data-rect="10,10,80,40">OK</button>
      <a href="/x" data-rect="10,60,80,40">Link</a>
      <input type="hidden" value="h">
      <button style="display:none" data-rect="10,110,80,40">Hidden</button>
      <div role="dialog" aria-label="Confirm" data-rect="200,10,300,200">Really?</div>
      <div role="alert" data-rect="200,300,300,40">Saved</div>
      <p data-rect="10,400,300,40">Body text</p>
    </body></html>`);
  env.document.getElementById('ok').focus();
  const state = await engine.quickUserState();
  assert.equal(state.url, 'http://localhost/page');
  assert.equal(state.title, 'Q');
  assert.deepEqual(state.dialogs, ['Confirm']);
  assert.deepEqual(state.alerts, ['Saved']);
  assert.equal(state.controlCount, 2, 'hidden input and display:none button are excluded');
  assert.equal(state.active, 'ok');
  assert.match(state.textHash, /^\d+$/);
  assert.equal(state.materialHash.length, 20);
  assert.equal(state.stateHash.length, 20);
  assert.notEqual(state.materialHash, state.stateHash);

  // The material hash ignores focus; the full state hash does not.
  env.document.querySelector('a').focus();
  const refocused = await engine.quickUserState();
  assert.equal(refocused.materialHash, state.materialHash);
  assert.notEqual(refocused.stateHash, state.stateHash);

  // A text change is material.
  env.document.querySelector('p').textContent = 'Changed body text';
  const changed = await engine.quickUserState();
  assert.notEqual(changed.materialHash, state.materialHash);
});

test('hitAtPoint: describes what a near-miss would hit and whether it is dangerous', async () => {
  const { env, engine } = browserBackedEngine(`<!doctype html><html><body>
      <button id="save" data-rect="100,100,80,40">Save</button>
      <button id="delete" class="danger" data-rect="200,100,80,40"><span data-rect="210,110,20,20">Delete</span></button>
      <a href="/help" data-rect="300,100,80,40" aria-label="Help centre">?</a>
      <button data-rect="400,100,80,40">Sair</button>
    </body></html>`);
  const target = env.document.getElementById('save');
  // locator.first().evaluate((element, point) => …) — bind the fake locator to the target.
  const locator = {
    first: () => ({ evaluate: (fn, arg) => env.compile(fn)(target, JSON.parse(JSON.stringify(arg))) }),
  };

  const inside = await engine.hitAtPoint(locator, 120, 120);
  assert.equal(inside.insideTarget, true);
  assert.equal(inside.interactive.id, 'save');
  assert.equal(inside.dangerous, false);
  assert.deepEqual({ x: inside.x, y: inside.y }, { x: 120, y: 120 });

  const nested = await engine.hitAtPoint(locator, 215, 115);
  assert.equal(nested.hit.tag, 'span', 'the raw hit is the innermost element');
  assert.equal(nested.interactive.id, 'delete', 'closest interactive ancestor is resolved');
  assert.equal(nested.insideTarget, false);
  assert.equal(nested.dangerous, true, 'class="danger" marks it');

  const help = await engine.hitAtPoint(locator, 320, 120);
  assert.equal(help.interactive.name, 'Help centre', 'aria-label wins over text');
  assert.equal(help.dangerous, false);

  const sair = await engine.hitAtPoint(locator, 420, 120);
  assert.equal(sair.dangerous, true, 'Portuguese logout verb is recognised by name');

  const nothing = await engine.hitAtPoint(locator, 5, 5);
  assert.equal(nothing.hit, null);
  assert.equal(nothing.interactive, null);
  assert.equal(nothing.insideTarget, false);
  assert.equal(nothing.dangerous, false);
});
