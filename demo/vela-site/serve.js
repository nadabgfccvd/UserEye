#!/usr/bin/env node
'use strict';

/**
 * serve.js — tiny static server for the Vela Analytics demo site.
 *
 * Features:
 *  - clean URLs:  /product  ->  product.html
 *  - special map: /blog/scaling-observability-to-10-trillion-events -> blog-post.html
 *  - correct MIME types, 404 fallback page with real 404 status
 *  - basic hardening headers (no frame-blocking, so it embeds in previews)
 *
 * Usage:  node serve.js            (port 3000)
 *         PORT=8080 node serve.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'site');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const CLEAN_URL_MAP = {
  '/blog/scaling-observability-to-10-trillion-events': 'blog-post.html',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  res.end(body);
}

function resolveFile(urlPath) {
  if (CLEAN_URL_MAP[urlPath]) return path.join(ROOT, CLEAN_URL_MAP[urlPath]);
  let rel = urlPath.replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  let full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) return null; // traversal guard
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    full = path.join(full, 'index.html');
  }
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  // clean URL: /product -> product.html
  const asHtml = full + '.html';
  if (fs.existsSync(asHtml) && fs.statSync(asHtml).isFile()) return asHtml;
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://vela').pathname);
  const file = resolveFile(urlPath);
  if (!file) {
    const notFound = path.join(ROOT, '404.html');
    if (fs.existsSync(notFound)) {
      return send(res, 404, fs.readFileSync(notFound), MIME['.html']);
    }
    return send(res, 404, '404 — Not found');
  }
  const ext = path.extname(file).toLowerCase();
  send(res, 200, fs.readFileSync(file), MIME[ext] || 'application/octet-stream');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Vela Analytics site listening on http://0.0.0.0:${PORT}`);
});
