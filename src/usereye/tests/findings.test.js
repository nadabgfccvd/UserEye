'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyFinding,
  applyFindingsPolicy,
  confidenceRank,
  parseFingerprint,
  countSeverityAtConfidence,
} = require('../findings');

test('classifyFinding maps documented sources/codes to confidence and kind', () => {
  const cases = [
    [
      { fingerprint: 'axe:home:color-contrast', source: 'a11y', code: 'color-contrast', severity: 'major' },
      'high',
      'defect',
    ],
    [
      { fingerprint: 'axe:home:link-name', source: 'a11y', code: 'link-name', severity: 'minor' },
      'medium',
      'defect',
    ],
    [
      { fingerprint: 'misclick:btn:x:harmful', source: 'misclick', code: 'harmful', severity: 'major' },
      'high',
      'defect',
    ],
    [
      { fingerprint: 'misclick:btn:x:confusing', source: 'misclick', code: 'confusing', severity: 'minor' },
      'medium',
      'risk',
    ],
    [
      {
        fingerprint: 'visual:missing-favicon:url:m',
        source: 'perception',
        code: 'missing-favicon',
        severity: 'minor',
      },
      'low',
      'signal',
    ],
    [
      {
        fingerprint: 'visual:duplicate-ids:url:m',
        source: 'perception',
        code: 'duplicate-ids',
        severity: 'major',
      },
      'medium',
      'risk',
    ],
    [
      { fingerprint: 'code-quality:lint', source: 'code-quality', code: 'lint', severity: 'major' },
      'high',
      'defect',
    ],
    [{ fingerprint: 'blocked-custom', severity: 'critical' }, 'high', 'defect'],
  ];
  for (const [issue, conf, kind] of cases) {
    const meta = classifyFinding(issue);
    assert.ok(meta, `expected a classification for ${issue.fingerprint}`);
    assert.equal(meta.confidence, conf, `confidence for ${issue.fingerprint}`);
    assert.equal(meta.kind, kind, `kind for ${issue.fingerprint}`);
  }
});

test('explicit confidence/kind wins over derivation', () => {
  const meta = classifyFinding({
    fingerprint: 'axe:home:color-contrast',
    source: 'a11y',
    severity: 'major',
    confidence: 'low',
    kind: 'signal',
  });
  assert.equal(meta.confidence, 'low');
  assert.equal(meta.kind, 'signal');
});

test('elevate forces high; treatAsSignal demotes to low/signal', () => {
  const issue = {
    fingerprint: 'visual:duplicate-ids:url:m',
    source: 'perception',
    code: 'duplicate-ids',
    severity: 'major',
  };
  assert.equal(classifyFinding(issue, { elevate: ['duplicate-ids'] }).confidence, 'high');
  const sig = classifyFinding(
    { ...issue, code: 'missing-lang', source: 'perception' },
    { treatAsSignal: ['missing-lang'] },
  );
  assert.equal(sig.confidence, 'low');
  assert.equal(sig.kind, 'signal');
});

test('parseFingerprint recovers source/code/outcome from stable prefixes', () => {
  assert.deepEqual(parseFingerprint('misclick:btn-a:left:harmful'), {
    source: 'misclick',
    code: 'harmful',
    outcome: 'harmful',
  });
  assert.deepEqual(parseFingerprint('visual:missing-favicon:https://x:mobile'), {
    source: 'visual',
    code: 'missing-favicon',
    outcome: undefined,
  });
  assert.deepEqual(parseFingerprint('axe:home:aria-hidden-focus'), {
    source: 'axe',
    code: 'aria-hidden-focus',
    outcome: undefined,
  });
});

test('applyFindingsPolicy annotates, suppresses, and buckets Actionable vs Review', () => {
  const result = {
    issues: [
      {
        fingerprint: 'axe:home:color-contrast',
        source: 'a11y',
        code: 'color-contrast',
        severity: 'major',
        title: 'contrast',
      },
      {
        fingerprint: 'misclick:btn:x:confusing',
        source: 'misclick',
        code: 'confusing',
        severity: 'minor',
        title: 'misclick',
      },
      {
        fingerprint: 'visual:missing-favicon:u:m',
        source: 'perception',
        code: 'missing-favicon',
        severity: 'minor',
        title: 'favicon',
      },
      {
        fingerprint: 'visual:duplicate-ids:u:m',
        source: 'perception',
        code: 'duplicate-ids',
        severity: 'major',
        title: 'dup',
      },
    ],
  };
  const out = applyFindingsPolicy(result, { minConfidence: 'low', suppress: ['missing-favicon'] });
  assert.equal(out.issues.length, 3);
  assert.ok(out.issues.every(i => i.confidence && i.kind));
  const a11y = out.issues.find(i => i.code === 'color-contrast');
  assert.equal(a11y.confidence, 'high');
  assert.equal(a11y.kind, 'defect');
  const mis = out.issues.find(i => i.code === 'confusing');
  assert.equal(mis.confidence, 'medium');
  assert.equal(mis.kind, 'risk');
  assert.equal(out.findings.actionable.total, 1); // only the a11y defect major
  assert.equal(out.findings.review, 2);
  assert.equal(out.summary.severity.major, 2);
});

test('applyFindingsPolicy can drop below-minConfidence signals', () => {
  const result = {
    issues: [
      {
        fingerprint: 'visual:missing-favicon:u:m',
        source: 'perception',
        code: 'missing-favicon',
        severity: 'minor',
        title: 'favicon',
      },
    ],
  };
  const out = applyFindingsPolicy(result, { minConfidence: 'medium' });
  assert.equal(out.issues.length, 0);
});

test('countSeverityAtConfidence respects gateConfidence rank', () => {
  const issues = [
    { fingerprint: 'axe:home:color-contrast', source: 'a11y', severity: 'major' }, // high
    {
      fingerprint: 'visual:duplicate-ids:u:m',
      source: 'perception',
      code: 'duplicate-ids',
      severity: 'major',
    }, // medium
  ];
  assert.equal(countSeverityAtConfidence(issues, 'major', { gateConfidence: 'high' }), 1);
  assert.equal(countSeverityAtConfidence(issues, 'major', { gateConfidence: 'low' }), 2);
  assert.equal(countSeverityAtConfidence(issues, 'major', { gateConfidence: 'medium' }), 2);
});

test('confidenceRank treats unknown issues as high (back-compat)', () => {
  assert.equal(confidenceRank({ severity: 'critical' }), 2);
  assert.equal(confidenceRank({ confidence: 'low' }), 0);
  assert.equal(confidenceRank({ confidence: 'medium' }), 1);
  assert.equal(confidenceRank({ confidence: 'high' }), 2);
});
