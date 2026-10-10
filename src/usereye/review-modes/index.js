'use strict';

const { createLogger } = require('../logger');
const { runPerformanceSeo } = require('./perf-seo-runner');
const { runFlows } = require('./flow-runner');
const { runStrictAccessibility } = require('./strict-a11y-runner');

/**
 * Human-readable close-out for a review-mode run.
 *
 * 7.5.1 fix: `perf-seo` and `a11y-strict` wrote their reports and exited — stdout
 * and stderr both empty — so a run that failed its gates looked identical to a
 * crash, and `exit 1` came with no stated reason. The `normal` path has always
 * printed an `=== UserEye ===` block; this gives the review modes the same
 * courtesy, in the same shape, from the one place all three converge.
 *
 * Honours `--log-level`/`--log-json` like the rest of the CLI, so `--log-level
 * silent` still produces no output and JSON mode stays machine-readable.
 */
function reportOutcome(config, outcome) {
  if (!outcome || !outcome.result) return;
  const logger = createLogger({ level: config.logLevel, json: config.logJson });
  const result = outcome.result;
  const summary = result.summary || {};
  const review = result.review || {};

  logger.info(`\n=== UserEye — review mode: ${result.reviewMode || config.reviewMode} ===`);
  if (result.requestedUrl) logger.info(`Target: ${result.requestedUrl}`);
  logger.info(
    `Steps: ${summary.steps || 0} (passed ${summary.passed || 0} · failed ${summary.failed || 0} · warnings ${summary.warning || 0})`,
  );
  logger.info(`Checks: ${summary.checks || 0} · findings: ${summary.issues || 0}`);

  const severity = summary.severity || {};
  logger.info(
    `Severity: blocker ${severity.blocker || 0} · critical ${severity.critical || 0} · major ${severity.major || 0} · minor ${severity.minor || 0}`,
  );
  logger.info(`Unexpected browser errors: ${summary.unexpectedBrowserErrors || 0}`);

  // Mode-specific headline: the number a reader of this mode actually came for.
  if (result.seo && typeof result.seo.score === 'number') {
    logger.info(`SEO score: ${Math.round(result.seo.score * 100)}%`);
  }
  const lab = result.performanceLab && result.performanceLab.summary;
  if (lab) {
    logger.info(
      `Performance: LCP ${lab.lcpMs ?? '—'} ms · FCP ${lab.fcpMs ?? '—'} ms · CLS ${lab.cls ?? '—'}`,
    );
  }

  // State the reason for the exit code rather than leaving the caller to infer it.
  const passed = review.passed === true;
  logger.info(`Review gates: ${passed ? 'PASS' : 'FAIL'}`);
  if (!passed) {
    const gates = (review.summary && review.summary.gates) || summary.issues || 0;
    logger.info(`Exit 1 — ${gates} gate finding(s); see the report for the breakdown.`);
  }
  if (outcome.artifactDir) logger.info(`Artifacts: ${outcome.artifactDir}`);
}

async function runReviewMode(config, argv, runtime) {
  let outcome;
  if (config.reviewMode === 'perf-seo') outcome = await runPerformanceSeo(config, runtime);
  else if (config.reviewMode === 'flows') outcome = await runFlows(config, runtime);
  else if (config.reviewMode === 'a11y-strict') outcome = await runStrictAccessibility(config, runtime);
  else throw new Error(`Unsupported reviewMode dispatcher target: ${config.reviewMode}`);

  reportOutcome(config, outcome);
  return outcome;
}

module.exports = { runReviewMode, reportOutcome };
