'use strict';

const fs = require('fs');
const path = require('path');

function relativeToArtifacts(eye, filePath) {
  return path.relative(eye.artifactDir, filePath).replace(/\\/g, '/');
}

function writeJSON(eye, filename, value) {
  const filePath = path.join(eye.artifactDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(eye._sanitize(value), null, 2));
  return relativeToArtifacts(eye, filePath);
}

function compactPerception(eye) {
  return {
    observations: eye.observations.map(observation => ({
      id: observation.id,
      label: observation.label,
      path: observation.path,
      profile: observation.profile,
      url: observation.url,
      stateHash: observation.stateHash,
      counts: observation.counts,
      findings: observation.findings.map(finding => ({
        code: finding.code,
        severity: finding.severity,
        title: finding.title,
        actual: finding.actual,
        confidence: finding.confidence,
        kind: finding.kind,
        triage: finding.triage,
        acceptedPattern: finding.acceptedPattern,
      })),
    })),
    transitions: eye.observationTransitions,
    findings: eye.visualFindings,
  };
}

function persistMetadata(eye) {
  fs.mkdirSync(eye.artifactDir, { recursive: true });
  eye.artifacts.actions = writeJSON(eye, 'actions.json', eye.actions);
  eye.artifacts.experience = writeJSON(eye, 'experience-events.json', eye.experienceEvents);
  eye.artifacts.misclicks = writeJSON(eye, 'misclicks.json', eye.misclicks);
  eye.artifacts.patience = writeJSON(eye, 'patience-report.json', eye.patienceReport());
  eye.artifacts.perceptionSummary = writeJSON(eye, 'perception-summary.json', compactPerception(eye));
  if (eye.firstImpression || eye.gazes?.length) {
    eye.artifacts.gaze = writeJSON(eye, 'first-impression.json', {
      firstImpression: eye.firstImpression,
      journey: eye.journey,
      gazes: eye.gazes,
      vitals: eye.vitalsSnapshots,
      userPlan: eye.userPlan || null,
    });
  }
  if (eye.humanSignals?.length) {
    eye.artifacts.human = writeJSON(eye, 'human-signals.json', eye.humanSignals);
  }
  if (eye.userPlan) {
    eye.artifacts.userPlan = writeJSON(eye, 'user-plan.json', eye.userPlan);
  }
  if (typeof eye.thirdParties === 'function') {
    eye.artifacts.thirdParties = writeJSON(eye, 'third-parties.json', eye.thirdParties());
  }
}

/**
 * Bounds a teardown promise that could hang forever (e.g. page.evaluate while
 * a provisional navigation to a never-responding server is still pending).
 * Rejects with an Error if the operation exceeds the budget; callers decide
 * how to record it. The original promise stays attached, so a real rejection
 * that arrives before the budget still wins the race.
 */
function withTimeout(promise, ms, operation) {
  let timer;
  const guarded = Promise.resolve(promise);
  guarded.catch(() => {}); // keep a losing rejection from becoming unhandled
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([guarded, guard]).finally(() => clearTimeout(timer));
}

async function flushBrowserExperience(eye) {
  if (!eye.page || eye.page.isClosed()) {
    return;
  }
  try {
    await withTimeout(
      eye.page.evaluate(() => window.__userEyeFlushExperience?.()),
      5000,
      'flushBrowserExperience',
    );
    await eye.page.waitForTimeout(60);
  } catch {}
}

/**
 * The one definition of a "clean run" shared by the `on-failure` policies of video
 * (7.4.1) and trace (7.5.1): no blocker/critical/major issue, no harmful misclick,
 * no unexpected browser error. Kept in one place so the two artifacts can never
 * disagree about whether the run failed.
 */
function isCleanRun(eye) {
  return (
    !eye.issues.some(issue => ['blocker', 'critical', 'major'].includes(issue.severity)) &&
    eye.misclicks.every(item => item.outcome !== 'harmful') &&
    Object.values(eye._unexpectedTelemetry()).every(list => list.length === 0)
  );
}

