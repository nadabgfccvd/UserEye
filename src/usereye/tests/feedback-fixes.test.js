'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectBrowserPerception } = require('../browser-perception');
const { collectHumanSignals } = require('../browser-human');
const { applyFindingsPolicy } = require('../findings');
const { generateHtml, generateMarkdown } = require('../report');
const { observeExitCode } = require('../usereye-observe');
const { makeExpect, makeEye } = require('../review-modes/flow-runner');
const { annotateAxeContrastOverlays, detectSiblingOverlays } = require('../axe-hints');
const { createBrowserEnv } = require('./helpers/browser-env');
const { loadConfig } = require('../config');
const { catalog } = require('../i18n');
const { parseAge, gcArtifacts } = require('../artifact-gc');
const { buildSarif } = require('../sarif');
const { buildIssuePayloads } = require('../issue-export');

const PERCEPTION_SETTINGS = {
  profile: 'desktop',
  touchTarget: 44,
  maxText: 5000,
  maxControls: 300,
  strings: catalog('en').findings,
};

function perceive(body) {
  const env = createBrowserEnv(
    `<!doctype html><html lang="en"><head><title>Patterns</title></head><body>${body}</body></html>`,
  );
  return env.evaluate(collectBrowserPerception, PERCEPTION_SETTINGS);
}

function human(body, readyState = 'complete') {
  const env = createBrowserEnv(
    `<!doctype html><html lang="en"><head><title>Patterns</title><link rel="icon" href="x.ico"></head><body>${body}</body></html>`,
    { readyState },
  );
  return env.evaluate(collectHumanSignals, {
    profile: 'desktop',
    strings: catalog('en').findings,
    consent: {},
  });
}

test('accepted patterns: decorative SVGs and sr-only clipping are opinions, not defects', () => {
  const result = perceive(`
    <button aria-label="Change theme" data-rect="20,20,44,44">
      <svg aria-hidden="true" data-rect="28,28,20,20"></svg>
    </button>
    <h1 class="sr-only" data-rect="0,0,1,1" data-scrollwidth="120"
        style="position:absolute;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">
      Accessible page title
    </h1>
  `);
  const byCode = new Map(result.findings.map(item => [item.code, item]));
  assert.ok(!byCode.has('visible-aria-hidden'));
  assert.ok(!byCode.has('text-overflow'));
  assert.equal(byCode.get('decorative-aria-hidden').kind, 'opinion');
  assert.equal(byCode.get('screen-reader-only-clipping').triage, 'accepted-pattern');
  assert.equal(result.counts.acceptedPatterns, 2);
});

test('accepted patterns: a tooltip backed by aria-label is opinionated, not hover-only content', () => {
  const result = human(
    '<button aria-label="Reset timer" title="Shortcut: R" data-rect="20,20,44,44"></button>',
  );
  const codes = result.findings.map(item => item.code);
  assert.ok(!codes.includes('hover-only-content'));
  const opinion = result.findings.find(item => item.code === 'complementary-tooltip');
  assert.equal(opinion.kind, 'opinion');
  assert.equal(opinion.acceptedPattern, 'tooltip-complements-accessible-name');
});

test('eternal skeleton explains the missing condition and accepts semantic progress >= 4%', () => {
  const empty = human(
    '<div role="progressbar" aria-valuenow="0" aria-valuemax="100" data-rect="20,20,200,20"></div>',
  );
  const finding = empty.findings.find(item => item.code === 'eternal-skeleton');
  assert.ok(finding);
  assert.match(finding.technical, /getBoundingClientRect/);
  assert.ok(finding.evidence[0].missing.includes('measurable progress below 4%'));
  assert.equal(finding.evidence[0].measurableProgressPercent, 0);

  const active = human(
    '<div role="progressbar" aria-valuenow="4" aria-valuemax="100" data-rect="20,20,200,20"></div>',
  );
  assert.ok(!active.findings.some(item => item.code === 'eternal-skeleton'));
  assert.equal(active.loadingIndicators[0].accepted, true);
});

