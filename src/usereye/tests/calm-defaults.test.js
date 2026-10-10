'use strict';

/**
 * Calm-defaults contract (ROADMAP-PACKAGING-AND-DEFAULTS Phases D + E).
 *
 * The whole point of 7.4.1 is that a bare `usereye auto` with no config file is
 * as calm as what `usereye init` scaffolds. These tests pin that promise from
 * four directions so it cannot silently regress:
 *
 *   1. `DEFAULT_CONFIG` itself (the single source of truth);
 *   2. the resolved config a bare CLI run actually gets, plus the opt-back flags;
 *   3. the two other places defaults are *written down* for humans — the
 *      `usereye init` scaffold and `usereye.config.example.js` — which must agree
 *      with (1) instead of contradicting it;
 *   4. Phase E: calming the report must never destroy evidence, so `issuesAll`
 *      keeps every finding and SARIF has its own explicit floor.
 *
 * Browser tests are skipped as a group when no Chromium binary is installed,
 * matching tests/engine.test.js.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('node:os');
const path = require('path');
const { test, before, after } = require('node:test');

const { DEFAULT_CONFIG, loadConfig } = require('../config');
const { applyFindingsPolicy } = require('../findings');
const { describeVideoOutcome, describeTraceOutcome } = require('../report');
const { buildSarif, DEFAULT_SARIF_MIN_CONFIDENCE } = require('../sarif');
const { CONFIG_TEMPLATE, runInit } = require('../bin/usereye-init');
const exampleConfig = require('../usereye.config.example.js');
const { UserEye } = require('../user-eye');

const root = path.resolve(__dirname, '..');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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

/** The four knobs that define the calm profile, read out of any config-ish object. */
function calmKnobs(config) {
  return {
    recordVideo: config.recordVideo,
    misclickPolicy: config.misclick?.policy,
    minConfidence: config.findings?.minConfidence,
    gateConfidence: config.findings?.gateConfidence,
  };
}

const CALM = {
  recordVideo: 'on-failure',
  misclickPolicy: 'stable-only',
  minConfidence: 'medium',
  gateConfidence: 'high',
};

const LOUD = {
  recordVideo: true,
  misclickPolicy: 'aggressive',
  minConfidence: 'low',
  gateConfidence: 'low',
};

// ---------------------------------------------------------------------------
// 1. DEFAULT_CONFIG — acceptance gate §6 "Calmer defaults"
// ---------------------------------------------------------------------------

test('calm defaults: DEFAULT_CONFIG is the calm profile (Phase D1)', () => {
  assert.equal(DEFAULT_CONFIG.recordVideo, 'on-failure');
  assert.equal(DEFAULT_CONFIG.misclick.policy, 'stable-only');
  assert.equal(DEFAULT_CONFIG.findings.minConfidence, 'medium');
  assert.equal(DEFAULT_CONFIG.findings.gateConfidence, 'high');
  assert.deepEqual(DEFAULT_CONFIG.findings.suppress, []);
  assert.deepEqual(DEFAULT_CONFIG.findings.elevate, []);
  assert.deepEqual(DEFAULT_CONFIG.findings.treatAsSignal, []);
});

test('calm defaults: heavy opt-in batteries stay OFF by default (non-goal guard)', () => {
  assert.equal(DEFAULT_CONFIG.extensions.enabled, false);
  assert.equal(DEFAULT_CONFIG.userJourney.enabled, false);
  assert.deepEqual(DEFAULT_CONFIG.reportFormat, ['html', 'md'], 'sarif stays opt-in');
});

test('calm defaults: SARIF has its own confidence floor, defaulting to medium (Phase E3)', () => {
  assert.equal(DEFAULT_CONFIG.sarif.minConfidence, 'medium');
  assert.equal(DEFAULT_SARIF_MIN_CONFIDENCE, 'medium');
});

test('calm defaults: a bare loadConfig() resolves to the calm profile', async () => {
  const config = await loadConfig({ cwd: tmpDir('usereye-calm-'), env: {} });
  assert.deepEqual(calmKnobs(config), CALM);
  assert.equal(config.sarif.minConfidence, 'medium');
  assert.equal(config.extensions.enabled, false);
  assert.equal(config.userJourney.enabled, false);
});

