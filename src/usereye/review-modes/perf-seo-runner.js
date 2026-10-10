'use strict';

const fs = require('fs');
const path = require('path');
const { launcher, prepareTarget, writeStandardArtifacts, absoluteUrl } = require('./common');
const { blankResult, issue, finalizeResult } = require('./result-schema');

function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.floor(xs.length / 2)];
}

function sum(values) {
  return Math.round(values.reduce((a, b) => a + (Number(b) || 0), 0));
}
function kb(bytes) {
  return Math.round((bytes / 1024) * 10) / 10;
}

async function runOne(page, url, timeoutMs) {
  const resources = [];
  const failures = [];
  const statusCodes = [];
  page.on('response', response => statusCodes.push({ url: response.url(), status: response.status() }));
  page.on('requestfailed', request =>
    failures.push({ url: request.url(), failure: request.failure()?.errorText || 'request failed' }),
  );
  page.on('requestfinished', async request => {
    try {
      const response = await request.response();
      const headers = response ? await response.allHeaders().catch(() => ({})) : {};
      resources.push({
        url: request.url(),
        method: request.method(),
        type: request.resourceType(),
        status: response?.status() || 0,
        bytes: Number(headers['content-length']) || 0,
      });
    } catch {}
  });
  const started = Date.now();
  const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: Math.min(5000, timeoutMs) }).catch(() => {});
  await page.mouse.move(10, 10).catch(() => {});
  const metrics = await page
    .evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paints = Object.fromEntries(
        performance.getEntriesByType('paint').map(p => [p.name, p.startTime]),
      );
      const res = performance.getEntriesByType('resource');
      const byType = {};
      for (const r of res) {
        const key = r.initiatorType || 'other';
        byType[key] = (byType[key] || 0) + (r.transferSize || 0);
      }
      const lcpEntry = performance.getEntriesByType('largest-contentful-paint').at(-1);
      let cls = 0;
      for (const entry of performance.getEntriesByType('layout-shift')) {
        if (!entry.hadRecentInput) cls += entry.value || 0;
      }
      const longTasks = performance
        .getEntriesByType('longtask')
        .map(t => ({ start: t.startTime, duration: t.duration }));
      return {
        loadMs: nav ? nav.loadEventEnd : performance.now(),
        ttfbMs: nav ? nav.responseStart : null,
        fcpMs: paints['first-contentful-paint'] || null,
        lcpMs: lcpEntry?.startTime || null,
        cls,
        inpMs: null,
        resourceTiming: {
          totalByteWeight: res.reduce((total, r) => total + (r.transferSize || 0), 0),
          byInitiatorType: byType,
          requests: res.length,
        },
        longTasks,
      };
    })
    .catch(() => ({
      loadMs: Date.now() - started,
      resourceTiming: { totalByteWeight: 0, byInitiatorType: {}, requests: 0 },
      longTasks: [],
    }));
  const seo = await page.evaluate(() => {
    const text = el => (el?.getAttribute('content') || el?.textContent || '').trim();
    const links = [...document.querySelectorAll('a[href]')];
    const images = [...document.querySelectorAll('img')];
    return {
      title: document.title || '',
      metaDescription: text(document.querySelector('meta[name="description" i]')),
      viewport: text(document.querySelector('meta[name="viewport" i]')),
      canonical: document.querySelector('link[rel="canonical" i]')?.href || '',
      robots: text(document.querySelector('meta[name="robots" i]')),
      h1Count: document.querySelectorAll('h1').length,
      links: links.length,
      vagueLinks: links.filter(a =>
        /^(click here|here|read more|more|clique aqui|aqui|saiba mais)$/i.test((a.textContent || '').trim()),
      ).length,
      images: images.length,
      imagesMissingAlt: images.filter(img => !img.hasAttribute('alt')).length,
      lang: document.documentElement.lang || '',
    };
  });
  return {
    url,
    finalUrl: page.url(),
    status: response?.status() || 0,
    metrics,
    seo,
    resources,
    failures,
    statusCodes,
  };
}

