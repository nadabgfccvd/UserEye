'use strict';

const { capturePerception } = require('../perception');
const { fnv } = require('./helpers');

async function keyboardNavigation(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const controlCount = await page
      .locator('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')
      .count();
    const focused = [];
    for (let index = 0; index < Math.min(12, Math.max(3, controlCount)); index++) {
      await page.keyboard.press('Tab');
      focused.push(
        await page.evaluate(() => ({
          tag: document.activeElement?.tagName?.toLowerCase() || '',
          id: document.activeElement?.id || '',
          name: (
            document.activeElement?.getAttribute?.('aria-label') ||
            document.activeElement?.textContent ||
            document.activeElement?.getAttribute?.('placeholder') ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100),
        })),
      );
    }
    const meaningful = focused.filter(item => item.tag && item.tag !== 'body').length;
    return {
      status: controlCount === 0 ? 'skipped' : meaningful > 0 ? 'passed' : 'warning',
      details: { controlCount, focused, telemetry },
    };
  });
}

async function touchPointer(runner) {
  return runner.withContext(
    { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    async ({ page, telemetry }) => {
      await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
      const candidates = page
        .locator('button,a[href],[role="button"],[role="tab"]')
        .filter({ visible: true })
        .filter({ hasNotText: runner.patterns.dangerous });
      const candidateCount = await candidates.count();
      if (!candidateCount) {
        return { status: 'skipped', details: { reason: 'no-safe-touch-target', telemetry } };
      }
      // FIX (2026-09-06): a control whose center lies outside the viewport
      // (e.g. an off-screen skip link kept in the DOM for keyboard users) cannot be
      // tapped by a real user, and elementFromPoint() returns null for it — which the
      // old code reported as a false failure: "Touch target is occluded by null".
      // Walk the candidates and test the first control a user can actually touch;
      // genuine occlusion of an in-viewport control still fails exactly as before.
      let target = null;
      let hitTest = null;
      for (let index = 0; index < candidateCount; index++) {
        const candidate = candidates.nth(index);
        const probe = await candidate.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const inViewport = x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight;
          const top = inViewport ? document.elementFromPoint(x, y) : null;
          return {
            inViewport,
            reachable: Boolean(top && (top === element || element.contains(top))),
            blocker: top
              ? { tag: top.tagName.toLowerCase(), id: top.id || '', classes: [...top.classList].slice(0, 6) }
              : null,
          };
        });
        if (probe.inViewport) {
          target = candidate;
          hitTest = probe;
          break;
        }
      }
      if (!target) {
        return { status: 'skipped', details: { reason: 'no-in-viewport-touch-target', telemetry } };
      }
      if (!hitTest.reachable) {
        return {
          status: 'failed',
          error: `Touch target is occluded by ${JSON.stringify(hitTest.blocker)}`,
          details: { hitTest, telemetry },
        };
      }
      const before = await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText.replace(/\s+/g, ' ').trim(),
      }));
      // FIX (2026-09-06): read the target's text BEFORE tapping. A tap can
      // navigate away (e.g. the first visible control is a logo/home link), which
      // detaches the element; awaiting `target.textContent()` after the tap then
      // re-resolves the locator against the new page, stalls until Playwright's
      // 30s element timeout and gets the whole protocol killed by the scheduler's
      // 15s budget with a false "failed" status.
      const targetText = await target.textContent();
      await target.tap({ timeout: 5000 });
      await page.waitForTimeout(180);
      const after = await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText.replace(/\s+/g, ' ').trim(),
      }));
      return {
        status: 'passed',
        details: {
          target: targetText,
          stateChanged: before.url !== after.url || fnv(before.text) !== fnv(after.text),
          telemetry,
        },
      };
    },
  );
}

async function renderingPreference(runner, kind) {
  const options =
    kind === 'dark'
      ? { colorScheme: 'dark' }
      : kind === 'reduced-motion'
        ? { reducedMotion: 'reduce' }
        : { forcedColors: 'active' };
  return runner.withContext(options, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const perception = await capturePerception(page, {
      profile: kind,
      locale: runner.eye.options.reportLocale,
      touchTarget: runner.eye.options.touchTarget,
      maxControls: 200,
    });
    const blockers = perception.findings.filter(finding =>
      ['blocker', 'critical'].includes(finding.severity),
    );
    return {
      status: blockers.length ? 'warning' : 'passed',
      details: {
        kind,
        blockers,
        counts: perception.counts,
        findings: perception.findings.map(item => item.code),
        telemetry,
      },
    };
  });
}

async function clipboardProtocol(runner) {
  return runner.withContext({}, async ({ context, page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(runner.baseURL).origin,
    });
    const buttons = page.getByRole('button', { name: runner.patterns.copy });
    if (!(await buttons.count())) {
      return { status: 'skipped', details: { reason: 'no-copy-control', telemetry } };
    }
    await buttons.first().click();
    const value = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    return { status: value ? 'passed' : 'warning', details: { copiedLength: value.length, telemetry } };
  });
}

async function formValidation(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const submit = page.locator('form button[type="submit"],form input[type="submit"]').first();
    if (!(await submit.count()) || !(await submit.isVisible())) {
      return { status: 'skipped', details: { reason: 'no-visible-submit', telemetry } };
    }
    const name = ((await submit.textContent()) || (await submit.getAttribute('value')) || '').trim();
    runner.patterns.dangerous.lastIndex = 0;
    if (runner.patterns.dangerous.test(name)) {
      return { status: 'skipped', details: { reason: 'dangerous-submit', name, telemetry } };
    }
    await submit.click();
    await page.waitForTimeout(180);
    const feedback = await page
      .locator('[role="alert"]:visible,[role="status"]:visible,.error:visible,.invalid:visible')
      .allTextContents();
    const invalid = await page.locator(':invalid').count();
    return {
      status: feedback.some(Boolean) || invalid ? 'passed' : 'warning',
      details: { name, feedback, invalidControls: invalid, telemetry },
    };
  });
}

module.exports = { keyboardNavigation, touchPointer, renderingPreference, clipboardProtocol, formValidation };
