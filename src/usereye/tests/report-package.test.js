'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const { writeReports, describeVideoOutcome } = require('../report');
const { buildSarif } = require('../sarif');
const { UserEye } = require('../user-eye');
const { V5_USER_EYE_METHODS, V5_PROTOCOL_IDS } = require('../v5-compat');
const { ProtocolRunner } = require('../protocol-runner');
const { evaluateQualityGates } = require('../usereye-auto');

const root = path.resolve(__dirname, '..');

function sampleResult() {
  return {
    toolVersion: '7.0.0',
    finishedAt: '2026-09-05T12:00:00.000Z',
    application: { name: 'Fixture App', stack: 'Static HTML' },
    environment: { browser: 'Chromium', locale: 'en-US', timezone: 'UTC', desktopViewport: '1440×900' },
    summary: {
      steps: 1,
      passed: 1,
      failed: 0,
      warning: 0,
      checks: 1,
      actions: 1,
      observations: 1,
      issues: 1,
      unexpectedBrowserErrors: 0,
      severity: { blocker: 0, critical: 0, major: 0, minor: 1 },
    },
    steps: [
      {
        number: 1,
        name: 'Open app',
        status: 'passed',
        durationMs: 10,
        issueIds: [],
        observationIds: [],
        actionStart: 0,
        actionEnd: 1,
      },
    ],
    issues: [
      {
        id: 'ISSUE-001',
        fingerprint: 'fixture-rule',
        severity: 'minor',
        title: 'Small target',
        expected: '44px',
        actual: '32px',
      },
    ],
    telemetry: { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] },
    unexpectedTelemetry: { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] },
    perception: { observations: [{}], findings: [{}] },
    accessibility: [],
    artifacts: { screenshots: [], observations: [], downloads: [], trace: 'trace.zip' },
    patience: { score: 90, mood: { label: 'Calm' } },
    adaptive: {
      mode: 'quick',
      quality: { score: 90, uniqueStates: 1, uniqueURLs: 1, coveragePercent: 100, gates: [] },
    },
  };
}

test('reports use locale catalogs and generic UserEye paths', () => {
  const enDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-report-en-'));
  const ptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-report-pt-'));
  writeReports(sampleResult(), enDir, { locale: 'en', formats: ['html', 'md'] });
  writeReports(sampleResult(), ptDir, { locale: 'pt', formats: ['html', 'md'] });
  const english = fs.readFileSync(path.join(enDir, 'report.html'), 'utf8');
  const portuguese = fs.readFileSync(path.join(ptDir, 'report.html'), 'utf8');
  assert.match(english, /Summary/);
  assert.match(portuguese, /Resumo/);
  assert.match(english, /<title>UserEye — Fixture App<\/title>/);
  const staleRunner = new RegExp(`run-${'secure'}|ui-${'test'}-tool`, 'i');
  assert.doesNotMatch(english, staleRunner);
});

test('SARIF contains issues and axe findings', () => {
  const result = sampleResult();
  result.accessibility.push({
    violations: [{ id: 'button-name', impact: 'critical', help: 'Buttons must have names', nodes: 2 }],
  });
  const sarif = buildSarif(result);
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].results.length, 2);
  assert.equal(sarif.runs[0].results[0].ruleId, 'fixture-rule');
});

test('configurable gates produce stable pass/fail decisions', () => {
  const result = sampleResult();
  const adaptive = result.adaptive;
  assert.equal(
    evaluateQualityGates(result, adaptive, {
      minAdaptiveScore: 80,
      maxBlocker: 0,
      maxCritical: 0,
      maxUnexpectedBrowserErrors: 0,
    }).passed,
    true,
  );
  assert.equal(
    evaluateQualityGates(result, adaptive, {
      minAdaptiveScore: 95,
      maxBlocker: 0,
      maxCritical: 0,
      maxUnexpectedBrowserErrors: 0,
    }).passed,
    false,
  );
});

test('v5 public class and protocol compatibility remains intact', () => {
  for (const method of V5_USER_EYE_METHODS)
    assert.equal(typeof UserEye.prototype[method], 'function', method);
  const ids = new ProtocolRunner({ options: {} }, { baseURL: 'https://example.test' })
    .registry()
    .map(item => item.id);
  for (const id of V5_PROTOCOL_IDS) assert.ok(ids.includes(id), id);
});

test('package identity and tarball contents are generic and bounded', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'usereye');
  assert.equal(pkg.private, false);
  const jsFiles = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) jsFiles.push(file);
    }
  };
  walk(root);
  const legacyBrand = new RegExp(`secure${'vault'}`, 'i');
  for (const file of jsFiles)
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), legacyBrand, path.relative(root, file));

  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stderr);
  const details = JSON.parse(packed.stdout)[0];
  const names = details.files.map(file => file.path);
  assert.ok(names.includes('bin/usereye.js'));
  assert.ok(names.includes('patterns/en.json'));
  assert.ok(names.includes('types/index.d.ts'));
  assert.equal(
    names.some(name => name.startsWith('tests/')),
    false,
  );
  assert.equal(
    names.some(name => name.startsWith('artifacts/')),
    false,
  );
  assert.ok(details.size < 2_000_000, `package is unexpectedly large: ${details.size}`);
});

