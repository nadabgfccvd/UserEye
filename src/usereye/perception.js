'use strict';

const { collectBrowserPerception } = require('./browser-perception');
const { findingStrings } = require('./i18n');

/**
 * Browser-side visual perception for UserEye.
 *
 * This intentionally inspects only what a browser user can encounter: rendered
 * geometry, visible text, focus, controls, dialogs, alerts and pointer hit-tests.
 * It does not call application APIs or read framework state.
 *
 * `options.locale` selects the language of the finding titles/details produced
 * inside the browser (defaults to English, matching `reportLocale`'s default).
 */
async function capturePerception(page, options = {}) {
  const settings = {
    profile: options.profile || 'desktop',
    touchTarget: Number(options.touchTarget || 44),
    maxText: Number(options.maxText || 5000),
    maxControls: Number(options.maxControls || 300),
    strings: findingStrings(options.locale || 'en'),
  };

  try {
    return await page.evaluate(collectBrowserPerception, settings);
  } catch (error) {
    let url = '';
    let title = '';
    try {
      url = page.url();
      title = await page.title();
    } catch {
      /* page already gone */
    }
    return {
      capturedAt: new Date().toISOString(),
      profile: settings.profile,
      url,
      title,
      lang: '',
      viewport: {
        width: 0,
        height: 0,
        devicePixelRatio: 1,
        scrollX: 0,
        scrollY: 0,
        documentWidth: 0,
        documentHeight: 0,
      },
      activeElement: null,
      visibleText: '',
      headings: [],
      landmarks: [],
      dialogs: [],
      alerts: [],
      overlays: [],
      controls: [],
      counts: {
        controls: 0,
        controlsInViewport: 0,
        headings: 0,
        landmarks: 0,
        dialogs: 0,
        alerts: 0,
        overlays: 0,
        visibleHidden: 0,
        ariaHiddenVisible: 0,
        brokenImages: 0,
        unlabeledFields: 0,
        contrastFails: 0,
      },
      findings: [
        {
          code: 'perception-failed',
          severity: 'major',
          title: 'Visual perception could not run on this page',
          actual: String(error.message || error).slice(0, 500),
          evidence: [],
        },
      ],
      degraded: true,
    };
  }
}

module.exports = { capturePerception };
