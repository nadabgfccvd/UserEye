'use strict';

/**
 * Regression gates for the three review modes (`perf-seo`, `flows`, `a11y-strict`).
 *
 * Context: these modes shipped in 7.5.1 with no automated coverage at all — no test
 * file referenced `review-modes/`, so the four runner modules never loaded during the
 * suite and never appeared in the coverage report. Two defects reached the box as a
 * direct result, and both are gated here.
 *
 *   BUG 1 — the target URL's path was silently discarded. `perf-seo-runner.js` and
 *   `strict-a11y-runner.js` defaulted their URL list to `['/']`, and
 *   `absoluteUrl(baseURL, '/')` resolves to the ORIGIN, so
 *   `--url http://host/vela/` audited `http://host/`. The reports looked entirely
 *   plausible while describing a page the user never asked for: perf-seo invented 6
 *   SEO failures (score 50%) belonging to a placeholder index, and a11y-strict ran
 *   2 checks instead of 73, hiding 26 real findings. Wrong in both directions.
 *
 *   BUG 2 — the review modes printed nothing at all. stdout and stderr were both
 *   empty and the process exited 1, so a gate failure was indistinguishable from a
 *   crash and the exit code came with no stated reason.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

/**
 * Run the CLI asynchronously.
 *
 * `spawnSync` cannot be used by the tests below: they serve the target from an
 * in-process http server, and a synchronous spawn blocks this process' event loop,
 * so the server never answers and the run dies on "URL did not respond".
 */
