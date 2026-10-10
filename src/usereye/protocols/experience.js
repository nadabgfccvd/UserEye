'use strict';

const { collectUserGaze } = require('../browser-gaze');
const { capturePerception } = require('../perception');

async function firstImpressionProtocol(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const gaze = await page.evaluate(collectUserGaze, { profile: 'desktop', maxBlocks: 40 });
    const hasAnchor = Boolean(gaze.headline || gaze.primaryCta);
    return {
      status: hasAnchor ? 'passed' : 'warning',
      details: {
        headline: gaze.headline?.text || null,
        primaryCta: gaze.primaryCta?.name || null,
        fold: gaze.fold,
        scan3s: gaze.scan3s,
        telemetry,
      },
    };
  });
}

/**
 * 200% zoom check (Phase 2.3). `zoomMode` selects the simulation strategy:
 *   - 'css'            apply `style.zoom = '2'` (historical, back-compat default)
 *   - 'viewport'       run in a context whose viewport is halved, approximating the
 *                      effective layout viewport of a desktop page at 200% zoom
 *                      (reveals the same horizontal-overflow failures as CSS zoom)
 *   - 'cdp'            reserved: true Chromium page-scale requires the CDP
 *                      `Emulation.setDeviceMetricsOverride` path; not shipped.
 * Default stays 'css' for comparability; `viewport` is opt-in via config.
 */
async function zoomUsability(runner) {
  const mode = runner.eye.options.zoomMode || 'css';
  if (mode === 'viewport') {
    return runner.withContext(
      { viewport: { width: 640, height: 400 } }, // ~200% of a 1280x800 default
      async ({ page, telemetry }) => {
        await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(80);
        const perception = await capturePerception(page, {
          profile: 'zoom-200',
          locale: runner.eye.options.reportLocale,
          touchTarget: runner.eye.options.touchTarget,
          maxControls: 180,
        });
        const overflow = perception.horizontalOverflow || 0;
        const blockers = perception.findings.filter(item => ['blocker', 'critical'].includes(item.severity));
        return {
          status: blockers.length ? 'warning' : overflow > 80 ? 'warning' : 'passed',
          details: {
            zoomMode: 'viewport',
            overflow,
            blockers: blockers.map(item => item.code),
            counts: perception.counts,
            telemetry,
          },
        };
      },
    );
  }
  // 'css' (and any unsupported mode) falls back to the historical style.zoom path.
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await page.waitForTimeout(80);
    const perception = await capturePerception(page, {
      profile: 'zoom-200',
      locale: runner.eye.options.reportLocale,
      touchTarget: runner.eye.options.touchTarget,
      maxControls: 180,
    });
    const overflow = perception.horizontalOverflow || 0;
    const blockers = perception.findings.filter(item => ['blocker', 'critical'].includes(item.severity));
    return {
      status: blockers.length ? 'warning' : overflow > 80 ? 'warning' : 'passed',
      details: {
        zoomMode: mode === 'cdp' ? 'css-fallback' : mode,
        overflow,
        blockers: blockers.map(item => item.code),
        counts: perception.counts,
        telemetry,
      },
    };
  });
}

async function rtlMirror(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl');
      document.body?.setAttribute('dir', 'rtl');
    });
    await page.waitForTimeout(60);
    const perception = await capturePerception(page, {
      profile: 'rtl',
      locale: runner.eye.options.reportLocale,
      touchTarget: runner.eye.options.touchTarget,
      maxControls: 180,
    });
    return {
      status: perception.horizontalOverflow > 48 ? 'warning' : 'passed',
      details: {
        overflow: perception.horizontalOverflow,
        findings: perception.findings.map(item => item.code),
        telemetry,
      },
    };
  });
}

async function securityHeaders(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    const response = await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const headers = response?.headers?.() || {};
    const interesting = {
      csp: headers['content-security-policy'] || null,
      xContentType: headers['x-content-type-options'] || null,
      referrer: headers['referrer-policy'] || null,
      frame: headers['x-frame-options'] || headers['content-security-policy'] || null,
      hsts: headers['strict-transport-security'] || null,
    };
    const notes = [];
    if (!interesting.csp) {
      notes.push('missing-csp');
    }
    if (!interesting.xContentType) {
      notes.push('missing-x-content-type-options');
    }
    const cookies = await page.context().cookies();
    const weakCookies = cookies
      .filter(cookie => cookie.secure === false || !String(cookie.sameSite || '').toLowerCase())
      .map(cookie => ({ name: cookie.name, secure: cookie.secure, sameSite: cookie.sameSite }));
    return {
      status: 'passed',
      details: { headers: interesting, notes, weakCookies: weakCookies.slice(0, 12), telemetry },
    };
  });
}

async function brokenMedia(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(120);
    const media = await page.evaluate(() =>
      [...document.images].map(image => ({
        src: String(image.currentSrc || image.src || '').slice(0, 220),
        alt: image.getAttribute('alt'),
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        broken: image.complete && image.naturalWidth === 0 && Boolean(image.currentSrc || image.src),
      })),
    );
    const broken = media.filter(item => item.broken);
    if (!media.length) {
      return { status: 'skipped', details: { reason: 'no-images', telemetry } };
    }
    return {
      status: broken.length ? 'warning' : 'passed',
      details: { total: media.length, broken: broken.slice(0, 12), telemetry },
    };
  });
}

async function tabOrderMap(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const sequence = [];
    const seen = new Set();
    let trapped = false;
    for (let index = 0; index < 24; index++) {
      await page.keyboard.press('Tab');
      const current = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body || element === document.documentElement) {
          return null;
        }
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          name: String(
            element.getAttribute('aria-label') ||
              element.textContent ||
              element.getAttribute('placeholder') ||
              '',
          )
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80),
        };
      });
      if (!current) {
        continue;
      }
      const key = `${current.tag}#${current.id}:${current.name}`;
      if (seen.has(key) && sequence.length >= 2) {
        trapped = true;
        break;
      }
      seen.add(key);
      sequence.push(current);
    }
    return {
      status: sequence.length ? 'passed' : 'warning',
      details: { sequence, unique: seen.size, trapped, telemetry },
    };
  });
}

module.exports = {
  firstImpressionProtocol,
  zoomUsability,
  rtlMirror,
  securityHeaders,
  brokenMedia,
  tabOrderMap,
};
