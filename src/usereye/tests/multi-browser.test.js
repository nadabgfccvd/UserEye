'use strict';

/**
 * Multi-browser engine support (roadmap item 3.3): UserEye must run the same
 * lifecycle on chromium, firefox and webkit. Each engine is skipped
 * individually when its binary is not installed.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');
const playwright = require('playwright');
const { UserEye, SUPPORTED_BROWSERS } = require('../user-eye');

const PAGE = `<!doctype html>
<html lang="en"><head><title>Multi-browser fixture</title></head>
<body><main><h1>Cross-engine page</h1>
<button style="min-width:140px;min-height:44px" aria-label="Save">Save</button>
<p style="color:#bbb;background:#fff">low contrast sample</p>
</main></body></html>`;

let server = null;
let base = '';

before(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

function installed(name) {
  if (process.env.USEREYE_SKIP_BROWSER_TESTS === '1') return false;
  try {
    return fs.existsSync(playwright[name].executablePath());
  } catch {
    return false;
  }
}

test('multi-browser: SUPPORTED_BROWSERS covers the three Playwright engines', () => {
  assert.deepEqual([...SUPPORTED_BROWSERS], ['chromium', 'firefox', 'webkit']);
});

for (const name of ['chromium', 'firefox', 'webkit']) {
  test(
    `multi-browser: full observe lifecycle on ${name}`,
    { skip: !installed(name) && `${name} not installed (npx playwright install ${name})` },
    async t => {
      const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), `usereye-${name}-`));
      const eye = new UserEye({ artifactDir, browser: name, recordVideo: false });
      t.after(() => eye.close().catch(() => {}));
      await eye.launch();
      assert.ok(eye.browser.version(), `${name} reports a version`);
      await eye.goto(base);
      assert.equal(await eye.page.title(), 'Multi-browser fixture');
      const observation = await eye.observe(`${name} first impression`, { screenshot: true });
      assert.equal(observation.id, 'OBS-001');
      assert.ok(observation.counts.controls >= 1);
      assert.ok(
        observation.findings.some(finding => finding.code === 'insufficient-contrast'),
        `${name} detects the low-contrast paragraph`,
      );
      await eye.step(`${name} click`, async () => {
        await eye.click({ role: 'button', name: 'Save' }, 'Click save');
      });
      // Build the result AFTER close: tracing/video artifacts are only
      // recorded while the run is being finalized.
      await eye.close();
      const result = eye.result({ application: { name: `Multi-browser ${name}` } });
      assert.equal(result.schemaVersion, 4);
      assert.ok(result.summary.actions >= 2);
      assert.ok(fs.existsSync(path.join(artifactDir, 'actions.json')));
      assert.ok(result.artifacts.trace, 'trace artifact is recorded on close');
      assert.ok(fs.existsSync(path.join(artifactDir, result.artifacts.trace)), 'trace works on every engine');
    },
  );
}
