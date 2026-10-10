'use strict';

/** Unit tests for collectUserGaze in a simulated DOM (roadmap item 1.1). */

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserEnv } = require('./helpers/browser-env');
const { collectUserGaze } = require('../browser-gaze');

const SETTINGS = { profile: 'desktop', maxBlocks: 40 };

function gaze(body, options = {}) {
  const env = createBrowserEnv(
    `<!doctype html><html lang="en"><head><title>${options.title || 'Gaze fixture'}</title></head><body>${body}</body></html>`,
    options,
  );
  return env.evaluate(collectUserGaze, { ...SETTINGS, ...(options.settings || {}) });
}

test('gaze: hero page — headline, primary CTA and competing CTAs are identified', () => {
  const html = `<main data-rect="0,0,1440,800">
       <h1 data-rect="100,60,700,60" style="font-size:48px;font-weight:700">Ship faster with confidence</h1>
       <p data-rect="100,140,600,40" style="font-size:18px">One platform for testing.</p>
       <button class="btn-primary" data-rect="100,220,260,60" style="font-size:20px">Get started</button>
       <button class="cta-secondary" data-rect="400,220,180,56" style="font-size:18px">Watch demo</button>
       <a href="/later" data-rect="620,220,140,56">Maybe later</a>
     </main>`;
  const result = gaze(html);
  assert.equal(result.headline.text, 'Ship faster with confidence');
  assert.equal(result.headline.level, 'h1');
  assert.equal(result.primaryCta.name, 'Get started');
  assert.equal(result.primaryCta.looksPrimary, true);
  assert.ok(result.primaryCta.score > 28, 'primary bonus must be applied');
  assert.ok(result.primaryCta.visualWeight > 0);
  // A second CTA-styled button genuinely competes for attention…
  const demo = result.competingCtas.find(item => item.name === 'Watch demo');
  assert.ok(demo, 'the second CTA competes in the fold');
  assert.equal(demo.looksPrimary, true, 'className contains "cta"');
  // …while a deliberately demoted "later" link does not.
  assert.ok(
    !result.competingCtas.some(item => item.name === 'Maybe later'),
    'a secondary-pattern action must not compete with the primary CTA',
  );
  assert.equal(result.fold.headingCount, 1);
  assert.equal(result.fold.actionCount, 3);
  assert.ok(result.fold.wordCount > 5);
  // Scan lines are localized: the default (en) pack and an explicit pt pack.
  assert.ok(result.scan3s.some(line => line.startsWith('Title:')));
  assert.ok(result.scan3s.some(line => line.startsWith('Obvious action:')));
  assert.ok(result.scan3s.some(line => line.includes('calls to action compete')));
  const ptResult = gaze(html, { settings: { strings: require('../i18n').section('pt', 'scan') } });
  assert.ok(ptResult.scan3s.some(line => line.startsWith('Título:')));
  assert.ok(ptResult.scan3s.some(line => line.startsWith('Ação óbvia:')));
  assert.ok(ptResult.scan3s.some(line => line.includes('chamadas à ação competem')));
});

test('gaze: primaryPattern recognises auth CTAs even without primary classes', () => {
  const result = gaze(
    `<a href="/dashboard" data-rect="20,20,200,44">Sign in</a>
     <a href="/tour" data-rect="20,90,200,44">Take the tour</a>`,
  );
  assert.equal(result.primaryCta.name, 'Sign in');
  assert.equal(result.primaryCta.looksPrimary, true);
});

test('gaze: secondaryPattern demotes cancel/close actions below the competition threshold', () => {
  const result = gaze(
    `<button class="btn-primary" data-rect="20,20,200,44">Continue</button>
     <button data-rect="20,90,200,44">Cancel</button>`,
  );
  assert.equal(result.primaryCta.name, 'Continue');
  assert.equal(result.primaryCta.looksPrimary, true);
  assert.ok(
    !result.competingCtas.some(item => item.name === 'Cancel'),
    'Cancel matches secondaryPattern and is demoted out of the competing set',
  );
});

test('gaze: disabled controls never become the primary CTA', () => {
  const result = gaze(
    `<button class="btn-primary" disabled data-rect="20,20,200,44">Get started</button>
     <a href="/x" data-rect="20,90,200,44">Documentation</a>`,
  );
  assert.equal(result.primaryCta.name, 'Documentation');
  assert.equal(result.fold.actionCount, 1);
});