test('finding policy keeps opinions in issuesAll, counts them separately, and excludes them from gates', () => {
  const opinion = {
    fingerprint: 'visual:decorative-aria-hidden:https://example.test:desktop',
    source: 'perception',
    code: 'decorative-aria-hidden',
    severity: 'minor',
    title: 'decorative SVG',
    confidence: 'low',
    kind: 'opinion',
    triage: 'accepted-pattern',
  };
  const output = applyFindingsPolicy({ issues: [opinion] }, { minConfidence: 'medium' });
  assert.equal(output.issues.length, 0);
  assert.equal(output.allAnnotated.length, 1);
  assert.equal(output.findings.opinions, 1);
  assert.equal(output.findings.review, 0);
  assert.equal(observeExitCode({ issues: [opinion], summary: { issues: 1 } }, null), 0);
  assert.equal(observeExitCode({ issues: [], summary: { issues: 0 } }, 'minor'), 0);
  const result = { issues: [opinion], accessibility: [] };
  assert.equal(buildSarif(result, { minConfidence: 'low' }).runs[0].results.length, 0);
  assert.deepEqual(buildIssuePayloads(result, { format: 'github', severities: ['minor'] }), []);
});

function reportFixture() {
  const opinion = {
    id: 'ISSUE-002',
    fingerprint: 'visual:decorative-aria-hidden:u:d',
    severity: 'minor',
    confidence: 'low',
    kind: 'opinion',
    triage: 'accepted-pattern',
    acceptedPattern: 'decorative-aria-hidden-in-named-control',
    title: 'Decorative SVG in named control',
    expected: 'No defect.',
    actual: 'Accepted decoration.',
    technical: '',
  };
  return {
    application: { name: 'Fixture' },
    summary: {
      steps: 0,
      passed: 0,
      failed: 0,
      warning: 0,
      checks: 0,
      issues: 0,
      unexpectedBrowserErrors: 0,
      severity: { blocker: 0, critical: 0, major: 0, minor: 0 },
    },
    steps: [],
    issues: [],
    issuesAll: [{ ...opinion, surfaced: false }],
    findings: {
      actionable: { total: 0 },
      review: 0,
      opinions: 1,
    },
    telemetry: {},
    unexpectedTelemetry: {},
    perception: { observations: [], findings: [] },
    accessibility: [],
    artifacts: {},
  };
}

