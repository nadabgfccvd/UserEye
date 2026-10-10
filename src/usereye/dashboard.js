#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.sarif': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
};

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Discover UserEye runs: directories (or the root itself) containing result.json. */
function discoverRuns(root) {
  const runs = [];
  const consider = (dir, name) => {
    const resultPath = path.join(dir, 'result.json');
    if (!fs.existsSync(resultPath)) {
      return;
    }
    let summary = null;
    let modifiedAt = '';
    try {
      const stat = fs.statSync(resultPath);
      modifiedAt = stat.mtime.toISOString();
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      summary = {
        tool: result.tool || 'UserEye',
        toolVersion: result.toolVersion || '',
        application: result.application?.name || name,
        finishedAt: result.finishedAt || '',
        issues: result.summary?.issues ?? null,
        severity: result.summary?.severity || null,
        qualityGates: result.qualityGates?.passed ?? null,
        adaptiveScore: result.adaptive?.quality?.score ?? null,
        actionable: result.findings?.actionable?.total ?? null,
        // 7.5.1 (item 2.5): on-disk cost of the run, as recorded by the run itself.
        totalBytes: Number.isFinite(result.artifacts?.totalBytes) ? result.artifacts.totalBytes : null,
        // 7.5.1 (item 5.4): worst LCP across the run, for trend comparison.
        lcpMs: Number.isFinite(result.performance?.metrics?.lcp?.value)
          ? result.performance.metrics.lcp.value
          : null,
      };
    } catch {
      summary = { application: name, parseError: true };
    }
    runs.push({
      name,
      dir: path.relative(root, dir).replace(/\\/g, '/') || '.',
      modifiedAt,
      hasReport: fs.existsSync(path.join(dir, 'report.html')),
      hasSummaryTxt: fs.existsSync(path.join(dir, 'summary.txt')),
      hasSarif: fs.existsSync(path.join(dir, 'usereye.sarif')),
      summary,
    });
  };
  consider(root, path.basename(root));
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      consider(path.join(root, entry.name), entry.name);
    }
  }
  // Phase 8: newest runs first (by result.json mtime) for a fresh-first dashboard.
  return runs.sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')));
}

/** Human-readable size for the artifacts column (7.5.1). */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Inline score bar so the dashboard reads trends at a glance (Phase 8). */
function scoreBar(score) {
  if (typeof score !== 'number') {
    return '—';
  }
  const width = Math.max(2, Math.min(100, Math.round(score)));
  const color = score >= 70 ? '#0a7d32' : score >= 50 ? '#b54708' : '#b42318';
  return `<span style="white-space:nowrap"><span style="display:inline-block;width:70px;background:#eaecf0;border-radius:4px"><span style="display:inline-block;width:${width}%;height:8px;background:${color};border-radius:4px"></span></span> ${escapeHTML(String(score))}</span>`;
}

/**
 * 7.5.1 (item 5.4): group the discovered runs by application and return a
 * chronological series per app for every app with >= 2 runs, so the dashboard
 * can show the score/LCP trend instead of only the latest numbers.
 * @returns {Array<{application: string, points: Array<{at, name, dir, score, issues, lcpMs}>}>}
 */
function buildTrends(runs) {
  const groups = new Map();
  for (const run of runs) {
    const application = run.summary?.application || run.name;
    if (!groups.has(application)) groups.set(application, []);
    groups.get(application).push(run);
  }
  const trends = [];
  for (const [application, list] of groups) {
    const series = [...list].sort((a, b) =>
      String(a.summary?.finishedAt || a.modifiedAt || '').localeCompare(
        String(b.summary?.finishedAt || b.modifiedAt || ''),
      ),
    );
    if (series.length < 2) continue;
    trends.push({
      application,
      points: series.map(run => ({
        at: run.summary?.finishedAt || run.modifiedAt,
        name: run.name,
        dir: run.dir,
        score: run.summary?.adaptiveScore ?? null,
        issues: run.summary?.issues ?? null,
        lcpMs: run.summary?.lcpMs ?? null,
      })),
    });
  }
  return trends;
}

