'use strict';

/**
 * Authentication flow of the adaptive explorer (roadmap 7.5.0 item 1.3 / A3).
 *
 * `_attemptAuthentication`, `_authSuccessAssert` and `_liveAuthSignals` are the most
 * sensitive path in the product — they type credentials into someone's login form —
 * and until 7.5.1 they had no test at all (adaptive-explorer.js: 46.9%, lines 426–659
 * uncovered). Every scenario below drives the REAL explorer against a REAL login
 * form served locally in Chromium; nothing is mocked except the network target.
 *
 * Scenarios: success by URL transition · success only by `auth.successAssert` ·
 * wrong password does not loop · no credentials → empty-submit validation only ·
 * `authStrategy: 'hook'` (with/without hook, hook throwing) · `authStrategy:
 * 'storageState'` · the password never reaches any artifact.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { UserEye } = require('../user-eye');
const { AdaptiveExplorer } = require('../adaptive-explorer');

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

const PASSWORD = 'Tr0ub4dor&3-explorer-secret';
const EMAIL = 'tester@example.test';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><title>Sign in</title><link rel="icon" href="data:,"></head>
<body>
  <main>
    <h1>Sign in to your account</h1>
    <p id="error" role="alert" hidden style="color:#b00020">Wrong password</p>
    <form id="login" method="post" action="/session">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" style="width:260px;height:44px">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" style="width:260px;height:44px">
      <button type="submit" id="submit" style="min-width:140px;min-height:44px">Sign in</button>
      <a href="/help" style="display:inline-block;min-height:44px">Sign in help</a>
    </form>
  </main>
</body></html>`;

const APP_PAGE = `<!doctype html>
<html lang="en"><head><title>Dashboard</title></head>
<body><main id="shell"><h1>Welcome back</h1><nav><a href="/reports" style="display:inline-block;min-height:44px">Reports</a></nav>
<p>You are signed in. Nothing here mentions a password field.</p></main></body></html>`;

function loginPageWithError() {
  return LOGIN_PAGE.replace('hidden style', 'style');
}

/**
 * A tiny login server. `mode` decides what a correct POST does:
 *  - 'redirect'  → 303 to /app (the common case; URL changes)
 *  - 'same-url'  → 200 on /login with the app shell (URL does NOT change — only a
 *                  successAssert or live signals can prove the login)
 * A wrong password always re-renders the login page with the error visible.
 */
async function startServer(mode = 'redirect') {
  const state = { posts: [], cookies: 0 };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const send = (status, body, headers = {}) => {
      response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      response.end(body);
    };
    if (request.method === 'POST' && url.pathname === '/session') {
      let raw = '';
      request.on('data', chunk => {
        raw += chunk;
      });
      request.on('end', () => {
        const params = new URLSearchParams(raw);
        state.posts.push({ email: params.get('email'), password: params.get('password') });
        const ok = params.get('password') === PASSWORD;
        if (!ok) return send(200, loginPageWithError());
        if (mode === 'same-url') return send(200, APP_PAGE);
        return send(303, '', { location: '/app', 'set-cookie': 'sid=1; Path=/' });
      });
      return;
    }
    if (url.pathname === '/app' || url.pathname === '/reports') {
      if (/sid=1/.test(request.headers.cookie || '')) return send(200, APP_PAGE);
      return send(303, '', { location: '/login' });
    }
    if (url.pathname === '/help')
      return send(200, '<!doctype html><title>Help</title><main><h1>Help</h1></main>');
    return send(200, LOGIN_PAGE);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, state, close: () => new Promise(resolve => server.close(resolve)) };
}

async function openExplorer(t, base, options = {}) {
  const artifactDir = path.join(tmpDir('usereye-auth-'), 'run');
  const eye = new UserEye({ artifactDir, recordVideo: false, navigationTimeoutMs: 8000 });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  await eye.goto(`${base}/login`);
  const explorer = new AdaptiveExplorer(eye, {
    mode: 'quick',
    baseURL: base,
    axe: false,
    patternPack: ['en'],
    quietMs: 60,
    maxWaitMs: 400,
    ...options,
  });
  const initial = await explorer.captureState('Login page', 0, true);
  assert.equal(initial.node.pageType, 'authentication', 'the fixture is classified as a login page');
  return { eye, explorer, node: initial.node, artifactDir };
}

/** Every file the run wrote, as text — the secret must be in none of them. */
function artifactCorpus(artifactDir) {
  const chunks = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!/\.(png|jpe?g|webm|zip)$/i.test(entry.name))
        chunks.push(`${full}\n${fs.readFileSync(full, 'utf8')}`);
    }
  };
  walk(artifactDir);
  return chunks.join('\n');
}

