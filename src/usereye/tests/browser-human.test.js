'use strict';

/** Unit tests for collectHumanSignals in a simulated DOM (roadmap item 1.1). */

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserEnv } = require('./helpers/browser-env');
const { collectHumanSignals } = require('../browser-human');

function human(body, options = {}) {
  const env = createBrowserEnv(
    `<!doctype html><html lang="en"><head><title>${options.title ?? 'Human fixture'}</title>${
      options.favicon === false ? '' : '<link rel="icon" href="/favicon.ico">'
    }</head><body>${body}</body></html>`,
    options,
  );
  return env.evaluate(collectHumanSignals, { profile: options.profile || 'desktop' });
}

function codes(result) {
  return Array.from(result.findings, finding => finding.code);
}

test('human: healthy page has title, favicon, skip link and no findings', () => {
  const result = human(
    `<a href="#main" data-rect="0,0,140,20" style="outline-style:solid;outline-width:2px;outline-color:rgb(0,0,255)">Skip to content</a>
     <main id="main" data-rect="0,20,1440,700">
       <h1 data-rect="20,40,400,40" style="outline-style:solid;outline-width:2px;outline-color:rgb(0,0,255)">Welcome</h1>
       <label for="q">Search</label>
       <input id="q" type="text" data-rect="20,100,300,44">
       <button data-rect="20,160,140,44" style="outline-style:solid;outline-width:2px;outline-color:rgb(0,0,255)">Go</button>
     </main>`,
  );
  assert.deepEqual(codes(result), []);
  assert.equal(result.tabChrome.hasTitle, true);
  assert.equal(result.tabChrome.hasFavicon, true);
  assert.equal(result.skipLink.targetExists, true);
  assert.equal(result.skipLink.href, '#main');
  assert.ok(result.readingTime.words > 0);
  assert.ok(result.screenReaderPreview.some(item => item.name === 'Go'));
});

test('human: consent wall covering the fold is flagged', () => {
  const result = human(
    `<div data-rect="0,450,1440,450" style="position:fixed">We use cookies to improve your experience. Accept all</div>`,
  );
  assert.ok(codes(result).includes('consent-wall'));
  assert.equal(result.consentWalls.length >= 1, true);
  const finding = result.findings.find(item => item.code === 'consent-wall');
  assert.equal(finding.severity, 'major');
});

test('human: small cookie note below the 18% area threshold is not a wall', () => {
  const result = human(`<div data-rect="0,820,600,80">We use cookies.</div>`);
  assert.ok(!codes(result).includes('consent-wall'));
});

test('human: scroll trap — overflow hidden while content extends past the fold', () => {
  const env = createBrowserEnv(
    `<!doctype html><html lang="en" style="overflow:hidden"><head><title>t</title><link rel="icon" href="/f.ico"></head>
     <body><p data-rect="10,10,400,20">Locked page</p></body></html>`,
    { height: 900 },
  );
  Object.defineProperty(env.document.documentElement, 'scrollHeight', { value: 2400, configurable: true });
  const result = env.evaluate(collectHumanSignals, { profile: 'desktop' });
  assert.equal(result.scrollTrap, true);
  assert.ok(Array.from(result.findings, f => f.code).includes('scroll-trap'));
});

test('human: fake controls — clickable divs without a control role', () => {
  const result = human(
    `<div data-rect="20,20,200,44" style="cursor:pointer" onclick="void(0)">Read more</div>
     <div data-rect="20,90,200,44" data-action="tap-to-open">Open modal</div>`,
  );
  assert.ok(codes(result).includes('fake-controls'));
  assert.equal(result.fakeControls.length, 2);
});

test('human: a div inside a real button is not a fake control', () => {
  const result = human(
    `<button data-rect="20,20,200,44"><div style="cursor:pointer" data-rect="20,20,200,44">Inner</div></button>`,
  );
  assert.equal(result.fakeControls.length, 0);
});

test('human: placeholder-as-label detection, and aria-label exempts the field', () => {
  const result = human(
    `<input placeholder="Your email" data-rect="20,20,300,44">
     <input placeholder="Your phone" aria-label="Phone number" data-rect="20,80,300,44">`,
  );
  assert.ok(codes(result).includes('placeholder-as-label'));
  assert.equal(result.placeholderOnly.length, 1);
  assert.equal(result.placeholderOnly[0].placeholder, 'Your email');
});

test('human: error messages must be associated with their field', () => {
  const bad = human(
    `<input id="email" type="email" aria-label="Email" data-rect="20,20,300,44">
     <div class="error" data-rect="20,70,300,20">Email is invalid</div>`,
  );
  assert.ok(codes(bad).includes('error-not-associated'));
  assert.equal(bad.unassociatedErrors.length, 1);

  const good = human(
    `<input id="email2" type="email" aria-label="Email" aria-describedby="err2" aria-invalid="true" data-rect="20,20,300,44">
     <div id="err2" class="error" data-rect="20,70,300,20">Email is invalid</div>`,
  );
  assert.ok(!codes(good).includes('error-not-associated'));
});

test('human: missing tab title and favicon are minor findings', () => {
  const result = human(`<p data-rect="10,10,100,20">x</p>`, { title: '', favicon: false });
  assert.ok(codes(result).includes('missing-tab-title'));
  assert.ok(codes(result).includes('missing-favicon'));
  assert.equal(result.tabChrome.hasTitle, false);
  assert.equal(result.tabChrome.hasFavicon, false);
});

