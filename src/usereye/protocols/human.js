'use strict';

const { collectHumanSignals } = require('../browser-human');
const { findingStrings } = require('../i18n');

async function skipLinkProtocol(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const skip = page.locator('a[href^="#"]').filter({
      hasText: runner.patterns.skipLink,
    });
    if (!(await skip.count())) {
      return { status: 'skipped', details: { reason: 'no-skip-link', telemetry } };
    }
    const href = await skip.first().getAttribute('href');
    await skip.first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    const landed = await page.evaluate(target => {
      if (!target) {
        return { ok: false, reason: 'empty-href' };
      }
      const node = document.querySelector(target);
      if (!node) {
        return { ok: false, reason: 'missing-target', target };
      }
      const active = document.activeElement;
      return {
        ok: Boolean(active && (active === node || node.contains(active) || node.id === active.id)),
        target,
        active: active?.id || active?.tagName || null,
      };
    }, href);
    return {
      status: landed.ok ? 'passed' : 'warning',
      details: { href, landed, telemetry },
    };
  });
}

async function reducedMotionAnimations(runner) {
  return runner.withContext({ reducedMotion: 'reduce' }, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(120);
    const running = await page.evaluate(() => {
      const animations = document.getAnimations ? document.getAnimations() : [];
      return animations
        .filter(animation => animation.playState === 'running')
        .map(animation => ({
          name: animation.animationName || animation.transitionProperty || 'unknown',
          duration: animation.effect?.getComputedTiming?.().duration || null,
        }))
        .slice(0, 16);
    });
    return {
      status: running.length ? 'warning' : 'passed',
      details: { running, telemetry },
    };
  });
}

async function printPreview(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    await page.emulateMedia({ media: 'print' });
    const snapshot = await page.evaluate(() => ({
      title: document.title,
      textLength: (document.body?.innerText || '').trim().length,
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    }));
    return {
      status: snapshot.textLength > 0 ? 'passed' : 'warning',
      details: { snapshot, telemetry },
    };
  });
}

async function screenReaderProtocol(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const human = await page.evaluate(collectHumanSignals, {
      profile: 'desktop',
      strings: findingStrings(runner.eye.options.reportLocale),
    });
    return {
      status: human.screenReaderPreview.length ? 'passed' : 'warning',
      details: {
        spoken: human.screenReaderPreview.slice(0, 12),
        readingTime: human.readingTime,
        telemetry,
      },
    };
  });
}

async function consentWallProtocol(runner) {
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const human = await page.evaluate(collectHumanSignals, {
      profile: 'desktop',
      strings: findingStrings(runner.eye.options.reportLocale),
      consent: runner.eye.options.consent || {},
    });
    return {
      status: human.consentWalls.length ? 'warning' : 'passed',
      details: { consentWalls: human.consentWalls, telemetry },
    };
  });
}

module.exports = {
  skipLinkProtocol,
  reducedMotionAnimations,
  printPreview,
  screenReaderProtocol,
  consentWallProtocol,
};