// ---------------------------------------------------------------------------
// 2. Opt-back flags (Phase D2) — the loud profile must stay reachable
// ---------------------------------------------------------------------------

test('calm defaults: --video / --video-on-failure / --no-video map to the tri-state', async () => {
  const cwd = tmpDir('usereye-video-flags-');
  assert.equal((await loadConfig({ cwd, argv: ['--video'], env: {} })).recordVideo, true);
  assert.equal((await loadConfig({ cwd, argv: ['--video-on-failure'], env: {} })).recordVideo, 'on-failure');
  assert.equal((await loadConfig({ cwd, argv: ['--no-video'], env: {} })).recordVideo, false);
});

test('calm defaults: conflicting video flags are a usage error, not a silent winner', async () => {
  const cwd = tmpDir('usereye-video-conflict-');
  for (const argv of [
    ['--video', '--no-video'],
    ['--video', '--video-on-failure'],
    ['--no-video', '--video-on-failure'],
  ]) {
    await assert.rejects(loadConfig({ cwd, argv, env: {} }), /Conflicting video flags/);
  }
});

test('calm defaults: --misclick-policy selects the policy and rejects junk', async () => {
  const cwd = tmpDir('usereye-misclick-flag-');
  assert.equal(
    (await loadConfig({ cwd, argv: ['--misclick-policy', 'aggressive'], env: {} })).misclick.policy,
    'aggressive',
  );
  assert.equal(
    (await loadConfig({ cwd, argv: ['--misclick-policy', 'stable-only'], env: {} })).misclick.policy,
    'stable-only',
  );
  await assert.rejects(
    loadConfig({ cwd, argv: ['--misclick-policy', 'yolo'], env: {} }),
    /--misclick-policy must be stable-only or aggressive/,
  );
});

test('calm defaults: the documented opt-back restores the exact pre-7.4.1 loud profile', async () => {
  const project = tmpDir('usereye-optback-');
  fs.writeFileSync(
    path.join(project, 'usereye.config.cjs'),
    `module.exports = {
      recordVideo: true,
      misclick: { policy: 'aggressive' },
      findings: { minConfidence: 'low', gateConfidence: 'low' },
    };`,
  );
  const config = await loadConfig({ cwd: project, env: {} });
  assert.deepEqual(calmKnobs(config), LOUD);
});

test('calm defaults: CLI opt-back beats a calm config file (precedence preserved)', async () => {
  const project = tmpDir('usereye-precedence-');
  fs.writeFileSync(
    path.join(project, 'usereye.config.cjs'),
    `module.exports = { recordVideo: 'on-failure', misclick: { policy: 'stable-only' } };`,
  );
  const config = await loadConfig({
    cwd: project,
    argv: ['--video', '--misclick-policy', 'aggressive'],
    env: {},
  });
  assert.equal(config.recordVideo, true);
  assert.equal(config.misclick.policy, 'aggressive');
});

test('calm defaults: invalid values degrade to the calm default, not to the loud one', async () => {
  const project = tmpDir('usereye-degrade-');
  fs.writeFileSync(
    path.join(project, 'usereye.config.cjs'),
    `module.exports = {
      recordVideo: 'whenever',
      misclick: { policy: 'sometimes' },
      findings: { minConfidence: 'vibes', gateConfidence: 'mood' },
      sarif: { minConfidence: 'perhaps' },
    };`,
  );
  const config = await loadConfig({ cwd: project, env: {} });
  assert.deepEqual(calmKnobs(config), CALM);
  assert.equal(config.sarif.minConfidence, 'medium');
});

// ---------------------------------------------------------------------------
// 3. The written-down defaults must agree with the runtime (Phase C4 / D4)
// ---------------------------------------------------------------------------

test('calm defaults: `usereye init` scaffolds exactly the DEFAULT_CONFIG calm knobs', () => {
  const project = tmpDir('usereye-init-calm-');
  const outcome = runInit([project, '--no-gitignore']);
  assert.equal(outcome.exitCode, 0);
  const scaffoldPath = path.join(project, 'usereye.config.js');
  assert.ok(fs.existsSync(scaffoldPath), 'init wrote usereye.config.js');

  // Load the generated file for real rather than regex-matching it, so a
  // syntactically broken scaffold fails here too.
  delete require.cache[require.resolve(scaffoldPath)];
  const scaffold = require(scaffoldPath);
  assert.deepEqual(calmKnobs(scaffold), CALM, 'init scaffold == DEFAULT_CONFIG calm knobs');
  assert.deepEqual(calmKnobs(DEFAULT_CONFIG), CALM);
});

