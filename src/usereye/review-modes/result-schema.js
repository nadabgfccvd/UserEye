'use strict';

const TOOL_VERSION = require('../package.json').version;

function blankResult({ mode, baseURL, appName, artifactDir, browser, startedAt }) {
  return {
    toolVersion: TOOL_VERSION,
    schemaVersion: 5,
    reviewMode: mode,
    review: {
      mode,
      startedAt,
      endedAt: null,
      passed: true,
      summary: {},
    },
    startedAt,
    finishedAt: null,
    requestedUrl: baseURL,
    application: {
      name: appName || safeName(baseURL),
      projectName: appName || safeName(baseURL),
      stack: 'web',
      baseURL,
    },
    environment: {
      browser,
      mode: 'standard',
    },
    scopeDescription: '',
    summary: {
      steps: 0,
      passed: 0,
      failed: 0,
      warning: 0,
      checks: 0,
      actions: 0,
      observations: 0,
      issues: 0,
      unexpectedBrowserErrors: 0,
      severity: { blocker: 0, critical: 0, major: 0, minor: 0 },
    },
    steps: [],
    issues: [],
    artifacts: { resultJson: 'result.json' },
    qualityGates: { passed: true, checks: [] },
    reportLocale: 'en',
    reportFormat: ['html', 'md'],
    artifactDir,
  };
}

function safeName(baseURL) {
  try {
    return new URL(baseURL).hostname;
  } catch {
    return 'Web application';
  }
}

function issue({ id, severity = 'major', title, expected, actual, technical, evidence, source }) {
  return {
    id,
    fingerprint: id,
    severity,
    title,
    step: null,
    steps: [],
    expected,
    actual,
    technical: technical || '',
    evidence: evidence || null,
    occurrences: 1,
    confidence: 'high',
    kind: 'defect',
    source: source || 'review-mode',
  };
}

function finalizeResult(result) {
  result.finishedAt = new Date().toISOString();
  result.review.endedAt = result.finishedAt;
  result.summary.steps = result.steps.length;
  result.summary.passed = result.steps.filter(step => step.status === 'passed').length;
  result.summary.failed = result.steps.filter(step => step.status === 'failed').length;
  result.summary.warning = result.steps.filter(step => step.status === 'warning').length;
  result.summary.issues = result.issues.length;
  result.summary.severity = { blocker: 0, critical: 0, major: 0, minor: 0 };
  for (const item of result.issues) {
    result.summary.severity[item.severity] = (result.summary.severity[item.severity] || 0) + 1;
  }
  result.qualityGates.passed = (result.qualityGates.checks || []).every(check => check.passed !== false);
  result.review.passed = result.qualityGates.passed && !result.summary.failed;
  result.review.summary = {
    issues: result.summary.issues,
    gates: result.qualityGates.checks.length,
    passed: result.review.passed,
  };
  return result;
}

module.exports = { blankResult, issue, finalizeResult };