/**
 * Stop tracing and apply the trace policy (7.5.1, roadmap 7.5.0 item 2.1).
 *
 *   'never'      — tracing was never started; nothing to stop, nothing written.
 *   'always'     — keep `user-eye-trace.zip` (pre-7.5.1 behaviour).
 *   'on-failure' — stop into the zip, then delete it when the run is clean and record
 *                  `traceDiscarded: true`; otherwise keep it and say why, exactly
 *                  like the video.
 */
async function stopTracing(eye) {
  const mode = eye.options.trace || 'always';
  if (mode === 'never') {
    eye.artifacts.trace = null;
    return;
  }
  try {
    await withTimeout(eye.context.tracing.stop({ path: eye.tracePath }), 15000, 'tracing.stop');
    if (mode === 'on-failure' && isCleanRun(eye)) {
      fs.rmSync(eye.tracePath, { force: true });
      eye.artifacts.trace = null;
      eye.artifacts.traceDiscarded = true;
      return;
    }
    eye.artifacts.trace = relativeToArtifacts(eye, eye.tracePath);
    if (mode === 'on-failure') {
      eye.artifacts.traceRetainedBecause = `trace: 'on-failure' — ${
        videoRetentionTriggers(eye).join(', ') || 'run was not clean'
      }`;
    }
  } catch (error) {
    eye.artifacts.traceError = eye._redactString(error.message);
  }
}

/**
 * What made an `on-failure` run count as a failure.
 *
 * `finalizeVideo` already decided this to compute `clean`; this returns the same
 * facts in words. Without it a run can print `Quality gates: PASS`, exit 0 and
 * still leave a `.webm` behind — which reads as a contradiction, because the gate
 * defaults only bound blockers and criticals while video retention also triggers
 * on majors. Naming the trigger removes the ambiguity instead of leaving the
 * reader to reverse-engineer it from result.json.
 */
function videoRetentionTriggers(eye) {
  const severities = ['blocker', 'critical', 'major'];
  const counts = new Map(severities.map(severity => [severity, 0]));
  for (const issue of eye.issues) {
    if (counts.has(issue.severity)) counts.set(issue.severity, counts.get(issue.severity) + 1);
  }
  const harmful = eye.misclicks.filter(item => item.outcome === 'harmful').length;
  const telemetry = Object.values(eye._unexpectedTelemetry()).reduce((total, list) => total + list.length, 0);

  const parts = [];
  for (const severity of severities) {
    const count = counts.get(severity);
    if (count) parts.push(`${count} ${severity} finding${count === 1 ? '' : 's'}`);
  }
  if (harmful) parts.push(`${harmful} harmful misclick${harmful === 1 ? '' : 's'}`);
  if (telemetry) parts.push(`${telemetry} unexpected browser error${telemetry === 1 ? '' : 's'}`);
  return parts;
}

async function finalizeVideo(eye) {
  try {
    const video = eye.page && !eye.page.isClosed() ? eye.page.video() : null;
    if (eye.page && !eye.page.isClosed()) {
      await withTimeout(eye.page.close(), 10000, 'page.close');
    }
    if (!video) {
      return;
    }
    const rawPath = await withTimeout(video.path(), 10000, 'video.path');
    const finalPath = path.join(eye.artifactDir, 'user-eye-session.webm');
    const mode = eye.options.recordVideoSetting;
    const clean = mode === 'on-failure' && isCleanRun(eye);
    if (clean) {
      // Phase 4.2: on-failure policy — a clean run has no video artifact/cost.
      eye.artifacts.videoDiscarded = true;
      return;
    }
    fs.copyFileSync(rawPath, finalPath);
    eye.artifacts.video = relativeToArtifacts(eye, finalPath);
    const triggers = mode === 'on-failure' ? videoRetentionTriggers(eye) : [];
    eye.artifacts.videoRetainedBecause =
      mode === 'on-failure'
        ? `recordVideo: 'on-failure' — ${triggers.join(', ') || 'run was not clean'}`
        : 'recordVideo: true';
  } catch (error) {
    eye.artifacts.videoError = eye._redactString(error.message);
  }
}

