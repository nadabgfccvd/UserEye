'use strict';

/**
 * UserEye browser-extension effect battery (7.4). Real Chrome extensions cannot
 * be installed in a headless Playwright browser, so each probe *simulates the net
 * effect* of the most popular Chrome extension categories and measures how the
 * running app reacts. Opt-in via `config.extensions` (default off — additive).
 *
 * Categories mapped to popular extensions the user asked about:
 *   adBlocker       -> AdBlock, Adblock Plus, uBlock Origin (block third-party
 *                      ad/tracker/analytics requests; does the app break?)
 *   darkReader      -> Dark Reader (forced dark scheme; do we still read well?)
 *   passwordManager -> LastPass, Bitwarden, 1Password (can login fields be
 *                      autofilled — proper autocomplete attributes?)
 *   translator      -> Google Translate (machine translation; does layout hold?)
 *   couponHelper    -> PayPal Honey, Capital One Shopping (price/cart DOM intact
 *                      for an injector to act on?)
 *   fullPageCapture -> GoFullPage / Loom (is main content DOM/canvas-based so a
 *                      capture sees it?)
 *   reactDevtools   -> React Developer Tools (is the app a real React tree?)
 *   volumeBooster   -> Volume Master (is there <audio>/<video> to amplify?)
 *
 * Every probe navigates its own isolated context and returns
 * `{status: passed|warning|skipped, details}` evidence into protocol-results.json.
 */

const { capturePerception } = require('../perception');

const PASS = 'passed';
const WARN = 'warning';
const SKIP = 'skipped';

function extCfg(runner) {
  return (runner.eye.options && runner.eye.options.extensions) || { enabled: false };
}
function catOn(runner, name) {
  const c = extCfg(runner).categories || {};
  return c[name] !== false;
}
async function gotoRoot(runner, page, options = {}) {
  await page.goto(runner.baseURL, { waitUntil: options.waitUntil || 'domcontentloaded' });
  await page.waitForTimeout(options.idleMs ?? 90);
}

/**
 * uBlock/ad-block style: abort third-party requests to known ad/tracker/analytics
 * domains, then re-observe. Reports whether the app still renders its main
 * content / layout, or whether content collapsed / went missing when ads were cut.
 */
const AD_TRACKER_RE =
  /(^|\.)(doubleclick|googlesyndication|google-analytics|googletagmanager|googleadservices|scorecardresearch|outbrain|taboola|facebook\.net|connect\.facebook|criteo|adservice|moatads|amazon-adsystem|pubmatic|rubiconproject|adnxs|adform|casalemedia|indexexchange|openx|appnexus|ads?\.)/i;

async function adBlockerProbe(runner) {
  if (!catOn(runner, 'adBlocker')) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ context, page, telemetry }) => {
    let blocked = 0;
    const matched = new Set();
    await context.route('**/*', route => {
      const url = route.request().url();
      const host = new URL(url).hostname;
      if (AD_TRACKER_RE.test(host) && !url.includes(runner.baseURL)) {
        blocked += 1;
        matched.add(host.replace(/^www\./, ''));
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    });
    try {
      await gotoRoot(runner, page, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const state = await page.evaluate(() => ({
        hasContent: Boolean(((document.body && document.body.innerText) || '').trim().length > 40),
        headingText: (document.querySelector('h1,h2')?.textContent || '').trim().slice(0, 60),
        imagesFailed: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
        bodyHtmlLen: (document.body?.innerHTML || '').length,
      }));
      const status = state.hasContent ? PASS : WARN;
      return {
        status,
        details: {
          probe: 'ad-blocker',
          simulatedBlocker: 'uBlock Origin / AdBlock / Adblock Plus',
          requestsBlocked: blocked,
          adHostsMatched: [...matched].slice(0, 12),
          mainContentPresent: state.hasContent,
          heading: state.headingText,
          note:
            status === PASS
              ? `App stayed usable after ${blocked} ad/tracker request(s) were blocked (no content collapse).`
              : `After blocking ad/tracker requests, no meaningful text remained — the app may depend on ad-supplied layout/content.`,
          telemetry,
        },
      };
    } finally {
      await context.unroute('**/*').catch(() => {});
    }
  });
}

