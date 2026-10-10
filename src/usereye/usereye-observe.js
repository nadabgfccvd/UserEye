#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { UserEye } = require('./user-eye');
const { loadConfig, writeResolvedConfig } = require('./config');
const { writeReports, describeVideoOutcome, describeTraceOutcome } = require('./report');
const { rotateArtifactDir, writeResultJson } = require('./artifact-store');
const { createLogger } = require('./logger');
const { section, t } = require('./i18n');
const { applyFindingsPolicy } = require('./findings');

/** Severity ranking used by `failOn` (roadmap 7.5.0 item 3.4). */
const SEVERITY_RANK = Object.freeze({ minor: 0, major: 1, critical: 2, blocker: 3 });

/**
 * Exit code of an observe run under `failOn`:
 *  - unexpected browser errors always exit 1 (the instrument itself failed);
 *  - 'never' → findings never fail a run;
 *  - accepted-pattern opinions never fail a run;
 *  - default (null = historical contract) or 'minor' → any other surfaced issue exits 1;
 *  - major/critical/blocker → only other issues at or above that severity.
 */
function observeExitCode(result, failOn) {
  if ((result.summary?.unexpectedBrowserErrors ?? 0) > 0) return 1;
  const recorded = Array.isArray(result.issues) ? result.issues : [];
  const gateIssues = recorded.filter(
    issue => issue.kind !== 'opinion' && issue.triage !== 'accepted-pattern',
  );
  if (!failOn) {
    // Backward compatible for unclassified findings, while a recognized accepted
    // pattern is never promoted back into a CI defect merely because it is visible
    // in the forensic issue list.
    return gateIssues.length > 0 || (!recorded.length && (result.summary?.issues ?? 0) > 0) ? 1 : 0;
  }
  if (failOn === 'never') return 0;
  if (!gateIssues.length) return 0;
  const threshold = SEVERITY_RANK[failOn] ?? 0;
  const worst = gateIssues.reduce((max, issue) => Math.max(max, SEVERITY_RANK[issue.severity] ?? 0), -1);
  return worst >= threshold ? 1 : 0;
}

const USAGE = `Usage: usereye observe [url] [options]

  --url <href>              Target URL (or use a positional URL)
  --config <path>           JS, MJS, CJS, or JSON config
  --mobile                  390x844 viewport
  --viewport <WxH>          Explicit viewport, for example 1440x900
  --headed                  Show the browser window
  --browser <name>          chromium (default), firefox, or webkit
  --axe                     Run axe-core
  --locale <tag>            Browser locale (default en-US)
  --timezone <id>           Browser timezone (default UTC)
  --color-scheme <value>    light, dark, or no-preference
  --storage-state <path>    Playwright storage state JSON
  --wait <ms>               Settle delay (default 500)
  --navigation-timeout <ms> Navigation timeout (default 15000)
  --retries <n>             Retries for transient navigation failures (default 1)
  --min-delay <ms>          Minimum delay between actions
  --out <dir>               Artifact directory
  --keep-last <n>           Keep the newest n previous runs under <out>-history/
  --report-locale <tag>     en | pt | pt-BR | es | fr | auto
  --report-format <list>    html,md,md-pr,sarif
  --ignore-https-errors     Do not fail on TLS errors
  --video / --video-on-failure / --no-video
                            Session video policy (default: on-failure)
  --trace <policy>          on-failure (default), always, or never
  --fail-on <level>         never | minor | major | critical | blocker
                            Default: any non-opinion finding exits 1. Browser errors always exit 1.
  --log-level <level>       error | warn | info | debug | trace (default info)
  --log-json                Emit structured JSON logs on stdout
  -h, --help

Exit codes: 0 clean observation; 1 findings (see --fail-on); 2 usage/setup.
`;

