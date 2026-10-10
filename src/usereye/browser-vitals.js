'use strict';

/** Browser-context vitals collector. Must remain self-contained for addInitScript(). */
function installUserEyeVitals() {
  if (window.__userEyeVitalsInstalled) {
    return;
  }
  window.__userEyeVitalsInstalled = true;
  const store = {
    lcp: null,
    cls: 0,
    inp: null,
    fcp: null,
    ttfb: null,
    longTasks: 0,
    longTaskMs: 0,
  };
  window.__userEyeVitals = store;

  const observe = (type, handler) => {
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          handler(entry);
        }
      });
      observer.observe({ type, buffered: true });
    } catch {
      // Older Chromium builds may reject an entry type.
    }
  };

  observe('largest-contentful-paint', entry => {
    store.lcp = Math.round(entry.startTime);
  });
  observe('paint', entry => {
    if (entry.name === 'first-contentful-paint') {
      store.fcp = Math.round(entry.startTime);
    }
  });
  observe('layout-shift', entry => {
    if (!entry.hadRecentInput) {
      store.cls = Math.round((store.cls + entry.value) * 1000) / 1000;
    }
  });
  observe('event', entry => {
    const delay = Math.round(entry.duration || entry.processingStart - entry.startTime || 0);
    if (store.inp === null || delay > store.inp) {
      store.inp = delay;
    }
  });
  observe('longtask', entry => {
    store.longTasks += 1;
    store.longTaskMs += Math.round(entry.duration || 0);
  });

  const navigation = performance.getEntriesByType?.('navigation')?.[0];
  if (navigation) {
    store.ttfb = Math.round(navigation.responseStart || 0);
  }

  window.__userEyeCollectVitals = () => {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    return {
      ...store,
      ttfb: store.ttfb ?? (nav ? Math.round(nav.responseStart || 0) : null),
      transferSize: nav?.transferSize ?? null,
      encodedBodySize: nav?.encodedBodySize ?? null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd || 0) : null,
      loadEventMs: nav ? Math.round(nav.loadEventEnd || 0) : null,
      url: location.href,
      collectedAt: new Date().toISOString(),
    };
  };
}

function rateVitals(vitals = {}) {
  const findings = [];
  const rating = (metric, value, good, poor, unit) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return { metric, value: null, rating: 'unknown' };
    }
    const numeric = Number(value);
    const level = numeric <= good ? 'good' : numeric <= poor ? 'needs-improvement' : 'poor';
    if (level === 'poor') {
      findings.push({
        code: `vital-${metric}`,
        severity: 'major',
        title: `${metric.toUpperCase()} percebido como lento`,
        actual: `${numeric}${unit} (limite pobre: ${poor}${unit}).`,
      });
    } else if (level === 'needs-improvement') {
      findings.push({
        code: `vital-${metric}`,
        severity: 'minor',
        title: `${metric.toUpperCase()} acima do ideal`,
        actual: `${numeric}${unit} (ideal ≤ ${good}${unit}).`,
      });
    }
    return { metric, value: numeric, rating: level };
  };

  return {
    lcp: rating('lcp', vitals.lcp, 2500, 4000, ' ms'),
    fcp: rating('fcp', vitals.fcp, 1800, 3000, ' ms'),
    inp: rating('inp', vitals.inp, 200, 500, ' ms'),
    cls: rating('cls', vitals.cls, 0.1, 0.25, ''),
    ttfb: rating('ttfb', vitals.ttfb, 800, 1800, ' ms'),
    longTasks: vitals.longTasks || 0,
    findings,
  };
}

module.exports = { installUserEyeVitals, rateVitals };
