'use strict';

const fs = require('fs');
const path = require('path');
const { launcher, prepareTarget, writeStandardArtifacts, absoluteUrl } = require('./common');
const { blankResult, issue, finalizeResult } = require('./result-schema');
const { annotateAxeContrastOverlays } = require('../axe-hints');

function tagsForStandard(standard) {
  if (standard === 'WCAG2A') return ['wcag2a', 'wcag21a', 'wcag22a'];
  if (standard === 'WCAG2AAA')
    return [
      'wcag2a',
      'wcag2aa',
      'wcag2aaa',
      'wcag21a',
      'wcag21aa',
      'wcag21aaa',
      'wcag22a',
      'wcag22aa',
      'wcag22aaa',
    ];
  return ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
}

function impactSeverity(impact) {
  return impact === 'critical' ? 'critical' : impact === 'serious' ? 'major' : 'minor';
}

function flattenAxe(run) {
  const out = [];
  for (const kind of ['violations', 'incomplete']) {
    for (const item of run[kind] || []) {
      for (const node of item.nodes || []) {
        out.push({
          kind,
          id: item.id,
          impact: item.impact || 'moderate',
          help: item.help,
          helpUrl: item.helpUrl,
          tags: item.tags,
          target: (node.target || []).join(' '),
          html: node.html,
          failureSummary: node.failureSummary,
          usereyeHint: node.usereyeHint || null,
        });
      }
    }
  }
  return out;
}

async function runPa11yIfEnabled(urls, config) {
  if (!config.accessibilityStrict.pa11y.enabled) return { enabled: false, results: [] };
  let pa11y;
  try {
    pa11y = require('pa11y');
  } catch (error) {
    return {
      enabled: true,
      missing: true,
      error:
        "Pa11y requested but package 'pa11y' is not installed. Install it as an optional dependency to enable this adapter.",
    };
  }
  const results = [];
  for (const url of urls) {
    results.push(
      await pa11y(url, {
        standard: config.accessibilityStrict.standard,
        runners: config.accessibilityStrict.pa11y.runners,
        includeWarnings: config.accessibilityStrict.pa11y.includeWarnings,
        includeNotices: config.accessibilityStrict.pa11y.includeNotices,
        threshold: config.accessibilityStrict.pa11y.threshold,
      }),
    );
  }
  return { enabled: true, results };
}