async function runObserve(argv = process.argv.slice(2), runtime = {}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return { exitCode: 0 };
  }
  const config = await loadConfig({
    argv,
    cwd: runtime.cwd || process.cwd(),
    env: runtime.env || process.env,
  });
  const url = config.baseURL || config.url;
  if (!url) throw new Error('A target URL is required. Pass a positional URL, --url, or baseURL in config.');
  const parsedWait = (() => {
    const index = argv.indexOf('--wait');
    return index >= 0 ? Number(argv[index + 1]) : 500;
  })();
  if (!Number.isFinite(parsedWait) || parsedWait < 0)
    throw new Error('--wait must be a non-negative number.');
  const artifactDir = config.outDir;
  if (!config.keepArtifacts) {
    const rotation = rotateArtifactDir(artifactDir, config.keepLast);
    if (rotation.moved) console.log(`Previous run kept: ${rotation.moved} (keepLast: ${config.keepLast})`);
  }
  fs.mkdirSync(artifactDir, { recursive: true });
  writeResolvedConfig(config, artifactDir);

  const logger = createLogger({ level: config.logLevel, json: config.logJson });
  const eye = new UserEye({
    artifactDir,
    logger,
    headless: !config.headed,
    browser: config.browser,
    retries: config.retries,
    retryBackoffMs: config.retryBackoffMs,
    navigationTimeoutMs: config.navigationTimeoutMs,
    dialogTimeoutMs: config.dialogTimeoutMs,
    minActionDelayMs: config.minActionDelayMs,
    recordVideo: config.recordVideo,
    trace: config.trace,
    viewport: config.viewport,
    locale: config.locale,
    timezoneId: config.timezoneId,
    colorScheme: config.colorScheme,
    storageState: config.storageState || undefined,
    ignoreHTTPSErrors: config.ignoreHTTPSErrors,
    acceptDownloads: config.allowDownloads,
    reportLocale: config.reportLocale,
  });
  eye.registerSecret(Object.values(config.credentials || {}));

  let observation;
  let fatal;
  let launched = false;
  try {
    await eye.launch();
    launched = true;
    await eye.goto(url);
    if (parsedWait && eye.page && !eye.page.isClosed()) {
      await eye.page.waitForTimeout(parsedWait).catch(() => {});
    }
    const firstImpressionLabel = t(section(config.reportLocale, 'issue'), 'firstImpression');
    observation = await eye.scanVisualHealth(firstImpressionLabel, {
      profile: config.viewport.width <= 480 ? 'mobile' : 'desktop',
      screenshot: true,
      fullPage: true,
      addIssues: true,
    });
    if (config.axe) await eye.runAxe(firstImpressionLabel, require.resolve('axe-core/axe.min.js'));
  } catch (error) {
    fatal = error;
    if (!launched) throw error;
  } finally {
    try {
      await eye.close();
    } catch {
      /* already closed by a hostile page */
    }
  }

  const result = eye.result({
    mode: 'single-page-observation',
    requestedUrl: url,
    application: { name: config.appName || new URL(url).hostname, baseURL: url },
    environment: {
      browser: `${String(config.browser || 'chromium')
        .charAt(0)
        .toUpperCase()}${String(config.browser || 'chromium').slice(1)} ${eye.browser?.version?.() || ''}`.trim(),
      locale: config.locale,
      timezone: config.timezoneId,
      desktopViewport: `${config.viewport.width}×${config.viewport.height}`,
      colorScheme: config.colorScheme,
    },
    reportLocale: config.reportLocale,
    reportFormat: config.reportFormat,
    fatalError: fatal ? { message: fatal.message } : null,
  });
  // `observe` now uses the same confidence/kind triage as `auto`. Recognized
  // accepted patterns remain in `issuesAll` for auditability but do not pollute
  // the primary issue list or fail a default run.
  const findingsResult = applyFindingsPolicy(result, config.findings);
  result.issues = findingsResult.issues;
  result.issuesAll = findingsResult.allAnnotated;
  result.findings = findingsResult.findings;
  result.summary = {
    ...result.summary,
    issues: findingsResult.summary.issues,
    issuesRecorded: findingsResult.allAnnotated.length,
    severity: findingsResult.summary.severity,
  };
  result.artifacts.resolvedConfig = 'resolved-config.json';
  fs.writeFileSync(path.join(artifactDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const reports = writeReports(result, artifactDir, {
    locale: config.reportLocale,
    formats: config.reportFormat,
    report: config.report,
  });
  writeResultJson(result, artifactDir); // 7.5.1: artifacts.totalBytes incl. the reports
  const videoOutcome = describeVideoOutcome(result.artifacts);
  const traceOutcome = describeTraceOutcome(result.artifacts);
  const summary = [
    `UserEye observation: ${url}`,
    `Controls: ${observation?.counts.controlsInViewport ?? 0}`,
    `Visual findings: ${observation?.findings.length ?? 0}`,
    `Issues: ${result.summary.issues}`,
    `Unexpected browser errors: ${result.summary.unexpectedBrowserErrors}`,
    // Omitted entirely when no video was configured, so a never-recorded run does
    // not grow a line about a file that was never going to exist.
    videoOutcome ? `Video: ${videoOutcome}` : null,
    traceOutcome ? `Trace: ${traceOutcome}` : null,
    `Artifacts: ${artifactDir}`,
  ]
    .filter(Boolean)
    .join('\n');
  fs.writeFileSync(path.join(artifactDir, 'summary.txt'), `${summary}\n`);
  logger.info(summary);
  return {
    // 7.5.1 (item 3.4): `--fail-on` turns observe into a severity gate. Default
    // (null) keeps the historical contract: any issue exits 1.
    exitCode: observeExitCode(result, config.failOn),
    artifactDir,
    result,
    reports,
  };
}

async function main() {
  try {
    const output = await runObserve();
    process.exitCode = output.exitCode;
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { USAGE, runObserve, observeExitCode, SEVERITY_RANK };
