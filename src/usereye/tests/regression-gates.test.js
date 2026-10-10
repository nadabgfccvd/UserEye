'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateQualityGates } = require('../usereye-auto');

function baseResult(issues = []) {
  const sev = { blocker: 0, critical: 0, major: 0, minor: 0 };
  for (const issue of issues) sev[issue.severity] = (sev[issue.severity] || 0) + 1;
  return { summary: { severity: sev, unexpectedBrowserErrors: 0 }, issues };
}
const adaptive = { quality: { score: 100 } };
const passGates = { minAdaptiveScore: 0, maxBlocker: 0, maxCritical: 0, maxUnexpectedBrowserErrors: 0 };

test('failOnNewMajor fails only on a real new major vs baseline', () => {
  const gates = { ...passGates, failOnNewMajor: true };
  const ok = evaluateQualityGates(baseResult(), adaptive, gates, {
    diff: { issues: { introduced: [{ severity: 'minor' }] } },
  });
  assert.equal(ok.passed, true);

  const broke = evaluateQualityGates(
    baseResult([{ fingerprint: 'axe:h:c', source: 'a11y', severity: 'major', title: 'x' }]),
    adaptive,
    gates,
    { diff: { issues: { introduced: [{ severity: 'major', id: 'ISSUE-001', title: 'x' }] } } },
  );
  assert.equal(broke.passed, false);
  assert.ok(broke.checks.some(c => c.id === 'no-new-major' && c.passed === false));
});

test('failOnNewHighConfidence ignores low-confidence signal introductions', () => {
  const gates = { ...passGates, failOnNewHighConfidence: true };
  const signal = evaluateQualityGates(baseResult(), adaptive, gates, {
    diff: { issues: { introduced: [{ severity: 'major', confidence: 'low', kind: 'signal' }] } },
  });
  assert.equal(signal.passed, true);
  const defect = evaluateQualityGates(baseResult(), adaptive, gates, {
    diff: { issues: { introduced: [{ severity: 'major', confidence: 'high', kind: 'defect' }] } },
  });
  assert.equal(defect.passed, false);
});

test('maxMajor counts only findings at gateConfidence', () => {
  const issues = [
    {
      fingerprint: 'axe:h:c',
      source: 'a11y',
      code: 'c',
      severity: 'major',
      title: 'a11y',
      confidence: 'high',
      kind: 'defect',
    },
    {
      fingerprint: 'visual:dup:u:m',
      source: 'perception',
      code: 'dup',
      severity: 'major',
      title: 'dup',
      confidence: 'medium',
      kind: 'risk',
    },
  ];
  const gates = { ...passGates, maxMajor: 0 };
  const withPolicy = evaluateQualityGates(baseResult(issues), adaptive, gates, {
    findings: { gateConfidence: 'high' },
  });
  // Only the a11y (high) major counts against maxMajor=0 -> fails.
  assert.equal(withPolicy.passed, false);
  assert.ok(withPolicy.checks.find(c => c.id === 'max-major').passed === false);

  const permissive = evaluateQualityGates(
    baseResult(issues),
    adaptive,
    { ...gates, maxMajor: 1 },
    {
      findings: { gateConfidence: 'high' },
    },
  );
  assert.equal(permissive.passed, true);
});
