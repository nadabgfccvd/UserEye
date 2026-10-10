'use strict';

/**
 * Performance benchmark (roadmap item 5.5): a quick-mode adaptive exploration
 * of the static fixture must not regress more than +50% against the recorded
 * baseline. Re-record deliberately with:
 *
 *   USEREYE_UPDATE_BASELINE=1 node --test tests/benchmark.test.js
 *
 * The first run (no baseline file) records and passes. Machines differ, so the
 * baseline stores the environment it was measured on; CI keeps its own copy.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');
const playwright = require('playwright');

const { UserEye } = require('../user-eye');
const { AdaptiveExplorer, mergeBudget } = require('../adaptive-explorer');
const pkg = require('../package.json');

const BASELINE_PATH = path.join(__dirname, 'benchmarks', 'quick-baseline.json');
const REGRESSION_TOLERANCE = 1.5; // fail above +50%

function browserReady() {
  if (process.env.USEREYE_SKIP_BROWSER_TESTS === '1') return false;
  try {
    return fs.existsSync(playwright.chromium.executablePath());
  } catch {
    return false;
  }
}
const skipBrowser = { skip: !browserReady() && 'chromium not installed (npx playwright install chromium)' };

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'static');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

let server = null;
let base = '';

before(async () => {
  if (!browserReady()) return;
  server = http.createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url, 'http://fixture').pathname);
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\//, '');
    let file = path.resolve(FIXTURE_ROOT, relative);
    if (!file.startsWith(path.resolve(FIXTURE_ROOT))) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(FIXTURE_ROOT, 'index.html');
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

async function measureQuickRun() {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-benchmark-'));
  const eye = new UserEye({
    artifactDir,
    recordVideo: false,
    autoObserve: 'failure',
    visualAuditIssues: false,
    retries: 1,
  });
  await eye.launch();
  eye.page.setDefaultTimeout(5000); // mirrors the quick-mode wiring in usereye-auto.js
  await eye.goto(base);
  const explorer = new AdaptiveExplorer(eye, {
    mode: 'quick',
    baseURL: base,
    budget: mergeBudget('quick'),
    axe: true,
    axeSourcePath: require.resolve('axe-core/axe.min.js'),
    patternPack: ['en'],
  });
  const startedAt = Date.now();
  const result = await explorer.explore();
  const durationMs = Date.now() - startedAt;
  await eye.close();
  fs.rmSync(artifactDir, { recursive: true, force: true });
  return { durationMs, result };
}

test(
  'benchmark: quick-mode exploration of the static fixture stays within +50% of baseline',
  skipBrowser,
  async () => {
    const { durationMs, result } = await measureQuickRun();
    assert.ok(result.states.length >= 1, 'the exploration must actually visit states');
    assert.equal(result.mode, 'quick');

    const update = process.env.USEREYE_UPDATE_BASELINE === '1';
    const hasBaseline = fs.existsSync(BASELINE_PATH);

    if (!hasBaseline || update) {
      fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
      fs.writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify(
          {
            durationMs,
            states: result.states.length,
            actions: result.actions.length,
            measuredAt: new Date().toISOString(),
            node: process.version,
            platform: `${process.platform} ${process.arch}`,
            usereye: pkg.version,
            note: 'quick-mode adaptive exploration of tests/fixtures/static, chromium headless, video off, axe on',
          },
          null,
          2,
        )}\n`,
      );
      console.log(`# benchmark baseline ${update ? 'updated' : 'recorded'}: ${durationMs} ms`);
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const ceiling = baseline.durationMs * REGRESSION_TOLERANCE;
    assert.ok(
      durationMs <= ceiling,
      `quick-mode run took ${durationMs} ms — more than +50% over the ${baseline.durationMs} ms baseline ` +
        `(ceiling ${Math.round(ceiling)} ms, measured on ${baseline.platform} / node ${baseline.node}). ` +
        'If the change is deliberate, re-record with USEREYE_UPDATE_BASELINE=1.',
    );
    console.log(
      `# benchmark: ${durationMs} ms (baseline ${baseline.durationMs} ms, ceiling ${Math.round(ceiling)} ms)`,
    );
  },
);