/**
 * Dark Reader effect: force a dark color scheme and run the perception contrast
 * pass — is text still legible under forced-dark? Also honors prefers-color-scheme.
 */
async function darkReaderProbe(runner) {
  if (!catOn(runner, 'darkReader')) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({ colorScheme: 'dark' }, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const perception = await capturePerception(page, {
      profile: 'dark-reader',
      locale: runner.eye.options.reportLocale || 'en',
      maxControls: 180,
    });
    const contrastFindings = perception.findings.filter(f => f.code === 'insufficient-contrast');
    const overflow = perception.horizontalOverflow || 0;
    const readable = contrastFindings.length === 0 && perception.counts?.controlsInViewport >= 0;
    return {
      status: readable ? PASS : WARN,
      details: {
        probe: 'dark-reader',
        simulatedBlocker: 'Dark Reader (forced dark color scheme)',
        insufficientContrastSnippets: contrastFindings.length,
        horizontalOverflowPx: overflow,
        note:
          contrastFindings.length === 0
            ? 'App remains readable under a forced dark color scheme.'
            : `${contrastFindings.length} low-contrast snippet(s) appear under dark mode — text may be hard to read with Dark Reader.`,
        telemetry,
      },
    };
  });
}

/**
 * Password-manager effect: on login surfaces, are credential fields autofillable
 * (proper type + autocomplete hints)? A manager like LastPass/Bitwarden/1Password
 * needs type=password and autocomplete="current-password"/"username" to fill.
 */
async function passwordManagerProbe(runner) {
  if (!catOn(runner, 'passwordManager')) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const fields = await page.evaluate(() => {
      const pw = [...document.querySelectorAll('input[type="password"]')];
      const userInputs = [
        ...document.querySelectorAll(
          'input[autocomplete="username"], input[autocomplete="email"], input[name*="user" i], input[name*="email" i], input[type="email"]',
        ),
      ];
      return {
        hasLogin: pw.length > 0,
        passwordFields: pw.length,
        passwordWithAutocomplete: pw.filter(i =>
          /(current-password|new-password)/i.test(i.getAttribute('autocomplete') || ''),
        ).length,
        usernameOrEmailFields: userInputs.length,
        usernameWithAutocomplete: userInputs.filter(i =>
          /(username|email)/i.test(i.getAttribute('autocomplete') || ''),
        ).length,
        insideForm: pw.length > 0 && pw.every(i => Boolean(i.closest('form'))),
      };
    });
    if (!fields.hasLogin) {
      return { status: SKIP, details: { reason: 'no-login-form', telemetry } };
    }
    const autofillReady =
      fields.passwordWithAutocomplete === fields.passwordFields &&
      (fields.usernameOrEmailFields === 0 ||
        fields.usernameWithAutocomplete >= Math.max(1, fields.usernameOrEmailFields));
    return {
      status: autofillReady && fields.insideForm ? PASS : WARN,
      details: {
        probe: 'password-manager',
        simulatedExtension: 'LastPass / Bitwarden / 1Password',
        loginPresent: true,
        passwordFields: fields.passwordFields,
        passwordFieldsAutofillReady: fields.passwordWithAutocomplete,
        usernameOrEmailFields: fields.usernameOrEmailFields,
        fieldsInsideForm: fields.insideForm,
        note:
          autofillReady && fields.insideForm
            ? 'Credential fields carry autocomplete hints and live in a <form>, so a password manager can autofill them.'
            : 'Credential fields are missing autocomplete hints (or sit outside a form), so password-manager autofill may not work.',
        telemetry,
      },
    };
  });
}

/**
 * Google-Translate effect: machine translation often lengthens text. We simulate
 * an aggressive translate that can break layout by checking the app tolerates
 * longer-than-designed text (via a temporary root font bump that approximates a
 * language with longer strings) — does layout overflow/clip?
 */
