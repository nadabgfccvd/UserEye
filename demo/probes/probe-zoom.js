#!/usr/bin/env node
'use strict';
// Probe: reproduce UserEye's zoom-200 protocol (documentElement.style.zoom = 2)
// and list every element that overflows the viewport horizontally.
// FIX (2026-09-06): portable playwright resolution (was a hardcoded
// absolute path from the original dev machine — crashed anywhere else).
function loadPlaywright() {
  const path = require('path');
  const candidates = [
    path.join(__dirname, '..', '..', 'UserEye', 'node_modules', 'playwright'), // this delivery
    'playwright', // resolvable from CWD / NODE_PATH
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error('playwright not found — run `npm install` inside UserEye/ first');
}
const { chromium } = loadPlaywright();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const url = process.env.VELA_BASE ? `${process.env.VELA_BASE.replace(/\/+$/, '')}/` : process.argv[2] || 'http://127.0.0.1:3000/';
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await page.waitForTimeout(400);
  const result = await page.evaluate(() => {
    const vw = window.innerWidth;
    const doc = document.documentElement;
    const overflowPx = doc.scrollWidth - vw;
    const offenders = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // getBoundingClientRect under zoom returns zoomed px; compare in same space
      if (r.right > vw + 4 || r.left < -4) {
        offenders.push({
          sel:
            el.tagName.toLowerCase() +
            (el.id ? '#' + el.id : '') +
            (el.className && typeof el.className === 'string'
              ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
              : ''),
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
      }
    }
    return { vw, zoomedVw: vw, scrollWidth: doc.scrollWidth, overflowPx, offenders: offenders.slice(0, 40) };
  });
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
})();