function runCli(args, timeoutMs = 180_000) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(root, 'bin', 'usereye.js'), ...args], {
      cwd: root,
      encoding: 'utf8',
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('close', status => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function browserInstalled() {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/**
 * Two pages that cannot be confused: the ORIGIN root is deliberately poor (no lang,
 * no viewport, no h1, empty title) while `/deep/` is well-formed. Auditing the wrong
 * one is therefore visible in the results, not just in a URL string.
 */
function startTwoPageServer() {
  const rootPage = '<!doctype html><html><head><title></title></head><body><p>origin root</p></body></html>';
  const deepPage = [
    '<!doctype html><html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Deep page — the requested target</title>',
    '<meta name="description" content="The page the user actually asked for.">',
    '</head><body><main><h1>Deep page</h1><p>Requested target.</p></main></body></html>',
  ].join('');

  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    const body = pathname.startsWith('/deep') ? deepPage : rootPage;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(body);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------------
// BUG 1 — behavioural: the audited URL keeps the path it was given
// ---------------------------------------------------------------------------

test(
  'review modes: perf-seo audits the requested URL, not the origin root',
  { skip: !browserInstalled() && 'chromium not installed (npx playwright install chromium)' },
  async t => {
    const { server, port } = await startTwoPageServer();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-rm-perf-'));
    t.after(() => {
      server.close();
      fs.rmSync(out, { recursive: true, force: true });
    });

    const target = `http://127.0.0.1:${port}/deep/`;
    const run = await runCli(['auto', '--url', target, '--review-mode', 'perf-seo', '--out', out]);

    const result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
    const network = JSON.parse(fs.readFileSync(path.join(out, 'network-summary.json'), 'utf8'));
    const documents = network.resources.filter(resource => resource.type === 'document');

    assert.ok(documents.length > 0, 'the run should have fetched a document');
    for (const document of documents) {
      assert.match(
        document.url,
        /\/deep\//,
        `audited ${document.url} instead of the requested ${target} — the URL path was discarded`,
      );
    }

    // The well-formed page must grade well; grading the bare origin produced the
    // title/viewport/h1/lang failures that made this bug look like a real finding.
    const failed = (result.seo?.audits || []).filter(audit => audit.passed === false).map(a => a.id);
    for (const id of ['seo-title', 'seo-viewport', 'seo-h1', 'seo-lang']) {
      assert.ok(!failed.includes(id), `${id} failed — that is the origin root's defect, not /deep/'s`);
    }
    assert.equal(
      run.status,
      0,
      `a clean well-formed page should pass the gates:\n${run.stdout}${run.stderr}`,
    );
  },
);

test(
  'review modes: a11y-strict audits the requested URL, not the origin root',
  { skip: !browserInstalled() && 'chromium not installed (npx playwright install chromium)' },
  async t => {
    const { server, port } = await startTwoPageServer();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-rm-a11y-'));
    t.after(() => {
      server.close();
      fs.rmSync(out, { recursive: true, force: true });
    });

    const target = `http://127.0.0.1:${port}/deep/`;
    await runCli(['auto', '--url', target, '--review-mode', 'a11y-strict', '--out', out]);

    const audit = JSON.parse(fs.readFileSync(path.join(out, 'accessibility-strict.json'), 'utf8'));
    const serialized = JSON.stringify(audit);
    assert.match(serialized, /\/deep\//, 'the strict a11y audit must cover the requested path');
    assert.ok(
      !/"url":"http:\/\/127\.0\.0\.1:\d+\/"/.test(serialized),
      'the strict a11y audit must not silently fall back to the origin root',
    );
  },
);

// ---------------------------------------------------------------------------
// BUG 1 — source guard: neither runner may default back to the origin
// ---------------------------------------------------------------------------

test('review modes: no runner defaults its target list to the origin root', () => {
  for (const file of ['perf-seo-runner.js', 'strict-a11y-runner.js']) {
    const source = fs.readFileSync(path.join(root, 'review-modes', file), 'utf8');
    assert.ok(
      !/:\s*\['\/'\]\)\.map\(/.test(source),
      `${file} defaults its URL list to ['/'], which resolves to the origin and drops the requested path`,
    );
    assert.match(
      source,
      /:\s*\[baseURL\]\)\.map\(/,
      `${file} must fall back to the requested baseURL, not to the origin root`,
    );
  }
});

// ---------------------------------------------------------------------------
// BUG 2 — the dispatcher reports the outcome instead of exiting silently
// ---------------------------------------------------------------------------

test('review modes: the dispatcher prints a summary and explains a non-zero exit', () => {
  const { reportOutcome } = require('../review-modes');
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = chunk => {
    lines.push(String(chunk));
    return true;
  };
  try {
    reportOutcome(
      { reviewMode: 'a11y-strict', logLevel: 'info', logJson: false },
      {
        exitCode: 1,
        artifactDir: '/tmp/example-artifacts',
        result: {
          reviewMode: 'a11y-strict',
          requestedUrl: 'http://127.0.0.1:4200/vela/',
          summary: {
            steps: 1,
            passed: 0,
            failed: 1,
            warning: 0,
            checks: 73,
            issues: 28,
            severity: { major: 28 },
          },
          review: { passed: false, summary: { gates: 3 } },
        },
      },
    );
  } finally {
    process.stdout.write = original;
  }

  const output = lines.join('');
  assert.notEqual(output.trim(), '', 'a review-mode run must not be completely silent');
  assert.match(output, /review mode: a11y-strict/, 'the mode must be named');
  assert.match(output, /http:\/\/127\.0\.0\.1:4200\/vela\//, 'the audited target must be stated');
  assert.match(output, /Checks: 73 · findings: 28/, 'the headline counts must be shown');
  assert.match(output, /Review gates: FAIL/, 'the gate verdict must be shown');
  assert.match(output, /Exit 1 —/, 'a non-zero exit must state its reason');
  assert.match(output, /\/tmp\/example-artifacts/, 'the artifact location must be shown');
});

test('review modes: a passing run reports PASS and no exit-code explanation', () => {
  const { reportOutcome } = require('../review-modes');
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = chunk => {
    lines.push(String(chunk));
    return true;
  };
  try {
    reportOutcome(
      { reviewMode: 'perf-seo', logLevel: 'info', logJson: false },
      {
        exitCode: 0,
        artifactDir: '/tmp/example-artifacts',
        result: {
          reviewMode: 'perf-seo',
          requestedUrl: 'http://127.0.0.1:4200/vela/',
          summary: { steps: 1, passed: 1, failed: 0, warning: 0, checks: 16, issues: 0, severity: {} },
          review: { passed: true, summary: { gates: 0 } },
          seo: { score: 1 },
          performanceLab: { summary: { lcpMs: 118, fcpMs: 128, cls: 0 } },
        },
      },
    );
  } finally {
    process.stdout.write = original;
  }

  const output = lines.join('');
  assert.match(output, /Review gates: PASS/);
  assert.match(output, /SEO score: 100%/, 'the mode headline number must be surfaced');
  assert.match(output, /LCP 118 ms/, 'the performance headline must be surfaced');
  assert.ok(!/Exit 1/.test(output), 'a passing run must not print a failure explanation');
});

// ---------------------------------------------------------------------------
// dispatcher contract
// ---------------------------------------------------------------------------

test('review modes: the dispatcher rejects an unsupported mode', async () => {
  const { runReviewMode } = require('../review-modes');
  await assert.rejects(
    () => runReviewMode({ reviewMode: 'nope' }, [], {}),
    /Unsupported reviewMode dispatcher target: nope/,
  );
});

test('review modes: flows refuses to run without a flow file, with a usable message', async t => {
  const { server, port } = await startTwoPageServer();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-rm-flows-'));
  t.after(() => {
    server.close();
    fs.rmSync(out, { recursive: true, force: true });
  });

  const run = await runCli([
    'auto',
    '--url',
    `http://127.0.0.1:${port}/deep/`,
    '--review-mode',
    'flows',
    '--out',
    out,
  ]);
  assert.equal(run.status, 2, `a missing flow file is a usage error (exit 2):\n${run.stdout}${run.stderr}`);
  assert.match(`${run.stdout}${run.stderr}`, /requires --flows <file> or flows\.files in config/);
});