test('gaze: trust signals — mixed password over http, https detection, skip link, lang', () => {
  const insecure = gaze(
    `<form data-rect="0,0,400,300">
       <label for="pw">Password</label>
       <input id="pw" type="password" data-rect="20,60,300,44">
     </form>`,
    { url: 'http://example.test/login' },
  );
  assert.equal(insecure.trust.https, false);
  assert.equal(insecure.trust.mixedPassword, true);
  assert.equal(insecure.trust.passwordFields, 1);
  assert.equal(insecure.trust.hasLang, true);

  const secure = gaze(`<input type="password" data-rect="20,60,300,44" aria-label="Password">`, {
    url: 'https://example.test/login',
  });
  assert.equal(secure.trust.https, true);
  assert.equal(secure.trust.mixedPassword, false);

  const local = gaze(`<p data-rect="10,10,100,20">dev</p>`, { url: 'http://127.0.0.1:3000/' });
  assert.equal(local.trust.https, true, 'localhost counts as a secure context');

  const skip = gaze(
    `<a href="#main" data-rect="0,0,120,20">Skip to content</a><main id="main" data-rect="0,40,1440,600"><h1 data-rect="10,50,300,30" style="font-size:30px">Title</h1></main>`,
  );
  assert.equal(skip.trust.skipLink, true);
  assert.equal(skip.fold.landmarkCount, 1);
});

test('gaze: reading order is sorted top-to-bottom then left-to-right', () => {
  const result = gaze(
    `<button data-rect="400,300,120,44">Lower right</button>
     <h2 data-rect="20,300,200,30" style="font-size:24px">Same row left</h2>
     <h1 data-rect="20,20,400,40" style="font-size:40px">Top heading</h1>
     <a href="/x" data-rect="20,120,120,44">Middle link</a>`,
  );
  const names = Array.from(result.readingOrder, item => item.name || item.text);
  assert.deepEqual(names, ['Top heading', 'Middle link', 'Same row left', 'Lower right']);
});

test('gaze: fields are described with type, required and autocomplete', () => {
  const result = gaze(
    `<label for="email">Email</label>
     <input id="email" type="email" required autocomplete="email" data-rect="20,40,300,44">
     <input type="text" placeholder="Company" data-rect="20,100,300,44">`,
  );
  assert.equal(result.fold.fieldCount, 2);
  const email = result.fields.find(field => field.name === 'Email');
  assert.equal(email.type, 'email');
  assert.equal(email.required, true);
  assert.equal(email.autocomplete, 'email');
  const company = result.fields.find(field => field.placeholder === undefined && field.name === 'Company');
  assert.ok(company, 'placeholder names the second field');
});

test('gaze: broken and decorative images are classified', () => {
  const env = createBrowserEnv(
    `<!doctype html><html lang="en"><head><title>t</title></head><body>
       <img src="/hero.png" alt="Hero illustration" data-rect="20,20,400,200">
       <img src="/dot.png" alt="" role="presentation" data-rect="20,240,10,10">
     </body></html>`,
  );
  const [hero, dot] = env.document.querySelectorAll('img');
  Object.defineProperty(hero, 'complete', { value: true, configurable: true });
  Object.defineProperty(hero, 'naturalWidth', { value: 0, configurable: true });
  Object.defineProperty(dot, 'complete', { value: true, configurable: true });
  Object.defineProperty(dot, 'naturalWidth', { value: 10, configurable: true });
  const result = env.evaluate(collectUserGaze, SETTINGS);
  const heroImage = result.images.find(image => image.alt === 'Hero illustration');
  assert.equal(heroImage.broken, true);
  const decorative = result.images.find(image => image.src.includes('dot.png'));
  assert.equal(decorative.decorative, true);
  assert.equal(decorative.broken, false);
});

test('gaze: empty fold — no headline, no CTA, but a valid payload', () => {
  const result = gaze('');
  assert.equal(result.headline, null);
  assert.equal(result.primaryCta, null);
  assert.deepEqual([...result.competingCtas], []);
  assert.equal(result.fold.actionCount, 0);
  assert.equal(result.fold.fieldCount, 0);
  assert.equal(result.profile, 'desktop');
});

test('gaze: elements below the fold are excluded from action/field counts', () => {
  const result = gaze(
    `<button data-rect="20,20,120,44">Above</button>
     <button data-rect="20,2000,120,44">Below</button>`,
    { height: 900 },
  );
  assert.equal(result.fold.actionCount, 1);
  assert.equal(result.primaryCta.name, 'Above');
});
