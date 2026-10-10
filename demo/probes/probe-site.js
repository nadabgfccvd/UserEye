#!/usr/bin/env node
'use strict';
/* Functional probe of the Vela site after refactor — mirrors (and extends)
   what UserEye checks, so we verify our own fixes instrumentally. */
// FIX (2026-09-06): the require below was a hardcoded absolute path from
// the original dev machine (/home/user/usereye-work/...) and crashed anywhere
// else. Resolve playwright from the known locations, in order, and fail with
// a helpful message instead of MODULE_NOT_FOUND.
function loadPlaywright() {
  const path = require('path');
  const candidates = [
    // 7.4.1: probes/ moved under demo/, so the package is two levels up. The
    // hardcoded absolute path from the original dev machine is gone — it could
    // only ever match one person's laptop.
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

// Target the standalone Vela server (demo/vela-site/serve.js) by default; override
// with VELA_BASE or a positional argument so the probe is not welded to one port.
const BASE = (process.env.VELA_BASE || process.argv[2] || 'http://127.0.0.1:3000').replace(/\/+$/, '');
let failures = 0;
function check(name, ok, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // ---------- homepage ----------
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const skip = await page.locator('a.skip-link').boundingBox();
  check('skip-link zero-height when unfocused', skip && skip.height === 0, JSON.stringify(skip));

  // skip link focuses main
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement.textContent.trim());
  check('first tab stop is skip link', focused === 'Skip to main content', focused);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const active = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
  check('skip link lands focus on <main>', active === 'main', active);

  // cookie banner appears and accepts
  const bannerVisible = await page.locator('#cookie-banner').isVisible();
  check('cookie banner visible on first visit', bannerVisible);
  await page.locator('[data-cookie-accept]').click();
  check('cookie banner dismissed', !(await page.locator('#cookie-banner').isVisible()));

  // theme toggle
  await page.locator('[data-theme-toggle]').click();
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('theme toggle → dark', theme === 'dark', theme);
  await page.locator('[data-theme-toggle]').click();

  // modal open/close + scroll lock WITHOUT overflow hidden
  await page.locator('header [data-demo-open]').click();
  await page.waitForTimeout(120);
  const modalOpen = await page.locator('.modal-backdrop').isVisible();
  check('demo modal opens', modalOpen);
  const lock = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    return { overflow: b.overflow, position: b.position };
  });
  check('scroll lock keeps body overflow visible', lock.overflow === 'visible', JSON.stringify(lock));
  check('scroll lock uses position:fixed', lock.position === 'fixed', lock.position);
  const firstFocus = await page.evaluate(() => document.activeElement.id);
  check('modal focuses first field', firstFocus === 'demo-name', firstFocus);
  // backdrop click must NOT close (form protection)
  await page.mouse.click(20, 450);
  check('backdrop click does not discard form', await page.locator('.modal-backdrop').isVisible());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  check('Escape closes modal', !(await page.locator('.modal-backdrop').isVisible()));
  const restored = await page.evaluate(() => getComputedStyle(document.body).position);
  check('body position restored after close', restored === 'static', restored);
  const refocus = await page.evaluate(() => document.activeElement.getAttribute('data-demo-open') !== null);
  check('focus returns to opener', refocus);

  // modal form validation
  await page.locator('header [data-demo-open]').click();
  await page.locator('[data-demo-form] button[type="submit"]').click();
  const nameErr = await page.locator('#demo-name-error').textContent();
  check('modal form blocks empty submit', nameErr.includes('required'), nameErr);
  await page.fill('#demo-email', 'not-an-email');
  await page.locator('[data-demo-form] button[type="submit"]').click();
  const emailErr = await page.locator('#demo-email-error').textContent();
  check('modal form rejects bad email', emailErr.includes('valid email'), emailErr);
  await page.keyboard.press('Escape');

  // ---------- product page ----------
  await page.goto(BASE + '/product', { waitUntil: 'networkidle' });
  const series = await page.locator('#vela-chart polyline.series').count();
  check('chart renders 3 series', series === 3, 'count=' + series);
  await page.locator('#tab-errors').click();
  const title = await page.locator('.chart-title').textContent();
  check('tab switches dataset', title.includes('Error rate'), title);
  await page.locator('[data-series-toggle="mobile"]').click();
  const pressed = await page.locator('[data-series-toggle="mobile"]').getAttribute('aria-pressed');
  const hidden = await page.locator('#vela-chart polyline[data-series="mobile"]').evaluate((el) => el.hidden);
  check('series toggle hides line', pressed === 'false' && hidden === true, `${pressed}/${hidden}`);

  // ---------- pricing page ----------
  await page.goto(BASE + '/pricing', { waitUntil: 'networkidle' });
  const before = await page.locator('.tier.featured .amount').textContent();
  await page.locator('#billing-monthly-label').click(); // button API
  await page.locator('[data-billing="annual"]').click();
  const after = await page.locator('.tier.featured .amount').textContent();
  const checked = await page.locator('#billing-switch').isChecked();
  check('Annual button sets switch + price', before === '$29' && after === '$23' && checked, `${before}→${after} checked=${checked}`);
  await page.locator('[data-billing="monthly"]').click();
  const back = await page.locator('.tier.featured .amount').textContent();
  check('Monthly button restores price', back === '$29' && !(await page.locator('#billing-switch').isChecked()), back);
  await page.locator('.faq details summary').first().click();
  check('FAQ opens', await page.locator('.faq details').first().evaluate((d) => d.open));

  // ---------- blog page ----------
  await page.goto(BASE + '/blog', { waitUntil: 'networkidle' });
  const all = await page.locator('[data-post-grid] article:visible').count();
  await page.locator('[data-tag-filter="design"]').click();
  const filtered = await page.locator('[data-post-grid] article:visible').count();
  const count = await page.locator('[data-blog-count]').textContent();
  check('tag filter works', all === 6 && filtered === 1, `${all}→${filtered} "${count}"`);
  await page.locator('[data-blog-search]').fill('SLO');
  await page.locator('[data-tag-filter="all"]').click();
  const searched = await page.locator('[data-post-grid] article:visible').count();
  check('search filters posts', searched === 1, 'count=' + searched);
  await page.locator('[data-blog-search]').fill('');

  // deep link ?tag=changelog
  await page.goto(BASE + '/blog?tag=changelog', { waitUntil: 'networkidle' });
  const deep = await page.locator('[data-post-grid] article:visible').count();
  check('?tag=changelog deep link', deep === 1, 'count=' + deep);

  // ---------- contact form ----------
  await page.goto(BASE + '/contact', { waitUntil: 'networkidle' });
  await page.locator('form[data-validate] button[type="submit"]').click();
  const errs = await page.locator('.field-error:not(:empty)').count();
  check('contact form shows errors on empty submit', errs >= 3, 'errors=' + errs);
  await page.fill('#name', 'Ada Lovelace');
  await page.fill('#email', 'ada@example.com');
  await page.selectOption('#topic', 'demo');
  await page.fill('#message', 'We would love to see Vela on our telemetry pipeline.');
  await page.locator('form[data-validate] button[type="submit"]').click();
  await page.waitForTimeout(120);
  const successVisible = await page.locator('[data-form-success]').isVisible();
  const successName = await page.locator('[data-success-name]').textContent();
  check('contact form success state', successVisible && successName === 'Ada', `${successVisible}/${successName}`);

  // ---------- 404 ----------
  const resp = await page.goto(BASE + '/definitely-missing', { waitUntil: 'domcontentloaded' });
  check('404 status for missing page', resp.status() === 404, 'status=' + resp.status());

  // ---------- console hygiene across all pages ----------
  consoleErrors.length = 0; // ignore the deliberate 404 navigation above
  const pages = ['/', '/product', '/pricing', '/blog', '/blog/scaling-observability-to-10-trillion-events', '/about', '/contact', '/legal'];
  for (const p of pages) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
  }
  check('no console errors on any page', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(failures === 0 ? '\nALL PROBES PASSED' : `\n${failures} PROBE(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
