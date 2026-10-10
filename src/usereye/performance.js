'use strict';

/**
 * Core Web Vitals as recordable metrics and (experimental) gates.
 * Roadmap M6, Phase 3.
 *
 * Design note — why these are `signal` by default:
 *
 * An *explorer* is a hostile environment for a performance measurement. It
 * clicks through states in an unspecified order, shares a CPU with the audit
 * passes, and records video. LCP measured that way varies by tens of percent
 * run to run. Turning that into a hard gate would produce exactly the flaky
 * red build that makes teams add `continue-on-error` and stop reading the
 * report at all.
 *
 * So the contract is:
 *   - vitals are ALWAYS summarized into `result.performance` (free, no config);
 *   - `gates.maxLcpMs` / `gates.maxCls` are optional and OFF by default;
 *   - when set, they default to `mode: 'signal'` — reported, never failing —
 *     and only become blocking with an explicit `gates.performanceMode: 'gate'`,
 *     which the docs label experimental.
 */

/** Web Vitals thresholds (good / needs-improvement boundary), per web.dev. */
const THRESHOLDS = Object.freeze({
  lcp: { good: 2500, poor: 4000, unit: 'ms' },
  fcp: { good: 1800, poor: 3000, unit: 'ms' },
  inp: { good: 200, poor: 500, unit: 'ms' },
  cls: { good: 0.1, poor: 0.25, unit: '' },
  ttfb: { good: 800, poor: 1800, unit: 'ms' },
});

const METRICS = Object.keys(THRESHOLDS);

function rate(metric, value) {
  const threshold = THRESHOLDS[metric];
  if (!threshold || value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'unknown';
  }
  const numeric = Number(value);
  return numeric <= threshold.good ? 'good' : numeric <= threshold.poor ? 'needs-improvement' : 'poor';
}

/**
 * Reduce every vitals snapshot taken during a run into one comparable block.
 *
 * Snapshots are aggregated with `max` rather than `mean`: for LCP/CLS the worst
 * state a user can land on is the honest number, and a mean would let one fast
 * state hide a slow one.
 *
 * @param {Array<object>} snapshots `eye.vitalsSnapshots`.
 * @returns {{samples:number, metrics:object, worstStates:object}}
 */
function summarizeVitals(snapshots = []) {
  const usable = (Array.isArray(snapshots) ? snapshots : []).filter(Boolean);
  const metrics = {};
  const worstStates = {};
  for (const metric of METRICS) {
    let worst = null;
    let worstUrl = null;
    for (const snapshot of usable) {
      const source = snapshot.vitals || snapshot;
      const value = Number(source?.[metric]);
      if (!Number.isFinite(value)) continue;
      if (worst === null || value > worst) {
        worst = value;
        worstUrl = source.url || snapshot.url || null;
      }
    }
    metrics[metric] = {
      value: worst,
      rating: rate(metric, worst),
      unit: THRESHOLDS[metric].unit,
      good: THRESHOLDS[metric].good,
      poor: THRESHOLDS[metric].poor,
    };
    worstStates[metric] = worstUrl;
  }
  const longTasks = usable.reduce((sum, snapshot) => {
    const source = snapshot.vitals || snapshot;
    return sum + (Number(source?.longTasks) || 0);
  }, 0);
  return {
    samples: usable.length,
    metrics,
    worstStates,
    longTasks,
    // An explorer's measurements are noisy by construction; say so in the data
    // itself so a consumer never mistakes this for a lab measurement.
    measurement: 'exploratory',
    note: 'Measured while exploring, with audits and recording active. Treat as a trend signal, not a lab benchmark.',
  };
}

/**
 * Build the (optional) performance checks.
 *
 * @param {object} performance Output of `summarizeVitals`.
 * @param {object} gates `config.gates`.
 * @returns {Array<{id:string, passed:boolean, actual:*, expected:string, mode:'signal'|'gate', experimental:true}>}
 */
function performanceChecks(performance, gates = {}) {
  const checks = [];
  // 'signal' (default) reports without ever failing the run. 'gate' is opt-in
  // and documented as experimental.
  const mode = gates.performanceMode === 'gate' ? 'gate' : 'signal';
  const add = (id, metric, limit) => {
    if (limit === undefined || limit === null) return;
    const actual = performance.metrics?.[metric]?.value ?? null;
    const within = actual === null || actual <= Number(limit);
    checks.push({
      id,
      // In 'signal' mode the check never reports a failure, so it cannot move
      // the exit code. The measured value is still right there to read.
      passed: mode === 'gate' ? within : true,
      actual,
      expected: `<= ${limit}${THRESHOLDS[metric].unit}`,
      within,
      mode,
      experimental: true,
    });
  };
  add('max-lcp-ms', 'lcp', gates.maxLcpMs);
  add('max-cls', 'cls', gates.maxCls);
  add('max-inp-ms', 'inp', gates.maxInpMs);
  return checks;
}

module.exports = { METRICS, THRESHOLDS, performanceChecks, rate, summarizeVitals };