async function closeEye(eye) {
  if (!eye.browser) {
    return;
  }
  const browser = eye.browser;
  eye.browser = null; // repeated close() calls become no-ops
  try {
    // collectVitals runs page.evaluate, which hangs for the full default
    // timeout when a provisional navigation is still pending (e.g. the target
    // stalled). Bounded so close() always completes in a few seconds.
    await withTimeout(eye.collectVitals(), 5000, 'collectVitals');
  } catch {}
  await flushBrowserExperience(eye);
  await stopTracing(eye);
  await finalizeVideo(eye);
  await withTimeout(eye.context.close(), 15000, 'context.close').catch(() => {});
  await withTimeout(browser.close(), 15000, 'browser.close').catch(() => {});
  fs.rmSync(eye.videoDir, { recursive: true, force: true });
  eye.finishedAt = new Date().toISOString();
  persistMetadata(eye);
}

/**
 * 7.5.1 (roadmap 7.5.0 item 2.3): optional retention of previous runs for local use.
 *
 * `keepLast: 0` (default, CI): `outDir` is removed and recreated — unchanged.
 * `keepLast: n`: a non-empty `outDir` is moved to `<outDir>-history/<stamp>` first,
 * where `<stamp>` is the previous run's `finishedAt` (from its result.json) or the
 * directory mtime, then the history is pruned to the newest `n` entries. Nothing
 * outside `outDir` and `<outDir>-history` is ever touched.
 *
 * @returns {{moved: string|null, historyDir: string|null, kept: string[]}}
 */