test('reports place accepted opinions below the confirmed finding table', () => {
  const result = reportFixture();
  const markdown = generateMarkdown(result, 'pt-BR');
  assert.match(markdown, /## Achados priorizados/);
  assert.match(markdown, /## Heurísticas de percepção \(opinativo\)/);
  assert.ok(markdown.indexOf('Achados priorizados') < markdown.indexOf('Heurísticas de percepção'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-opinion-report-'));
  const html = generateHtml(result, dir, 'pt-BR');
  assert.match(html, /Heurísticas de percepção \(opinativo\)/);
  assert.match(html, /decorative-aria-hidden-in-named-control/);
});

class FakeLocator {
  constructor({ texts = ['ready'], counts = [1] } = {}) {
    this.texts = texts;
    this.counts = counts;
    this.textIndex = 0;
    this.countIndex = 0;
  }
  first() {
    return this;
  }
  async textContent() {
    const value = this.texts[Math.min(this.textIndex, this.texts.length - 1)];
    this.textIndex += 1;
    return value;
  }
  async count() {
    const value = this.counts[Math.min(this.countIndex, this.counts.length - 1)];
    this.countIndex += 1;
    return value;
  }
  async waitFor() {}
}

test('flow API provides native text/count assertions and the safe waitFor wrapper', async () => {
  const locators = new Map([
    ['#clock', new FakeLocator({ texts: ['24:59', ' 25:00 '] })],
    ['.task', new FakeLocator({ counts: [2, 3] })],
  ]);
  const calls = [];
  const page = {
    locator: selector => locators.get(selector) || new FakeLocator(),
    getByText: text => locators.get(text) || new FakeLocator(),
    waitForTimeout: async () => {},
    waitForFunction: async (...args) => {
      calls.push(args);
      return 'handle';
    },
    url: () => 'http://example.test/',
  };
  const expect = makeExpect(page, 100);
  assert.equal(await expect(page).text('#clock', '25:00'), '25:00');
  assert.equal(await expect(page).count('.task', 3), 3);

  const eye = makeEye(
    page,
    { name: 'flow', steps: [] },
    { steps: [] },
    os.tmpdir(),
    { baseURL: 'http://example.test/', flows: { timeoutMs: 30000 } },
    'flow',
  );
  const predicate = () => document.readyState === 'complete';
  await eye.waitFor(predicate, { timeout: 90000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], predicate);
  assert.equal(calls[0][1], undefined, 'the second argument is ARG, never the options object');
  assert.deepEqual(calls[0][2], { timeout: 90000 });
});

test('color-contrast hint identifies a positioned sibling and annotates axe nodes', async () => {
  const env = createBrowserEnv(`<!doctype html><html><body>
    <div data-rect="0,0,300,60" style="background-color:rgb(28,35,48)">
      <span id="navIndicator" data-rect="10,10,100,40"
        style="position:absolute;background-color:rgb(240,240,240);z-index:0"></span>
      <button class="mode" data-rect="10,10,100,40"
        style="position:relative;color:rgb(16,20,24);background-color:rgba(0,0,0,0);z-index:1">Focus</button>
    </div>
  </body></html>`);
  const hints = env.evaluate(detectSiblingOverlays, [['.mode']]);
  assert.equal(hints[0].overlay, '#navIndicator');
  assert.equal(hints[0].measuredAncestor.background, 'rgb(28, 35, 48)');

  const axe = {
    violations: [
      {
        id: 'color-contrast',
        nodes: [{ target: ['.mode'], html: '<button class="mode">Focus</button>' }],
      },
    ],
  };
  const fakePage = {
    isClosed: () => false,
    evaluate: async () => hints,
  };
  await annotateAxeContrastOverlays(fakePage, axe, 'pt-BR');
  const hint = axe.violations[0].nodes[0].usereyeHint;
  assert.equal(hint.code, 'sibling-overlay-background');
  assert.match(hint.technical, /Possível causa raiz/);
  assert.match(hint.technical, /#navIndicator/);
});

test('artifact gc removes only old run directories and supports a dry run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-gc-'));
  const old = path.join(root, 'old-run');
  const recent = path.join(root, 'recent-run');
  const unrelated = path.join(root, 'notes');
  for (const directory of [old, recent, unrelated]) fs.mkdirSync(directory);
  fs.writeFileSync(path.join(old, 'result.json'), JSON.stringify({ finishedAt: '2026-08-01T00:00:00.000Z' }));
  fs.writeFileSync(
    path.join(recent, 'result.json'),
    JSON.stringify({ finishedAt: '2026-09-06T00:00:00.000Z' }),
  );
  fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'not a UserEye run');
  const now = Date.parse('2026-09-07T00:00:00.000Z');
  const preview = gcArtifacts(root, { olderThanMs: parseAge('7d'), dryRun: true, now });
  assert.equal(preview.matched, 1);
  assert.ok(fs.existsSync(old));
  const removed = gcArtifacts(root, { olderThanMs: parseAge('7d'), now });
  assert.equal(removed.matched, 1);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(recent));
  assert.ok(fs.existsSync(unrelated));
});

test('pt-BR is accepted explicitly and has complete translated issue/report strings', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-ptbr-'));
  const config = await loadConfig({ cwd, argv: ['--report-locale', 'pt-BR'], env: {} });
  assert.equal(config.reportLocale, 'pt-BR');
  assert.equal(catalog('pt-BR').language, 'pt-BR');
  assert.match(catalog('pt-BR').findings['eternal-skeleton'].actual, /progresso mensurável/);
  assert.match(catalog('pt-BR').issue.contrastSiblingOverlayHint, /causa raiz/);
});
