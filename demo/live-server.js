#!/usr/bin/env node
'use strict';

/**
 * live-server.js — demo + docs server for the UserEye delivery bundle.
 * Lives in demo/ (one level under the delivery root), so docs/ is '..'/docs.
 * NOT part of the UserEye npm package.
 *
 *   /            -> index
 *   /vela/…      -> Vela Analytics demo site (target for live runs)
 *   /CURRENT.md  -> delivery root docs (CURRENT.md, DELIVERY.md, README.md)
 *   /docs/…      -> docs/ (audits/, evidence/, history/, roadmaps)
 *
 * Read-only static serving with a traversal guard; directory listings enabled.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4200);
// Delivery root (one level up from demo/) and its docs/ subdirectory. Both are
// served: CURRENT.md / DELIVERY.md / README.md live at the root, archived audits
// under docs/audits/.
const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const ROOT_DOC = /^\/(CURRENT\.md|DELIVERY\.md|README\.md|DELIVERY-MANIFEST\.json)$/;
const VELA = path.join(__dirname, 'vela-site', 'site');

const CLEAN_URL_MAP = {
  '/blog/scaling-observability-to-10-trillion-events': 'blog-post.html',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.sarif': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

// FIX (2026-09-06): redirect helper for root-absolute demo links (see below).
function sendRedirect(res, location) {
  res.writeHead(301, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function list(res, dir, base) {
  const items = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const rows = items
    .map(it => {
      const href = base.replace(/\/$/, '') + '/' + it.name + (it.isDirectory() ? '/' : '');
      return `<li><a href="${href}">${it.name}${it.isDirectory() ? '/' : ''}</a></li>`;
    })
    .join('\n');
  send(
    res,
    200,
    `<!doctype html><meta charset="utf-8"><title>Index of ${base}</title>
     <body style="font-family:system-ui;max-width:820px;margin:36px auto;line-height:1.5">
     <h2>Index of ${base}</h2><ul>${rows}</ul>
     <p><a href="/">← home</a></p></body>`,
  );
}

function serve(res, root, rel, base) {
  const safe = path.normalize(rel).replace(/^([./\\])+/, '');
  const full = path.join(root, safe);
  if (!full.startsWith(root)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(full)) return send(res, 404, 'Not found');
  if (fs.statSync(full).isDirectory()) {
    const idx = path.join(full, 'index.html');
    if (fs.existsSync(idx)) return send(res, 200, fs.readFileSync(idx), MIME['.html']);
    return list(res, full, base);
  }
  send(res, 200, fs.readFileSync(full), MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
}

const VERSION = (() => {
  try {
    return require(path.join(__dirname, '..', 'UserEye', 'package.json')).version;
  } catch {
    return '(unknown)';
  }
})();

const HOME = `<!doctype html><meta charset="utf-8">
<title>UserEye ${VERSION} — delivery bundle</title>
<body style="font-family:system-ui;max-width:880px;margin:44px auto;line-height:1.6">
<h1>UserEye ${VERSION} — delivery bundle</h1>
<p>App completo (código, testes, CI, scripts) + site demo Vela + docs.
Sem dumps de evidência (screenshots, traces, webm, JSON de runs).</p>
<p><strong>Comece aqui:</strong> <a href="/CURRENT.md">CURRENT.md</a> ·
<a href="/DELIVERY.md">DELIVERY.md</a></p>
<h2>Site demo</h2>
<ul>
  <li><a href="/vela/">/vela/</a> — Vela Analytics (9 páginas, modais, tabs, charts, forms). Alvo para <code>usereye auto</code> / <code>observe</code>.</li>
</ul>
<h2>Docs</h2>
<ul>
  <li><a href="/CURRENT.md">CURRENT.md</a> — versão atual, nota e ponto de partida</li>
  <li><a href="/DELIVERY.md">DELIVERY.md</a> — o que tem no zip e como rodar</li>
  <li><a href="/docs/audits/">docs/audits/</a> — auditorias históricas (7.0.0 → 7.4.0)</li>
</ul>
<p style="color:#666">Server: <code>live-server.js</code> (não faz parte do pacote npm).</p>
</body>`;

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') return send(res, 200, HOME);
    // FIX (7.4.1, roadmap Phase G): the mount is exactly /vela or /vela/... .
    // The old `p.startsWith('/vela')` test also matched /velapricing, /velaabout,
    // /velablog — any path beginning with those five letters was silently served
    // out of the demo site. Harmless, but wrong, and this file was already open.
    if (p === '/vela' || p.startsWith('/vela/')) {
      let rel = p.slice('/vela'.length).replace(/^\/+/, '');
      if (CLEAN_URL_MAP['/' + rel.replace(/\/$/, '')]) rel = CLEAN_URL_MAP['/' + rel.replace(/\/$/, '')];
      const key = rel.replace(/\/+$/, '');
      const abs = path.join(VELA, path.normalize(key).replace(/^([./\\])+/, ''));
      if (key && !path.extname(abs) && !fs.existsSync(abs) && fs.existsSync(abs + '.html')) rel = key + '.html';
      return serve(res, VELA, rel, '/vela/');
    }
    if (ROOT_DOC.test(p)) return serve(res, ROOT, p.slice(1), '/');
    if (p.startsWith('/docs')) return serve(res, DOCS, p.slice('/docs'.length), '/docs/');

    // FIX (2026-09-06): the Vela site is authored with root-absolute links
    // (href="/product", src="/assets/app.js" — it was built to be mounted at "/"
    // by vela-site/serve.js). Mounted under /vela/ those links used to 404 at the
    // server root, leaving the demo unstyled with dead navigation. If a root-level
    // path maps to a real file (or clean URL) inside the Vela site, bounce it back
    // into the demo with a 301 (query string preserved). Everything else keeps the
    // original 404. `/` (delivery home) and `/docs/*` are NOT affected.
    const cleanTarget = CLEAN_URL_MAP[p];
    const velaTarget = path.join(VELA, path.normalize(p).replace(/^([./\\])+/, ''));
    if (
      cleanTarget ||
      (velaTarget.startsWith(VELA) && (fs.existsSync(velaTarget) || fs.existsSync(velaTarget + '.html')))
    ) {
      return sendRedirect(res, '/vela' + p + url.search);
    }
    return send(res, 404, 'Not found');
  })
  .listen(PORT, '0.0.0.0', () => console.log(`live-server on :${PORT}`));
