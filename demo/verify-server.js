#!/usr/bin/env node
'use strict';

/**
 * verify-server.js — audit-only static server. Lives in demo/ of the delivery
 * bundle, never inside the npm package (the package `files` whitelist only ships
 * *.js at the package root). Serves the delivery tree (docs, a live-run evidence
 * folder, the demo site) so an auditor can open generated reports without a web host.
 *
 * This is intentionally NOT part of the published package. `npm run verify`
 * (tests/repo-hygiene.test.js) asserts it stays outside the package directory.
 *
 * Usage:
 *   node verify-server.js [dir] [--port <n>]
 *
 * Examples:
 *   node demo/verify-server.js . --port 4200        # serve this delivery bundle
 *   node demo/verify-server.js UserEye/artifacts    # serve a previous run's evidence
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
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

function parseArgv(argv) {
  const out = { dir: '.', port: 4200 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--port') out.port = Number(argv[++index]);
    else if (!token.startsWith('--')) out.dir = token;
  }
  return out;
}

const opts = parseArgv(process.argv.slice(2));
const root = path.resolve(opts.dir);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`verify-server: directory not found: ${root}`);
  process.exit(2);
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url, 'http://verify');
    const requested = decodeURIComponent(url.pathname);
    const filePath = path.join(root, requested);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500).end(`verify-server error: ${error.message}`);
  }
});

server.listen(opts.port, () => {
  console.log(`verify-server: serving ${root} on http://127.0.0.1:${opts.port}`);
});
