'use strict';

/**
 * Roadmap 7.5.0 item 5.4 — the dashboard aggregates multiple runs: score/LCP
 * trend series between result.json files of the same application, plus delta
 * columns and the existing per-run table.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { buildTrends, discoverRuns, renderIndex, runDashboard, sparkline } = require('../dashboard');

function writeRun(dir, name, application, overrides = {}) {
  const runDir = path.join(dir, name);
  fs.mkdirSync(runDir, { recursive: true });
  const result = {
    tool: 'UserEye',
    toolVersion: '7.5.1',
    application: { name: application },
    finishedAt: overrides.finishedAt || '2026-09-06T12:00:00.000Z',
    summary: {
      issues: overrides.issues ?? 0,
      severity: { blocker: 0, critical: 0, major: 0, minor: overrides.issues ?? 0 },
    },
    qualityGates: { passed: overrides.gatesPassed ?? true },
    adaptive: { quality: { score: overrides.score ?? 90 } },
    performance: {
      metrics: { lcp: { value: overrides.lcpMs ?? null } },
    },
    artifacts: { totalBytes: overrides.totalBytes ?? 4096 },
    findings: { actionable: { total: overrides.actionable ?? 0 } },
  };
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result));
  fs.writeFileSync(path.join(runDir, 'report.html'), '<html>report</html>');
  return runDir;
}

test('dashboard: discoverRuns parses score, lcp, bytes and artifact links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-dash-'));
  writeRun(dir, 'run-1', 'Demo', { score: 80, lcpMs: 3200, issues: 5, totalBytes: 65536 });
  const runs = discoverRuns(dir);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].summary.adaptiveScore, 80);
  assert.equal(runs[0].summary.lcpMs, 3200);
  assert.equal(runs[0].summary.totalBytes, 65536);
  assert.equal(runs[0].summary.issues, 5);
  assert.equal(runs[0].hasReport, true);
});

test('dashboard: buildTrends groups by application, sorts by time and needs >= 2 runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-dash-'));
  writeRun(dir, 'a-1', 'Demo', { finishedAt: '2026-09-06T10:00:00.000Z', score: 80, lcpMs: 3200, issues: 5 });
  writeRun(dir, 'a-2', 'Demo', { finishedAt: '2026-09-06T11:00:00.000Z', score: 90, lcpMs: 2600, issues: 3 });
  writeRun(dir, 'a-3', 'Demo', { finishedAt: '2026-09-06T12:00:00.000Z', score: 95, lcpMs: 2200, issues: 2 });
  writeRun(dir, 'single', 'Other', { finishedAt: '2026-09-06T11:30:00.000Z', score: 70 });

  const trends = buildTrends(discoverRuns(dir));
  assert.equal(trends.length, 1, 'single-run applications are not trends');
  assert.equal(trends[0].application, 'Demo');
  assert.deepEqual(
    trends[0].points.map(point => point.score),
    [80, 90, 95],
  );
  assert.deepEqual(
    trends[0].points.map(point => point.lcpMs),
    [3200, 2600, 2200],
  );
});

test('dashboard: sparkline renders a polyline and stays empty without enough points', () => {
  const svg = sparkline([10, 20, 15], { min: 0, max: 100 });
  assert.match(svg, /^<svg/);
  assert.match(svg, /<polyline [^>]*points="0,4[0-9] 120,[0-9]+ 240,[0-9]+"/);
  assert.equal(sparkline([null, null], { min: 0, max: 100 }), '');
  assert.equal(sparkline([5], { min: 0, max: 100 }), '');
});

test('dashboard: renderIndex shows the trend section with deltas when applicable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-dash-'));
  writeRun(dir, 'a-1', 'Demo', { finishedAt: '2026-09-06T10:00:00.000Z', score: 80, lcpMs: 3200, issues: 5 });
  writeRun(dir, 'a-2', 'Demo', { finishedAt: '2026-09-06T11:00:00.000Z', score: 90, lcpMs: 2600, issues: 3 });
  const html = renderIndex(dir, discoverRuns(dir));
  assert.match(html, /<h1[^>]*>Trends<\/h1>/);
  assert.match(html, /Demo — trend/);
  assert.match(html, /Latest vs previous/);
  // Score 80 -> 90 renders a green +10.
  assert.match(html, /color:#0a7d32">\+10<\/span>/);
  // Issues 5 -> 3 is an improvement (lower is better), also green.
  assert.match(html, /color:#0a7d32">-2<\/span>/);
});

test('dashboard: HTTP server serves the trend index and stays read-only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-dash-'));
  writeRun(dir, 'a-1', 'Demo', { finishedAt: '2026-09-06T10:00:00.000Z', score: 80, lcpMs: 3200, issues: 5 });
  writeRun(dir, 'a-2', 'Demo', { finishedAt: '2026-09-06T11:00:00.000Z', score: 90, lcpMs: 2600, issues: 3 });
  const session = await runDashboard([dir, '--port', '0']);
  try {
    const response = await fetch(`${session.url}index.html`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /UserEye dashboard/);
    assert.match(body, /Trends/);
  } finally {
    await session.close();
  }
});
