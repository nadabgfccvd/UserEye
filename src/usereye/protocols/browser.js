'use strict';

const { fnv } = require('./helpers');

async function multiTabSession(runner) {
  return runner.withContext({}, async ({ context, page, telemetry }) => {
    const second = await context.newPage();
    await Promise.all([
      page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' }),
      second.goto(runner.baseURL, { waitUntil: 'domcontentloaded' }),
    ]);
    const states = await Promise.all(
      [page, second].map(item =>
        item.evaluate(() => ({
          title: document.title,
          hasPassword: Boolean(document.querySelector('input[type="password"]')),
          text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 300),
        })),
      ),
    );
    await second.close();
    const consistent = states[0].title === states[1].title && states[0].hasPassword === states[1].hasPassword;
    return { status: consistent ? 'passed' : 'warning', details: { consistent, states, telemetry } };
  });
}

async function refreshPersistence(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const before = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      localStorageKeys: Object.keys(localStorage).sort(),
      text: document.body.innerText.replace(/\s+/g, ' ').trim(),
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    const after = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      localStorageKeys: Object.keys(localStorage).sort(),
      text: document.body.innerText.replace(/\s+/g, ' ').trim(),
    }));
    const stable =
      before.url === after.url &&
      before.title === after.title &&
      JSON.stringify(before.localStorageKeys) === JSON.stringify(after.localStorageKeys);
    return {
      status: stable ? 'passed' : 'warning',
      details: { stable, beforeHash: fnv(before.text), afterHash: fnv(after.text), telemetry },
    };
  });
}

async function historyNavigation(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const origin = new URL(runner.baseURL).origin;
    const links = page.locator('a[href]');
    let href = null;
    for (let index = 0; index < (await links.count()); index++) {
      const value = await links.nth(index).getAttribute('href');
      if (!value) {
        continue;
      }
      const absolute = new URL(value, runner.baseURL);
      if (absolute.origin === origin && absolute.href !== page.url()) {
        href = absolute.href;
        break;
      }
    }
    if (!href) {
      return { status: 'skipped', details: { reason: 'no-internal-link', telemetry } };
    }
    const initial = page.url();
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    const forward = page.url();
    await page.goBack({ waitUntil: 'domcontentloaded' });
    const restored = page.url() === initial;
    await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
    return { status: restored ? 'passed' : 'warning', details: { initial, forward, restored, telemetry } };
  });
}

async function parallelInternalNavigation(runner) {
  return runner.withContext({}, async ({ context, page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const origin = new URL(runner.baseURL).origin;
    const hrefs = [
      ...new Set(
        await page
          .locator('a[href]')
          .evaluateAll(
            (links, base) => links.map(link => new URL(link.getAttribute('href'), base).href),
            runner.baseURL,
          ),
      ),
    ]
      .filter(href => new URL(href).origin === origin)
      .slice(0, 4);
    if (hrefs.length < 2) {
      return { status: 'skipped', details: { reason: 'fewer-than-two-internal-links', hrefs, telemetry } };
    }
    const pages = await Promise.all(hrefs.map(() => context.newPage()));
    const started = Date.now();
    const responses = await Promise.all(
      pages.map((item, index) =>
        item.goto(hrefs[index], { waitUntil: 'domcontentloaded' }).catch(error => ({ error })),
      ),
    );
    const success = responses.filter(
      response => response && !response.error && response.status() < 400,
    ).length;
    await Promise.all(pages.map(item => item.close()));
    return {
      status: success === hrefs.length ? 'passed' : 'warning',
      details: {
        hrefs,
        success,
        simultaneousActions: hrefs.length,
        durationMs: Date.now() - started,
        telemetry,
      },
    };
  });
}

async function popupProtocol(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const origin = new URL(runner.baseURL).origin;
    const links = page.locator('a[target="_blank"][href]');
    let target = null;
    for (let index = 0; index < (await links.count()); index++) {
      const href = new URL(await links.nth(index).getAttribute('href'), runner.baseURL);
      if (href.origin === origin) {
        target = links.nth(index);
        break;
      }
    }
    if (!target) {
      return { status: 'skipped', details: { reason: 'no-safe-popup-link', telemetry } };
    }
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 });
    await target.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    const popupURL = popup.url();
    await popup.close();
    return { status: popupURL ? 'passed' : 'warning', details: { popupURL, telemetry } };
  });
}

async function cacheStorage(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const data = await page.evaluate(async () => ({
      localStorage: Object.keys(localStorage),
      sessionStorage: Object.keys(sessionStorage),
      cookies: document.cookie ? document.cookie.split(';').length : 0,
      caches: 'caches' in window ? await caches.keys() : [],
    }));
    return { status: 'passed', details: { ...data, telemetry } };
  });
}

module.exports = {
  multiTabSession,
  refreshPersistence,
  historyNavigation,
  parallelInternalNavigation,
  popupProtocol,
  cacheStorage,
};