test('calm defaults: the init template carries no contradictory default comments', () => {
  // The roadmap's complaint was a scaffold that *said* one thing while the engine
  // did another. Assert the template no longer advertises the loud values as
  // defaults, and that it does name the calm ones.
  assert.match(CONFIG_TEMPLATE, /recordVideo: 'on-failure'/);
  assert.match(CONFIG_TEMPLATE, /policy: 'stable-only'/);
  assert.match(CONFIG_TEMPLATE, /minConfidence: 'medium'/);
  assert.doesNotMatch(CONFIG_TEMPLATE, /minConfidence: 'low',\s*\/\/ show every recorded finding/);
  assert.match(CONFIG_TEMPLATE, /built-in 7\.4\.1 defaults/);
  // The template must also parse as JS on its own (it is written verbatim to disk).
  const probe = path.join(tmpDir('usereye-init-parse-'), 'template.cjs');
  fs.writeFileSync(probe, CONFIG_TEMPLATE);
  assert.doesNotThrow(() => require(probe));
});

test('calm defaults: usereye.config.example.js mirrors DEFAULT_CONFIG (Phase C4)', () => {
  assert.deepEqual(calmKnobs(exampleConfig), CALM, 'example config == DEFAULT_CONFIG calm knobs');
  const text = fs.readFileSync(path.join(root, 'usereye.config.example.js'), 'utf8');
  assert.match(text, /recordVideo: 'on-failure'/);
  assert.match(text, /minConfidence: 'medium'/);
  assert.doesNotMatch(text, /^\s*recordVideo: true,/m, 'loud video must stay commented-out opt-back');
});

