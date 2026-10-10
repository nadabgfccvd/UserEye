#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const fixture = process.argv[2] || 'static';
const root = path.join(__dirname, 'fixtures', fixture);
if (!fs.existsSync(root)) throw new Error(`Unknown fixture: ${fixture}`);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};
const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://fixture').pathname);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\//, '');
  let file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root))) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  response.writeHead(200, {
    'content-type': types[path.extname(file)] || 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(fs.readFileSync(file));
});
server.listen(4173, '0.0.0.0', () => console.log(`Fixture ${fixture}: http://127.0.0.1:4173`));
