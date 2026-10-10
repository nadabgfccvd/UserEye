#!/usr/bin/env node
'use strict';

/**
 * results-server.js — serves the UserEye test evidence for the Vela site.
 * NOT part of the UserEye package and not part of the Vela site itself.
 *
 *   /                  -> index with links to every run + report
 *   /standard/…        -> final standard-mode auto run (report.html, sarif, screenshots, video)
 *   /deep/…            -> deep-mode auto run
 *   /first-observe/…   -> the FIRST observe run (8 issues found, before site fixes)
 *   /second-observe/…  -> observe after the first round of fixes (1 issue)
 *   /docs/…            -> audit markdown files
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5000);

// Mounts are resolved relative to this file so the evidence server runs from
// any checkout layout (previous releases hard-coded one sandbox's abs paths).
const MOUNTS = {
  '/standard/': path.join(__dirname, '..', '..', 'vela-usereye-artifacts', 'vela-standard-final'),
  '/deep/': path.join(__dirname, '..', '..', 'vela-usereye-artifacts', 'vela-deep'),
  '/first-observe/': path.join(__dirname, '..', '..', 'UserEye', 'artifacts', 'vela-observe'),
  '/second-observe/': path.join(__dirname, '..', '..', 'UserEye', 'artifacts', 'vela-observe-2'),
  '/docs/': path.join(__dirname, '..', '..'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.sarif': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const HOME = `<!doctype html>
<meta charset="utf-8" />
<title>UserEye × Vela Analytics — test evidence</title>
<body style="font-family:system-ui,sans-serif;max-width:860px;margin:44px auto;line-height:1.6;padding:0 16px;color:#14212b">
<h1>UserEye 7.1.0 × Vela Analytics — live test evidence</h1>
<p>Every artifact below was produced by real runs of <code>bin/usereye.js</code> against the
Vela demo site (served live on port 3000). Nothing is hand-written except the index you are reading.</p>
<h2>Final runs</h2>
<ul>
  <li><b>Standard mode — Quality 100/100, gates PASS, exit 0</b><br />
      <a href="/standard/report.html">report.html</a> ·
      <a href="/standard/result.json">result.json</a> ·
      <a href="/standard/usereye.sarif">usereye.sarif</a> ·
      <a href="/standard/report.md">report.md</a> ·
      <a href="/standard/user-eye-session.webm">session video</a> ·
      <a href="/standard/">all files</a></li>
  <li><b>Deep mode — Quality 100/100, coverage 100%, gates PASS, exit 0</b><br />
      <a href="/deep/report.html">report.html</a> ·
      <a href="/deep/result.json">result.json</a> ·
      <a href="/deep/usereye.sarif">usereye.sarif</a> ·
      <a href="/deep/report.md">report.md</a> ·
      <a href="/deep/user-eye-session.webm">session video</a> ·
      <a href="/deep/">all files</a></li>
</ul>
<h2>The iteration story (before → after)</h2>
<ul>
  <li><a href="/first-observe/">First observe run</a> — 8 issues (1 blocker, 2 major) on the site as first built.</li>
  <li><a href="/second-observe/">Observe after fixes</a> — 1 issue (documented aria-hidden heuristic false positive).</li>
</ul>
<h2>Written analysis</h2>
<ul>
  <li><a href="/docs/">/docs/</a> — audit reports (VELA-TEST-REPORT.md and the delivery's own docs).</li>
</ul>
</body>`;

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function listDir(res, dir, urlBase) {
  if (!fs.existsSync(dir)) return send(res, 404, 'Not found');
  const items = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const rows = items
    .map((it) => {
      const href = urlBase.replace(/\/$/, '') + '/' + it.name + (it.isDirectory() ? '/' : '');
      const size = it.isDirectory() ? '' : ` <small style="color:#7a8a97">(${(fs.statSync(path.join(dir, it.name)).size / 1024).toFixed(0)} kB)</small>`;
      return `<li><a href="${href}">${it.name}${it.isDirectory() ? '/' : ''}</a>${size}</li>`;
    })
    .join('\n');
  send(res, 200, `<!doctype html><meta charset="utf-8"><title>Index of ${urlBase}</title>
    <body style="font-family:system-ui,sans-serif;max-width:780px;margin:40px auto;line-height:1.7">
    <h2>Index of ${urlBase}</h2><ul>${rows}</ul><p><a href="/">&larr; evidence home</a></p></body>`, 'text/html; charset=utf-8');
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://results').pathname);
  if (url === '/' || url === '') return send(res, 200, HOME, 'text/html; charset=utf-8');
  for (const [prefix, base] of Object.entries(MOUNTS)) {
    if (url.startsWith(prefix)) {
      const rel = path.normalize(url.slice(prefix.length)).replace(/^([./\\])+/, '');
      const full = path.join(base, rel);
      if (!full.startsWith(base)) return send(res, 403, 'Forbidden');
      if (!fs.existsSync(full)) return send(res, 404, 'Not found');
      if (fs.statSync(full).isDirectory()) {
        const idx = path.join(full, 'report.html');
        if (rel === '' && fs.existsSync(idx)) {
          return send(res, 200, fs.readFileSync(idx), MIME['.html']);
        }
        return listDir(res, full, url);
      }
      return send(res, 200, fs.readFileSync(full), MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
    }
  }
  return send(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => console.log(`Results server on http://0.0.0.0:${PORT}`));