async function runStrictAccessibility(config, runtime = {}) {
  const startedAt = new Date().toISOString();
  const prepared = await prepareTarget(config, runtime);
  const { artifactDir, adapter, baseURL, analysis } = prepared;
  const result = blankResult({
    mode: 'a11y-strict',
    baseURL,
    appName: config.appName || analysis.projectName,
    artifactDir,
    browser: config.browser,
    startedAt,
  });
  result.reportLocale = config.reportLocale;
  result.reportFormat = config.reportFormat;
  result.scopeDescription =
    'Strict accessibility audit: complete axe result types, WCAG tags, needs-review handling and optional Pa11y adapter.';
  // 7.5.1 fix: same defect as perf-seo-runner — defaulting to '/' resolved to the
  // origin root and threw away the path in `--url`, so a strict a11y audit of
  // `http://host/vela/` silently graded `http://host/`. Explicit `seedPaths` are
  // unchanged and still resolve relative to baseURL.
  const urls = (config.seedPaths && config.seedPaths.length ? config.seedPaths : [baseURL]).map(u =>
    absoluteUrl(baseURL, u),
  );
  const browser = await launcher(config.browser).launch({ headless: !config.headed });
  const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const runs = [];
  try {
    for (const targetUrl of urls) {
      const context = await browser.newContext({
        ignoreHTTPSErrors: config.ignoreHTTPSErrors,
        viewport: config.viewport,
      });
      const page = await context.newPage();
      const t0 = Date.now();
      const step = {
        number: result.steps.length + 1,
        name: `a11y-strict ${targetUrl}`,
        status: 'passed',
        durationMs: 0,
      };
      try {
        await page.goto(targetUrl, { waitUntil: 'load', timeout: config.navigationTimeoutMs });
        await page.addScriptTag({ content: axeSource });
        const tags = config.accessibilityStrict.axe.runOnly.length
          ? config.accessibilityStrict.axe.runOnly
          : tagsForStandard(config.accessibilityStrict.standard);
        const axe = await page.evaluate(
          async ({ tags, resultTypes }) =>
            await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes }),
          { tags, resultTypes: config.accessibilityStrict.axe.resultTypes },
        );
        await annotateAxeContrastOverlays(page, axe, config.reportLocale);
        axe.url = page.url();
        runs.push(axe);
        if ((axe.violations || []).length) step.status = 'failed';
      } catch (error) {
        step.status = 'failed';
        result.issues.push(
          issue({
            id: `a11y-run:${targetUrl}`,
            severity: 'blocker',
            title: 'Strict accessibility scan failed',
            expected: 'axe runs on rendered page.',
            actual: error.message,
            technical: error.stack,
            source: 'a11y-strict',
          }),
        );
      } finally {
        step.durationMs = Date.now() - t0;
        result.steps.push(step);
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await adapter.stop().catch(() => {});
  }
  const flattened = runs.flatMap(flattenAxe);
  const seen = new Set();
  const findings = [];
  for (const item of flattened) {
    const key = `${item.kind}:${item.id}:${item.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(item);
    if (item.kind === 'violations') {
      result.issues.push(
        issue({
          id: `a11y:${item.id}:${item.target}`.slice(0, 180),
          severity: impactSeverity(item.impact),
          title: item.help || item.id,
          expected: 'WCAG rule passes for the target node.',
          actual: item.failureSummary || `${item.id} on ${item.target}`,
          technical: JSON.stringify(
            {
              target: item.target,
              html: item.html,
              helpUrl: item.helpUrl,
              tags: item.tags,
              usereyeHint: item.usereyeHint,
            },
            null,
            2,
          ),
          source: 'a11y-strict',
        }),
      );
    } else if (config.accessibilityStrict.incomplete === 'fail') {
      result.issues.push(
        issue({
          id: `a11y-needs-review:${item.id}:${item.target}`.slice(0, 180),
          severity: 'major',
          title: `Needs manual review: ${item.help || item.id}`,
          expected: 'No incomplete axe checks when incomplete=fail.',
          actual: item.failureSummary || `${item.id} needs review`,
          technical: JSON.stringify(
            {
              target: item.target,
              html: item.html,
              helpUrl: item.helpUrl,
              tags: item.tags,
              usereyeHint: item.usereyeHint,
            },
            null,
            2,
          ),
          source: 'a11y-strict',
        }),
      );
    }
  }
  const pa11y = await runPa11yIfEnabled(urls, config);
  if (pa11y.missing) {
    result.issues.push(
      issue({
        id: 'pa11y-adapter-missing',
        severity: 'major',
        title: 'Pa11y adapter requested but package is missing',
        expected: "Install optional package 'pa11y' or set accessibilityStrict.pa11y.enabled=false.",
        actual: pa11y.error,
        source: 'a11y-strict',
      }),
    );
  }
  result.accessibilityStrict = {
    standard: config.accessibilityStrict.standard,
    incompletePolicy: config.accessibilityStrict.incomplete,
    runs,
    findings,
    violations: findings.filter(f => f.kind === 'violations').length,
    needsReview: findings.filter(f => f.kind === 'incomplete').length,
    pa11y,
  };
  result.accessibility = runs.map(run => ({
    label: run.url,
    passes: run.passes?.length || 0,
    incomplete: run.incomplete || [],
    violations: run.violations || [],
  }));
  const serious = findings.filter(
    f => f.kind === 'violations' && ['serious', 'critical'].includes(f.impact),
  ).length;
  const incomplete = findings.filter(f => f.kind === 'incomplete').length;
  result.qualityGates.checks = [
    {
      id: 'a11y-strict-no-serious-violations',
      passed: serious === 0,
      actual: serious,
      expected: '0 serious/critical violations',
    },
    {
      id: 'a11y-strict-incomplete-policy',
      passed: config.accessibilityStrict.incomplete !== 'fail' || incomplete === 0,
      actual: incomplete,
      expected:
        config.accessibilityStrict.incomplete === 'fail' ? '0 incomplete checks' : 'needs-review allowed',
    },
    {
      id: 'a11y-strict-pa11y-threshold',
      passed: !pa11y.missing,
      actual: pa11y.missing ? 'missing' : 'available/not requested',
      expected: 'adapter available when enabled',
    },
  ];
  result.summary.checks = flattened.length;
  fs.writeFileSync(
    path.join(artifactDir, 'accessibility-strict.json'),
    `${JSON.stringify(result.accessibilityStrict, null, 2)}\n`,
  );
  result.artifacts.accessibilityStrict = 'accessibility-strict.json';
  finalizeResult(result);
  const reports = await writeStandardArtifacts(result, artifactDir, config, ['a11y-strict']);
  return { exitCode: result.review.passed ? 0 : 1, artifactDir, result, reports };
}

module.exports = { runStrictAccessibility };
