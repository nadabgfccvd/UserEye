'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateMarkdownPr, writeReports, generateHtml } = require('../report');
const { discoverRuns } = require('../dashboard');

function sampleResult() {
  return {
    toolVersion: '7.2.0',
    application: { name: 'Demo', projectName: 'demo' },
    summary: { issues: 3, severity: { blocker: 0, critical: 0, major: 1, minor: 2 } },
    issues: [
      {
        fingerprint: 'axe:h:c',
        source: 'a11y',
        code: 'c',
        severity: 'major',
        confidence: 'high',
        kind: 'defect',
        id: 'ISSUE-001',
        title: 'Contrast',
        expected: 'x',
        actual: 'y',
        evidence: 'screenshots/1.jpg',
      },
      {
        fingerprint: 'visual:m:u:m',
        source: 'perception',
        code: 'missing-favicon',
        severity: 'minor',
        confidence: 'low',
        kind: 'signal',
        id: 'ISSUE-002',
        title: 'Favicon',
      },
      {
        fingerprint: 'misclick:a:l:c',
        source: 'misclick',
        code: 'confusing',
        severity: 'minor',
        confidence: 'medium',
        kind: 'risk',
        id: 'ISSUE-003',
        title: 'Misclick',
      },
    ],
    adaptive: { quality: { score: 88 } },
    qualityGates: { passed: true },
    findings: { actionable: { total: 1 }, review: 2 },
    reportLocale: 'en',
  };
}

test('generateMarkdownPr returns a compact comment without signal noise', () => {
  const md = generateMarkdownPr(sampleResult());
  const lines = md.trim().split('\n');
  assert.ok(lines.length <= 30, `pr markdown should be <= 30 lines, got ${lines.length}`);
  assert.ok(md.includes('ISSUE-001'), 'includes the actionable finding');
  assert.ok(!md.includes('ISSUE-002'), 'excludes the low-confidence signal');
  assert.ok(md.includes('88'), 'includes the score');
});

test('writeReports emits md-pr next to html/md/sarif', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-ev-'));
  const out = writeReports(sampleResult(), dir, { formats: ['html', 'md', 'md-pr', 'sarif'], locale: 'en' });
  assert.ok(out.mdPrPath && fs.existsSync(out.mdPrPath), 'report-pr.md written');
  assert.ok(out.htmlPath && fs.existsSync(out.htmlPath));
  assert.ok(out.sarifPath && fs.existsSync(out.sarifPath));
});

test('html includes an executive top-actionable strip and confidence markers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-ev2-'));
  const html = generateHtml(sampleResult(), dir, 'en');
  assert.ok(html.includes('Actionable (high)'), 'executive label present');
  assert.ok(html.includes('ISSUE-001'), 'top finding present');
  assert.ok(html.includes('conf-high') || html.includes('High'), 'confidence pill rendered');
});

test('dashboard discoverRuns lists newest-first by mtime and includes actionable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-dash-'));
  const newer = path.join(dir, 'a');
  const older = path.join(dir, 'b');
  fs.mkdirSync(newer);
  fs.mkdirSync(older);
  fs.writeFileSync(path.join(newer, 'result.json'), JSON.stringify(sampleResult()));
  fs.writeFileSync(path.join(older, 'result.json'), JSON.stringify(sampleResult()));
  // Make `older` actually older.
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(older, 'result.json'), past, past);
  const runs = discoverRuns(dir);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].name, 'a', 'newest first');
  assert.equal(runs[0].summary.actionable, 1);
});
