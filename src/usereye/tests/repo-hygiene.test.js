'use strict';

/**
 * Runs every distribution/verification gate as a test so `npm test` alone
 * enforces the roadmap's CI contract (items 1.4, 2.2, 2.3, 3.2, 3.4, 5.2).
 */

const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function runScript(relativePath, options = {}) {
  const run = spawnSync(process.execPath, [path.join(root, relativePath)], {
    cwd: root,
    encoding: 'utf8',
    timeout: options.timeout ?? 240_000,
    env: { ...process.env, ...(options.env || {}) },
  });
  return run;
}

test('hygiene: playwright version alignment gate passes (items 0.1/3.2)', () => {
  const run = runScript('scripts/check-playwright-version.js');
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /playwright-version-check: OK/);
});

test('hygiene: version single-source gate passes (items 0.8/5.2)', () => {
  const run = runScript('scripts/sync-version.js');
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /sync-version: OK/);
});

test('hygiene: public API surface is fully typed (items 0.2/2.1)', () => {
  const run = runScript('scripts/check-api-surface.js');
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /api-surface: OK/);
});

test('hygiene: README examples parse (item 2.3)', () => {
  const run = runScript('scripts/check-readme-examples.js');
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /readme-check: OK/);
});

test('hygiene: published package composition and size ceilings hold (items 3.4)', () => {
  const run = runScript('scripts/check-package.js');
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /package-check: OK/);
  assert.match(run.stdout, /verify-server|113|kB/, 'reports the packed size');
});

test('hygiene: the audit-only verify-server.js stays out of the package directory', () => {
  // It belongs to the delivery bundle, not the npm package (files: ["*.js"]).
  // Since 7.4.1 the delivery layout is flat and demo tooling lives in demo/.
  const fs = require('fs');
  assert.ok(!fs.existsSync(path.join(root, 'verify-server.js')));
  const deliveryRoot = path.join(root, '..');
  if (fs.existsSync(path.join(deliveryRoot, 'demo'))) {
    // Full delivery bundle: assert the canonical flat layout (Phase A2).
    assert.ok(
      fs.existsSync(path.join(deliveryRoot, 'demo', 'verify-server.js')),
      'demo/verify-server.js must ship with the delivery bundle',
    );
    assert.ok(!fs.existsSync(path.join(deliveryRoot, 'verify-server.js')));
  }
});

// ---------------------------------------------------------------------------
// Documentation-rot gates added 2026-09-06 (R1 test counts, R2 command targets).
// Both are exercised against synthetic bundles via --root so they can be shown to
// FAIL: a gate that cannot fail is not a gate.
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const os = require('node:os');

function docBundle({ current, delivery }) {
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-docgate-'));
  fs.mkdirSync(path.join(bundle, 'UserEye'), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'demo', 'probes'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'UserEye', 'package.json'), '{"name":"usereye"}\n');
  // The gate reads these defaults from source rather than hardcoding them.
  fs.writeFileSync(
    path.join(bundle, 'demo', 'live-server.js'),
    'const PORT = Number(process.env.PORT || 4200);\n',
  );
  fs.writeFileSync(
    path.join(bundle, 'demo', 'probes', 'probe-site.js'),
    "const BASE = (process.env.VELA_BASE || process.argv[2] || 'http://127.0.0.1:3000');\n",
  );
  fs.writeFileSync(path.join(bundle, 'CURRENT.md'), current);
  fs.writeFileSync(path.join(bundle, 'DELIVERY.md'), delivery);
  return bundle;
}

function runDocGate(bundle) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'check-readme-examples.js'), '--root', bundle],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
}

const HEADER = '# UserEye\n\n**Tests:** 282 total · 282 pass · 0 fail · 0 skipped\n';

test('hygiene: a test count typed into prose must match the **Tests:** header (R1)', () => {
  const stale = docBundle({
    current: HEADER,
    delivery: `${HEADER}\n\`\`\`bash\nnpm test   # 246 tests\n\`\`\`\n`,
  });
  const bad = runDocGate(stale);
  assert.equal(bad.status, 1, 'a stale count must fail the gate');
  assert.match(bad.stderr, /test-count/);
  assert.match(bad.stderr, /246 tests/);

  const fixed = docBundle({
    current: HEADER,
    delivery: `${HEADER}\n\`\`\`bash\nnpm test   # 282 tests\n\`\`\`\n`,
  });
  const good = runDocGate(fixed);
  assert.equal(good.status, 0, good.stderr || good.stdout);
  assert.match(good.stdout, /documented test count\(s\) agree/);
});

test('hygiene: a documented command must target a server the doc starts (R2)', () => {
  // live-server is started on :4200, then the reader is told to run a probe that
  // defaults to :3000 — exactly the block that shipped in 7.4.1's DELIVERY.md §4.
  const refused = docBundle({
    current: HEADER,
    delivery: `${HEADER}\n\`\`\`bash\nnode demo/live-server.js\nnode demo/probes/probe-site.js\n\`\`\`\n`,
  });
  const bad = runDocGate(refused);
  assert.equal(bad.status, 1, 'a command aimed at nothing must fail the gate');
  assert.match(bad.stderr, /port/);
  assert.match(bad.stderr, /:3000/);

  const pointed = docBundle({
    current: HEADER,
    delivery: `${HEADER}\n\`\`\`bash\nnode demo/live-server.js\nVELA_BASE=http://127.0.0.1:4200/vela node demo/probes/probe-site.js\n\`\`\`\n`,
  });
  const good = runDocGate(pointed);
  assert.equal(good.status, 0, good.stderr || good.stdout);
  assert.match(good.stdout, /command target\(s\) match/);
});

test('hygiene: the port gate follows the harness source instead of a hardcoded number', () => {
  // Move live-server to :8080 and the SAME doc that was green must now fail: the
  // gate must read the default from the code, not from a constant that can rot.
  const bundle = docBundle({
    current: HEADER,
    delivery: `${HEADER}\n\`\`\`bash\nnode demo/live-server.js\nnode bin/usereye.js auto --url http://127.0.0.1:4200/vela/\n\`\`\`\n`,
  });
  assert.equal(runDocGate(bundle).status, 0, 'baseline: doc and code agree on :4200');

  fs.writeFileSync(
    path.join(bundle, 'demo', 'live-server.js'),
    'const PORT = Number(process.env.PORT || 8080);\n',
  );
  const drifted = runDocGate(bundle);
  assert.equal(drifted.status, 1, 'changing the server default must break the stale doc');
  assert.match(drifted.stderr, /:8080/);
});
