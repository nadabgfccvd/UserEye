'use strict';

/**
 * Unit tests for the explorer's browser-context collectors (`adaptive-browser.js`),
 * executed inside jsdom exactly like `page.evaluate` would execute them
 * (roadmap 7.5.0 item 1.1 / A2). Until 7.5.1 this file had no dedicated test and
 * showed 2.6% coverage; the classification below is what the explorer's targeting
 * and authentication decisions are built on, so it deserves cell-by-cell regression.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createBrowserEnv,
  locateFunction,
  attributedScript,
  BROWSER_INJECTED_FILES,
} = require('./helpers/browser-env');
const { collectAdaptiveFacts, collectActionCandidates, collectFormFields } = require('../adaptive-browser');
const { collectBrowserPerception } = require('../browser-perception');

function page(body) {
  return `<!doctype html><html lang="en"><head><title>Adaptive fixture</title></head><body>${body}</body></html>`;
}

// ---------------------------------------------------------------------------
// harness: attribution + serializability
// ---------------------------------------------------------------------------

test('browser-env: every browser-injected collector is attributed to its real file', () => {
  const location = locateFunction(collectBrowserPerception);
  assert.ok(location, 'collectBrowserPerception is found in its module source');
  assert.equal(location.relative, 'browser-perception.js');
  const script = attributedScript(location);
  // Only whitespace (plus a pair of parentheses replacing two blanks) surrounds the
  // function, so every line/column offset is exactly the original file's.
  const before = location.source.slice(0, location.start);
  assert.equal(script.length, location.source.length, 'same length as the source file');
  assert.equal(script.split('\n').length, location.source.split('\n').length, 'same line count');
  assert.equal(script.indexOf('function collectBrowserPerception'), before.length);
  assert.ok(script.startsWith("'use strict';"), 'strict mode is preserved');
  assert.match(
    script.slice(0, before.length),
    /^'use strict';\s*\(\s*$/,
    'prefix is strict + blanks + one paren',
  );
  assert.match(script.slice(location.end), /^\s*\)\s*$/, 'suffix is one paren + blanks');
  assert.ok(BROWSER_INJECTED_FILES.includes('adaptive-browser.js'));
  for (const fn of [collectAdaptiveFacts, collectActionCandidates, collectFormFields]) {
    assert.equal(
      locateFunction(fn)?.relative,
      'adaptive-browser.js',
      `${fn.name} lives in adaptive-browser.js`,
    );
  }
});

test('browser-env: functions declared in a test still run (plain eval fallback)', () => {
  function inlineHelper(arg) {
    return { ok: true, echoed: arg, title: document.title };
  }
  const env = createBrowserEnv(page('<p>x</p>'));
  assert.equal(locateFunction(inlineHelper), null);
  assert.deepEqual(env.evaluate(inlineHelper, { n: 1 }), {
    ok: true,
    echoed: { n: 1 },
    title: 'Adaptive fixture',
  });
});

test('browser-env: arguments cross the boundary as JSON, like page.evaluate', () => {
  // A RegExp does not survive JSON — which is exactly why collectActionCandidates
  // accepts { source, flags } (see below). The harness must not paper over that.
  function inlineProbe(arg) {
    return { isRegExp: arg.re instanceof RegExp, keys: Object.keys(arg.re) };
  }
  const env = createBrowserEnv(page('<p>x</p>'));
  assert.deepEqual(env.evaluate(inlineProbe, { re: /abc/i }), { isRegExp: false, keys: [] });
});

// ---------------------------------------------------------------------------
// collectAdaptiveFacts
// ---------------------------------------------------------------------------

test('adaptive facts: counts visible structure and ignores hidden nodes', () => {
  const env = createBrowserEnv(
    page(`
      <nav data-rect="0,0,1440,60"><a href="/a" data-rect="10,10,80,40">Home</a></nav>
      <h1 data-rect="20,80,400,40">Title</h1>
      <form data-rect="20,140,400,200">
        <input type="text" data-rect="20,150,200,30">
        <input type="password" data-rect="20,190,200,30">
        <input type="hidden" value="csrf">
        <button data-rect="20,230,100,40">Go</button>
      </form>
      <table data-rect="20,400,400,100"><tr><td>x</td></tr></table>
      <article data-rect="20,520,400,100">card</article>
      <ul><li data-rect="20,640,400,20">item</li><li style="display:none" data-rect="20,660,400,20">hidden</li></ul>
    `),
  );
  const facts = env.evaluate(collectAdaptiveFacts);
  assert.equal(facts.forms, 1);
  assert.equal(facts.inputs, 2, 'hidden input is excluded');
  assert.equal(facts.passwordInputs, 1);
  assert.equal(facts.tables, 1);
  assert.equal(facts.cards, 2, 'article + visible li; display:none li is not counted');
  assert.equal(facts.navigation, 1);
  assert.equal(facts.headings, 1);
  assert.equal(facts.shadowRoots, 0);
  assert.equal(facts.controls, 4, 'a[href], 2 inputs, button');
});

test('adaptive facts: looks through open shadow roots', () => {
  const env = createBrowserEnv(page('<div id="host" data-rect="0,0,300,300"></div>'));
  const host = env.document.getElementById('host');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button data-rect="10,10,100,40">Inside</button><input data-rect="10,60,100,30">';
  const facts = env.evaluate(collectAdaptiveFacts);
  assert.equal(facts.shadowRoots, 1);
  assert.equal(facts.controls, 2);
  assert.equal(facts.inputs, 1);
});

// ---------------------------------------------------------------------------
// collectActionCandidates
// ---------------------------------------------------------------------------

function candidates(body, patternInput, options = {}) {
  const env = createBrowserEnv(page(body), options);
  return env.evaluate(collectActionCandidates, patternInput);
}

test('action candidates: classifies dangerous / auth / write / navigation / utility / control', () => {
  const list = candidates(`
    <a href="/dashboard" data-rect="0,0,120,40">Dashboard</a>
    <button data-rect="0,50,120,40" class="danger">Nuke it</button>
    <button data-rect="0,100,120,40">Delete account</button>
    <form data-rect="0,150,300,120">
      <button type="submit" data-rect="0,160,120,40">Sign in</button>
      <a href="/login" data-rect="130,160,120,40">Sign in</a>
    </form>
    <button type="button" data-rect="0,300,120,40">Save draft</button>
    <button type="button" data-rect="0,350,120,40">Close</button>
    <div role="switch" aria-label="Dark mode" data-rect="0,400,60,30"></div>
    <button type="button" data-rect="0,450,120,40">Cancel</button>
    <button type="button" data-rect="0,500,120,40">Plain thing</button>
    <a href="https://elsewhere.example/x" data-rect="0,550,120,40">External docs</a>
    <button data-rect="0,600,120,40" disabled>Disabled</button>
    <button data-rect="0,650,120,40" aria-disabled="true">Aria disabled</button>
    <button data-rect="0,0,0,0">Zero size</button>
    <button data-rect="0,2000,120,40">Off screen</button>
  `);
  const byName = Object.fromEntries(list.map(entry => [`${entry.tag}:${entry.name}`, entry]));

  assert.equal(byName['a:Dashboard'].kind, 'navigation');
  assert.equal(byName['button:Nuke it'].kind, 'dangerous', 'class="danger" marks it');
  assert.equal(byName['button:Delete account'].kind, 'dangerous');
  assert.ok(byName['button:Delete account'].priority < 0, 'dangerous actions sort last');

  const submit = list.find(entry => entry.tag === 'button' && entry.name === 'Sign in');
  const link = list.find(entry => entry.tag === 'a' && entry.name === 'Sign in');
  assert.equal(submit.kind, 'auth');
  assert.equal(link.kind, 'auth');
  assert.ok(submit.priority > link.priority, 'a real submit outranks a nav link sharing the label');
  assert.equal(submit.priority, 85 + 25);
  assert.equal(link.priority, 85 - 15);

  assert.equal(byName['button:Save draft'].kind, 'write');
  assert.equal(byName['button:Close'].kind, 'utility');
  assert.equal(byName['button:Cancel'].kind, 'utility', 'cancel is never auth');
  assert.equal(byName['div:Dark mode'].kind, 'utility');
  assert.equal(byName['div:Dark mode'].role, 'switch');
  assert.equal(byName['button:Plain thing'].kind, 'control');

  assert.equal(byName['a:External docs'].external, true);
  assert.equal(byName['a:Dashboard'].external, false);

  for (const missing of [
    'button:Disabled',
    'button:Aria disabled',
    'button:Zero size',
    'button:Off screen',
  ]) {
    assert.equal(byName[missing], undefined, `${missing} is not a candidate`);
  }
  const priorities = list.map(entry => entry.priority);
  assert.deepEqual(
    priorities,
    [...priorities].sort((a, b) => b - a),
    'sorted by priority, descending',
  );
});

test('action candidates: accessible names and stable selectors', () => {
  const list = candidates(`
    <span id="lbl">Labelled by span</span>
    <button id="with-id" aria-labelledby="lbl" data-rect="0,0,120,40"></button>
    <button data-testid="tid" data-rect="0,50,120,40" aria-label="Aria wins">Text loses</button>
    <button name="nm" data-rect="0,100,120,40" title="Title fallback"></button>
    <div><button data-rect="0,150,120,40">First</button><button data-rect="0,200,120,40">Second</button></div>
    <button data-rect="0,250,120,40"></button>
  `);
  const byName = Object.fromEntries(list.map(entry => [entry.name, entry]));
  assert.equal(byName['Labelled by span'].selector, '#with-id');
  assert.equal(byName['Aria wins'].selector, 'button[data-testid="tid"]');
  assert.equal(byName['Title fallback'].selector, 'button[name="nm"]');
  assert.equal(byName['Second'].selector, 'body > div > button:nth-of-type(2)');
  assert.equal(
    list.some(entry => entry.name === '' && !entry.href),
    false,
    'nameless, hrefless nodes are dropped',
  );
});

test('action candidates: honours pattern overrides and falls back on a broken regex', () => {
  const body = `<button type="button" data-rect="0,0,120,40">Frobnicate</button>
                <button type="button" data-rect="0,50,120,40">Delete</button>`;
  const overridden = candidates(body, { dangerous: { source: 'frobnicate', flags: 'i' } });
  const byName = Object.fromEntries(overridden.map(entry => [entry.name, entry]));
  assert.equal(byName.Frobnicate.kind, 'dangerous');
  assert.equal(byName.Delete.kind, 'control', 'the default dangerous pattern was replaced');

  const broken = candidates(body, { dangerous: { source: '(' } });
  assert.equal(broken.find(entry => entry.name === 'Delete').kind, 'dangerous', 'invalid regex -> default');
});

// ---------------------------------------------------------------------------
// collectFormFields
// ---------------------------------------------------------------------------

test('form fields: synthesizes plausible values per field type and skips search boxes', () => {
  const env = createBrowserEnv(
    page(`
      <form>
        <label for="email">E-mail</label><input id="email" type="text" data-rect="0,0,200,30" required>
        <input name="password" type="password" data-rect="0,40,200,30">
        <input name="site" type="url" data-rect="0,80,200,30">
        <input name="phone" type="tel" data-rect="0,120,200,30">
        <input name="qty" type="number" data-rect="0,160,200,30">
        <input name="when" type="date" data-rect="0,200,200,30">
        <input name="at" type="time" data-rect="0,240,200,30">
        <input name="username" type="text" data-rect="0,280,200,30">
        <input name="q" placeholder="Search" type="text" data-rect="0,320,200,30">
        <textarea name="notes" data-rect="0,360,200,60"></textarea>
        <select name="choice" data-rect="0,430,200,30"><option>a</option></select>
        <input type="hidden" name="csrf">
        <input type="submit" value="Send" data-rect="0,470,100,30">
        <input name="ro" readonly data-rect="0,510,200,30">
        <input name="dis" disabled data-rect="0,550,200,30">
        <input name="invisible" style="visibility:hidden" data-rect="0,590,200,30">
        <div><input type="text" data-rect="0,630,200,30"></div>
      </form>
    `),
  );
  const fields = env.evaluate(collectFormFields, 'seed42');
  const bySelector = Object.fromEntries(fields.map(field => [field.selector, field]));

  assert.equal(
    bySelector['#email'].value,
    'usereye+seed42@example.test',
    'label text drives the email heuristic',
  );
  assert.equal(bySelector['#email'].required, true);
  assert.equal(bySelector['input[name="password"]'].value, 'UserEye#seed42Aa1!');
  assert.equal(bySelector['input[name="password"]'].sensitive, true);
  assert.equal(bySelector['input[name="site"]'].value, 'https://example.test/usereye');
  assert.equal(bySelector['input[name="phone"]'].value, '31999990000');
  assert.equal(bySelector['input[name="qty"]'].value, '42');
  assert.equal(bySelector['input[name="when"]'].value, '2026-08-11');
  assert.equal(bySelector['input[name="at"]'].value, '10:30');
  assert.equal(bySelector['input[name="username"]'].value, 'usereye_seed42');
  assert.equal(bySelector['textarea[name="notes"]'].value, 'UserEye seed42');
  assert.equal(bySelector['textarea[name="notes"]'].type, 'textarea');
  assert.equal(bySelector['select[name="choice"]'].type, 'select');
  assert.equal(
    bySelector['body > form > div > input'].value,
    'UserEye seed42',
    'path selector for anonymous inputs',
  );

  for (const absent of [
    'input[name="q"]',
    'input[name="csrf"]',
    'input[name="ro"]',
    'input[name="dis"]',
    'input[name="invisible"]',
  ]) {
    assert.equal(bySelector[absent], undefined, `${absent} must not be filled`);
  }
  assert.equal(
    fields.some(field => field.type === 'submit'),
    false,
  );
  assert.ok(fields.every(field => field.signature === field.signature.toLowerCase()));
});
