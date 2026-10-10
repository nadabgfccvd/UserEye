'use strict';

/**
 * Unit tests for collectBrowserPerception running in a simulated DOM (jsdom).
 * Roadmap item 1.1: cell-by-cell regression coverage of the perception logic
 * without launching a browser. Geometry is explicit via data-rect attributes;
 * colors use rgb() notation exactly like Chromium's computed styles.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserEnv } = require('./helpers/browser-env');
const { collectBrowserPerception } = require('../browser-perception');

const SETTINGS = { profile: 'desktop', touchTarget: 44, maxText: 5000, maxControls: 300 };

function perceive(html, options = {}) {
  const env = createBrowserEnv(html, options);
  return env.evaluate(collectBrowserPerception, { ...SETTINGS, ...(options.settings || {}) });
}

function page(body, attributes = '') {
  return `<!doctype html><html ${attributes}><head><title>Perception fixture</title></head><body>${body}</body></html>`;
}

function codes(result) {
  return Array.from(result.findings, finding => finding.code);
}

test('perception: clean page produces structured output and no findings', () => {
  const result = perceive(
    page(
      `<main data-rect="0,0,1440,800">
         <h1 data-rect="20,20,400,40" style="font-size:32px">Welcome</h1>
         <p data-rect="20,80,600,20" style="font-size:16px;color:rgb(17,17,17)">Readable body copy.</p>
         <button data-rect="20,120,140,44">Save changes</button>
         <a href="/next" data-rect="200,120,100,44">Next step</a>
       </main>`,
      'lang="en"',
    ),
  );
  assert.deepEqual(codes(result), []);
  assert.equal(result.title, 'Perception fixture');
  assert.equal(result.lang, 'en');
  assert.equal(result.counts.controls, 2);
  assert.equal(result.counts.controlsInViewport, 2);
  assert.equal(result.counts.headings, 1);
  assert.equal(result.counts.landmarks, 1);
  assert.match(result.visibleText, /Welcome/);
  const button = result.controls.find(control => control.name === 'Save changes');
  assert.equal(button.role, 'button');
  assert.equal(button.tag, 'button');
  assert.equal(button.inViewport, true);
  assert.equal(button.occluded, false);
  assert.equal(button.clipped, false);
  assert.equal(button.touchTargetSmall, false);
  assert.deepEqual(
    { ...button.rect },
    { x: 20, y: 120, width: 140, height: 44, top: 120, right: 160, bottom: 164, left: 20 },
  );
});

test('perception: black text on the default (transparent) canvas is NOT low contrast — regression for opaqueBackground fallback', () => {
  const result = perceive(
    page(
      `<h1 data-rect="20,20,400,40" style="font-size:32px">Black on white canvas</h1>
       <p data-rect="20,80,600,20" style="font-size:16px">Default colors.</p>`,
      'lang="en"',
    ),
  );
  assert.ok(!codes(result).includes('insufficient-contrast'), `unexpected findings: ${codes(result)}`);
  assert.deepEqual([...result.contrastSamples], []);
});

test('perception: genuinely low contrast text is flagged with WCAG AA thresholds', () => {
  const result = perceive(
    page(
      `<p data-rect="20,20,600,20" style="font-size:16px;color:rgb(170,170,170);background-color:rgb(255,255,255)">Faded gray copy</p>`,
      'lang="en"',
    ),
  );
  assert.ok(codes(result).includes('insufficient-contrast'));
  const finding = result.findings.find(item => item.code === 'insufficient-contrast');
  assert.equal(finding.severity, 'major');
  const sample = result.contrastSamples[0];
  assert.ok(sample.ratio < 4.5 && sample.ratio > 1, `ratio should be real, got ${sample.ratio}`);
  assert.equal(sample.minimum, 4.5);
});

test('perception: large text uses the 3:1 threshold', () => {
  // rgb(118,118,118) on white ≈ 4.54:1 → passes 3:1 (large) and 4.5:1 (normal).
  const large = perceive(
    page(
      `<h1 data-rect="20,20,600,40" style="font-size:32px;color:rgb(118,118,118)">Large heading</h1>`,
      'lang="en"',
    ),
  );
  assert.ok(!codes(large).includes('insufficient-contrast'));
  // rgb(150,150,150) on white ≈ 2.88:1 → fails 3:1 even as large text.
  const failing = perceive(
    page(
      `<h1 data-rect="20,20,600,40" style="font-size:32px;color:rgb(160,160,160)">Faded heading</h1>`,
      'lang="en"',
    ),
  );
  assert.ok(codes(failing).includes('insufficient-contrast'));
  assert.equal(failing.contrastSamples[0].minimum, 3);
});

test('perception: hidden elements that still render are a blocker', () => {
  const result = perceive(
    page(
      `<div hidden data-rect="10,10,200,40" style="display:block">Should not be visible</div>`,
      'lang="en"',
    ),
  );
  assert.ok(codes(result).includes('visible-hidden-elements'));
  const finding = result.findings.find(item => item.code === 'visible-hidden-elements');
  assert.equal(finding.severity, 'blocker');
  assert.equal(result.counts.visibleHidden, 1);
});

test('perception: duplicate ids, nameless controls, unlabeled fields', () => {
  const result = perceive(
    page(
      `<section id="dup" data-rect="0,0,100,20">one</section>
       <section id="dup" data-rect="0,30,100,20">two</section>
       <button data-rect="20,80,40,44"></button>
       <input type="text" data-rect="20,140,200,44">
       <label for="named">Named field</label>
       <input id="named" type="text" data-rect="20,200,200,44">`,
      'lang="en"',
    ),
  );
  assert.ok(codes(result).includes('duplicate-ids'));
  assert.equal(result.counts.duplicateIds, 1);
  assert.deepEqual(
    Array.from(result.duplicateIds, item => ({ ...item })),
    [{ id: 'dup', count: 2 }],
  );
  assert.ok(codes(result).includes('nameless-controls'));
  assert.equal(result.counts.namelessControls, 1);
  assert.ok(codes(result).includes('unlabeled-fields'));
  assert.equal(result.counts.unlabeledFields, 1);
  // The labelled input is not nameless.
  const named = result.controls.find(control => control.id === 'named');
  assert.equal(named.name, 'Named field');
});

test('perception: aria-label, aria-labelledby, placeholder and title feed the accessible name', () => {
  const result = perceive(
    page(
      `<button aria-label="Close panel" data-rect="10,10,44,44">x</button>
       <span id="lbl" hidden>Referenced label</span>
       <button aria-labelledby="lbl" data-rect="70,10,44,44"></button>
       <input placeholder="Search products" data-rect="10,70,200,44">
       <button title="More options" data-rect="10,130,44,44"></button>`,
      'lang="en"',
    ),
  );
  const names = result.controls.map(control => control.name);
  assert.ok(names.includes('Close panel'));
  assert.ok(names.includes('Referenced label'));
  assert.ok(names.includes('More options'));
  // placeholder alone still names the textbox for controls, and unlabeled-fields
  // only fires when no name at all was computed.
  assert.ok(!codes(result).includes('unlabeled-fields'));
});

test('perception: touch targets are only audited on the mobile profile', () => {
  const body = `<button data-rect="20,20,28,28" aria-label="Tiny">•</button>`;
  const mobile = perceive(page(body, 'lang="en"'), { settings: { profile: 'mobile' } });
  assert.ok(codes(mobile).includes('small-touch-targets'));
  assert.equal(mobile.counts.smallTouchTargets, 1);
  const desktop = perceive(page(body, 'lang="en"'));
  assert.ok(!codes(desktop).includes('small-touch-targets'));
  // disabled controls are exempt
  const disabled = perceive(
    page(`<button disabled data-rect="20,20,28,28" aria-label="Tiny">•</button>`, 'lang="en"'),
    { settings: { profile: 'mobile' } },
  );
  assert.equal(disabled.counts.smallTouchTargets, 0);
});

test('perception: viewport geometry — clipped, fully outside, and occluded controls', () => {
  const result = perceive(
    page(
      `<button data-rect="1380,100,200,44" aria-label="Half out">edge</button>
       <button data-rect="20,2000,140,44" aria-label="Below fold">far</button>
       <button data-rect="20,100,140,44" aria-label="Covered">under</button>
       <div data-rect="10,90,300,70" style="position:fixed" data-overlay="true"></div>`,
      'lang="en"',
    ),
  );
  const halfOut = result.controls.find(control => control.name === 'Half out');
  assert.equal(halfOut.inViewport, true);
  assert.equal(halfOut.clipped, true);
  assert.ok(halfOut.visibleFraction < 0.98);
  const below = result.controls.find(control => control.name === 'Below fold');
  assert.equal(below.inViewport, false);
  assert.equal(below.clipped, false);
  const covered = result.controls.find(control => control.name === 'Covered');
  assert.equal(covered.occluded, true);
  assert.ok(codes(result).includes('occluded-controls'));
  assert.equal(result.counts.clippedControls, 1);
  // The covering element is described as evidence.
  const occludedEvidence = result.findings.find(item => item.code === 'occluded-controls').evidence;
  assert.equal(occludedEvidence[0].name, 'Covered');
  assert.ok(covered.occludedBy);
});

test('perception: off-canvas slivers (<10% visible) are treated as not in viewport', () => {
  const result = perceive(
    page(`<button data-rect="1437,100,200,44" aria-label="Sliver">x</button>`, 'lang="en"'),
  );
  const sliver = result.controls.find(control => control.name === 'Sliver');
  assert.equal(sliver.inViewport, false, 'a 3px sliver must not count as visible');
  assert.ok(!codes(result).includes('clipped-controls'));
});

test('perception: heading order, missing lang, aria-hidden visibility, dialogs and alerts', () => {
  const result = perceive(
    page(
      `<h1 data-rect="10,10,300,30" style="font-size:32px">Title</h1>
       <h3 data-rect="10,60,300,24" style="font-size:20px">Skipped level</h3>
       <div aria-hidden="true" data-rect="10,100,200,30">Visible to eyes, hidden to AT</div>
       <div role="dialog" data-rect="100,100,400,300">Dialog one</div>
       <div role="dialog" data-rect="150,150,400,300">Dialog two</div>
       <div role="alert" data-rect="10,450,400,30">Saved successfully</div>`,
    ),
  );
  assert.ok(codes(result).includes('heading-order-skip'));
  assert.ok(codes(result).includes('missing-lang'));
  assert.ok(codes(result).includes('visible-aria-hidden'));
  assert.ok(codes(result).includes('multiple-visible-dialogs'));
  assert.equal(result.counts.dialogs, 2);
  assert.equal(result.counts.alerts, 1);
  assert.equal(result.alerts[0].text, 'Saved successfully');
  assert.deepEqual(
    Array.from(result.headings, heading => heading.level),
    [1, 3],
  );
});

test('perception: broken images, horizontal overflow and text overflow', () => {
  const env = createBrowserEnv(
    page(
      `<img src="/missing.png" alt="Missing chart" data-rect="10,10,200,100">
       <p data-rect="10,140,120,20" style="white-space:nowrap" data-scrollwidth="400" data-clientwidth="120">Truncated label</p>`,
      'lang="en"',
    ),
  );
  // jsdom never loads images: force the "finished but empty" state Chromium
  // reports for a 404'd image.
  const img = env.document.querySelector('img');
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
  Object.defineProperty(env.document.documentElement, 'scrollWidth', { value: 1600, configurable: true });
  const result = env.evaluate(collectBrowserPerception, SETTINGS);
  assert.ok(codes(result).includes('broken-images'));
  assert.match(result.brokenImages[0].src, /\/missing\.png$/);
  assert.equal(result.brokenImages[0].alt, 'Missing chart');
  assert.ok(codes(result).includes('horizontal-overflow'));
  assert.equal(result.horizontalOverflow, 160);
  assert.ok(codes(result).includes('text-overflow'));
  assert.equal(result.overflowingText[0].tag, 'p');
});

test('perception: overlays cover ≥15% of the viewport and are reported with position/z-index', () => {
  const result = perceive(
    page(
      `<div data-rect="0,0,1440,900" style="position:fixed;z-index:50;background-color:rgba(0,0,0,0.6)"></div>`,
      'lang="en"',
    ),
  );
  assert.equal(result.counts.overlays, 1);
  assert.equal(result.overlays[0].position, 'fixed');
  assert.equal(result.overlays[0].zIndex, '50');
});

test('perception: maxControls caps the collected control list', () => {
  const buttons = Array.from(
    { length: 40 },
    (_, index) => `<button data-rect="20,${index * 20},120,18">Button ${index}</button>`,
  ).join('');
  const result = perceive(page(buttons, 'lang="en"'), { settings: { maxControls: 10 } });
  assert.equal(result.controls.length, 10);
  assert.equal(result.counts.controls, 10);
});

test('perception: disabled and aria-disabled controls are marked', () => {
  const result = perceive(
    page(
      `<button disabled data-rect="10,10,120,44">Disabled</button>
       <button aria-disabled="true" data-rect="10,70,120,44">Aria disabled</button>`,
      'lang="en"',
    ),
  );
  const disabled = result.controls.find(control => control.name === 'Disabled');
  const aria = result.controls.find(control => control.name === 'Aria disabled');
  assert.equal(disabled.disabled, true);
  assert.equal(aria.disabled, true);
});

test('perception: empty page — no controls, no text, but still a valid structure', () => {
  const result = perceive(page('', 'lang="en"'));
  assert.equal(result.counts.controls, 0);
  assert.equal(result.visibleText, '');
  assert.deepEqual([...result.controls], []);
  assert.equal(result.activeElement.tag, 'body');
  assert.ok(Array.isArray(result.findings));
});
