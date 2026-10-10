'use strict';

async function httpDocument(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    const started = Date.now();
    const response = await page.goto(runner.baseURL, {
      waitUntil: 'domcontentloaded',
      timeout: runner.timeoutMs,
    });
    const bodyVisible = await page.locator('body').isVisible();
    const statusCode = response?.status() || 0;
    return {
      status: (statusCode && statusCode >= 400) || !bodyVisible ? 'failed' : 'passed',
      details: {
        statusCode,
        bodyVisible,
        title: await page.title(),
        loadMs: Date.now() - started,
        telemetry,
      },
    };
  });
}

async function offlineRecovery(runner) {
  return runner.withContext({}, async ({ context, page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    await context.setOffline(true);
    let offlineFallback = false;
    let offlineError = null;
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 });
      offlineFallback = await page.locator('body').isVisible();
    } catch (error) {
      offlineError = error.message;
    }
    await context.setOffline(false);
    let recovered = false;
    try {
      await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded', timeout: 8000 });
      recovered = await page.locator('body').isVisible();
    } catch {}
    return {
      status: recovered ? 'passed' : 'failed',
      details: { offlineFallback, offlineError, recovered, telemetry },
    };
  });
}

async function pwaServiceWorker(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const data = await page.evaluate(async () => ({
      manifest: document.querySelector('link[rel="manifest"]')?.href || null,
      serviceWorkers:
        'serviceWorker' in navigator
          ? (await navigator.serviceWorker.getRegistrations()).map(registration => registration.scope)
          : [],
      caches: 'caches' in window ? await caches.keys() : [],
    }));
    const supported = Boolean(data.manifest || data.serviceWorkers.length || data.caches.length);
    return { status: supported ? 'passed' : 'skipped', details: { supported, ...data, telemetry } };
  });
}

async function realtimeProtocols(runner) {
  return runner.withContext({}, async ({ context, page, telemetry }) => {
    await context.addInitScript(() => {
      window.__usereyeRealtime = { eventSources: [] };
      if (window.EventSource) {
        const Native = window.EventSource;
        window.EventSource = class extends Native {
          constructor(url, options) {
            super(url, options);
            window.__usereyeRealtime.eventSources.push(String(url));
          }
        };
      }
    });
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const eventSources = await page.evaluate(() => window.__usereyeRealtime?.eventSources || []);
    const count = telemetry.websockets.length + eventSources.length;
    return {
      status: count ? 'passed' : 'skipped',
      details: { websockets: telemetry.websockets, eventSources, telemetry },
    };
  });
}

async function slowNetwork(runner) {
  return runner.withContext({}, async ({ context, page, telemetry }) => {
    const origin = new URL(runner.baseURL).origin;
    await context.route('**/*', async route => {
      if (route.request().url().startsWith(origin)) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      await route.continue();
    });
    const started = Date.now();
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded', timeout: runner.timeoutMs });
    const loadMs = Date.now() - started;
    const visible = await page.locator('body').isVisible();
    return {
      status: visible ? 'passed' : 'failed',
      details: { injectedLatencyMs: 350, loadMs, visible, telemetry },
    };
  });
}

module.exports = { httpDocument, offlineRecovery, pwaServiceWorker, realtimeProtocols, slowNetwork };