test('calm defaults: engine JSDoc documents the tri-state video policy (Phase C3)', () => {
  const source = fs.readFileSync(path.join(root, 'user-eye.js'), 'utf8');
  assert.match(source, /@property \{boolean\|'on-failure'\} \[recordVideo=true\]/);
  assert.match(source, /'on-failure'` records but discards/);
  assert.match(source, /@property \{'en'\|'pt'\|'pt-BR'\|'es'\|'fr'\|'auto'\} \[reportLocale='en'\]/);
  assert.doesNotMatch(source, /@property \{'en'\|'pt'\} \[reportLocale/, 'stale two-locale JSDoc is gone');
});

test('calm defaults: CLI help advertises the calm profile and the opt-back flags', () => {
  const auto = fs.readFileSync(path.join(root, 'usereye-auto.js'), 'utf8');
  for (const flag of ['--video', '--video-on-failure', '--no-video', '--misclick-policy']) {
    assert.ok(auto.includes(flag), `usereye auto --help documents ${flag}`);
  }
  assert.match(auto, /Calm defaults \(7\.4\.1\)/);
  const observe = fs.readFileSync(path.join(root, 'usereye-observe.js'), 'utf8');
  assert.match(observe, /--video \/ --video-on-failure \/ --no-video/);
});

test('calm defaults: action.yml exposes the CI profile inputs with calm defaults (Phase D3)', () => {
  const action = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');
  assert.match(action, /^\s{2}video:/m);
  assert.match(action, /^\s{2}misclick-policy:/m);
  assert.match(action, /default: on-failure/);
  assert.match(action, /default: stable-only/);
  assert.match(action, /--video-on-failure/);
  assert.match(action, /--misclick-policy "\$INPUT_MISCICK"/);
  assert.match(action, /soft-fail/, 'gradual-adoption input documented');
});

// ---------------------------------------------------------------------------
// 4. Phase E — calm presentation, complete evidence
// ---------------------------------------------------------------------------

const EVIDENCE_ISSUES = [
  {
    fingerprint: 'axe:home:color-contrast',
    source: 'a11y',
    code: 'color-contrast',
    severity: 'major',
    title: 'contrast',
  }, // -> high / defect
  {
    fingerprint: 'misclick:btn:x:confusing',
    source: 'misclick',
    code: 'confusing',
    severity: 'minor',
    title: 'misclick',
  }, // -> medium / risk
  {
    fingerprint: 'visual:missing-favicon:u:m',
    source: 'perception',
    code: 'missing-favicon',
    severity: 'minor',
    title: 'favicon',
  }, // -> low / signal
];

test('phase E: every finding is annotated and flagged surfaced, none is dropped', () => {
  const out = applyFindingsPolicy({ issues: EVIDENCE_ISSUES }, { minConfidence: 'medium' });
  assert.equal(out.allAnnotated.length, EVIDENCE_ISSUES.length, 'issuesAll keeps everything');
  assert.ok(out.allAnnotated.every(issue => typeof issue.surfaced === 'boolean'));
  assert.equal(out.issues.length, 2, 'the low-confidence signal is held back from the primary list');
  assert.ok(out.issues.every(issue => issue.surfaced === true));
  assert.equal(out.findings.heldBack, 1);
  assert.equal(out.findings.totalRecorded, 3);
  assert.equal(out.findings.signals, 0, 'the only signal was held back');
});

test('phase E: a fully calm policy still reports its signals so exit 0 is not "empty"', () => {
  const out = applyFindingsPolicy({ issues: EVIDENCE_ISSUES }, { minConfidence: 'low' });
  assert.equal(out.issues.length, 3);
  assert.equal(out.findings.signals, 1);
  assert.equal(out.findings.heldBack, 0);
  assert.equal(out.findings.actionable.total, 1);
});

test('phase E: suppressed findings stay in issuesAll with surfaced=false', () => {
  const out = applyFindingsPolicy(
    { issues: EVIDENCE_ISSUES },
    { minConfidence: 'low', suppress: ['missing-favicon'] },
  );
  assert.equal(out.issues.length, 2);
  assert.equal(out.allAnnotated.length, 3);
  const hidden = out.allAnnotated.find(issue => issue.code === 'missing-favicon');
  assert.equal(hidden.surfaced, false, 'suppressed row is retained but flagged');
  assert.equal(out.findings.heldBack, 1);
});

test('phase E: SARIF applies its own floor and says so in the run properties', () => {
  const annotated = applyFindingsPolicy({ issues: EVIDENCE_ISSUES }, { minConfidence: 'low' });
  const result = { issues: annotated.issues, toolVersion: require('../package.json').version };

  const calm = buildSarif(result);
  const calmIds = calm.runs[0].results.map(entry => entry.ruleId);
  assert.ok(calmIds.includes('axe:home:color-contrast'), 'high confidence kept');
  assert.ok(calmIds.includes('misclick:btn:x:confusing'), 'medium confidence kept');
  assert.ok(!calmIds.includes('visual:missing-favicon:u:m'), 'low confidence held out of code scanning');
  assert.equal(calm.runs[0].properties.minConfidence, 'medium');
  assert.equal(calm.runs[0].properties.heldBackBelowFloor, 1);
  assert.equal(calm.runs[0].properties.fullEvidence, 'result.json#issuesAll');

  const forensic = buildSarif(result, { minConfidence: 'low' });
  assert.equal(forensic.runs[0].results.length, 3, 'sarif.minConfidence: low exports everything');
  assert.equal(forensic.runs[0].properties.heldBackBelowFloor, 0);
});

test('phase E: SARIF never drops an unclassified authoritative axe violation', () => {
  const result = {
    issues: [],
    accessibility: [
      {
        violations: [
          { id: 'image-alt', impact: 'critical', help: 'Images must have alt text', nodes: [{ id: 'x' }] },
        ],
      },
    ],
  };
  const sarif = buildSarif(result, { minConfidence: 'high' });
  assert.equal(sarif.runs[0].results.length, 1);
  assert.equal(sarif.runs[0].results[0].ruleId, 'axe/image-alt');
  assert.equal(sarif.runs[0].results[0].level, 'error');
});

// ---------------------------------------------------------------------------
// 5. Browser: the video policy actually behaves (Phase D4)
// ---------------------------------------------------------------------------

const CLEAN_PAGE = `<!doctype html>
<html lang="en">
<head><title>Calm fixture</title><link rel="icon" href="data:,"></head>
<body>
  <main>
    <h1>Calm defaults fixture</h1>
    <p>A perfectly readable paragraph with default colors.</p>
    <a href="/second">Second page</a>
  </main>
</body>
</html>`;

const SECOND_PAGE = `<!doctype html>
<html lang="en"><head><title>Second</title></head>
<body><main><h1>Second page</h1><p>Different content.</p></main></body></html>`;

let server = null;
let base = '';

before(async () => {
  if (!browserReady()) return;
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://calm-fixture');
    const body = url.pathname === '/second' ? SECOND_PAGE : CLEAN_PAGE;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

async function runSession({ recordVideo, trace, failRun }) {
  const artifactDir = path.join(tmpDir('usereye-calm-video-'), 'run');
  const eye = new UserEye({ artifactDir, recordVideo, trace, navigationTimeoutMs: 15000 });
  try {
    await eye.launch();
    await eye.goto(`${base}/`);
    if (failRun) {
      // A real major finding is what flips an 'on-failure' run from clean to dirty.
      eye.verify('deliberate failure', false, {
        severity: 'major',
        expected: 'a passing check',
        actual: 'a failing check',
      });
    }
  } finally {
    await eye.close();
  }
  const webm = path.join(artifactDir, 'user-eye-session.webm');
  const zip = path.join(artifactDir, 'user-eye-trace.zip');
  return {
    artifactDir,
    webmExists: fs.existsSync(webm),
    traceExists: fs.existsSync(zip),
    artifacts: eye.artifacts,
    options: eye.options,
  };
}

test("calm defaults: recordVideo 'on-failure' + clean run retains no webm", skipBrowser, async () => {
  const run = await runSession({ recordVideo: 'on-failure', failRun: false });
  assert.equal(run.webmExists, false, 'a clean run must not ship a video artifact');
  assert.equal(run.artifacts.videoDiscarded, true, 'the discard is recorded, not silent');
  assert.ok(!run.artifacts.video, 'no video path is advertised for a discarded recording');
  assert.equal(run.artifacts.videoRetainedBecause, undefined, 'nothing was retained, so no reason');
  assert.equal(
    describeVideoOutcome(run.artifacts),
    "discarded — clean run (recordVideo: 'on-failure')",
    'the console line must say the video was discarded on purpose',
  );
});

test("calm defaults: recordVideo 'on-failure' + failing run keeps the webm", skipBrowser, async () => {
  const run = await runSession({ recordVideo: 'on-failure', failRun: true });
  assert.equal(run.webmExists, true, 'evidence must survive exactly when it is needed');
  assert.ok(run.artifacts.video, 'result.artifacts.video points at the retained webm');
  assert.equal(run.artifacts.videoDiscarded, undefined);
  // This is the case that reads as a contradiction: gates can PASS and the run can
  // exit 0 while a .webm survives, because the default gates bound blockers and
  // criticals while retention also triggers on majors. The reason must be stated.
  assert.match(
    run.artifacts.videoRetainedBecause,
    /^recordVideo: 'on-failure' — 1 major finding$/,
    'a retained video must name the trigger that retained it',
  );
  assert.match(describeVideoOutcome(run.artifacts), /^kept — recordVideo: 'on-failure' — 1 major finding$/);
});

test(
  'calm defaults: recordVideo true still always keeps the webm (opt-back works)',
  skipBrowser,
  async () => {
    const run = await runSession({ recordVideo: true, failRun: false });
    assert.equal(run.webmExists, true, 'forensic profile is unchanged from 7.4.0');
    assert.equal(run.artifacts.videoDiscarded, undefined);
    assert.equal(run.artifacts.videoRetainedBecause, 'recordVideo: true');
  },
);

test('calm defaults: recordVideo false never creates video-raw/', skipBrowser, async () => {
  const artifactDir = path.join(tmpDir('usereye-calm-novideo-'), 'run');
  const eye = new UserEye({ artifactDir, recordVideo: false });
  try {
    assert.equal(fs.existsSync(eye.videoDir), false);
  } finally {
    await eye.close().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// 7.5.1 (roadmap 7.5.0 item 2.1): trace policy mirrors the video policy.
// ---------------------------------------------------------------------------

test("trace policy: config/CLI default is 'on-failure', engine default stays 'always'", async () => {
  assert.equal(DEFAULT_CONFIG.trace, 'on-failure');
  const cwd = tmpDir('usereye-trace-default-');
  assert.equal((await loadConfig({ cwd, argv: [], env: {} })).trace, 'on-failure');
  assert.equal((await loadConfig({ cwd, argv: ['--trace', 'always'], env: {} })).trace, 'always');
  assert.equal((await loadConfig({ cwd, argv: ['--trace', 'never'], env: {} })).trace, 'never');
  await assert.rejects(loadConfig({ cwd, argv: ['--trace', 'sometimes'], env: {} }), /--trace must be/);
  // Unknown config values degrade to the calm default, never to a silent 'never'.
  fs.writeFileSync(path.join(cwd, 'usereye.config.js'), `module.exports = { trace: 'whenever' };`);
  assert.equal((await loadConfig({ cwd, argv: [], env: {} })).trace, 'on-failure');
  // The engine keeps the 7.5.0 behaviour for direct callers.
  const eye = new UserEye({
    artifactDir: path.join(tmpDir('usereye-trace-engine-'), 'run'),
    recordVideo: false,
  });
  assert.equal(eye.options.trace, 'always');
  const bogus = new UserEye({
    artifactDir: path.join(tmpDir('usereye-trace-engine-'), 'run'),
    recordVideo: false,
    trace: 'maybe',
  });
  assert.equal(bogus.options.trace, 'always', 'an unknown engine value never disables tracing');
  // The scaffold and the example config name the default explicitly.
  assert.match(CONFIG_TEMPLATE, /trace: 'on-failure'/);
  assert.equal(exampleConfig.trace, 'on-failure');
});

test("trace policy: 'on-failure' + clean run discards trace.zip and says so", skipBrowser, async () => {
  const run = await runSession({ recordVideo: false, trace: 'on-failure', failRun: false });
  assert.equal(run.traceExists, false, 'a clean run must not ship the trace');
  assert.equal(run.artifacts.trace, null);
  assert.equal(run.artifacts.traceDiscarded, true, 'the discard is recorded, not silent');
  assert.equal(run.artifacts.traceRetainedBecause, undefined);
  assert.equal(describeTraceOutcome(run.artifacts), "discarded — clean run (trace: 'on-failure')");
});

test(
  "trace policy: 'on-failure' + failing run keeps trace.zip and names the trigger",
  skipBrowser,
  async () => {
    const run = await runSession({ recordVideo: 'on-failure', trace: 'on-failure', failRun: true });
    assert.equal(run.traceExists, true, 'forensics survive exactly when needed');
    assert.equal(run.artifacts.trace, 'user-eye-trace.zip');
    assert.equal(run.artifacts.traceDiscarded, undefined);
    assert.match(run.artifacts.traceRetainedBecause, /^trace: 'on-failure' — 1 major finding$/);
    assert.match(describeTraceOutcome(run.artifacts), /^kept — trace: 'on-failure' — 1 major finding$/);
    // Video and trace apply the same clean-run definition: both kept, same trigger text.
    assert.equal(run.webmExists, true);
    assert.equal(
      run.artifacts.traceRetainedBecause.replace(/^trace/, ''),
      run.artifacts.videoRetainedBecause.replace(/^recordVideo/, ''),
    );
  },
);

test("trace policy: 'always' keeps the trace on a clean run (7.5.0 behaviour)", skipBrowser, async () => {
  const run = await runSession({ recordVideo: false, trace: 'always', failRun: false });
  assert.equal(run.traceExists, true);
  assert.equal(run.artifacts.trace, 'user-eye-trace.zip');
  assert.equal(describeTraceOutcome(run.artifacts), "kept — trace: 'always'");
});

test("trace policy: 'never' does not start tracing and writes nothing", skipBrowser, async () => {
  const run = await runSession({ recordVideo: false, trace: 'never', failRun: true });
  assert.equal(run.traceExists, false);
  assert.equal(run.artifacts.trace, null);
  assert.equal(run.artifacts.traceError, undefined, 'stopping a never-started trace must not error');
  assert.equal(
    describeTraceOutcome(run.artifacts),
    null,
    'no console line for a trace that was never configured',
  );
});