function rotateArtifactDir(outDir, keepLast = 0) {
  const keep = Math.floor(Number(keepLast));
  if (!Number.isFinite(keep) || keep <= 0) {
    fs.rmSync(outDir, { recursive: true, force: true });
    return { moved: null, historyDir: null, kept: [] };
  }
  const historyDir = `${outDir}-history`;
  let moved = null;
  const hasPrevious = fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0;
  if (hasPrevious) {
    fs.mkdirSync(historyDir, { recursive: true });
    const base = path.join(historyDir, previousRunStamp(outDir));
    let target = base;
    for (let suffix = 2; fs.existsSync(target); suffix += 1) target = `${base}-${suffix}`;
    try {
      fs.renameSync(outDir, target);
    } catch {
      // Cross-device or locked directory: copy then remove.
      fs.cpSync(outDir, target, { recursive: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
    moved = target;
  } else {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  let kept = [];
  if (fs.existsSync(historyDir)) {
    const entries = fs
      .readdirSync(historyDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort(); // stamps are ISO-like, so lexical order is chronological
    for (const stale of entries.slice(0, Math.max(0, entries.length - keep))) {
      fs.rmSync(path.join(historyDir, stale), { recursive: true, force: true });
    }
    kept = entries.slice(Math.max(0, entries.length - keep));
  }
  return { moved, historyDir, kept };
}

function previousRunStamp(outDir) {
  let iso = null;
  try {
    const previous = JSON.parse(fs.readFileSync(path.join(outDir, 'result.json'), 'utf8'));
    iso = previous.finishedAt || previous.startedAt || null;
  } catch {}
  if (!iso || Number.isNaN(Date.parse(iso))) {
    iso = fs.statSync(outDir).mtime.toISOString();
  }
  return new Date(iso)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
}

/**
 * 7.5.1 (roadmap 7.5.0 item 2.5): measure what a run left on disk so the cost is
 * visible in result.json (`artifacts.totalBytes`, `artifacts.files`,
 * `artifacts.largest`) and on the dashboard before it becomes a complaint.
 * Walks `artifactDir` recursively; `result.json` itself is excluded here and added
 * by `writeResultJson`, which knows its final size.
 */
function measureArtifacts(artifactDir) {
  const files = [];
  const walk = dir => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        if (dir === artifactDir && entry.name === 'result.json') continue;
        try {
          files.push({
            path: path.relative(artifactDir, absolute).replace(/\\/g, '/'),
            bytes: fs.statSync(absolute).size,
          });
        } catch {}
      }
    }
  };
  walk(artifactDir);
  files.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return {
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files: files.length,
    largest: files.slice(0, 5),
  };
}

/**
 * Write `result.json` with `artifacts.totalBytes` covering every file in the
 * directory *including* result.json itself. The JSON's own length depends on the
 * number it contains, so the size is settled by a short fixed-point loop.
 * @returns {string} The absolute path of result.json.
 */
function writeResultJson(result, artifactDir) {
  const measured = measureArtifacts(artifactDir);
  result.artifacts ||= {};
  result.artifacts.files = measured.files + 1;
  result.artifacts.largest = measured.largest;
  let ownBytes = 0;
  let serialized = '';
  for (let pass = 0; pass < 4; pass += 1) {
    result.artifacts.totalBytes = measured.totalBytes + ownBytes;
    serialized = `${JSON.stringify(result, null, 2)}\n`;
    const next = Buffer.byteLength(serialized);
    if (next === ownBytes) break;
    ownBytes = next;
  }
  const filePath = path.join(artifactDir, 'result.json');
  fs.writeFileSync(filePath, serialized);
  return filePath;
}

function summarizeByStatus(items, key, initial) {
  return items.reduce((summary, item) => {
    summary[item[key]] = (summary[item[key]] || 0) + 1;
    return summary;
  }, initial);
}

function buildResult(eye, toolVersion, extra = {}) {
  const stepSummary = summarizeByStatus(eye.steps, 'status', { passed: 0, failed: 0, warning: 0 });
  const severitySummary = summarizeByStatus(eye.issues, 'severity', {
    blocker: 0,
    critical: 0,
    major: 0,
    minor: 0,
  });
  const unexpectedTelemetry = eye._unexpectedTelemetry();
  const unexpectedBrowserErrors = Object.values(unexpectedTelemetry).reduce(
    (sum, list) => sum + list.length,
    0,
  );
  const patience = eye.options.patienceEnabled ? eye.patienceReport() : null;
  return eye._sanitize({
    schemaVersion: 4,
    tool: 'UserEye UI Test Tool',
    toolVersion,
    startedAt: eye.startedAt,
    finishedAt: eye.finishedAt || new Date().toISOString(),
    summary: {
      steps: eye.steps.length,
      ...stepSummary,
      checks: eye.checks.length,
      checksPassed: eye.checks.filter(check => check.passed).length,
      checksFailed: eye.checks.filter(check => !check.passed).length,
      issues: eye.issues.length,
      severity: severitySummary,
      actions: eye.actions.length,
      experienceEvents: eye.experienceEvents.length,
      measuredInteractions: patience?.summary.measuredInteractions || 0,
      observations: eye.observations.length,
      visualFindings: eye.visualFindings.length,
      misclicks: eye.misclicks.length,
      harmfulMisclicks: eye.misclicks.filter(item => item.outcome === 'harmful').length,
      unexpectedBrowserErrors,
      retriedOperations: (eye.retriedOperations || []).length,
      patienceScore: patience?.score ?? null,
      patienceMood: patience?.mood.label || null,
      cognitiveLoad: eye.firstImpression?.cognitiveLoad?.score ?? null,
      firstImpressionCta:
        eye.firstImpression?.primaryCta?.name || eye.firstImpression?.primaryCta?.text || null,
    },
    firstImpression: eye.firstImpression,
    journey: eye.journey,
    userPlan: eye.userPlan || null,
    human: eye.humanSignals?.[0] || null,
    thirdParties: typeof eye.thirdParties === 'function' ? eye.thirdParties() : null,
    vitals: eye.vitalsSnapshots[eye.vitalsSnapshots.length - 1] || null,
    steps: eye.steps,
    checks: eye.checks,
    issues: eye.issues,
    actions: eye.actions,
    experienceEvents: eye.experienceEvents,
    misclicks: eye.misclicks,
    retriedOperations: eye.retriedOperations || [],
    patience,
    perception: {
      observations: eye.observations,
      transitions: eye.observationTransitions,
      findings: eye.visualFindings,
    },
    accessibility: eye.axeRuns,
    telemetry: eye.telemetry,
    unexpectedTelemetry,
    expectedTelemetryRules: eye.expectedTelemetryRules.map(rule => ({
      ...rule,
      url: rule.url?.toString?.() || rule.url,
      message: rule.message?.toString?.() || rule.message,
    })),
    artifacts: eye.artifacts,
    ...extra,
  });
}

module.exports = {
  buildResult,
  closeEye,
  persistMetadata,
  isCleanRun,
  rotateArtifactDir,
  measureArtifacts,
  writeResultJson,
};