// ---------------------------------------------------------------------------

test('explorer auth: correct credentials → URL transition → authenticated', skipBrowser, async t => {
  const site = await startServer('redirect');
  t.after(() => site.close());
  const { eye, explorer, node } = await openExplorer(t, site.base, {
    credentials: { email: EMAIL, password: PASSWORD },
  });

  const after = await explorer._attemptAuthentication(node, 0);

  assert.equal(explorer.auth.attempted, true);
  assert.equal(explorer.auth.succeeded, true);
  assert.equal(explorer.auth.reason, 'authenticated');
  assert.ok(after && after.id !== node.id, 'a new state (the app shell) is returned');
  assert.notEqual(after.pageType, 'authentication');
  assert.match(eye.page.url(), /\/app$/);
  assert.deepEqual(site.state.posts, [{ email: EMAIL, password: PASSWORD }], 'exactly one submit');

  const record = explorer.actions.find(action => action.outcome === 'authenticated');
  assert.ok(record, 'the action log records the authentication');
  assert.equal(record.candidate.name, 'Sign in');
  assert.equal(record.candidate.type, 'submit', 'the form submit was chosen over the "Sign in help" link');
  assert.equal(record.resultingState, after.id);

  // Idempotent: a second attempt is a no-op (no second POST, no loop).
  assert.equal(await explorer._attemptAuthentication(node, 0), null);
  assert.equal(site.state.posts.length, 1);
});

test(
  'explorer auth: wrong password does not transition, does not retry, is reported honestly',
  skipBrowser,
  async t => {
    const site = await startServer('redirect');
    t.after(() => site.close());
    // `username` (not `email`) exercises the identity fallback; it must still satisfy
    // the fixture's <input type="email"> or native validation would block the submit.
    const { eye, explorer, node } = await openExplorer(t, site.base, {
      credentials: { username: 'tester@example.test', password: 'definitely-not-it' },
    });

    const after = await explorer._attemptAuthentication(node, 0);

    assert.equal(explorer.auth.succeeded, false);
    assert.equal(explorer.auth.reason, 'authentication-did-not-transition');
    assert.equal(site.state.posts.length, 1, 'one attempt only — never a credential loop');
    assert.equal(
      site.state.posts[0].email,
      'tester@example.test',
      'username is used when no email is configured',
    );
    assert.match(eye.page.url(), /\/session$|\/login$/);
    // The page re-rendered the login form: the live signals still say "auth".
    const live = await explorer._liveAuthSignals();
    assert.equal(live.looksLikeAuth, true);
    assert.equal(live.passwordInputs, 1);
    assert.ok(after === null || after.pageType === 'authentication');
    // A failed login must stop the explorer from exploring "behind" the wall.
    const before = explorer.actions.length;
    await explorer._exploreNode(node, 0);
    assert.equal(
      explorer.actions.length,
      before,
      'no candidates are exercised on a login page that did not authenticate',
    );
  },
);