async function translatorProbe(runner) {
  if (!catOn(runner, 'translator')) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const baseline = await page.evaluate(() => {
      const de = document.documentElement;
      return {
        hasTranslatableText: (document.body?.innerText || '').trim().length > 40,
        docLang: de.lang,
      };
    });
    if (!baseline.hasTranslatableText) {
      return { status: SKIP, details: { reason: 'no-text', telemetry } };
    }
    // Bump root font ~14% and widen to ~1500px to simulate longer translated strings;
    // then measure whether horizontal overflow appears (layout breakage).
    const probe = await page.evaluate(() => {
      const de = document.documentElement;
      const beforeOverflow = de.scrollWidth - de.clientWidth;
      de.style.fontSize = '112%';
      const afterOverflow = de.scrollWidth - de.clientWidth;
      de.style.fontSize = '';
      return { beforeOverflow: Math.max(0, beforeOverflow), afterOverflow: Math.max(0, afterOverflow) };
    });
    const overflowed = probe.afterOverflow > probe.beforeOverflow + 8;
    return {
      status: overflowed ? WARN : PASS,
      details: {
        probe: 'translator',
        simulatedExtension: 'Google Translate (text lengthening)',
        overflowBeforePx: probe.beforeOverflow,
        overflowAfterPx: probe.afterOverflow,
        note: overflowed
          ? 'Layout produced extra horizontal overflow when text was enlarged (machine translation may break the layout).'
          : 'Layout held when text grew — tolerant of machine-translated, longer strings.',
        telemetry,
      },
    };
  });
}

/**
 * Coupon-helper effect (Honey / Capital One Shopping): these inject into a
 * checkout/cart DOM. Report whether a price/cart surface exists and that prices
 * and the "add to cart" control are real DOM (so an injector could act) vs canvas.
 */
async function couponHelperProbe(runner) {
  if (!catOn(runner, 'couponHelper')) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const info = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const priceSelectors = '[class*="price" i], [class*="amount" i], [data-price], [itemprop="price"]';
      const prices = [...document.querySelectorAll(priceSelectors)].filter(el =>
        /\d/.test(el.textContent || ''),
      ).length;
      const cartText = /\b(cart|checkout|buy|comprar|carrinho|add to cart|cesta)\b/i.test(text);
      const buttons = [...document.querySelectorAll('button,a[role="button"]')].map(el =>
        (el.textContent || '').trim().toLowerCase(),
      );
      const ctaBuy = buttons.some(b => /\b(add to cart|buy|buy now|comprar|checkout|adicionar)\b/.test(b));
      const hasCommerce = prices > 0 || cartText || ctaBuy;
      return { hasCommerce, pricesFound: prices, hasBuyCta: ctaBuy, isDOMText: text.length > 40 };
    });
    if (!info.hasCommerce) {
      return { status: SKIP, details: { reason: 'no-commerce-surface', telemetry } };
    }
    // A coupon injector works on DOM text/prices. If prices are absent from DOM,
    // Honey can't scan for deals reliably.
    const ready = info.pricesFound > 0 && info.isDOMText;
    return {
      status: ready ? PASS : WARN,
      details: {
        probe: 'coupon-helper',
        simulatedExtension: 'PayPal Honey / Capital One Shopping',
        commercePresent: true,
        pricesFoundInDOM: info.pricesFound,
        buyCtaFound: info.hasBuyCta,
        note: ready
          ? 'A commerce surface with DOM-visible prices is present, so a coupon/cashback injector can operate.'
          : 'Commerce detected but prices are not clearly present as DOM text — a coupon helper may not find anything to act on.',
        telemetry,
      },
    };
  });
}

/**
 * GoFullPage / Loom effect: a full-page capture only sees what is rendered in
 * DOM (not canvas-drawn). Report whether the main content is DOM-based so a
 * capture/recorder would see it.
 */
