#!/usr/bin/env node
'use strict';

/**
 * Documentation-rot gate.
 *
 * Three independent checks, all aimed at one failure mode: a document that makes a
 * claim the code no longer honours.
 *
 *   1. Fenced ```js / ```ts blocks must parse (roadmap item 2.3) — JS with
 *      `node --check`, TS with `tsc --noEmit` when typescript is installed.
 *
 *   2. (R1) Test counts written anywhere in the CURRENT docs must equal the
 *      authoritative `**Tests:**` line in CURRENT.md. `pack:delivery` refreshes that
 *      header from a real run, but only that header: a count typed into a sentence or
 *      a code comment escaped it, so DELIVERY.md shipped `# 246 tests` while its own
 *      line 5 said 280. Historical documents (docs/audits/, docs/history/, HISTORY.md)
 *      are deliberately out of scope — they are records of past runs and must keep
 *      quoting the numbers they were written with.
 *
 *   3. (R2) A command must target a server the surrounding document actually starts.
 *      DELIVERY.md §4 started `live-server.js` on :4200 and then told the reader to run
 *      `probe-site.js`, which defaults to :3000 — the block died with
 *      ERR_CONNECTION_REFUSED for anyone who pasted it. Ports are read from the harness
 *      sources at run time, never hardcoded here, so changing a default moves the gate
 *      with it instead of rotting alongside the docs.
 *
 * Checks 2 and 3 need the delivery bundle (CURRENT.md + demo/). In a standalone package
 * checkout they SKIP with a reason rather than passing silently.
 *
 * Usage: node scripts/check-readme-examples.js [--root <deliveryRoot>] [file.md ...]
 *   With explicit files, only check 1 runs, over exactly those files.
 *   --root points checks 2 and 3 at a bundle other than the one beside this package.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

// Fence languages treated as "commands a reader will paste".
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'console', 'text', '']);

// Harness servers whose ports define what a documented workflow has listening.
// The dashboard is deliberately absent: it is a viewer, never a run target.
const HARNESS_SERVERS = new Set(['live-server.js', 'serve.js', 'verify-server.js', 'results-server.js']);
const PROBE_SCRIPTS = new Set(['probe-site.js', 'probe-zoom.js']);

function extractBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence && !current) {
      current = { language: fence[1].toLowerCase(), startLine: index + 1, lines: [] };
      continue;
    }
    if (/^```\s*$/.test(line) && current) {
      blocks.push(current);
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// 1. fenced code blocks must parse
// ---------------------------------------------------------------------------

function checkFile(filePath) {
  const markdown = fs.readFileSync(filePath, 'utf8');
  const blocks = extractBlocks(markdown).filter(block =>
    ['js', 'javascript', 'ts', 'typescript', 'mjs', 'cjs'].includes(block.language),
  );
  const failures = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-readme-'));
  blocks.forEach((block, blockIndex) => {
    const isTs = block.language.startsWith('ts');
    const extension = isTs ? '.ts' : '.js';
    const tmpFile = path.join(tmpDir, `block-${blockIndex}${extension}`);
    fs.writeFileSync(tmpFile, `${block.lines.join('\n')}\n`);
    if (isTs) {
      const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
      if (!fs.existsSync(tsc)) {
        return; // typescript not installed; JS syntax checking still applies to js blocks
      }
      const run = spawnSync(
        tsc,
        ['--noEmit', '--skipLibCheck', '--target', 'es2022', '--module', 'commonjs', tmpFile],
        { encoding: 'utf8' },
      );
      if (run.status !== 0) {
        failures.push({
          filePath,
          startLine: block.startLine,
          language: block.language,
          output: run.stdout || run.stderr,
        });
      }
      return;
    }
    const run = spawnSync(process.execPath, ['--check', tmpFile], { encoding: 'utf8' });
    if (run.status !== 0) {
      failures.push({
        filePath,
        startLine: block.startLine,
        language: block.language,
        output: run.stderr || run.stdout,
      });
    }
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { total: blocks.length, failures };
}

// ---------------------------------------------------------------------------
// delivery-root discovery — checks 2 and 3 only apply inside a bundle
// ---------------------------------------------------------------------------

function detectDeliveryRoot(explicit) {
  const candidate = explicit ? path.resolve(explicit) : path.resolve(root, '..');
  const hasDocs = fs.existsSync(path.join(candidate, 'CURRENT.md'));
  const hasDemo = fs.existsSync(path.join(candidate, 'demo'));
  const hasPackage = fs.existsSync(path.join(candidate, 'UserEye', 'package.json'));
  return hasDocs && hasDemo && hasPackage ? candidate : null;
}

/** The docs that claim to describe the CURRENT release. Histories are excluded. */
function currentDocs(deliveryRoot) {
  return [
    path.join(deliveryRoot, 'CURRENT.md'),
    path.join(deliveryRoot, 'DELIVERY.md'),
    path.join(deliveryRoot, 'README.md'),
    path.join(deliveryRoot, 'UserEye', 'README.md'),
  ].filter(file => fs.existsSync(file));
}

