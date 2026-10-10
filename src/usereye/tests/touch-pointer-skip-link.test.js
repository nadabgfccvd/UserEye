'use strict';

/**
 * Regression for the touch-pointer off-screen-target false failure
 * (2026-09-06).
 *
 * A correctly-authored skip link sits above the viewport (top:-60px) and is the
 * first focusable control in the DOM. Playwright still reports it as "visible"
 * (it has a bounding box), so the old touchPointer() picked it as the tap
 * target; elementFromPoint() at its center returns null and the protocol died
 * with a false failure: "Touch target is occluded by null".
 *
 * The fixed protocol skips controls whose center lies outside the viewport and
 * taps the first control a real user could actually touch.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { runAuto } = require('../usereye-auto');
const playwright = require('playwright');

function browserReady() {
  if (process.env.USEREYE_SKIP_BROWSER_TESTS === '1') return false;
  try {
    return fs.existsSync(playwright.chromium.executablePath());
  } catch {
    return false;
  }
}
const skipBrowserRun = {
  skip: !browserReady() && 'chromium not installed (npx playwright install chromium)',
};

test(
  'touch-pointer: an off-viewport skip link is not reported as an occluded target',
  skipBrowserRun,
  async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-skiplink-'));
    const output = await runAuto([
      '--project',
      path.join(__dirname, 'fixtures', 'skip-link'),
      '--mode',
      'quick',
      '--out',
      out,
      '--no-video',
    ]);

    assert.equal(output.exitCode, 0, 'a page with a parked skip link still runs clean');
    const resultsPath = path.join(out, 'protocol-results.json');
    assert.ok(fs.existsSync(resultsPath), 'protocol-results.json is written');
    const { protocols } = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    const touch = protocols.find(item => item.id === 'touch-pointer');
    assert.ok(touch, 'touch-pointer ran');
    assert.equal(touch.status, 'passed', `touch-pointer must pass, got: ${touch.error || touch.status}`);
    assert.match(
      String(touch.details?.target || ''),
      /Tap me/,
      'the protocol taps the first in-viewport control, not the off-screen skip link',
    );
  },
);