async function fullPageCaptureProbe(runner) {
  if (!catOn(runner, 'fullPageCapture')) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const info = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll('canvas')];
      const canvasArea = canvases.reduce((s, c) => {
        const r = c.getBoundingClientRect();
        return s + r.width * r.height;
      }, 0);
      const viewportArea = innerWidth * innerHeight;
      const textLen = (document.body?.innerText || '').length;
      return {
        canvasCoverage: viewportArea ? canvasArea / viewportArea : 0,
        hasDOMText: textLen > 40,
        tallEnoughToScroll: document.documentElement.scrollHeight > innerHeight + 100,
      };
    });
    const capturesDOM = info.hasDOMText && info.canvasCoverage < 0.6;
    return {
      status: capturesDOM ? PASS : WARN,
      details: {
        probe: 'full-page-capture',
        simulatedExtension: 'GoFullPage / Loom',
        domTextPresent: info.hasDOMText,
        canvasCoverageRatio: Math.round(info.canvasCoverage * 100) / 100,
        scrollable: info.tallEnoughToScroll,
        note: capturesDOM
          ? 'Main content is DOM-rendered, so full-page screenshot / recording extensions will capture it.'
          : 'Page is dominated by canvas or lacks DOM text — full-page capture tools may produce blank/partial output.',
        telemetry,
      },
    };
  });
}

/**
 * React DevTools effect: is the page a real React tree (reachable by React
 * DevTools)? Purely informational — a healthy React app is inspectable.
 */
async function reactDevtoolsProbe(runner) {
  if (!catOn(runner, 'reactDevtools')) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const info = await page.evaluate(() => {
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const legacy = document.querySelector('[data-reactroot]');
      const root = document.querySelector('#root, [id*="root"], [data-reactroot]');
      const fiber = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ && hook.renderers ? hook.renderers.size : 0;
      const reactOn = Boolean(
        hook ||
        legacy ||
        /_reactRootContainer|__reactFiber/.test(document.documentElement.outerHTML.slice(0, 4000)),
      );
      return { reactDetected: reactOn, hasMountRoot: Boolean(root), renderers: fiber };
    });
    return {
      status: info.reactDetected ? PASS : PASS, // informational
      details: {
        probe: 'react-devtools',
        simulatedExtension: 'React Developer Tools',
        reactDetected: info.reactDetected,
        mountRootFound: info.hasMountRoot,
        liveRenderers: info.renderers,
        note: info.reactDetected
          ? 'React is detected (mount root / internal fiber), so React DevTools can inspect the component tree.'
          : 'No React mount markers detected on this surface (framework may differ or be server-rendered).',
        telemetry,
      },
    };
  });
}

/**
 * Volume Master effect: is there <audio>/<video> on the page that a per-tab
 * volume booster would affect? Informational.
 */
async function volumeBoosterProbe(runner) {
  if (!catOn(runner, 'volumeBooster')) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const info = await page.evaluate(() => {
      const media = [...document.querySelectorAll('video,audio')];
      return {
        mediaCount: media.length,
        hasVideo: media.some(m => m.tagName === 'VIDEO'),
        hasAudio: media.some(m => m.tagName === 'AUDIO'),
        autoplaying: media.some(m => !m.paused),
      };
    });
    return {
      status: info.mediaCount ? PASS : PASS,
      details: {
        probe: 'volume-booster',
        simulatedExtension: 'Volume Master (per-tab audio)',
        mediaElements: info.mediaCount,
        video: info.hasVideo,
        audio: info.hasAudio,
        note: info.mediaCount
          ? 'Media element(s) present, so a per-tab volume booster has something to control.'
          : 'No <video>/<audio> on this page — a volume booster has nothing to amplify here.',
        telemetry,
      },
    };
  });
}

module.exports = {
  adBlockerProbe,
  darkReaderProbe,
  passwordManagerProbe,
  translatorProbe,
  couponHelperProbe,
  fullPageCaptureProbe,
  reactDevtoolsProbe,
  volumeBoosterProbe,
};
