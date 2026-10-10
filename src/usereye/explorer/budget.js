'use strict';

/**
 * Exploration budgets (roadmap M9, Phase 6 — extracted from adaptive-explorer.js).
 *
 * A "mode" is nothing more than a budget: how many states may be observed, how
 * many actions may be taken, how deep, how many screenshots/axe passes, and
 * which viewports the responsive audit sweeps. Keeping it in its own module
 * makes the numbers reviewable on one screen — they are the single biggest
 * lever on run time, and they used to be buried at the top of a 1279-line file.
 */

const MODES = {
  quick: {
    maxStates: 6,
    maxActions: 14,
    maxDepth: 2,
    actionsPerState: 5,
    coverageTarget: 35,
    screenshots: 3,
    axeStates: 1,
    misclickTargets: 1,
    misclickPoints: ['left', 'right'],
    viewports: [{ name: 'mobile', width: 390, height: 844 }],
  },
  standard: {
    maxStates: 18,
    maxActions: 45,
    maxDepth: 4,
    actionsPerState: 9,
    coverageTarget: 65,
    screenshots: 8,
    axeStates: 4,
    misclickTargets: 3,
    misclickPoints: ['left', 'right', 'top', 'bottom'],
    viewports: [
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 768, height: 1024 },
    ],
  },
  deep: {
    maxStates: 45,
    maxActions: 120,
    maxDepth: 6,
    actionsPerState: 15,
    coverageTarget: 85,
    screenshots: 16,
    axeStates: 10,
    misclickTargets: 6,
    misclickPoints: [
      'left',
      'right',
      'top',
      'bottom',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ],
    viewports: [
      { name: 'mobile-small', width: 320, height: 700 },
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop-wide', width: 1920, height: 1080 },
    ],
  },
};

/**
 * Resolve a mode name into a budget, with per-run overrides applied on top.
 * Unknown modes fall back to `standard` rather than throwing: a budget is a
 * performance decision, never a correctness one.
 *
 * @param {'quick'|'standard'|'deep'} mode
 * @param {object} [override]
 * @returns {object} The effective budget.
 */
function mergeBudget(mode, override = {}) {
  return { ...(MODES[mode] || MODES.standard), ...override };
}

/**
 * Has this run exhausted its wall-clock allowance?
 *
 * @param {number} startedMs Epoch ms when exploration began.
 * @param {number|null} wallClockMs Allowance, or null/0 for unlimited.
 * @param {number} [now]
 */
function wallClockExceeded(startedMs, wallClockMs, now = Date.now()) {
  return wallClockMs ? now - startedMs >= wallClockMs : false;
}

/**
 * Has this run exhausted its state/action allowance?
 *
 * @param {{states:number, actions:number}} counts
 * @param {{maxStates:number, maxActions:number}} budget
 */
function budgetExhausted(counts, budget) {
  return counts.states >= budget.maxStates || counts.actions >= budget.maxActions;
}

module.exports = { MODES, budgetExhausted, mergeBudget, wallClockExceeded };