// ---------------------------------------------------------------------------
// 2. (R1) every documented test count agrees with the authoritative header
// ---------------------------------------------------------------------------

/** `**Tests:** 282 total · 282 pass · …` -> 282 */
function authoritativeTestTotal(deliveryRoot) {
  const file = path.join(deliveryRoot, 'CURRENT.md');
  if (!fs.existsSync(file)) return null;
  const match = fs.readFileSync(file, 'utf8').match(/^\*\*Tests:\*\*\s*(\d+)\s+total\b/m);
  return match ? Number(match[1]) : null;
}

function checkTestCounts(docs, total, failures) {
  let claims = 0;
  for (const file of docs) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      // "280 tests" in prose or in a code comment, and "280 total ·" in a summary line.
      const patterns = [/(\d+)\s+tests\b/g, /(\d+)\s+total\s*·/g];
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          claims += 1;
          const claimed = Number(match[1]);
          if (claimed !== total) {
            failures.push({
              filePath: file,
              startLine: index + 1,
              language: 'test-count',
              output:
                `documents "${match[0].trim()}" but CURRENT.md's **Tests:** line says ${total} total.\n` +
                `  A count in prose is not refreshed by anything except this gate — update the sentence,\n` +
                `  or let \`npm run pack:delivery\` rewrite it from a real run.`,
            });
          }
        }
      }
    });
  }
  return claims;
}

// ---------------------------------------------------------------------------
// 3. (R2) documented commands must target a server the docs actually start
// ---------------------------------------------------------------------------

function collectHarnessSources(demoDir) {
  const sources = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(absolute);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      if (HARNESS_SERVERS.has(entry.name) || PROBE_SCRIPTS.has(entry.name)) {
        sources.set(entry.name, fs.readFileSync(absolute, 'utf8'));
      }
    }
  };
  walk(demoDir);
  return sources;
}

/** Read a server's default port from its own source, so the gate follows the code. */
function defaultPortOf(source) {
  const env = source.match(/process\.env\.PORT\s*\|\|\s*(\d+)/);
  if (env) return Number(env[1]);
  const option = source.match(/\bport:\s*(\d+)/);
  return option ? Number(option[1]) : null;
}

/** Read a probe's default base URL from its own source. */
function defaultBaseOf(source) {
  const match = source.match(/\|\|\s*'(https?:\/\/[^']+)'/);
  return match ? match[1] : null;
}

function portOfUrl(url) {
  const match = String(url).match(/^https?:\/\/[A-Za-z0-9._-]+:(\d+)/);
  return match ? Number(match[1]) : null;
}

function buildRegistry(demoDir) {
  const sources = collectHarnessSources(demoDir);
  const servers = new Map();
  const probes = new Map();
  for (const [name, source] of sources) {
    if (HARNESS_SERVERS.has(name)) servers.set(name, defaultPortOf(source));
    if (PROBE_SCRIPTS.has(name)) probes.set(name, portOfUrl(defaultBaseOf(source)));
  }
  return { servers, probes };
}