// A kept video beside `Quality gates: PASS` reads as a contradiction unless the
// reason is stated. These are browser-free so they run everywhere, including in CI
// without any Playwright download.
test('report: describeVideoOutcome explains every video outcome', () => {
  assert.equal(
    describeVideoOutcome({ videoDiscarded: true }),
    "discarded — clean run (recordVideo: 'on-failure')",
  );
  assert.equal(
    describeVideoOutcome({
      video: 'user-eye-session.webm',
      videoRetainedBecause: "recordVideo: 'on-failure' — 2 major findings",
    }),
    "kept — recordVideo: 'on-failure' — 2 major findings",
  );
  // A retained video with no recorded reason must still say something true rather
  // than print "kept — undefined".
  assert.equal(describeVideoOutcome({ video: 'user-eye-session.webm' }), 'kept — recordVideo: true');
  assert.equal(describeVideoOutcome({ videoError: 'video.path timed out' }), 'error — video.path timed out');
  assert.equal(describeVideoOutcome({}), null, 'no video configured: no line at all');
  assert.equal(describeVideoOutcome(), null, 'missing artifacts must not throw');
});

test('report: a discarded video takes precedence over a stale video path', () => {
  // Defensive ordering: if both were ever set, the discard is the more recent fact
  // and the sentence must not claim a file was kept.
  assert.match(describeVideoOutcome({ videoDiscarded: true, video: 'x.webm' }), /^discarded/);
});

// ---------------------------------------------------------------------------
// 7.5.1 (roadmap 7.5.0 item 2.2): report.html embeds screenshots only up to a budget.
// ---------------------------------------------------------------------------

const { DEFAULT_EMBED_LIMIT, generateHtml } = require('../report');
const { DEFAULT_CONFIG, loadConfig } = require('../config');

function galleryFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-embed-'));
  fs.mkdirSync(path.join(dir, 'screenshots'));
  // Three fake JPEGs of 30 KB each: the byte pattern does not matter to the report.
  const names = ['01-a.jpg', '02-b.jpg', '03-c.jpg'];
  for (const name of names)
    fs.writeFileSync(path.join(dir, 'screenshots', name), Buffer.alloc(30 * 1024, 0xab));
  const result = sampleResult();
  result.artifacts.screenshots = names.map(name => `screenshots/${name}`);
  return { dir, result, names };
}

test('report.embedLimit: screenshots are embedded in order until the budget, then linked', () => {
  const { dir, result } = galleryFixture();
  // Budget for exactly two 30 KB files once base64-encoded (×4/3 = 40 KB each).
  const html = generateHtml(result, dir, 'en', { embedLimit: 85 * 1024 });
  assert.equal((html.match(/data:image\/jpeg;base64,/g) || []).length, 2, 'first two are inlined');
  assert.match(html, /<a href="screenshots\/03-c\.jpg"><img src="screenshots\/03-c\.jpg" loading="lazy"/);
  assert.match(html, /1 screenshot\(s\) linked to files next to this report/);
  assert.match(html, /report\.embedLimit: 85 KB/);
  // Path safety: a screenshot outside the artifact dir is neither read nor linked.
  result.artifacts.screenshots.push('../../etc/passwd');
  const escaped = generateHtml(result, dir, 'en', { embedLimit: 'unlimited' });
  assert.doesNotMatch(escaped, /href="\.\.\/\.\.\/etc/);
});

test('report.embedLimit: unlimited restores full embedding; 0 links everything; default is 200 KB', () => {
  const { dir, result } = galleryFixture();
  const full = generateHtml(result, dir, 'en', { embedLimit: 'unlimited' });
  assert.equal((full.match(/data:image\/jpeg;base64,/g) || []).length, 3);
  assert.doesNotMatch(full, /linked to files next to this report/);
  const none = generateHtml(result, dir, 'en', { embedLimit: 0 });
  assert.equal((none.match(/data:image\/jpeg;base64,/g) || []).length, 0);
  assert.match(none, /3 screenshot\(s\) linked/);
  // No option and no result.report → the default budget.
  assert.equal(DEFAULT_EMBED_LIMIT, 200 * 1024);
  assert.equal(DEFAULT_CONFIG.report.embedLimit, DEFAULT_EMBED_LIMIT);
  const byDefault = generateHtml(result, dir, 'en');
  assert.equal(
    (byDefault.match(/data:image\/jpeg;base64,/g) || []).length,
    3,
    '90 KB of files fit in 200 KB',
  );
  // writeReports forwards config.report, and the note is localized.
  writeReports(result, dir, { locale: 'pt', formats: ['html'], report: { embedLimit: 0 } });
  const pt = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(pt, /3 captura\(s\) vinculada\(s\)/);
});

test('report.embedLimit: config normalizes numbers and "unlimited", rejects junk to the default', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-embed-config-'));
  assert.deepEqual((await loadConfig({ cwd, argv: [], env: {} })).report, { embedLimit: 200 * 1024 });
  for (const [written, expected] of [
    ['0', 0],
    ['512000', 512000],
    ["'unlimited'", 'unlimited'],
    ['Infinity', 'unlimited'],
    ['-5', 200 * 1024],
    ["'big'", 200 * 1024],
  ]) {
    fs.writeFileSync(
      path.join(cwd, 'usereye.config.js'),
      `module.exports = { report: { embedLimit: ${written} } };`,
    );
    const config = await loadConfig({ cwd, argv: [], env: {} });
    assert.equal(config.report.embedLimit, expected, `embedLimit ${written}`);
  }
});
