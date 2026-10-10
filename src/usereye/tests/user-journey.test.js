'use strict';

/**
 * 7.3 user-journey battery. Serves a fixture that deliberately implements each
 * scenario the probes look for, then runs the ProtocolRunner with the battery
 * enabled and asserts the probes report the intended status:
 *   - resilience WARNs for a form with no unsaved-change guard,
 *   - a login form WITH a "forgot password" recovery link PASSES password-recovery,
 *   - the opt-in lockout probe runs (wrong credential submitted to the fixture),
 *   - a11y/device probes WARN for: no mobile viewport meta + horizontal overflow,
 *     blocked right-click, a dead same-origin link, no font-size / high-contrast /
 *     colour-blind controls; PASS for smooth fast scroll and free keyboard.
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
<html lang="en"><head><title>User journey fixture</title>
<style>
  body{font-family:system-ui;margin:0;background:#fff;color:#000}
  .spacer{height:3400px}
  .clip{overflow:hidden;border:1px solid #ccc}
  .wide{width:1500px;height:60px;background:#eee}
  label{display:block;margin:12px 0}
</style>
</head><body>
<script>
  // block right-click app-wide (the probe should detect this)
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); }, true);
</script>
<main id="top">
  <h1>User journey fixture</h1>
  <p>Welcome. This page is intentionally tall so it can scroll.</p>

  <h2>Authentication (login present)</h2>
  <form id="login" action="/login" method="post">
    <label>Email <input type="email" name="email" value="usereye@example.invalid"></label>
    <label>Password <input type="password" name="password"></label>
    <a href="/forgot-password">Forgot password?</a>
    <button type="submit">Sign in</button>
  </form>

  <h2>Editor (unsaved work)</h2>
  <form id="editor">
    <label>Notes <textarea name="notes" placeholder="Type something…"></textarea></label>
    <button type="submit">Save</button>
  </form>

  <h2>Language</h2>
  <select aria-label="Language" id="lang">
    <option value="en">English</option><option value="pt">Português</option>
    <option value="es">Español</option><option value="fr">Français</option>
  </select>

  <h2>Links</h2>
  <p><a href="/forgot-password">works</a> ·
     <a href="/missing-page">dead link</a> ·
     <a href="#top">anchor to top</a></p>

  <div class="spacer"></div>
  <div class="clip"><div class="wide">wide box</div></div>
</main>
</body></html>`;

const NO_LOGIN = `<!doctype html>
<html lang="en"><head><title>No login fixture</title></head>
<body><main><h1>Public site — no account system</h1>
<p>Marketing content with no sign-in anywhere.</p>
<p><a href="#top">anchor</a></p></main></body></html>`;

let server = null;
let base = '';
let uj = null;

before(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/missing-page') {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    if (request.url === '/login' || request.url === '/forgot-password') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(INDEX);
      return;
    }
    if (request.url === '/nologin') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(NO_LOGIN);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(INDEX);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  uj = {
    enabled: true,
    resilience: {
      backgroundTab: true,
      unsavedClose: true,
      passwordRecovery: true,
      lockout: true,
      languageSwitch: true,
    },
    a11y: {
      permissions: true,
      fastScroll: true,
      keyboardShortcuts: true,
      mobileLayout: true,
      rightClick: true,
      deadLinks: true,
      textResize: true,
      highContrast: true,
      colorblind: true,
    },
    lockoutAttempts: 1,
    tempMail: null,
  };
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test('user journey battery runs the enabled probes against a live fixture', async t => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-uj-'));
  const eye = new UserEye({ artifactDir, recordVideo: false, userJourney: uj });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  const runner = new ProtocolRunner(eye, {
    baseURL: base,
    mode: 'standard',
    protocols: 'auto',
    timeoutMs: 15000,
    userJourney: uj,
  });
  const result = await runner.run();
  const byId = new Map(result.protocols.map(p => [p.id, p]));
  const ujIds = [...byId.keys()].filter(id => id.startsWith('uj-'));
  // All enabled probes registered + none disabled leaked in.
  assert.ok(ujIds.includes('uj-background-tab'));
  assert.ok(ujIds.includes('uj-mobile-layout'));
  assert.ok(ujIds.includes('uj-dead-links'));
  assert.ok(ujIds.includes('uj-high-contrast'));
  assert.ok(ujIds.includes('uj-colorblind'));
  assert.ok(ujIds.includes('uj-text-resize'));

  const status = id => (byId.get(id) || {}).status;
  const details = id => (byId.get(id) || {}).details || {};

  // Resilience: form without a save guard -> unsaved-close WARN.
  assert.equal(status('uj-unsaved-close'), 'warning', JSON.stringify(details('uj-unsaved-close')));
  // Login present WITH a recovery link -> password-recovery PASS.
  assert.equal(status('uj-password-recovery'), 'passed', JSON.stringify(details('uj-password-recovery')));
  // Opt-in lockout ran (not skipped) against the fixture login.
  assert.notEqual(status('uj-lockout-backoff'), 'skipped', JSON.stringify(details('uj-lockout-backoff')));
  // Temp-mail probe stays off without a configured provider.
  assert.equal(status('uj-temp-mail-login'), 'skipped');
  assert.match(details('uj-temp-mail-login').reason || '', /temp-mail/);

  // a11y/device gaps on the fixture.
  assert.equal(status('uj-mobile-layout'), 'warning', JSON.stringify(details('uj-mobile-layout')));
  assert.equal(status('uj-right-click'), 'warning', JSON.stringify(details('uj-right-click')));
  // fixture does not block Ctrl+C/V, so the (fixed) keyboard probe must PASS.
  assert.equal(status('uj-keyboard-shortcuts'), 'passed', JSON.stringify(details('uj-keyboard-shortcuts')));
  assert.equal(status('uj-dead-links'), 'warning', JSON.stringify(details('uj-dead-links')));
  assert.ok(
    details('uj-dead-links').dead.some(d => /missing-page/.test(d.href)),
    'dead link reported',
  );
  assert.equal(status('uj-high-contrast'), 'warning');
  assert.equal(status('uj-colorblind'), 'warning');
  assert.equal(status('uj-text-resize'), 'warning');
  // healthy fast-scroll on the tall page.
  assert.equal(status('uj-fast-scroll'), 'passed', JSON.stringify(details('uj-fast-scroll')));
  // permissions is informational.
  assert.equal(status('uj-permissions'), 'passed');
  assert.ok(fs.existsSync(path.join(artifactDir, 'protocol-results.json')));
});

async function runLoginProbes(t, baseURL, userJourney) {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-uj-login-'));
  const eye = new UserEye({ artifactDir, recordVideo: false, userJourney });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  const runner = new ProtocolRunner(eye, {
    baseURL: baseURL,
    mode: 'standard',
    protocols: ['uj-password-recovery', 'uj-lockout-backoff', 'uj-temp-mail-login'],
    timeoutMs: 15000,
    userJourney,
  });
  const result = await runner.run();
  const byId = new Map(result.protocols.map(p => [p.id, p]));
  return { status: id => (byId.get(id) || {}).status, reason: id => (byId.get(id) || {}).details?.reason };
}

test('login-only probes are skipped (pass through) when hasLogin:false', async t => {
  // caller answered: "my app has no login system"
  const r = await runLoginProbes(t, `${base}/nologin`, {
    enabled: true,
    resilience: { passwordRecovery: true, lockout: true },
    lockoutAttempts: 1,
    tempMail: null,
    hasLogin: false,
  });
  assert.equal(r.status('uj-password-recovery'), 'skipped');
  assert.equal(r.status('uj-lockout-backoff'), 'skipped');
  assert.equal(r.status('uj-temp-mail-login'), 'skipped');
});

test('login-only probes auto-skip on a page with no login form (hasLogin unset)', async t => {
  // hasLogin left null => probes still auto-detect a real login form before running.
  const r = await runLoginProbes(t, `${base}/nologin`, {
    enabled: true,
    resilience: { passwordRecovery: true, lockout: true },
    lockoutAttempts: 1,
    tempMail: null,
    hasLogin: null,
  });
  assert.equal(r.status('uj-password-recovery'), 'skipped');
  assert.equal(r.status('uj-lockout-backoff'), 'skipped');
  assert.equal(r.status('uj-temp-mail-login'), 'skipped');
});

test('login-only probes DO run when a login form is present', async t => {
  const r = await runLoginProbes(t, base, {
    enabled: true,
    resilience: { passwordRecovery: true, lockout: true },
    lockoutAttempts: 1,
    tempMail: null,
    hasLogin: null, // auto-detect finds the fixture login form
  });
  // password-recovery sees the login form + a recovery link -> passed.
  assert.equal(r.status('uj-password-recovery'), 'passed');
  // lockout opt-in ran against the real fixture login (not skipped for no-login).
  assert.notEqual(r.status('uj-lockout-backoff'), 'skipped');
  // temp-mail still skips because no provider is configured (not because no login).
  assert.equal(r.status('uj-temp-mail-login'), 'skipped');
  assert.match(r.reason('uj-temp-mail-login') || '', /temp-mail/);
});

test('user journey battery is OFF by default (additive — no probes registered)', async t => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-uj-off-'));
  const eye = new UserEye({ artifactDir, recordVideo: false }); // no userJourney
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  const runner = new ProtocolRunner(eye, {
    baseURL: base,
    mode: 'standard',
    protocols: 'auto',
    timeoutMs: 15000,
  });
  const registry = runner.registry();
  assert.ok(!registry.some(p => p.id.startsWith('uj-')), 'no uj probes when disabled');
});
