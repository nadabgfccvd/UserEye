'use strict';

/**
 * Roadmap 7.5.0 item 5.5 — the "intelligence layer" pattern.
 *
 * The engine core stays deterministic (no AI, no network, no non-determinism in
 * the pipeline). Anything smarter is an OPTIONAL post-run plugin whose `afterRun`
 * receives the finished result in memory (the same payload that is then written
 * to `result.json`) and writes its own artifact. This example is a pure function
 * of the result: it summarizes score / LCP / issues into
 * `plugin-result-insights.json`.
 *
 * This is also the recommended shape if a future LLM layer ever returns: a
 * plugin whose `afterRun` consumes `result.json` and writes a file, keeping the
 * core byte-identical. Deterministic runs never depend on the plugin's output.
 */

const fs = require('fs');
const path = require('path');

async function afterRun(result, { artifactDir }) {
  // afterRun receives the finished payload in memory; result.json is written to
  // disk right after the hooks return, so never depend on the file here.
  if (!result || !result.adaptive) {
    throw new Error('result-insights: expected a completed result payload');
  }
  const metrics = (result.performance || {}).metrics || {};
  const insights = {
    plugin: 'result-insights-example',
    score: result.adaptive?.quality?.score ?? null,
    issues: result.summary?.issues ?? null,
    lcpMs: Number.isFinite(metrics.lcp?.value) ? metrics.lcp.value : null,
    qualityGatesPassed: result.qualityGates?.passed ?? null,
    generatedAt: new Date().toISOString(),
    note: 'Deterministic summary example (item 5.5). Swap the body for an LLM call if you ever want one.',
  };
  // Results are pure data: never mutate the run, only read it and write your own
  // prefixed artifact (plugin-<id>-*).
  fs.writeFileSync(
    path.join(artifactDir, 'plugin-result-insights.json'),
    `${JSON.stringify(insights, null, 2)}\n`,
  );
  return insights;
}

module.exports = { id: 'result-insights-example', afterRun };