function seoAudits(run, config) {
  const seo = run.seo || {};
  const checks = [
    {
      id: 'seo-status-ok',
      passed: run.status >= 200 && run.status < 400,
      actual: run.status,
      expected: '2xx/3xx final HTTP status',
    },
    {
      id: 'seo-title',
      passed: Boolean(seo.title),
      actual: seo.title || '(empty)',
      expected: 'non-empty <title>',
    },
    {
      id: 'seo-meta-description',
      passed: !config.seo.requireMetaDescription || Boolean(seo.metaDescription),
      actual: seo.metaDescription || '(empty)',
      expected: 'non-empty meta description',
    },
    {
      id: 'seo-viewport',
      passed: /width=device-width/i.test(seo.viewport || ''),
      actual: seo.viewport || '(missing)',
      expected: 'mobile viewport meta tag',
    },
    { id: 'seo-h1', passed: (seo.h1Count || 0) === 1, actual: seo.h1Count || 0, expected: 'exactly one H1' },
    {
      id: 'seo-images-alt',
      passed: (seo.imagesMissingAlt || 0) === 0,
      actual: seo.imagesMissingAlt || 0,
      expected: 'all images have alt attribute',
    },
    {
      id: 'seo-descriptive-links',
      passed: !config.seo.requireDescriptiveLinks || (seo.vagueLinks || 0) === 0,
      actual: seo.vagueLinks || 0,
      expected: 'no vague link text',
    },
    {
      id: 'seo-canonical',
      passed: !config.seo.requireCanonical || Boolean(seo.canonical),
      actual: seo.canonical || '(missing)',
      expected: 'canonical link when required',
    },
    {
      id: 'seo-lang',
      passed: Boolean(seo.lang),
      actual: seo.lang || '(missing)',
      expected: 'html lang attribute',
    },
    {
      id: 'seo-not-noindex',
      passed: !/noindex/i.test(seo.robots || ''),
      actual: seo.robots || '(none)',
      expected: 'page is indexable',
    },
  ];
  const passed = checks.filter(check => check.passed).length;
  return { score: checks.length ? passed / checks.length : 1, checks };
}

function perfGates(summary, seo, budgets) {
  return [
    {
      id: 'perf-lcp-budget',
      passed: !summary.lcpMs || summary.lcpMs <= budgets.lcpMs,
      actual: summary.lcpMs,
      expected: `<= ${budgets.lcpMs}ms`,
    },
    {
      id: 'perf-cls-budget',
      passed: summary.cls === null || summary.cls <= budgets.cls,
      actual: summary.cls,
      expected: `<= ${budgets.cls}`,
    },
    {
      id: 'perf-total-byte-budget',
      passed: summary.totalByteWeightKb <= budgets.totalByteWeightKb,
      actual: summary.totalByteWeightKb,
      expected: `<= ${budgets.totalByteWeightKb} KB`,
    },
    {
      id: 'perf-script-budget',
      passed: summary.scriptKb <= budgets.scriptKb,
      actual: summary.scriptKb,
      expected: `<= ${budgets.scriptKb} KB`,
    },
    {
      id: 'perf-image-budget',
      passed: summary.imageKb <= budgets.imageKb,
      actual: summary.imageKb,
      expected: `<= ${budgets.imageKb} KB`,
    },
    {
      id: 'seo-score-budget',
      passed: seo.score >= budgets.seoScore,
      actual: Math.round(seo.score * 100) / 100,
      expected: `>= ${budgets.seoScore}`,
    },
  ];
}