/** Inline SVG polyline of one metric across runs (equal spacing, by index). */
function sparkline(values, options = {}) {
  const width = options.width || 240;
  const height = options.height || 48;
  const minimum = options.min;
  const maximum = options.max;
  const points = values
    .map((value, index) => ({ value, index }))
    .filter(point => Number.isFinite(point.value));
  const range = maximum - minimum;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map(point => {
    const x = Math.round(point.index * step);
    const y =
      Number.isFinite(range) && range > 0
        ? Math.round(height - 4 - ((point.value - minimum) / range) * (height - 8))
        : height / 2;
    return `${x},${y}`;
  });
  if (coords.length < 2) return '';
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="trend line">
<line x1="0" y1="${height - 4}" x2="${width}" y2="${height - 4}" stroke="#e4e7ec" stroke-width="1"/>
<polyline fill="none" stroke="${options.color || '#0a7d32'}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${coords.join(' ')}"/>
</svg>`;
}

function formatDelta(current, previous, options = {}) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return '—';
  const delta = current - previous;
  const better = options.lowerIsBetter === true ? delta < 0 : delta > 0;
  const worse = options.lowerIsBetter === true ? delta > 0 : delta < 0;
  const sign = delta > 0 ? '+' : '';
  const color = delta === 0 ? '#667085' : better ? '#0a7d32' : worse ? '#b42318' : '#667085';
  return `<span style="color:${color}">${sign}${Math.round(delta * 100) / 100}</span>`;
}

function renderTrends(trends) {
  if (!trends.length) return '';
  const sections = trends
    .map(trend => {
      const points = trend.points;
      const scores = points.map(point => point.score);
      const lcps = points.map(point => point.lcpMs);
      const lcpValues = lcps.filter(Number.isFinite);
      const lcpMax = lcpValues.length ? Math.max(...lcpValues) : null;
      const latest = points[points.length - 1];
      const previous = points[points.length - 2];
      const rows = points
        .map(point => {
          const prev = points[points.indexOf(point) - 1];
          const scoreDelta = prev ? formatDelta(point.score, prev.score) : '—';
          const issueDelta = prev ? formatDelta(point.issues, prev.issues, { lowerIsBetter: true }) : '—';
          const lcpDelta = prev ? formatDelta(point.lcpMs, prev.lcpMs, { lowerIsBetter: true }) : '—';
          return `<tr>
<td>${escapeHTML(point.at || '')}</td>
<td>${point.score ?? '—'}</td><td>${scoreDelta}</td>
<td>${point.issues ?? '—'}</td><td>${issueDelta}</td>
<td>${point.lcpMs !== null ? `${Math.round(point.lcpMs)} ms` : '—'}</td><td>${lcpDelta}</td>
<td><a href="${encodeURI(point.dir)}/">${escapeHTML(point.name)}</a></td>
</tr>`;
        })
        .join('\n');
      return `<section style="margin:24px 0">
<h2>${escapeHTML(trend.application)} — trend (${points.length} runs)</h2>
<div style="display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end">
  <div><div style="color:#667085;font-size:12px">Score (0–100)</div>${sparkline(scores, { min: 0, max: 100 })}</div>
  ${
    lcpMax
      ? `<div><div style="color:#667085;font-size:12px">LCP (ms, worst)</div>${sparkline(lcps, { min: 0, max: lcpMax, color: '#1d4ed8' })}</div>`
      : ''
  }
</div>
<table>
<thead><tr><th>Run</th><th>Score</th><th>Δ</th><th>Issues</th><th>Δ</th><th>LCP</th><th>Δ</th><th>Evidence</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${latest && previous ? `<p style="color:#667085">Latest vs previous: score ${latest.score ?? '—'} (${formatDelta(latest.score, previous.score)}), issues ${latest.issues ?? '—'} (${formatDelta(latest.issues, previous.issues, { lowerIsBetter: true })}), LCP ${latest.lcpMs !== null ? Math.round(latest.lcpMs) : '—'} ms (${formatDelta(latest.lcpMs, previous.lcpMs, { lowerIsBetter: true })}).</p>` : ''}
</section>`;
    })
    .join('\n');
  return `<h1 style="font-size:18px;margin-top:32px">Trends</h1>${sections}`;
}

function renderIndex(root, runs) {
  const rows = runs
    .map(run => {
      const severity = run.summary?.severity;
      const sev = severity
        ? `blocker ${severity.blocker ?? 0} · critical ${severity.critical ?? 0} · major ${severity.major ?? 0} · minor ${severity.minor ?? 0}`
        : '—';
      const gates =
        run.summary?.qualityGates === true
          ? '<span style="color:#0a7d32">PASS</span>'
          : run.summary?.qualityGates === false
            ? '<span style="color:#b42318">FAIL</span>'
            : '—';
      const links = [
        run.hasReport ? `<a href="${encodeURI(run.dir)}/report.html">report.html</a>` : null,
        `<a href="${encodeURI(run.dir)}/result.json">result.json</a>`,
        run.hasSarif ? `<a href="${encodeURI(run.dir)}/usereye.sarif">sarif</a>` : null,
        run.hasSummaryTxt ? `<a href="${encodeURI(run.dir)}/summary.txt">summary.txt</a>` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return `<tr>
        <td>${escapeHTML(run.name)}</td>
        <td>${escapeHTML(run.summary?.toolVersion || '')}</td>
        <td>${scoreBar(run.summary?.adaptiveScore)}</td>
        <td>${run.summary?.issues ?? '—'}</td>
        <td>${sev}</td>
        <td>${gates}</td>
        <td>${run.summary?.actionable ?? '—'}</td>
        <td>${escapeHTML(formatBytes(run.summary?.totalBytes))}</td>
        <td>${escapeHTML(run.summary?.finishedAt || run.modifiedAt || '')}</td>
        <td>${links}</td>
      </tr>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>UserEye dashboard</title>
<style>
  body { font: 15px system-ui, sans-serif; max-width: 1100px; margin: 32px auto; padding: 0 20px; color: #101828; }
  h1 { font-size: 22px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 10px; border: 1px solid #d0d5dd; text-align: left; vertical-align: top; }
  th { background: #f2f4f7; }
  code { background: #f2f4f7; padding: 1px 5px; border-radius: 4px; }
  .empty { padding: 16px; border: 1px dashed #d0d5dd; border-radius: 8px; }
</style>
<h1>UserEye dashboard</h1>
<p>Serving artifacts from <code>${escapeHTML(root)}</code> — read-only. Refresh to pick up new runs.</p>
${renderTrends(buildTrends(runs))}
${
  runs.length
    ? `<table>
<thead><tr><th>Run</th><th>Version</th><th>Score</th><th>Issues</th><th>Severity</th><th>Gates</th><th>Actionable</th><th>Artifacts</th><th>Finished</th><th>Evidence</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
    : `<div class="empty">No <code>result.json</code> found in this directory or its immediate subdirectories.<br>Point the dashboard at an artifacts folder, for example <code>usereye dashboard artifacts/usereye</code>.</div>`
}
</html>
`;
}

function parseDashboardArgv(argv = []) {
  const options = { dir: null, port: 4174, host: '127.0.0.1' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--port') {
      options.port = Number(argv[++index]);
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new Error('--port must be an integer between 0 and 65535.');
      }
    } else if (token === '--host') {
      options.host = String(argv[++index] || '');
    } else if (token === '--help' || token === '-h') {
      options.help = true;
    } else if (!token.startsWith('--') && !options.dir) {
      options.dir = token;
    } else {
      throw new Error(`Unknown dashboard option: ${token}`);
    }
  }
  return options;
}

const DASHBOARD_USAGE = `Usage: usereye dashboard [artifacts-dir] [options]

  [artifacts-dir]   Directory containing UserEye runs (default: artifacts/usereye)
  --port <n>        Port to listen on (default 4174; 0 picks a free port)
  --host <addr>     Address to bind (default 127.0.0.1)

Serves a read-only index of every run (result.json) found in the directory and
its immediate subdirectories, linking report.html, SARIF and raw JSON evidence.
`;

/**
 * Start the artifact dashboard.
 * @param {string[]} argv CLI arguments (after `usereye dashboard`).
 * @returns {Promise<{url: string, port: number, root: string, close: () => Promise<void>, untilClosed: () => Promise<void>}>}
 */
async function runDashboard(argv = process.argv.slice(2)) {
  const options = parseDashboardArgv(argv);
  if (options.help) {
    console.log(DASHBOARD_USAGE);
    return { url: '', port: 0, root: '', help: true, close: async () => {}, untilClosed: async () => {} };
  }
  const root = path.resolve(options.dir || path.join('artifacts', 'usereye'));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Dashboard directory not found: ${root}`);
  }
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://dashboard');
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const body = renderIndex(root, discoverRuns(root));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(body);
        return;
      }
      const requested = decodeURIComponent(url.pathname);
      const filePath = path.join(root, requested);
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' }).end(`Dashboard error: ${error.message}`);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });
  const port = server.address().port;
  let closed = false;
  const closePromise = new Promise(resolve => {
    server.once('close', () => {
      closed = true;
      resolve();
    });
  });
  return {
    url: `http://${options.host === '0.0.0.0' ? '127.0.0.1' : options.host}:${port}/`,
    port,
    root,
    closed: () => closed,
    close: () =>
      new Promise(resolve => {
        if (closed) {
          resolve();
          return;
        }
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
    untilClosed: () => closePromise,
  };
}

async function main() {
  try {
    await runDashboard();
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  DASHBOARD_USAGE,
  buildTrends,
  discoverRuns,
  parseDashboardArgv,
  renderIndex,
  runDashboard,
  sparkline,
};