const SERVER_RE = /(?:PORT=(\d+)\s+)?\bnode\s+((?:[^\s;|&]*[/\\])?([A-Za-z0-9._-]+\.js))/g;
const PROBE_RE =
  /(?:VELA_BASE=(\S+)\s+)?\bnode\s+(?:[^\s;|&]*[/\\])?(probe-(?:site|zoom)\.js)(?:\s+([^\s;|&#]+))?/g;
const URL_RE = /\bhttps?:\/\/[A-Za-z0-9._-]+:(\d+)/g;

function checkPortCoherence(docs, registry, failures) {
  let targets = 0;
  for (const file of docs) {
    const markdown = fs.readFileSync(file, 'utf8');
    // Servers started earlier in a document stay up for the blocks that follow:
    // real workflows are written as "terminal 1 … terminal 2".
    const started = new Set();
    for (const block of extractBlocks(markdown)) {
      if (!SHELL_LANGUAGES.has(block.language)) continue;

      // pass 1 — what does this block put on a port?
      for (const line of block.lines) {
        SERVER_RE.lastIndex = 0;
        let match;
        while ((match = SERVER_RE.exec(line)) !== null) {
          const [, explicitPort, , basename] = match;
          if (!HARNESS_SERVERS.has(basename)) continue;
          const flag = line.match(/--port\s+(\d+)/);
          const port = Number(explicitPort) || (flag && Number(flag[1])) || registry.servers.get(basename);
          if (port) started.add(port);
        }
      }
      if (!started.size) continue;

      // pass 2 — does everything this block talks to actually exist?
      block.lines.forEach((line, index) => {
        const lineNumber = block.startLine + 1 + index;
        const complain = (what, port) => {
          targets += 1;
          if (started.has(port)) return;
          failures.push({
            filePath: file,
            startLine: lineNumber,
            language: 'port',
            output:
              `${what} targets :${port}, but this document only starts ${[...started]
                .sort()
                .map(value => `:${value}`)
                .join(', ')}.\n` +
              `  Pasting this block gives the reader ERR_CONNECTION_REFUSED. Start that server,\n` +
              `  or point the command at one that is running (probes accept VELA_BASE=…).`,
          });
        };

        PROBE_RE.lastIndex = 0;
        let probe;
        while ((probe = PROBE_RE.exec(line)) !== null) {
          const [, envBase, basename, positional] = probe;
          const explicit = envBase || (positional && /^https?:\/\//.test(positional) ? positional : null);
          const port = explicit ? portOfUrl(explicit) : registry.probes.get(basename);
          if (port) complain(`${basename} (default :${registry.probes.get(basename)})`, port);
        }

        // Any other explicit host:port a reader is told to hit.
        URL_RE.lastIndex = 0;
        let url;
        while ((url = URL_RE.exec(line)) !== null) complain('a documented URL', Number(url[1]));
      });
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------

function parseArgv(argv) {
  const out = { root: null, files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      out.root = argv[index + 1];
      index += 1;
      continue;
    }
    out.files.push(path.resolve(token));
  }
  return out;
}

function main() {
  const options = parseArgv(process.argv.slice(2));
  const deliveryRoot = detectDeliveryRoot(options.root);
  if (options.root && !deliveryRoot) {
    console.error(`readme-check: FAIL — --root is not a delivery bundle: ${options.root}`);
    process.exit(1);
  }

  const bundleReadme = deliveryRoot && path.join(deliveryRoot, 'UserEye', 'README.md');
  const defaultReadme =
    bundleReadme && fs.existsSync(bundleReadme) ? bundleReadme : path.join(root, 'README.md');
  const targets = options.files.length ? options.files : [defaultReadme];

  let total = 0;
  const failures = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      console.error(`readme-check: FAIL — file not found: ${target}`);
      process.exit(1);
    }
    const result = checkFile(target);
    total += result.total;
    failures.push(...result.failures);
  }

  const report = () => {
    if (!failures.length) return;
    for (const failure of failures) {
      console.error(
        `readme-check: FAIL — ${path.relative(root, failure.filePath)}:${failure.startLine} (${failure.language})\n${failure.output}`,
      );
    }
    process.exit(1);
  };

  // Explicit files mean "just parse these" — the historical contract.
  if (options.files.length) {
    report();
    console.log(`readme-check: OK — ${total} code block(s) parse cleanly.`);
    return;
  }

  if (!deliveryRoot) {
    report();
    console.log(`readme-check: OK — ${total} code block(s) parse cleanly.`);
    console.log('readme-check: note — no delivery bundle beside the package; doc-consistency gates skipped.');
    return;
  }

  const docs = currentDocs(deliveryRoot);
  const testTotal = authoritativeTestTotal(deliveryRoot);
  let claims = 0;
  if (testTotal === null) {
    console.log('readme-check: note — CURRENT.md has no **Tests:** line; test-count gate skipped.');
  } else {
    claims = checkTestCounts(docs, testTotal, failures);
  }

  const registry = buildRegistry(path.join(deliveryRoot, 'demo'));
  const documentedTargets = checkPortCoherence(docs, registry, failures);

  report();
  console.log(`readme-check: OK — ${total} code block(s) parse cleanly.`);
  if (testTotal !== null) {
    console.log(
      `readme-check: OK — ${claims} documented test count(s) agree with CURRENT.md (${testTotal} total).`,
    );
  }
  console.log(
    `readme-check: OK — ${documentedTargets} documented command target(s) match the servers the docs start.`,
  );
}

main();