async function runPerformanceSeo(config, runtime = {}) {
  const startedAt = new Date().toISOString();
  const prepared = await prepareTarget(config, runtime);
  const { artifactDir, adapter, baseURL, analysis } = prepared;
  const result = blankResult({
    mode: 'perf-seo',
    baseURL,
    appName: config.appName || analysis.projectName,
    artifactDir,
    browser: 'Chromium',
    startedAt,
  });
  result.reportLocale = config.reportLocale;
  result.reportFormat = config.reportFormat;
  result.scopeDescription =
    'Performance + SEO lab audit with Lighthouse-like native checks, budgets and technical SEO gates.';
  const formFactors =
    config.performanceSeo.formFactor === 'both' ? ['mobile', 'desktop'] : [config.performanceSeo.formFactor];
  // 7.5.1 fix: the default target is the URL the user actually asked for, not the
  // origin root. `absoluteUrl(baseURL, '/')` resolved to the origin and silently
  // discarded the path, so `--url http://host/vela/` audited `http://host/` and
  // reported SEO/perf numbers about a page nobody requested. Explicit
  // `performanceSeo.urls` entries still resolve relative to baseURL as before.
  const urls = (config.performanceSeo.urls.length ? config.performanceSeo.urls : [baseURL]).map(u =>
    absoluteUrl(baseURL, u),
  );
  const browser = await launcher('chromium').launch({ headless: !config.headed });
  const allRuns = [];
  try {
    for (const formFactor of formFactors) {
      for (const target of urls) {
        for (let i = 0; i < config.performanceSeo.runs; i += 1) {
          const context = await browser.newContext({
            viewport: formFactor === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
            isMobile: formFactor === 'mobile',
            hasTouch: formFactor === 'mobile',
            ignoreHTTPSErrors: config.ignoreHTTPSErrors,
          });
          const page = await context.newPage();
          const step = {
            number: result.steps.length + 1,
            name: `perf-seo ${formFactor} ${target}`,
            status: 'passed',
            durationMs: 0,
          };
          const t0 = Date.now();
          try {
            const run = await runOne(page, target, config.navigationTimeoutMs);
            run.formFactor = formFactor;
            run.run = i + 1;
            allRuns.push(run);
          } catch (error) {
            step.status = 'failed';
            result.issues.push(
              issue({
                id: `perf-navigation:${target}`,
                severity: 'blocker',
                title: 'Performance navigation failed',
                expected: 'Page loads for lab audit.',
                actual: error.message,
                technical: error.stack,
                source: 'perf-seo',
              }),
            );
          } finally {
            step.durationMs = Date.now() - t0;
            result.steps.push(step);
            await context.close().catch(() => {});
          }
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await adapter.stop().catch(() => {});
  }
  const lcpValues = allRuns.map(r => r.metrics.lcpMs ?? r.metrics.loadMs);
  const totalBytes = allRuns.map(
    r => r.metrics.resourceTiming.totalByteWeight || sum(r.resources.map(x => x.bytes)),
  );
  const byTypeBytes = type =>
    allRuns.map(
      r =>
        sum(r.resources.filter(x => x.type === type).map(x => x.bytes)) ||
        r.metrics.resourceTiming.byInitiatorType[type] ||
        0,
    );
  const firstSeo = allRuns[0] ? seoAudits(allRuns[0], config.performanceSeo) : { score: 0, checks: [] };
  const summary = {
    urls: urls.length,
    runs: allRuns.length,
    formFactors,
    lcpMs: Math.round(median(lcpValues) || 0),
    fcpMs: Math.round(median(allRuns.map(r => r.metrics.fcpMs)) || 0),
    ttfbMs: Math.round(median(allRuns.map(r => r.metrics.ttfbMs)) || 0),
    cls: median(allRuns.map(r => r.metrics.cls)) ?? null,
    inpMs: null,
    totalByteWeightKb: kb(median(totalBytes) || 0),
    scriptKb: kb(median(byTypeBytes('script')) || 0),
    imageKb: kb(median(byTypeBytes('image')) || 0),
    requestCount: Math.round(
      median(allRuns.map(r => r.metrics.resourceTiming.requests || r.resources.length)) || 0,
    ),
    longTasks: sum(allRuns.map(r => r.metrics.longTasks?.length || 0)),
  };
  result.performanceLab = {
    engine: 'native',
    aggregation: config.performanceSeo.aggregation,
    summary,
    runs: allRuns,
  };
  result.seo = firstSeo;
  result.networkSummary = {
    resources: allRuns.flatMap(r => r.resources),
    failures: allRuns.flatMap(r => r.failures),
    httpErrors: allRuns.flatMap(r => r.statusCodes).filter(r => r.status >= 400),
  };
  result.qualityGates.checks = perfGates(summary, firstSeo, config.performanceSeo.budgets);
  for (const check of [...result.qualityGates.checks, ...firstSeo.checks]) {
    if (check.passed) continue;
    result.issues.push(
      issue({
        id: check.id,
        severity: check.id.startsWith('perf') ? 'major' : 'minor',
        title: `Failed ${check.id}`,
        expected: String(check.expected),
        actual: String(check.actual),
        source: 'perf-seo',
      }),
    );
  }
  result.summary.checks = result.qualityGates.checks.length + firstSeo.checks.length;
  fs.writeFileSync(
    path.join(artifactDir, 'performance-lab.json'),
    `${JSON.stringify(result.performanceLab, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(artifactDir, 'seo-audits.json'), `${JSON.stringify(result.seo, null, 2)}\n`);
  fs.writeFileSync(
    path.join(artifactDir, 'network-summary.json'),
    `${JSON.stringify(result.networkSummary, null, 2)}\n`,
  );
  Object.assign(result.artifacts, {
    performanceLab: 'performance-lab.json',
    seoAudits: 'seo-audits.json',
    networkSummary: 'network-summary.json',
  });
  finalizeResult(result);
  const reports = await writeStandardArtifacts(result, artifactDir, config, ['perf-seo']);
  return { exitCode: result.review.passed ? 0 : 1, artifactDir, result, reports };
}

module.exports = { runPerformanceSeo };
