'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { runAuto } = require('../usereye-auto');
const { loadConfig } = require('../config');

const root = path.resolve(__dirname, '..');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Roadmap 7.5.0 item 3.1: `--url` without an explicit project must not analyse
// (or emit artefacts about) the *invocation directory*.
// ---------------------------------------------------------------------------

test('url-only scope: --url without --project skips cwd analysis and writes no project-analysis.json', async () => {
  const out = tmpDir('usereye-urlonly-');
  const printed = [];
  const originalLog = console.log;
  console.log = message => printed.push(String(message));
  let output;
  try {
    // cwd is the UserEye repo itself — the exact situation that used to print
    // "Project: usereye · stack: Node.js" and analyse the tool's own sources.
    output = await runAuto(['--url', 'http://127.0.0.1:59999/', '--dry-run', '--out', out], {
      cwd: root,
      env: {},
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(output.exitCode, 0);
  assert.ok(output.analysis.urlOnly, 'analysis is the URL-only placeholder');
  assert.equal(output.analysis.projectDir, null, 'no cwd leaked into the placeholder');
  assert.equal(output.analysis.stack, 'web');
  assert.ok(!fs.existsSync(path.join(out, 'project-analysis.json')), 'no project-analysis.json from the cwd');
  assert.ok(fs.existsSync(path.join(out, 'plan.json')), 'the dry-run plan still exists');
  const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'));
  assert.equal(plan.target.url, 'http://127.0.0.1:59999/');
  assert.ok(
    printed.some(line => /URL-only mode/.test(line)),
    `console announces URL-only mode, got: ${JSON.stringify(printed.slice(0, 3))}`,
  );
  assert.ok(
    !printed.some(line => /^Project: /.test(line)),
    `no "Project:" line from the cwd, got: ${JSON.stringify(printed)}`,
  );
});

test('url-only scope: --project still analyses and writes project-analysis.json', async () => {
  const out = tmpDir('usereye-project-scope-');
  const output = await runAuto(
    [
      '--project',
      path.join(__dirname, 'fixtures', 'static'),
      '--url',
      'http://127.0.0.1:59999/',
      '--dry-run',
      '--out',
      out,
    ],
    { cwd: root, env: {} },
  );
  assert.equal(output.exitCode, 0);
  assert.ok(fs.existsSync(path.join(out, 'project-analysis.json')), 'explicit project keeps the analysis');
  assert.ok(!output.analysis.urlOnly, 'an explicit project is never URL-only');
});

test('url-only scope: codeQuality: true in config opts back into analysis', async () => {
  const dir = tmpDir('usereye-urlonly-config-');
  const out = path.join(dir, 'out');
  fs.writeFileSync(
    path.join(dir, 'usereye.config.cjs'),
    `module.exports = { url: 'http://127.0.0.1:59999/', codeQuality: true, outDir: ${JSON.stringify(out)} };`,
  );
  const output = await runAuto(['--config', path.join(dir, 'usereye.config.cjs'), '--dry-run'], {
    cwd: dir,
    env: {},
  });
  assert.equal(output.exitCode, 0);
  assert.ok(!output.analysis.urlOnly, 'codeQuality: true implies a project scope');
});

test('url-only scope: loadConfig derives urlOnlyTarget only for pure URL runs', async () => {
  const config = await loadConfig({ argv: ['--url', 'http://127.0.0.1:59999/'], cwd: root, env: {} });
  assert.equal(config.urlOnlyTarget, true);
  const withProject = await loadConfig({
    argv: ['--url', 'http://127.0.0.1:59999/', '--project', path.join(__dirname, 'fixtures', 'static')],
    cwd: root,
    env: {},
  });
  assert.equal(withProject.urlOnlyTarget, false);
  const none = await loadConfig({ argv: [], cwd: root, env: {} });
  assert.equal(none.urlOnlyTarget, false, 'no URL → no url-only mode');
});
