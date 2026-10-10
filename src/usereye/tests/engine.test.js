'use strict';

/**
 * Integration tests for the UserEye engine against a real browser and a local
 * HTTP fixture server (roadmap item 1.2). Every method of the public surface is
 * exercised in isolation and verified by result AND by the artifacts produced —
 * not merely by "exit code 0".
 *
 * Skipped as a suite when no Chromium binary is installed
 * (USEREYE_SKIP_BROWSER_TESTS=1 or missing executable).
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');
const { UserEye, safeName, TOOL_VERSION } = require('../user-eye');
const pkg = require('../package.json');

function browserReady() {
  if (process.env.USEREYE_SKIP_BROWSER_TESTS === '1') {
    return false;
  }
  try {
    const { chromium } = require('playwright');
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const skipBrowser = { skip: !browserReady() && 'Chromium not installed (npx playwright install chromium)' };

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const CLEAN_PAGE = `<!doctype html>
<html lang="en">
<head><title>Engine fixture</title><link rel="icon" href="data:,"></head>
<body>
  <main>
    <h1>Welcome to the engine fixture</h1>
    <p>A perfectly readable paragraph with default colors.</p>
    <form>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" style="width:260px;height:44px">
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" style="width:260px;height:44px">
      <button type="button" id="save" style="min-width:140px;min-height:44px">Save changes</button>
    </form>
    <a href="/second">Second page</a>
  </main>
</body>
</html>`;

const SECOND_PAGE = `<!doctype html>
<html lang="en"><head><title>Second</title></head>
<body><main><h1>Second page</h1><p>Different content, different state hash.</p></main></body></html>`;

const ISSUES_PAGE = `<!doctype html>
<html lang="en"><head><title>Issues</title></head>
<body>
  <h1>Problematic page</h1>
  <p style="color:#aaa;background:#fff;font-size:16px">Very low contrast copy that fails WCAG AA.</p>
  <button style="min-width:120px;min-height:44px"></button>
  <input type="text" style="width:200px;height:44px">
  <img src="/definitely-missing.png" style="width:80px;height:40px">
</body></html>`;

const DIALOG_PAGE = `<!doctype html>
<html lang="en"><head><title>Dialogs</title></head>
<body>
  <h1>Dialog fixture</h1>
  <button id="confirm" style="min-width:140px;min-height:44px" onclick="window.__confirmResult = confirm('Proceed with care?')">Trigger confirm</button>
  <button id="dismiss" style="min-width:140px;min-height:44px" onclick="window.__alertSeen = true; alert('Dismiss me')">Trigger alert</button>
  <button id="prompt" style="min-width:140px;min-height:44px" onclick="window.__promptValue = prompt('Your name?', 'anon')">Trigger prompt</button>
</body></html>`;

let server = null;
let base = '';
let flakyHits = 0;

before(async () => {
  if (!browserReady()) return;
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(CLEAN_PAGE);
    } else if (url.pathname === '/second') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(SECOND_PAGE);
    } else if (url.pathname === '/issues') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(ISSUES_PAGE);
    } else if (url.pathname === '/dialog') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DIALOG_PAGE);
    } else if (url.pathname === '/flaky') {
      flakyHits += 1;
      if (flakyHits === 1) {
        request.socket.destroy(); // simulates a transient network failure
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(CLEAN_PAGE);
    } else if (url.pathname === '/stall') {
      // never respond — exercises navigationTimeoutMs
    } else if (url.pathname === '/500') {
      response.writeHead(500, { 'content-type': 'text/plain' }).end('boom');
    } else {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    // The /stall route intentionally never responds; drop those sockets so the
    // suite can exit.
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Pure engine logic (no browser needed)
// ---------------------------------------------------------------------------

test('engine: TOOL_VERSION is single-sourced from package.json (items 0.8/5.2)', () => {
  assert.equal(TOOL_VERSION, pkg.version);
});

test('engine: safeName slugifies, strips accents and falls back to "step"', () => {
  assert.equal(safeName('Ação: salvar!'), 'acao-salvar');
  assert.equal(safeName('Ünïcödé 123'), 'unicode-123');
  assert.equal(safeName(''), 'step');
  assert.equal(safeName('###'), 'step');
  assert.equal(safeName('x'.repeat(200)).length, 90);
});

test('engine: constructor artifact policy — video-raw only with recording (item 0.5)', () => {
  const noVideo = tmpDir('usereye-novideo-');
  const eye = new UserEye({ artifactDir: path.join(noVideo, 'run'), recordVideo: false });
  assert.ok(fs.existsSync(eye.screenshotDir));
  assert.ok(fs.existsSync(eye.observationDir));
  assert.ok(!fs.existsSync(eye.videoDir), '--no-video must not create video-raw/');

  const withVideo = tmpDir('usereye-video-');
  const eye2 = new UserEye({ artifactDir: path.join(withVideo, 'run') });
  assert.ok(fs.existsSync(eye2.videoDir));
});

test('engine: constructor validates the browser option (item 3.3)', () => {
  assert.throws(
    () => new UserEye({ artifactDir: tmpDir('usereye-bad-browser-'), browser: 'safari' }),
    /Unsupported browser/,
  );
  const viaAlias = new UserEye({ artifactDir: tmpDir('usereye-alias-'), browserName: 'firefox' });
  assert.equal(viaAlias.options.browser, 'firefox');
  const fallback = new UserEye({ artifactDir: tmpDir('usereye-default-') });
  assert.equal(fallback.options.browser, 'chromium');
});

test('engine: resilience options have safe defaults (items 4.1/4.2/4.4)', () => {
  const eye = new UserEye({ artifactDir: tmpDir('usereye-defaults-') });
  assert.equal(eye.options.retries, 1);
  assert.equal(eye.options.retryBackoffMs, 400);
  assert.equal(eye.options.navigationTimeoutMs, 15000);
  assert.equal(eye.options.dialogTimeoutMs, 5000);
  assert.equal(eye.options.minActionDelayMs, 0);
  const custom = new UserEye({
    artifactDir: tmpDir('usereye-custom-'),
    retries: 3,
    navigationTimeoutMs: 1234,
    minActionDelayMs: 50,
    dialogTimeoutMs: 99,
  });
  assert.equal(custom.options.retries, 3);
  assert.equal(custom.options.navigationTimeoutMs, 1234);
  assert.equal(custom.options.minActionDelayMs, 50);
  assert.equal(custom.options.dialogTimeoutMs, 99);
  const clamped = new UserEye({ artifactDir: tmpDir('usereye-clamp-'), retries: -5, minActionDelayMs: -1 });
  assert.equal(clamped.options.retries, 0);
  assert.equal(clamped.options.minActionDelayMs, 0);
});

test('engine: verify / require / addIssue semantics and fingerprint dedup', () => {
  const eye = new UserEye({ artifactDir: tmpDir('usereye-issues-') });
  assert.equal(eye.verify('passes', true), true);
  assert.equal(eye.checks.length, 1);
  assert.equal(eye.issues.length, 0);

  assert.equal(eye.verify('fails', false, { severity: 'minor', expected: 'a', actual: 'b' }), false);
  assert.equal(eye.issues.length, 1);
  assert.equal(eye.issues[0].id, 'ISSUE-001');
  assert.equal(eye.issues[0].severity, 'minor');

  assert.throws(() => eye.require('blocker check', false, { actual: 'nope' }), /blocker check: nope/);
  assert.equal(eye.issues[1].severity, 'blocker');

  const first = eye.addIssue({ fingerprint: 'dup', title: 'Same', severity: 'major', step: 'step-a' });
  const second = eye.addIssue({ fingerprint: 'dup', title: 'Same', severity: 'major', step: 'step-b' });
  assert.equal(first, second);
  assert.equal(second.occurrences, 2);
  assert.deepEqual(second.steps, ['step-a', 'step-b']);
  assert.equal(eye.issues.filter(issue => issue.fingerprint === 'dup').length, 1);
});

test('engine: secret registration, redaction and sanitization', () => {
  const eye = new UserEye({ artifactDir: tmpDir('usereye-secrets-') });
  eye.registerSecret(['deep-secret', 'ab', null, 4242, 'nested-token-value']);
  assert.equal(eye._redactString('a deep-secret and 4242 here'), 'a [REDACTED] and [REDACTED] here');
  assert.equal(eye._redactString('ab stays'), 'ab stays', 'values shorter than 3 chars are ignored');
  const circular = { name: 'x' };
  circular.self = circular;
  const sanitized = eye._sanitize({
    text: 'contains deep-secret',
    pattern: /foo/i,
    list: ['nested-token-value', null, 7],
    circular,
  });
  assert.equal(sanitized.text, 'contains [REDACTED]');
  assert.equal(sanitized.pattern, '/foo/i');
  assert.equal(sanitized.list[0], '[REDACTED]');
  assert.equal(sanitized.circular.self, '[Circular]');
});

test('engine: expected-telemetry rules mark planned failures (allowHttpError/allowTelemetry)', () => {
  const eye = new UserEye({ artifactDir: tmpDir('usereye-telemetry-') });
  eye.allowHttpError(500, /\/api\/broken/, 'negative scenario');
  const expected = eye._expectedTelemetry('http', { status: 500, url: 'https://x.test/api/broken' });
  assert.equal(expected.expected, true);
  assert.equal(expected.expectedReason, 'negative scenario');
  const unexpected = eye._expectedTelemetry('http', { status: 500, url: 'https://x.test/api/other' });
  assert.equal(unexpected.expected, false);
  eye.allowTelemetry({ type: 'console', message: /planned/, reason: 'demo' });
  assert.equal(eye._expectedTelemetry('console', { text: 'a planned error' }).expected, true);
  assert.equal(eye._expectedTelemetry('console', { text: 'unrelated' }).expected, false);
});

// ---------------------------------------------------------------------------
// Browser integration
// ---------------------------------------------------------------------------

test(
  'engine: full lifecycle — launch, goto, observe, steps, secrets, dialogs, axe, vitals, close',
  skipBrowser,
  async t => {
    const artifactDir = path.join(tmpDir('usereye-lifecycle-'), 'run');
    const eye = new UserEye({ artifactDir, recordVideo: true, navigationTimeoutMs: 8000 });
    t.after(() => eye.close().catch(() => {}));
    eye.registerSecret('super-secret-value');

    await eye.launch();
    assert.ok(eye.browser && eye.context && eye.page);

    await eye.goto(`${base}/`);
    assert.equal(await eye.page.title(), 'Engine fixture');

    await eye.step('Read the hero', async () => {
      assert.equal(await eye.see('h1', 'Hero heading is visible'), true);
      const observation = await eye.observe('Hero', { screenshot: true });
      assert.equal(observation.id, 'OBS-001');
      assert.equal(observation.label, 'Hero');
      assert.ok(observation.counts.controls >= 4);
      assert.deepEqual(observation.findings, [], 'the clean fixture must produce no visual findings');
      assert.ok(observation.stateHash);
      assert.ok(observation.gaze, 'gaze analysis is attached');
      assert.ok(observation.human, 'human signals are attached');
      assert.ok(observation.screenshot);
      assert.ok(fs.existsSync(path.join(artifactDir, observation.screenshot)));
      assert.ok(observation.path.startsWith('observations/'));
      assert.ok(fs.existsSync(path.join(artifactDir, observation.path)));
    });

    await eye.step('Fill the form with a secret', async () => {
      await eye.fill({ label: 'Email' }, 'user@example.test', 'Type email');
      await eye.fill({ label: 'Password' }, 'super-secret-value', 'Type password', { sensitive: true });
      await eye.press('Tab');
      const masked = await eye.page.getAttribute('#password', 'data-usereye-mask');
      assert.equal(masked, 'true', 'sensitive fields get the screenshot mask attribute');
    });

    const actionsJson = JSON.stringify(eye.actions);
    assert.ok(!actionsJson.includes('super-secret-value'), 'secrets never reach the action log');
    const pressAction = eye.actions.find(action => action.kind === 'keypress');
    assert.equal(pressAction.label, 'Press Tab', 'default press label is English (item 0.4)');
    const fillAction = eye.actions.find(action => action.label === 'Type password');
    assert.equal(fillAction.metadata.sensitive, true);
    assert.equal(fillAction.metadata.valueLength, 'super-secret-value'.length);
    assert.ok(!JSON.stringify(fillAction).includes('super-secret-value'));

    // step() swallows non-critical failures into issues: assert the steps really passed.
    for (const recorded of eye.steps) {
      assert.equal(
        recorded.status,
        'passed',
        `step "${recorded.name}" failed: ${JSON.stringify(recorded.error)}`,
      );
    }

    // Second page creates an observation transition.
    await eye.goto(`${base}/second`);
    await eye.observe('Second', { screenshot: false });
    assert.equal(eye.observations.length, 2);
    assert.equal(eye.observationTransitions.length, 1);
    assert.equal(eye.observationTransitions[0].from, 'OBS-001');
    assert.equal(eye.observationTransitions[0].to, 'OBS-002');
    assert.equal(eye.observationTransitions[0].stateChanged, true);
    assert.equal(eye.observationTransitions[0].urlChanged, true);

    // Dialogs: accept, dismiss and prompt.
    await eye.goto(`${base}/dialog`);
    const confirmPromise = eye.nextDialog('accept', { expectedText: 'Proceed with care' });
    await eye.click('#confirm', 'Open confirm');
    assert.equal(await confirmPromise, 'Proceed with care?');
    assert.equal(await eye.page.evaluate(() => window.__confirmResult), true);

    const dismissPromise = eye.nextDialog('dismiss');
    await eye.click('#dismiss', 'Open alert');
    assert.equal(await dismissPromise, 'Dismiss me');

    const promptPromise = eye.nextDialog('accept', { promptText: 'Ada Lovelace' });
    await eye.click('#prompt', 'Open prompt');
    await promptPromise;
    assert.equal(await eye.page.evaluate(() => window.__promptValue), 'Ada Lovelace');
    assert.equal(eye.telemetry.dialogs.length, 3);
    assert.deepEqual(
      eye.telemetry.dialogs.map(dialog => dialog.action),
      ['accept', 'dismiss', 'accept'],
    );

    // Expected vs unexpected telemetry on a 500.
    eye.allowHttpError(500, /\/500/, 'negative scenario');
    await eye.goto(`${base}/500`);
    const httpError = eye.telemetry.httpErrors.find(item => item.url.endsWith('/500'));
    assert.ok(httpError);
    assert.equal(httpError.expected, true);
    assert.equal(eye._unexpectedTelemetry().httpErrors.length, 0);

    // Accessibility + visual audit on the problematic page.
    await eye.goto(`${base}/issues`);
    const issuesBefore = eye.issues.length;
    const axe = await eye.runAxe('Issues page', require.resolve('axe-core/axe.min.js'));
    assert.ok(axe.violations.length >= 1);
    assert.ok(axe.passes >= 1);
    const axeIssue = eye.issues
      .slice(issuesBefore)
      .find(issue => issue.fingerprint.startsWith('axe:Issues page:'));
    assert.ok(axeIssue, 'axe violations become issues');
    assert.ok(['critical', 'major', 'minor'].includes(axeIssue.severity));

    const healthBefore = eye.issues.length;
    const health = await eye.scanVisualHealth('Issues page visual');
    assert.ok(health.findings.length >= 1);
    assert.ok(health.findings.some(finding => finding.code === 'insufficient-contrast'));
    assert.ok(eye.issues.length > healthBefore, 'scanVisualHealth promotes findings to issues by default');

    // Vitals snapshot.
    const vitals = await eye.collectVitals();
    assert.ok(vitals);
    assert.ok(vitals.url.endsWith('/issues'));
    assert.ok(vitals.rated);
    assert.equal(eye.vitalsSnapshots.length >= 1, true);

    const result = await (async () => {
      await eye.close();
      return eye.result({ application: { name: 'Engine fixture', baseURL: base } });
    })();

    assert.equal(result.schemaVersion, 4);
    assert.equal(result.toolVersion, pkg.version);
    assert.equal(result.tool, 'UserEye UI Test Tool');
    assert.ok(result.summary.steps >= 2);
    assert.ok(result.summary.actions >= 8);
    assert.ok(result.summary.observations >= 3);
    assert.equal(result.summary.retriedOperations, 0);
    assert.ok(!JSON.stringify(result).includes('super-secret-value'));
    assert.ok(result.artifacts.trace && fs.existsSync(path.join(artifactDir, result.artifacts.trace)));
    assert.ok(result.artifacts.video && fs.existsSync(path.join(artifactDir, result.artifacts.video)));
    for (const file of [
      'actions.json',
      'patience-report.json',
      'perception-summary.json',
      'third-parties.json',
      'experience-events.json',
      'misclicks.json',
    ]) {
      assert.ok(fs.existsSync(path.join(artifactDir, file)), `${file} must be persisted on close`);
    }
    const persistedActions = JSON.parse(fs.readFileSync(path.join(artifactDir, 'actions.json'), 'utf8'));
    assert.ok(!JSON.stringify(persistedActions).includes('super-secret-value'));
  },
);

test('engine: step failure semantics — issues, statuses and critical rethrow', skipBrowser, async t => {
  const artifactDir = path.join(tmpDir('usereye-steps-'), 'run');
  const eye = new UserEye({ artifactDir, recordVideo: false });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  await eye.goto(`${base}/`);

  const soft = await eye.step('Soft failure', async () => {
    throw new Error('element vanished');
  });
  assert.equal(soft.status, 'failed');
  assert.equal(soft.error.message, 'element vanished');
  assert.ok(eye.issues.some(issue => issue.title === 'Unexpected failure: Soft failure'));
  assert.ok(soft.screenshot, 'failure steps still capture a screenshot');

  const warning = await eye.step('Minor issue step', async () => {
    eye.addIssue({ severity: 'minor', title: 'Small thing', fingerprint: 'small-thing' });
  });
  assert.equal(warning.status, 'warning');

  await assert.rejects(
    eye.step(
      'Critical failure',
      async () => {
        throw new Error('fatal flow break');
      },
      { critical: true },
    ),
    /fatal flow break/,
  );
  const critical = eye.steps[eye.steps.length - 1];
  assert.equal(critical.status, 'failed');
  assert.equal(critical.issueIds.length >= 1, true);
});

test('engine: nextDialog timeout removes its listener (item 0.6 regression)', skipBrowser, async t => {
  const eye = new UserEye({
    artifactDir: path.join(tmpDir('usereye-dialog-timeout-'), 'run'),
    recordVideo: false,
    dialogTimeoutMs: 250,
  });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  await eye.goto(`${base}/`);
  const listenersBefore = eye.page.listenerCount('dialog');
  await assert.rejects(eye.nextDialog(), /Expected browser dialog did not appear/);
  assert.equal(
    eye.page.listenerCount('dialog'),
    listenersBefore,
    'the pending once(dialog) listener must be removed after the timeout',
  );
  // A dialog arriving afterwards must not crash or resolve a dead promise.
  await eye.goto(`${base}/dialog`);
  const late = eye.nextDialog('accept');
  await eye.click('#confirm', 'Open confirm after a previous timeout');
  assert.equal(await late, 'Proceed with care?');
});

test('engine: goto retries transient network failures and records them (item 4.1)', skipBrowser, async t => {
  flakyHits = 0;
  const eye = new UserEye({
    artifactDir: path.join(tmpDir('usereye-retry-'), 'run'),
    recordVideo: false,
    retryBackoffMs: 40,
  });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  await eye.goto(`${base}/flaky`);
  assert.equal(await eye.page.title(), 'Engine fixture', 'second attempt succeeds');
  assert.equal(flakyHits, 2);
  assert.equal(eye.retriedOperations.length, 1);
  const retry = eye.retriedOperations[0];
  assert.match(retry.operation, /goto/);
  assert.equal(retry.attempt, 1);
  assert.equal(retry.succeededOnAttempt, 2);
  assert.ok(retry.backoffMs >= 40);

  // Permanent failure: retries are exhausted and the error propagates.
  const dead = new UserEye({
    artifactDir: path.join(tmpDir('usereye-retry-dead-'), 'run'),
    recordVideo: false,
    retries: 1,
    retryBackoffMs: 10,
  });
  t.after(() => dead.close().catch(() => {}));
  await dead.launch();
  await assert.rejects(dead.goto('http://127.0.0.1:13999/unreachable'), error => {
    assert.match(error.message, /ERR_CONNECTION_REFUSED/);
    assert.equal(error.usereyeAttempts, 2, 'both attempts happened');
    return true;
  });
  assert.equal(dead.retriedOperations.length, 1);
  assert.equal(dead.retriedOperations[0].succeededOnAttempt, undefined);
  const failedAction = dead.actions[dead.actions.length - 1];
  assert.equal(failedAction.status, 'failed');

  // Non-transient errors (e.g. Chromium's unsafe-port block) are NOT retried.
  await assert.rejects(dead.goto('http://127.0.0.1:1/blocked'), /ERR_UNSAFE_PORT/);
  assert.equal(dead.retriedOperations.length, 1, 'unsafe port must not consume a retry');
});

test('engine: navigationTimeoutMs is configurable and honored (item 4.2)', skipBrowser, async t => {
  const eye = new UserEye({
    artifactDir: path.join(tmpDir('usereye-navtimeout-'), 'run'),
    recordVideo: false,
    navigationTimeoutMs: 600,
    retries: 0,
  });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  await assert.rejects(eye.goto(`${base}/stall`), /Timeout 600ms exceeded/);
  assert.equal(eye.retriedOperations.length, 0, 'retries: 0 disables the retry policy');
  // Reset the pending provisional navigation; otherwise the next goto to the
  // same stalled URL aborts the old one instantly (net::ERR_ABORTED) instead
  // of exercising the timeout path.
  await eye.page.goto('about:blank');
  // Per-call override still works.
  await assert.rejects(eye.goto(`${base}/stall`, { timeout: 300 }), /Timeout 300ms exceeded/);
  // Regression guard: close() must not hang for ~90s while a request to a
  // never-responding socket is still pending (teardown ops are bounded).
  const closedAt = Date.now();
  await eye.close();
  const closeMs = Date.now() - closedAt;
  assert.ok(closeMs < 20000, `close() took ${closeMs}ms with a stalled navigation pending`);
});

test('engine: minActionDelayMs throttles consecutive actions (item 4.4)', skipBrowser, async t => {
  const eye = new UserEye({
    artifactDir: path.join(tmpDir('usereye-throttle-'), 'run'),
    recordVideo: false,
    minActionDelayMs: 220,
  });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  await eye.goto(`${base}/`);
  const first = Date.now();
  await eye.click('#save', 'Click save once');
  await eye.click('#save', 'Click save twice');
  // The in-page instrumentation also records real DOM click events
  // (source: 'dom'); throttle assertions apply to engine-issued actions only.
  const clicks = eye.actions.filter(action => action.kind === 'click' && action.source === 'usereye');
  assert.equal(clicks.length, 2);
  assert.ok(
    eye.actions.some(action => action.kind === 'click' && action.source === 'dom'),
    'DOM instrumentation records the real click events too',
  );
  const gap = Date.parse(clicks[1].at) - Date.parse(clicks[0].at);
  assert.ok(gap >= 200, `second click must be delayed by minActionDelayMs, gap was ${gap}ms`);
  assert.ok(Date.now() - first >= 400);
});

test('engine: observe deduplicates state hashes and masks sensitive attributes', skipBrowser, async t => {
  const eye = new UserEye({ artifactDir: path.join(tmpDir('usereye-observe-'), 'run'), recordVideo: false });
  t.after(() => eye.close().catch(() => {}));
  await eye.launch();
  await eye.goto(`${base}/`);
  const first = await eye.observe('Same page A', { screenshot: false, gaze: false, human: false });
  const second = await eye.observe('Same page B', { screenshot: false, gaze: false, human: false });
  assert.equal(first.stateHash, second.stateHash, 'identical states hash identically');
  assert.equal(first.gaze, undefined, 'gaze can be disabled per observation');
  assert.equal(eye.observationTransitions[0].stateChanged, false);
  assert.equal(eye.observationTransitions[0].urlChanged, false);
});