test('human: hover-only content on icon-like controls', () => {
  const result = human(
    `<button title="Export to CSV" data-rect="20,20,24,24"></button>
     <span data-tooltip="More info" data-rect="60,20,20,20"></span>`,
  );
  assert.ok(codes(result).includes('hover-only-content'));
  assert.equal(result.findings.find(item => item.code === 'hover-only-content').evidence.length >= 1, true);
});

test('human: modal without a close control is major; with close it passes', () => {
  const without = human(
    `<div role="dialog" data-rect="200,150,600,400"><h2 data-rect="220,170,300,30">Confirm</h2></div>`,
  );
  assert.ok(codes(without).includes('modal-without-close'));

  const withClose = human(
    `<div role="dialog" data-rect="200,150,600,400">
       <h2 data-rect="220,170,300,30">Confirm</h2>
       <button aria-label="Close dialog" data-rect="740,160,44,44">x</button>
     </div>`,
  );
  assert.ok(!codes(withClose).includes('modal-without-close'));
});

test('human: eternal skeleton after document completion', () => {
  const result = human(`<div class="loader" data-rect="20,20,200,20">Loading…</div>`, {
    readyState: 'complete',
  });
  assert.ok(codes(result).includes('eternal-skeleton'));
});

test('human: progressbar with aria-valuenow is not an eternal skeleton', () => {
  const result = human(`<div role="progressbar" aria-valuenow="40" data-rect="20,20,200,20"></div>`, {
    readyState: 'complete',
  });
  assert.ok(!codes(result).includes('eternal-skeleton'));
});

test('human: focus ring detection distinguishes outlined controls', () => {
  const result = human(
    `<button data-rect="20,20,140,44">No ring</button>
     <button data-rect="20,90,140,44" style="outline-style:solid;outline-width:2px;outline-color:rgb(37,99,235)">Ring</button>`,
  );
  assert.ok(codes(result).includes('focus-not-visible'));
  const names = result.focusInvisible.map(item => item.name);
  assert.ok(names.includes('No ring'));
  assert.ok(!names.includes('Ring'));
});

test('human: mixed language detection needs both pt and en signals', () => {
  const mixed = human(
    `<p data-rect="10,10,800,120">Não faça login sem a senha correta de uma conta para buscar dados e entrar no painel</p>
     <p data-rect="10,140,800,120">the settings and search for password login with the account</p>`,
  );
  assert.ok(codes(mixed).includes('mixed-language'));
  assert.ok(mixed.mixedLanguage.ptHits >= 3);
  assert.ok(mixed.mixedLanguage.enHits >= 3);

  const english = human(
    `<p data-rect="10,10,800,120">the settings and search for password login with the account and save changes</p>`,
  );
  assert.ok(!codes(english).includes('mixed-language'));
  assert.equal(english.mixedLanguage, null);
});

test('human: hitbox mismatch — parent click area far larger than the drawn control', () => {
  const result = human(
    `<div style="cursor:pointer" data-rect="0,0,600,200">
       <button data-rect="20,20,60,30">Go</button>
     </div>`,
  );
  assert.ok(codes(result).includes('hitbox-mismatch'));
  assert.equal(result.findings.find(item => item.code === 'hitbox-mismatch').evidence[0].name, 'Go');
});

test('human: empty click region — huge nearly-empty clickable zone', () => {
  const result = human(`<a href="/somewhere" data-rect="0,0,1440,600">Hi</a>`);
  assert.ok(codes(result).includes('empty-click-region'));
});

test('human: sticky header overlapping the first heading', () => {
  const result = human(
    `<h1 data-rect="20,30,400,40" style="font-size:32px">Page title</h1>
     <header data-rect="0,0,1440,64" style="position:fixed">Nav bar</header>`,
  );
  assert.ok(codes(result).includes('sticky-overlap'));
  assert.equal(result.stickyOverlap[0].name, 'Page title');
});

test('human: autocomplete expectation for identity fields', () => {
  const result = human(
    `<input type="email" name="email" aria-label="Email" data-rect="20,20,300,44">
     <input type="password" name="password" aria-label="Password" data-rect="20,80,300,44">
     <input type="tel" name="phone" autocomplete="tel" aria-label="Phone" data-rect="20,140,300,44">`,
  );
  assert.ok(codes(result).includes('missing-autocomplete'));
  const evidence = result.findings.find(item => item.code === 'missing-autocomplete').evidence;
  assert.equal(evidence.length, 2, 'the tel input has autocomplete and is exempt');
});

test('human: autofocus abuse outside form fields', () => {
  const result = human(`<div autofocus id="hero" data-rect="0,0,600,200">Look here</div>`);
  assert.ok(codes(result).includes('autofocus-abuse'));
});

test('human: reading time and screen-reader preview shape', () => {
  const words = Array.from({ length: 210 }, (_, index) => `word${index}`).join(' ');
  const result = human(
    `<p data-rect="10,10,1200,600">${words}</p>
     <a href="/x" data-rect="20,700,120,44" aria-label="Docs link">Docs</a>`,
  );
  assert.equal(result.readingTime.wpm, 200);
  assert.ok(result.readingTime.words >= 210);
  assert.ok(result.readingTime.minutes >= 1);
  const link = result.screenReaderPreview.find(item => item.name === 'Docs link');
  assert.ok(link);
  assert.equal(link.role, 'a');
  assert.ok(link.selector.length > 0);
});
