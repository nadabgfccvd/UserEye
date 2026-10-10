'use strict';

const { section, t, format } = require('../i18n');

/**
 * Run-quality scoring (roadmap M9, Phase 6 — extracted from adaptive-explorer.js).
 *
 * This is *self*-audit: it does not score the application, it scores the run.
 * "Did I actually observe an initial state? Did the responsive sweep finish?
 * Did I cover enough of what I discovered?" A low score here means the report
 * is thin and should not be trusted as a clean bill of health — which is why
 * `gates.minAdaptiveScore` reads it.
 */

/**
 * Build the weighted gate list describing how complete a run was.
 *
 * @param {object} explorer The AdaptiveExplorer instance (read-only).
 * @param {{coveragePercent:number}} coverage
 * @param {string} [locale] Report locale for the labels (7.5.1, roadmap item 3.3).
 *   These labels used to be hard-coded English in the pt report.
 * @returns {Array<{id:string,label:string,passed:boolean,weight:number}>}
 */
function buildGates(explorer, coverage, locale = 'en') {
  const G = section(locale, 'gateLabels');
  const label = (key, params) => {
    const template = t(G, key) || t(section('en', 'gateLabels'), key);
    return params ? format(template, params) : template;
  };
  return [
    { id: 'initial-state', label: label('initialState'), passed: explorer.states.length > 0, weight: 20 },
    {
      id: 'browser-telemetry',
      label: label('browserTelemetry'),
      passed: Boolean(explorer.eye.telemetry),
      weight: 10,
    },
    {
      id: 'state-dedup',
      label: label('stateDedup'),
      passed: explorer.stateByHash.size === explorer.states.length,
      weight: 10,
    },
    {
      id: 'responsive',
      label: label('responsive'),
      passed: explorer.responsiveAudits.some(audit => audit.status === 'completed'),
      weight: 15,
    },
    {
      id: 'accessibility',
      label: label('axePerState'),
      passed: !explorer.options.axe || explorer.axeStateHashes.size > 0,
      weight: 15,
    },
    {
      id: 'safety',
      label: label('destructive'),
      passed:
        explorer.options.allowDestructive ||
        explorer.skipped.some(item => item.reason === 'destructive-safety') ||
        ![...explorer.discoveredCandidates.values()].some(candidate => candidate.dangerous),
      weight: 10,
    },
    {
      id: 'auth',
      label: label('auth'),
      passed: !explorer.auth.detected || explorer.auth.attempted,
      weight: 10,
    },
    {
      id: 'misclick',
      label: label('misclickSample'),
      passed: explorer.misclickAudit.length > 0 || explorer.budget.misclickTargets === 0,
      weight: 10,
    },
    {
      id: 'first-impression',
      label: label('firstImpression'),
      passed: Boolean(explorer.firstImpression),
      weight: 10,
    },
    {
      id: 'budget-accounting',
      label: label('budgetCoverage', { target: explorer.budget.coverageTarget }),
      passed: coverage.coveragePercent >= explorer.budget.coverageTarget,
      weight: 10,
    },
  ];
}

/** Weighted 0-100 score from a gate list. */
function scoreGates(gates) {
  const totalWeight = gates.reduce((sum, gate) => sum + gate.weight, 0);
  if (!totalWeight) return 100;
  return Math.round(
    (gates.reduce((sum, gate) => sum + (gate.passed ? gate.weight : 0), 0) / totalWeight) * 100,
  );
}

/**
 * Assemble the full quality report for a finished exploration.
 *
 * @param {object} explorer The AdaptiveExplorer instance.
 * @returns {object} The `adaptive.quality` block.
 */
function buildQualityReport(explorer) {
  const discovered = explorer.discoveredCandidates.size;
  const accounted = explorer.accountedCandidates.size;
  const budgetLimited = Math.max(0, discovered - accounted);
  const coveragePercent = discovered ? Math.round((accounted / discovered) * 100) : 100;
  const gates = buildGates(explorer, { coveragePercent }, explorer.eye?.options?.reportLocale || 'en');
  const score = scoreGates(gates);
  const elapsedMs = Date.now() - explorer.startedMs;
  return {
    score,
    efficiency: {
      elapsedMs,
      actionsPerSecond: elapsedMs
        ? Math.round((explorer.actions.length / (elapsedMs / 1000)) * 100) / 100
        : 0,
      fullObservations: explorer.states.length,
      duplicateObservationsAvoided: explorer.duplicateStateHits,
      observationCacheHitPercent:
        explorer.states.length + explorer.duplicateStateHits
          ? Math.round(
              (explorer.duplicateStateHits / (explorer.states.length + explorer.duplicateStateHits)) * 100,
            )
          : 0,
      responsiveProfilesInParallel: explorer.responsiveAudits.length,
      axeUniqueStatesOnly: explorer.axeStateHashes.size,
    },
    gates,
    discoveredCandidates: discovered,
    accountedCandidates: accounted,
    coveragePercent,
    coverageTarget: explorer.budget.coverageTarget,
    testedActionKeys: explorer.testedActions.size,
    skippedActions: explorer.skipped.length,
    unaccountedDueToBudget: budgetLimited,
    uniqueStates: explorer.states.length,
    uniqueURLs: new Set(explorer.states.map(state => state.url)).size,
    pageTypes: [...new Set(explorer.states.map(state => state.pageType))],
    stopReason: explorer._stopReason,
    budget: explorer.budget,
  };
}

module.exports = { buildGates, buildQualityReport, scoreGates };