test(
  'explorer auth: same-URL login is proven by auth.successAssert (selector + noSelector + urlNotMatch)',
  skipBrowser,
  async t => {
    const site = await startServer('same-url');
    t.after(() => site.close());
    const { explorer, node } = await openExplorer(t, site.base, {
      credentials: { email: EMAIL, password: PASSWORD },
      authConfig: {
        successAssert: { selector: '#shell', noSelector: 'input[type="password"]', urlNotMatch: /\/login$/ },
      },
    });

    const beforeAssert = await explorer._authSuccessAssert();
    assert.equal(beforeAssert.passed, false, 'on the login page the assertion fails…');
    assert.match(beforeAssert.reason, /url-still-login/);
    assert.match(beforeAssert.reason, /shell-not-visible:#shell/);
    assert.match(beforeAssert.reason, /password-still-visible/);

    await explorer._attemptAuthentication(node, 0);
    assert.equal(
      explorer.auth.succeeded,
      true,
      '…and after the POST (same URL, app shell rendered) it passes',
    );
    assert.equal(explorer.auth.reason, 'authenticated');
    const afterAssert = await explorer._authSuccessAssert();
    assert.deepEqual(afterAssert, { passed: true, reason: null });
  },
);

test(
  'explorer auth: _authSuccessAssert accepts string patterns and is null when unconfigured',
  skipBrowser,
  async t => {
    const site = await startServer('redirect');
    t.after(() => site.close());
    const { explorer } = await openExplorer(t, site.base, { authConfig: null });
    assert.equal(await explorer._authSuccessAssert(), null);
    explorer.options.authConfig = { successAssert: { urlNotMatch: 'LOGIN' } };
    const result = await explorer._authSuccessAssert();
    assert.equal(result.passed, false, 'string patterns are compiled case-insensitively');
    explorer.options.authConfig = { successAssert: { urlNotMatch: '/nowhere' } };
    assert.equal((await explorer._authSuccessAssert()).passed, true);
  },
);

test(
  'explorer auth: without a password nothing is typed — only an empty submit to surface validation',
  skipBrowser,
  async t => {
    const site = await startServer('redirect');
    t.after(() => site.close());
    const { explorer, node } = await openExplorer(t, site.base, { credentials: { email: EMAIL } });

    const after = await explorer._attemptAuthentication(node, 0);

    assert.equal(after, null);
    assert.equal(explorer.auth.succeeded, false);
    assert.equal(explorer.auth.reason, 'credentials-required');
    assert.equal(site.state.posts.length, 1, 'the empty submit reached the server…');
    assert.equal(site.state.posts[0].email, '', '…with no identity typed');
    assert.equal(site.state.posts[0].password, '', '…and no password typed');
    const record = explorer.actions.find(action => action.outcome === 'validation-only');
    assert.ok(record, 'the action is logged as validation-only');
  },
);

test('explorer auth: hook strategy — success, missing hook, and a throwing hook', skipBrowser, async t => {
  const site = await startServer('redirect');
  t.after(() => site.close());

  // 1. a login hook that performs the login itself
  const calls = [];
  const good = await openExplorer(t, site.base, {
    authStrategy: 'hook',
    credentials: { email: EMAIL, password: PASSWORD },
    hooks: {
      async login(page, context) {
        calls.push({
          hasEye: Boolean(context.eye),
          baseURL: context.baseURL,
          credentials: context.credentials,
        });
        await page.fill('#email', context.credentials.email);
        await page.fill('#password', context.credentials.password);
        await Promise.all([page.waitForURL(/\/app$/), page.click('#submit')]);
      },
    },
  });
  const after = await good.explorer._attemptAuthentication(good.node, 0);
  assert.equal(good.explorer.auth.succeeded, true);
  assert.equal(good.explorer.auth.reason, 'authenticated-by-hook');
  assert.ok(after && after.id !== good.node.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hasEye, true);
  assert.equal(calls[0].baseURL, site.base);
  assert.equal(calls[0].credentials.password, PASSWORD, 'the hook receives the raw credentials');

  // 2. strategy says hook, but none was provided
  const missing = await openExplorer(t, site.base, { authStrategy: 'hook', hooks: {} });
  assert.equal(await missing.explorer._attemptAuthentication(missing.node, 0), null);
  assert.equal(missing.explorer.auth.reason, 'login-hook-required');
  assert.equal(missing.explorer.auth.succeeded, false);

  // 3. the hook throws: the run continues, the reason carries the message
  const throwing = await openExplorer(t, site.base, {
    authStrategy: 'hook',
    hooks: {
      async login() {
        throw new Error('idp unreachable');
      },
    },
  });
  assert.equal(await throwing.explorer._attemptAuthentication(throwing.node, 0), null);
  assert.equal(throwing.explorer.auth.reason, 'login-hook-error: idp unreachable');
  assert.ok(
    throwing.explorer.actions.some(
      action => action.outcome === 'error' && action.error === 'idp unreachable',
    ),
  );

  // 4. the hook ran but the page is still the login page
  const noop = await openExplorer(t, site.base, { authStrategy: 'hook', hooks: { async login() {} } });
  await noop.explorer._attemptAuthentication(noop.node, 0);
  assert.equal(noop.explorer.auth.succeeded, false);
  assert.equal(noop.explorer.auth.reason, 'login-hook-did-not-transition');
});

test(
  'explorer auth: storageState strategy trusts the successAssert and never touches the form',
  skipBrowser,
  async t => {
    const site = await startServer('redirect');
    t.after(() => site.close());

    const failing = await openExplorer(t, site.base, {
      authStrategy: 'storageState',
      authConfig: { successAssert: { selector: '#shell' } },
    });
    assert.equal(await failing.explorer._attemptAuthentication(failing.node, 0), null);
    assert.equal(failing.explorer.auth.succeeded, false);
    assert.equal(failing.explorer.auth.reason, 'storage-state-failed:shell-not-visible:#shell');
    assert.equal(site.state.posts.length, 0, 'the form is never submitted under storageState');

    const unconfigured = await openExplorer(t, site.base, { authStrategy: 'storageState' });
    assert.equal(await unconfigured.explorer._attemptAuthentication(unconfigured.node, 0), null);
    assert.equal(unconfigured.explorer.auth.reason, 'storage-state-did-not-authenticate');

    // Simulate a valid storage state: the cookie is present, the page IS the app.
    const passing = await openExplorer(t, site.base, {
      authStrategy: 'storageState',
      authConfig: { successAssert: { selector: '#shell', noSelector: 'input[type="password"]' } },
    });
    await passing.eye.context.addCookies([{ name: 'sid', value: '1', url: site.base }]);
    await passing.eye.goto(`${site.base}/app`);
    assert.equal(
      await passing.explorer._attemptAuthentication(passing.node, 0),
      null,
      'no new node: the current page is already the app',
    );
    assert.equal(passing.explorer.auth.succeeded, true);
    assert.equal(passing.explorer.auth.reason, 'authenticated-by-storage-state');
    assert.equal(site.state.posts.length, 0);
  },
);

test(
  'explorer auth: the password is registered as a secret and never reaches artifacts or results',
  skipBrowser,
  async t => {
    const site = await startServer('redirect');
    t.after(() => site.close());
    const { eye, explorer, node, artifactDir } = await openExplorer(t, site.base, {
      credentials: { email: EMAIL, password: PASSWORD },
    });

    await explorer._attemptAuthentication(node, 0);
    assert.equal(explorer.auth.succeeded, true);
    assert.ok(eye.secrets.has(PASSWORD), 'the password was registered before any fill');

    // The fill step for the password is marked sensitive and its value redacted.
    const fills = eye.actions.filter(action => /password/i.test(action.label || ''));
    assert.ok(fills.length >= 1, 'a "Fill test password" action was recorded');
    const serializedActions = JSON.stringify(eye.actions);
    assert.equal(serializedActions.includes(PASSWORD), false, 'action log never contains the raw password');

    // The explorer result and everything already written to disk are clean.
    const result = JSON.stringify(eye._sanitize(explorer.result()));
    assert.equal(result.includes(PASSWORD), false);
    assert.equal(JSON.stringify(eye._sanitize(eye.steps)).includes(PASSWORD), false);
    const corpus = artifactCorpus(artifactDir);
    assert.equal(corpus.includes(PASSWORD), false, `password leaked into ${artifactDir}`);
    // And redaction is the mechanism, not luck:
    assert.equal(eye._redactString(`typed ${PASSWORD} here`), 'typed [REDACTED] here');
  },
);

test('explorer auth: _liveAuthSignals honours the configured authPage pattern', skipBrowser, async t => {
  const site = await startServer('redirect');
  t.after(() => site.close());
  const { explorer } = await openExplorer(t, site.base);
  const live = await explorer._liveAuthSignals();
  assert.equal(live.looksLikeAuth, true);
  assert.equal(live.passwordInputs, 1);
  assert.match(live.url, /\/login$/);
  // A pattern that does not match the page copy flips the verdict even with a
  // password field present — the two signals are ANDed on purpose.
  explorer.patterns = { ...explorer.patterns, authPage: /zzz-no-such-word/i };
  const unmatched = await explorer._liveAuthSignals();
  assert.equal(unmatched.looksLikeAuth, false);
  assert.equal(unmatched.passwordInputs, 1);
});

test(
  'explorer auth: no recognisable submit → submit-not-found, and a click failure is contained',
  skipBrowser,
  async t => {
    const site = await startServer('redirect');
    t.after(() => site.close());
    const { explorer, node } = await openExplorer(t, site.base, {
      credentials: { email: EMAIL, password: PASSWORD },
    });

    // Same page, but the candidates the explorer saw contain no auth control.
    const stripped = {
      ...node,
      candidates: node.candidates.filter(candidate => !candidate.auth && candidate.kind !== 'auth'),
    };
    assert.equal(await explorer._attemptAuthentication(stripped, 0), null);
    assert.equal(explorer.auth.reason, 'submit-not-found');
    assert.equal(explorer.auth.succeeded, false);
    assert.equal(site.state.posts.length, 0, 'fields were filled but nothing was submitted');

    // A submit whose selector no longer exists: the error is recorded, not thrown.
    const broken = new AdaptiveExplorer(explorer.eye, { ...explorer.options, patternPack: ['en'] });
    const ghost = {
      ...node,
      candidates: [
        {
          selector: '#does-not-exist',
          name: 'Sign in',
          kind: 'auth',
          auth: true,
          tag: 'button',
          type: 'submit',
        },
      ],
    };
    assert.equal(await broken._attemptAuthentication(ghost, 0), null);
    assert.match(broken.auth.reason, /^error: /);
    assert.ok(broken.actions.some(action => action.outcome === 'error'));
    assert.equal(site.state.posts.length, 0);
  },
);
