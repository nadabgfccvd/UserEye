'use strict';

const fs = require('fs');
const path = require('path');
const { writeSarif } = require('./sarif');
const { issueBody } = require('./issue-export');
const { catalog } = require('./i18n');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function md(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function severityLabel(severity, messages) {
  return messages[severity] || severity;
}

function confidenceLabel(confidence, messages) {
  if (confidence === 'high' || confidence === 'medium' || confidence === 'low') {
    return messages[confidence] || confidence;
  }
  return messages.high || 'high';
}

/**
 * 7.5.1 (roadmap 7.5.0 item 2.2): default budget, in bytes, for evidence embedded
 * as data URIs in report.html. A quick demo run produced a 580 KB report for two
 * observations because every screenshot was inlined without a ceiling. Once the
 * running total would exceed the budget, further screenshots are *linked* to the
 * neighbouring file (`screenshots/…jpg`) instead of inlined — the report stays
 * self-contained for the first N KB and readable next to the artifacts after that.
 * `Infinity` restores the pre-7.5.1 behaviour; `0` links everything.
 */
const DEFAULT_EMBED_LIMIT = 200 * 1024;

function safeArtifactPath(artifactDir, relative) {
  const absolute = path.resolve(artifactDir, relative);
  return absolute.startsWith(path.resolve(artifactDir)) ? absolute : null;
}

function dataUri(artifactDir, relative) {
  try {
    const absolute = safeArtifactPath(artifactDir, relative);
    if (!absolute) return '';
    const extension = path.extname(absolute).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(absolute).toString('base64')}`;
  } catch {
    return '';
  }
}

/** Size a screenshot would add to the HTML once base64-encoded (4/3 of the file). */
function embeddedSize(artifactDir, relative) {
  try {
    const absolute = safeArtifactPath(artifactDir, relative);
    return absolute ? Math.ceil((fs.statSync(absolute).size * 4) / 3) : 0;
  } catch {
    return 0;
  }
}

function resolveEmbedLimit(value) {
  if (value === Infinity || value === 'unlimited' || value === false) return Infinity;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : DEFAULT_EMBED_LIMIT;
}

function normalized(result) {
  const summary = result.summary || {};
  summary.severity ||= { blocker: 0, critical: 0, major: 0, minor: 0 };
  const telemetry = result.telemetry || {};
  const unexpected = result.unexpectedTelemetry || {};
  return {
    summary,
    telemetry: {
      consoleErrors: telemetry.consoleErrors || [],
      pageErrors: telemetry.pageErrors || [],
      requestFailures: telemetry.requestFailures || [],
      httpErrors: telemetry.httpErrors || [],
    },
    unexpected: {
      consoleErrors: unexpected.consoleErrors || telemetry.consoleErrors || [],
      pageErrors: unexpected.pageErrors || telemetry.pageErrors || [],
      requestFailures: unexpected.requestFailures || telemetry.requestFailures || [],
      httpErrors: unexpected.httpErrors || telemetry.httpErrors || [],
    },
    steps: result.steps || [],
    issues: result.issues || [],
    accessibility: result.accessibility || [],
    perception: result.perception || { observations: [], findings: [] },
    artifacts: result.artifacts || {},
  };
}

function tableRows(items, render, columns, empty) {
  return items.length ? items.map(render).join('') : `<tr><td colspan="${columns}">${esc(empty)}</td></tr>`;
}

function reviewModeHtml(result) {
  const perf = result.performanceLab;
  const seo = result.seo;
  const flows = result.flows;
  const strict = result.accessibilityStrict;
  let html = '';
  if (perf) {
    const m = perf.summary || {};
    const rows = Object.entries(m)
      .map(
        ([k, v]) =>
          `<div class="metric"><strong>${esc(Array.isArray(v) ? v.join(', ') : (v ?? '—'))}</strong>${esc(k)}</div>`,
      )
      .join('');
    const gates =
      (result.qualityGates?.checks || [])
        .map(
          g =>
            `<tr><td>${g.passed ? 'PASS' : 'FAIL'}</td><td><code>${esc(g.id)}</code></td><td>${esc(g.actual)}</td><td>${esc(g.expected)}</td></tr>`,
        )
        .join('') || '<tr><td colspan="4">—</td></tr>';
    html += `<h2>Performance Lab</h2><section class="panel"><div class="metrics">${rows}</div></section><table><thead><tr><th>Status</th><th>Gate</th><th>Actual</th><th>Expected</th></tr></thead><tbody>${gates}</tbody></table>`;
  }
  if (seo) {
    const checks =
      (seo.checks || [])
        .map(
          c =>
            `<tr><td>${c.passed ? 'PASS' : 'FAIL'}</td><td><code>${esc(c.id)}</code></td><td>${esc(c.actual)}</td><td>${esc(c.expected)}</td></tr>`,
        )
        .join('') || '<tr><td colspan="4">—</td></tr>';
    html += `<h2>SEO</h2><section class="panel"><div class="metric"><strong>${esc(Math.round((seo.score || 0) * 100))}%</strong>SEO score</div></section><table><thead><tr><th>Status</th><th>Audit</th><th>Actual</th><th>Expected</th></tr></thead><tbody>${checks}</tbody></table>`;
  }
  if (Array.isArray(flows)) {
    const rows =
      flows
        .map(
          f =>
            `<tr><td>${esc(f.name)}</td><td>${esc(f.browser)}</td><td><span class="pill outcome-${esc(f.status)}">${esc(f.status)}</span></td><td>${esc(f.durationMs)} ms</td><td>${esc((f.steps || []).map(s => `${s.status}: ${s.name}`).join(' | '))}</td></tr>`,
        )
        .join('') || '<tr><td colspan="5">—</td></tr>';
    html += `<h2>Critical Flows</h2><table><thead><tr><th>Flow</th><th>Browser</th><th>Status</th><th>Duration</th><th>Steps</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (strict) {
    const rows =
      (strict.findings || [])
        .slice(0, 200)
        .map(
          f =>
            `<tr><td>${esc(f.kind)}</td><td><code>${esc(f.id)}</code></td><td>${esc(f.impact)}</td><td>${esc(f.target)}</td><td><a href="${esc(f.helpUrl || '#')}">${esc(f.help || '')}</a></td></tr>`,
        )
        .join('') || '<tr><td colspan="5">—</td></tr>';
    html += `<h2>Strict Accessibility</h2><section class="panel"><div class="metrics"><div class="metric"><strong>${esc(strict.violations || 0)}</strong>Violations</div><div class="metric"><strong>${esc(strict.needsReview || 0)}</strong>Needs review</div><div class="metric"><strong>${esc(strict.standard)}</strong>Standard</div></div></section><table><thead><tr><th>Type</th><th>Rule</th><th>Impact</th><th>Target</th><th>Help</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return html;
}

function generateHtml(result, artifactDir, locale = 'en', options = {}) {
  const t = catalog(locale);
  const embedLimit = resolveEmbedLimit(options.embedLimit ?? result.report?.embedLimit);
  const view = normalized(result);
  const s = view.summary;
  const app = result.application || {};
  const appName =
    app.name ||
    app.projectName ||
    new URL(result.requestedUrl || 'https://application.invalid').hostname ||
    'Web application';
  const failed = Boolean(
    (s.severity.blocker || 0) +
    (s.severity.critical || 0) +
    (s.severity.major || 0) +
    (s.unexpectedBrowserErrors || 0),
  );
  const adaptive = result.adaptive;
  const protocols = adaptive?.protocols || result.protocols;
  const codeQuality = result.codeQuality;
  const screenshotPaths = [
    ...new Set([
      ...(view.artifacts.screenshots || []),
      ...view.steps.map(step => step.screenshot).filter(Boolean),
    ]),
  ];
  const findings = result.findings || {};
  const actionable = findings.actionable || {};
  const reviewCount = findings.review ?? null;
  const diff = result.diff;
  const diffSection = diff
    ? `<h2>${esc(t.regression)}</h2><section class="panel two">
<div><b>${esc(t.new)}</b> <span class="pill outcome-failed">${esc(diff.issues.introducedCount)}</span><br>${diff.issues.introduced.map(item => esc(`${item.severity} · ${item.id} — ${item.title}`)).join('<br>') || '—'}</div>
<div><b>${esc(t.resolved)}</b> <span class="pill outcome-passed">${esc(diff.issues.resolvedCount)}</span><br>${diff.issues.resolved.map(item => esc(`${item.severity} · ${item.id} — ${item.title}`)).join('<br>') || '—'}</div>
<div><b>${esc(t.persistent)}</b> <span class="pill">${esc(diff.issues.persistedCount)}</span><br>${diff.issues.persisted.map(item => esc(`${item.severity} · ${item.id} — ${item.title}`)).join('<br>') || '—'}</div>
<div><b>${esc(t.scoreDelta)}</b> <span class="pill ${Number(diff.scores.delta) < 0 ? 'outcome-failed' : 'outcome-passed'}">${esc(diff.scores.delta ?? '—')}</span></div>
</section>`
    : '';
  const SEV_W = { blocker: 0, critical: 1, major: 2, minor: 3 };
  const topActionable = [...view.issues]
    .filter(issue => !['signal', 'opinion'].includes(issue.kind) && issue.confidence !== 'low')
    .sort(
      (a, b) =>
        SEV_W[a.severity] - SEV_W[b.severity] ||
        (a.confidence === 'high' ? 0 : 1) - (b.confidence === 'high' ? 0 : 1),
    )
    .slice(0, 3);
  const topActionableHtml = topActionable.length
    ? `<h3>${esc(t.actionable)}</h3><div class="tops">${topActionable
        .map(
          issue =>
            `<div class="top"><span class="pill sev-${esc(issue.severity)}">${esc(
              severityLabel(issue.severity, t),
            )}</span> <b>${esc(issue.id)}</b> — ${esc(issue.title)}${
              issue.evidence ? ` <a href="${encodeURI(issue.evidence)}" target="_blank">📷</a>` : ''
            }</div>`,
        )
        .join('')}</div>`
    : '';
  const recordedIssues = Array.isArray(result.issuesAll) ? result.issuesAll : view.issues;
  const primaryIssues = view.issues.filter(
    issue => issue.kind !== 'opinion' && issue.triage !== 'accepted-pattern',
  );
  const opinionIssues = recordedIssues.filter(
    issue => issue.kind === 'opinion' || issue.triage === 'accepted-pattern',
  );
  const renderIssueRow = issue => {
    const ghPayload = {
      title: `[${issue.severity}] ${issue.id}: ${issue.title}`.slice(0, 250),
      body: issueBody(issue, result),
    };
    return `<tr>
    <td><span class="pill sev-${esc(issue.severity)}">${esc(severityLabel(issue.severity, t))}</span><br><span class="pill conf-${esc(issue.confidence || 'high')}" title="${esc(t.kind)}: ${esc(issue.kind || '')}">${esc(confidenceLabel(issue.confidence, t))}</span></td>
    <td><strong>${esc(issue.id)} — ${esc(issue.title)}</strong><small>${esc(t.step)}: ${esc(issue.step || '—')}</small></td>
    <td><b>${esc(t.expected)}:</b> ${esc(issue.expected)}<br><b>${esc(t.observed)}:</b> ${esc(issue.actual)}${issue.acceptedPattern ? `<br><b>${esc(t.acceptedPattern || 'Accepted pattern')}:</b> <code>${esc(issue.acceptedPattern)}</code>` : ''}${issue.technical ? `<details><summary>${esc(t.details)}</summary><pre>${esc(issue.technical)}</pre></details>` : ''}<br><button type="button" class="copy-issue" data-issue="${esc(JSON.stringify(ghPayload))}">${esc(t.copyIssue)}</button></td>
  </tr>`;
  };
  const issueRows = tableRows(primaryIssues, renderIssueRow, 3, t.noIssues);
  const opinionRows = tableRows(opinionIssues, renderIssueRow, 3, t.noOpinions || t.noIssues);
  const opinionSection = opinionIssues.length
    ? `<h2>${esc(t.opinions || 'Perception heuristics (opinion)')}</h2><section class="panel"><p>${esc(
        t.opinionsIntro ||
          'Recognized intentional patterns are recorded for transparency but are not treated as defects or CI failures.',
      )}</p></section><table><thead><tr><th>${esc(t.severity)} / ${esc(t.confidence)}</th><th>${esc(t.finding)}</th><th>${esc(t.details)}</th></tr></thead><tbody>${opinionRows}</tbody></table>`
    : '';
  const stepRows = tableRows(
    view.steps,
    step =>
      `<tr><td>${esc(step.number)}</td><td>${esc(step.name)}</td><td><span class="pill outcome-${esc(step.status)}">${esc(step.status)}</span></td><td>${esc(step.durationMs)} ms</td></tr>`,
    4,
    t.noData,
  );
  const gateRows = tableRows(
    adaptive?.quality?.gates || [],
    gate =>
      `<tr><td>${gate.passed ? 'PASS' : 'FAIL'}</td><td>${esc(gate.label)}</td><td>${esc(gate.weight)}</td></tr>`,
    3,
    t.noData,
  );
  const protocolRows = tableRows(
    protocols?.protocols || [],
    item =>
      `<tr><td><code>${esc(item.id)}</code></td><td>${esc(item.category)}</td><td><span class="pill outcome-${esc(item.status)}">${esc(item.status)}</span></td><td>${esc(item.durationMs ?? '—')} ms</td><td><details><summary>${esc(t.details)}</summary><pre>${esc(JSON.stringify(item.details || item.error || {}, null, 2))}</pre></details></td></tr>`,
    5,
    t.noData,
  );
  const axeRows = tableRows(
    view.accessibility,
    run =>
      `<tr><td>${esc(run.label)}</td><td>${esc(run.passes)}</td><td>${esc(run.incomplete?.length || 0)}</td><td>${esc(run.violations?.length || 0)}</td><td>${(run.violations || []).map(item => `<code>${esc(item.id)}</code>`).join(' ') || '—'}</td></tr>`,
    5,
    t.noData,
  );
  const codeRows = tableRows(
    codeQuality?.checks || [],
    check =>
      `<tr><td><code>${esc(check.id)}</code></td><td>${esc(check.command || '—')}</td><td>${esc(check.status)}</td><td>${esc(check.durationMs || 0)} ms</td></tr>`,
    4,
    t.noData,
  );
  // Embed screenshots in order until the budget is spent; link the rest. A screenshot
  // that does not exist on disk is neither embedded nor linked (noData), as before.
  let embeddedBytes = 0;
  let linkedShots = 0;
  const gallery =
    screenshotPaths
      .map((relative, index) => {
        const size = embeddedSize(artifactDir, relative);
        const fits = size > 0 && embeddedBytes + size <= embedLimit;
        const uri = fits ? dataUri(artifactDir, relative) : '';
        if (uri) embeddedBytes += size;
        const exists = size > 0;
        if (exists && !uri) linkedShots += 1;
        const image = uri
          ? `<img src="${uri}" alt="${esc(t.screenshot)} ${index + 1}">`
          : exists
            ? `<a href="${esc(relative)}"><img src="${esc(relative)}" loading="lazy" alt="${esc(t.screenshot)} ${index + 1}"></a>`
            : `<p>${esc(t.noData)}</p>`;
        return `<article class="shot"><h3>${index + 1}. ${esc(relative)}</h3>${image}</article>`;
      })
      .join('') || `<section class="panel">${esc(t.noData)}</section>`;
  const embedNote = linkedShots
    ? `<p class="embed-note"><small>${esc(
        (
          t.embedLimitNote ||
          '{linked} screenshot(s) linked instead of embedded (report.embedLimit: {limit} KB).'
        )
          .replace('{linked}', String(linkedShots))
          .replace('{limit}', String(Math.round(embedLimit / 1024))),
      )}</small></p>`
    : '';
  const artifactRows =
    Object.entries(view.artifacts)
      .filter(([, value]) => value && (!Array.isArray(value) || value.length))
      .map(
        ([key, value]) =>
          `<tr><td><code>${esc(key)}</code></td><td>${esc(typeof value === 'string' ? value : JSON.stringify(value))}</td></tr>`,
      )
      .join('') || `<tr><td colspan="2">${esc(t.noData)}</td></tr>`;

  return `<!doctype html>
<html lang="${esc(t.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UserEye — ${esc(appName)}</title>
<style>
:root{color-scheme:light dark;--bg:#f4f7fb;--panel:#fff;--text:#172033;--muted:#657087;--line:#dce3ed;--brand:#4657d5;--ok:#087f5b;--bad:#c92a2a;--warn:#a65b00} @media(prefers-color-scheme:dark){:root{--bg:#0b1020;--panel:#131a2d;--text:#edf1ff;--muted:#aab4ce;--line:#2a3552;--brand:#9aa8ff;--ok:#63e6be;--bad:#ff8787;--warn:#ffd43b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1160px;margin:auto;padding:28px 18px 70px}.hero,.panel,.shot,table{background:var(--panel);border:1px solid var(--line);border-radius:14px}.hero,.panel,.shot{padding:20px}.hero h1{font-size:34px;margin:0}.eyebrow,small{display:block;color:var(--muted)}.status{display:inline-block;margin-top:12px;padding:7px 11px;border-radius:999px;font-weight:800;background:${failed ? 'var(--bad)' : 'var(--ok)'};color:#fff}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px;margin-top:18px}.metric{padding:12px;background:color-mix(in srgb,var(--panel),var(--brand) 5%);border:1px solid var(--line);border-radius:10px}.metric strong{font-size:24px;display:block}h2{margin:34px 0 12px}.tops{margin:6px 0;display:grid;gap:4px}.top{padding:5px 0;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:baseline}.copy-issue{margin-top:6px;font:inherit;font-size:12px;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--brand);cursor:pointer}table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px;border-bottom:1px solid var(--line)}tr:last-child td{border-bottom:0}th{color:var(--muted)}.pill{display:inline-block;padding:3px 7px;border-radius:999px;font-weight:700}.sev-blocker,.sev-critical,.outcome-failed{background:#c92a2a22;color:var(--bad)}.sev-major,.outcome-warning{background:#f08c0022;color:var(--warn)}.sev-minor,.outcome-passed{background:#087f5b22;color:var(--ok)}.outcome-skipped{background:#65708722;color:var(--muted)}.conf-high{background:#087f5b22;color:var(--ok)}.conf-medium{background:#f08c0022;color:var(--warn)}.conf-low{background:#65708722;color:var(--muted)}pre{white-space:pre-wrap;overflow:auto;font-size:11px}code{color:var(--brand)}.shot{margin:12px 0}.shot img{display:block;max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:720px){.two{grid-template-columns:1fr}table{font-size:12px}th,td{padding:7px}.hero h1{font-size:27px}}
</style></head><body><main>
<section class="hero"><div class="eyebrow">${esc(t.report)} · UserEye ${esc(result.toolVersion || '')} · ${esc(result.finishedAt || '')}</div><h1>UserEye — ${esc(appName)}</h1><p>${esc(result.scopeDescription || 'Browser-first, safe, adaptive exploration with reproducible evidence.')}</p><span class="status">${esc(failed ? t.statusFailed : t.statusPassed)}</span><h2>${esc(t.summary)}</h2><div class="metrics">
${[
  [t.steps, s.steps],
  [t.passed, s.passed],
  [t.failed, s.failed],
  [t.checks, s.checks],
  [t.interactions, s.actions],
  [t.observations, s.observations],
  [t.findingsLabel, s.issues],
  [t.browserErrors, s.unexpectedBrowserErrors],
  [t.actionable, actionable.total ?? 0],
  [t.review, reviewCount ?? 0],
]
  .map(([label, value]) => `<div class="metric"><strong>${esc(value ?? 0)}</strong>${esc(label)}</div>`)
  .join('')}
</div></section>
${topActionableHtml}
<h2>${esc(t.scope)}</h2><section class="panel two"><div><b>${esc(t.application)}</b><br>${esc(appName)}<small>${esc(app.stack || '')}</small></div><div><b>${esc(t.browser)}</b><br>${esc(result.environment?.browser || 'Chromium')}<small>${esc(t.viewport)}: ${esc(result.environment?.desktopViewport || '—')} · ${esc(t.locale)}: ${esc(result.environment?.locale || '—')} · ${esc(t.timezone)}: ${esc(result.environment?.timezone || '—')}</small></div></section>
${
  adaptive
    ? `<h2>${esc(t.adaptive)}</h2><section class="panel"><div class="metrics">${[
        [t.score, adaptive.quality?.score],
        [t.states, adaptive.quality?.uniqueStates],
        [t.urls, adaptive.quality?.uniqueURLs],
        [t.coverage, `${adaptive.quality?.coveragePercent ?? 0}%`],
        [t.mode, adaptive.mode],
      ]
        .map(([label, value]) => `<div class="metric"><strong>${esc(value ?? 0)}</strong>${esc(label)}</div>`)
        .join(
          '',
        )}</div></section><h3>${adaptive.quality?.stopReason ? `<p>${esc(t.stopReason)}: <code>${esc(adaptive.quality.stopReason)}</code></p>` : ''}<h3>${esc(t.qualityGates)}</h3><table><thead><tr><th>${esc(t.status)}</th><th>${esc(t.finding)}</th><th>${esc(t.weight)}</th></tr></thead><tbody>${gateRows}</tbody></table>`
    : ''
}
${
  protocols
    ? `<h2>${esc(t.protocols)}</h2><section class="panel"><div class="metrics">${[
        [t.selected, protocols.summary?.selected],
        [t.passed, protocols.summary?.passed],
        [t.skipped, protocols.summary?.skipped],
        [t.failed, protocols.summary?.failed],
        [t.workers, protocols.summary?.configuredWorkers],
      ]
        .map(([label, value]) => `<div class="metric"><strong>${esc(value ?? 0)}</strong>${esc(label)}</div>`)
        .join(
          '',
        )}</div></section><table><thead><tr><th>${esc(t.protocol)}</th><th>${esc(t.category)}</th><th>${esc(t.status)}</th><th>${esc(t.duration)}</th><th>${esc(t.details)}</th></tr></thead><tbody>${protocolRows}</tbody></table>`
    : ''
}
${codeQuality ? `<h2>${esc(t.codeQuality)}</h2><section class="panel"><div class="metrics"><div class="metric"><strong>${esc(codeQuality.score)}</strong>${esc(t.score)}</div><div class="metric"><strong>${esc(codeQuality.summary?.passed || 0)}</strong>${esc(t.passed)}</div><div class="metric"><strong>${esc(codeQuality.summary?.failed || 0)}</strong>${esc(t.failed)}</div></div></section><table><tbody>${codeRows}</tbody></table>` : ''}
${diffSection}
${reviewModeHtml(result)}
<h2>${esc(t.issues)}</h2><table><thead><tr><th>${esc(t.severity)} / ${esc(t.confidence)}</th><th>${esc(t.finding)}</th><th>${esc(t.details)}</th></tr></thead><tbody>${issueRows}</tbody></table>
${opinionSection}
<h2>${esc(t.journey)}</h2><table><thead><tr><th>#</th><th>${esc(t.step)}</th><th>${esc(t.status)}</th><th>${esc(t.duration)}</th></tr></thead><tbody>${stepRows}</tbody></table>
<h2>${esc(t.perception)}</h2><section class="panel"><b>${esc(view.perception.observations?.length || 0)}</b> ${esc(t.observations)} · <b>${esc(view.perception.findings?.length || 0)}</b> ${esc(t.findingsLabel)}</section>
<h2>${esc(t.patienceLabel)}</h2><section class="panel"><div class="metrics"><div class="metric"><strong>${esc(result.patience?.score ?? '—')}</strong>${esc(t.score)} / 100</div><div class="metric"><strong>${esc(result.patience?.mood?.label || '—')}</strong>${esc(t.status)}</div></div></section>
<h2>${esc(t.accessibility)}</h2><table><thead><tr><th>${esc(t.run)}</th><th>${esc(t.passed)}</th><th>Incomplete</th><th>${esc(t.violations)}</th><th>${esc(t.details)}</th></tr></thead><tbody>${axeRows}</tbody></table>
<h2>${esc(t.telemetry)}</h2><section class="panel"><div class="metrics">${[
    [t.console, view.unexpected.consoleErrors.length],
    [t.pageErrors, view.unexpected.pageErrors.length],
    [t.network, view.unexpected.requestFailures.length],
    [t.http, view.unexpected.httpErrors.length],
  ]
    .map(([label, value]) => `<div class="metric"><strong>${esc(value)}</strong>${esc(label)}</div>`)
    .join('')}</div></section>
<h2>${esc(t.artifacts)}</h2><table><tbody><tr><td>${esc(t.tool)}</td><td><code>usereye</code></td></tr><tr><td>${esc(t.runner)}</td><td><code>${adaptive ? 'usereye auto' : 'usereye observe'}</code></td></tr><tr><td>${esc(t.resultJson)}</td><td><code>result.json</code></td></tr>${artifactRows}</tbody></table>
<h2>${esc(t.evidence)}</h2>${embedNote}${gallery}
<script>
(function () {
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.copy-issue') : null;
    if (!b) return;
    try {
      var p = JSON.parse(b.getAttribute('data-issue') || '{}');
      var text = '# ' + (p.title || '') + '\n\n' + (p.body || '');
      function fallbackCopy() {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
        ta.remove(); return ok;
      }
      function done() { var old = b.textContent; b.textContent = '✓'; b.disabled = true; setTimeout(function () { b.textContent = old; b.disabled = false; }, 1400); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { if (fallbackCopy()) done(); });
      } else if (fallbackCopy()) { done(); }
    } catch (e) { b.textContent = '✗'; }
  });
})();
</script>
</body></html>`;
}

function appendReviewModeMarkdown(lines, result) {
  if (result.performanceLab) {
    const m = result.performanceLab.summary || {};
    lines.push('', '## Performance Lab', '');
    for (const [key, value] of Object.entries(m))
      lines.push(`- ${key}: **${md(Array.isArray(value) ? value.join(', ') : (value ?? '—'))}**`);
  }
  if (result.seo) {
    lines.push(
      '',
      '## SEO',
      '',
      `- Score: **${Math.round((result.seo.score || 0) * 100)}%**`,
      '',
      '| Status | Audit | Actual | Expected |',
      '|---|---|---|---|',
    );
    for (const check of result.seo.checks || [])
      lines.push(
        `| ${check.passed ? 'PASS' : 'FAIL'} | ${md(check.id)} | ${md(check.actual)} | ${md(check.expected)} |`,
      );
  }
  if (Array.isArray(result.flows)) {
    lines.push('', '## Critical Flows', '', '| Flow | Browser | Status | Duration |', '|---|---|---|---|');
    for (const flow of result.flows)
      lines.push(
        `| ${md(flow.name)} | ${md(flow.browser)} | ${md(flow.status)} | ${md(flow.durationMs)} ms |`,
      );
  }
  if (result.accessibilityStrict) {
    lines.push(
      '',
      '## Strict Accessibility',
      '',
      `- Standard: **${md(result.accessibilityStrict.standard)}**`,
      `- Violations: **${result.accessibilityStrict.violations || 0}**`,
      `- Needs review: **${result.accessibilityStrict.needsReview || 0}**`,
    );
  }
}

function generateMarkdown(result, locale = 'en') {
  const t = catalog(locale);
  const view = normalized(result);
  const s = view.summary;
  const recordedIssues = Array.isArray(result.issuesAll) ? result.issuesAll : view.issues;
  const primaryIssues = view.issues.filter(
    issue => issue.kind !== 'opinion' && issue.triage !== 'accepted-pattern',
  );
  const opinionIssues = recordedIssues.filter(
    issue => issue.kind === 'opinion' || issue.triage === 'accepted-pattern',
  );
  const appName =
    result.application?.name || result.application?.projectName || result.requestedUrl || 'Web application';
  const lines = [
    `# UserEye — ${appName}`,
    '',
    `**${t.run}:** ${result.finishedAt || ''}`,
    '',
    `- ${t.steps}: **${s.steps || 0}** (${t.passed}: ${s.passed || 0}; ${t.failed}: ${s.failed || 0}; ${t.warnings}: ${s.warning || 0})`,
    `- ${t.checks}: **${s.checks || 0}**`,
    `- ${t.findingsLabel}: **${s.issues || 0}**`,
    `- ${t.browserErrors}: **${s.unexpectedBrowserErrors || 0}**`,
    '',
  ];
  if (result.adaptive?.quality) {
    lines.push(
      `## ${t.adaptive}`,
      '',
      `- ${t.score}: **${result.adaptive.quality.score}/100**`,
      `- ${t.states}: **${result.adaptive.quality.uniqueStates}**`,
      `- ${t.urls}: **${result.adaptive.quality.uniqueURLs}**`,
      `- ${t.coverage}: **${result.adaptive.quality.coveragePercent}%**`,
      '',
    );
  }
  const f = result.findings;
  if (f) {
    lines.push(`- ${t.actionable}: **${f.actionable.total}** · ${t.review}: **${f.review}**`);
  }
  appendReviewModeMarkdown(lines, result);
  lines.push(
    `## ${t.issues}`,
    '',
    `| ${t.severity} | ${t.confidence} | ${t.finding} | ${t.expected} | ${t.observed} |`,
    '|---|---|---|---|---|',
  );
  if (!primaryIssues.length) lines.push(`| — | — | ${t.noIssues} | — | — |`);
  for (const issue of primaryIssues)
    lines.push(
      `| ${md(severityLabel(issue.severity, t))} | ${md(confidenceLabel(issue.confidence, t))} | ${md(`${issue.id} — ${issue.title}`)} | ${md(issue.expected)} | ${md(issue.actual)} |`,
    );
  if (opinionIssues.length) {
    lines.push(
      '',
      `## ${t.opinions || 'Perception heuristics (opinion)'}`,
      '',
      t.opinionsIntro ||
        'Recognized intentional patterns are recorded for transparency but are not treated as defects or CI failures.',
      '',
      `| ${t.finding} | ${t.acceptedPattern || 'Accepted pattern'} | ${t.observed} |`,
      '|---|---|---|',
    );
    for (const issue of opinionIssues) {
      lines.push(
        `| ${md(`${issue.id} — ${issue.title}`)} | ${md(issue.acceptedPattern || issue.triage || 'accepted-pattern')} | ${md(issue.actual)} |`,
      );
    }
  }
  if (result.diff) {
    const d = result.diff;
    lines.push(
      '',
      `## ${t.regression}`,
      '',
      `- ${t.new}: **${d.issues.introducedCount}** · ${t.resolved}: **${d.issues.resolvedCount}** · ${t.persistent}: **${d.issues.persistedCount}**`,
      `- ${t.scoreDelta}: **${d.scores.delta ?? '—'}**`,
      '',
    );
    if (d.issues.introduced.length) {
      lines.push(`**${t.new}**`);
      for (const item of d.issues.introduced) lines.push(`- ${item.severity} · ${item.id} — ${item.title}`);
      lines.push('');
    }
  }
  lines.push('', `## ${t.journey}`, '');
  for (const step of view.steps)
    lines.push(
      `- **${String(step.status || '').toUpperCase()}** — ${step.number}. ${step.name} (${step.durationMs} ms)${step.screenshot ? ` — [${t.screenshot}](${step.screenshot})` : ''}`,
    );
  lines.push(
    '',
    `## ${t.artifacts}`,
    '',
    '- Tool: `usereye`',
    '- Result: `result.json`',
    '- HTML: `report.html`',
    '',
  );
  return `${lines.join('\n')}\n`;
}

/** Compact PR-ready markdown (Phase 8): one short comment, <= ~30 lines. */
function generateMarkdownPr(result) {
  const appName =
    result.application?.name || result.application?.projectName || result.requestedUrl || 'application';
  const score = result.adaptive?.quality?.score;
  const gates = result.qualityGates?.passed;
  const s = result.summary?.severity || {};
  const f = result.findings?.actionable;
  const lines = [`## UserEye — ${appName}`];
  lines.push(`Score **${score ?? '—'}/100** · Gates **${gates ? 'PASS' : 'FAIL'}**`);
  lines.push(
    `Issues ${result.summary?.issues ?? 0} (blocker ${s.blocker ?? 0} · critical ${s.critical ?? 0} · major ${s.major ?? 0} · minor ${s.minor ?? 0})`,
  );
  if (f) lines.push(`Actionable (high) ${f.total} · Review ${result.findings?.review ?? 0}`);
  const actionable = (result.issues || []).filter(
    i => !['signal', 'opinion'].includes(i.kind) && i.triage !== 'accepted-pattern',
  );
  if (actionable.length) {
    lines.push('', '**Findings**');
    for (const i of actionable.slice(0, 8)) {
      lines.push(`- **${i.severity}** ${i.confidence || ''} · ${i.id} — ${i.title}`);
    }
    if (actionable.length > 8) lines.push(`- … and ${actionable.length - 8} more`);
  } else {
    lines.push('', '_No actionable findings._');
  }
  if (result.diff && result.diff.issues.introducedCount) {
    lines.push('', '**New vs baseline**');
    for (const i of result.diff.issues.introduced.slice(0, 5))
      lines.push(`- ${i.severity} · ${i.id} — ${i.title}`);
  }
  lines.push('', 'Full evidence: `report.html` / `result.json` in the artifacts.');
  return `${lines.join('\n')}\n`;
}

function writeReports(result, artifactDir, options = {}) {
  const locale = options.locale || result.reportLocale || 'en';
  const formats = options.formats || result.reportFormat || ['html', 'md'];
  const selected = Array.isArray(formats) ? formats : String(formats).split(',');
  fs.mkdirSync(artifactDir, { recursive: true });
  const output = {};
  if (selected.includes('html')) {
    output.htmlPath = path.join(artifactDir, 'report.html');
    fs.writeFileSync(
      output.htmlPath,
      generateHtml(result, artifactDir, locale, {
        embedLimit: options.embedLimit ?? options.report?.embedLimit,
      }),
    );
  }
  if (selected.includes('md') || selected.includes('markdown')) {
    output.mdPath = path.join(artifactDir, 'report.md');
    fs.writeFileSync(output.mdPath, generateMarkdown(result, locale));
  }
  if (selected.includes('md-pr') || selected.includes('markdown-pr')) {
    output.mdPrPath = path.join(artifactDir, 'report-pr.md');
    fs.writeFileSync(output.mdPrPath, generateMarkdownPr(result, locale));
  }
  if (selected.includes('sarif'))
    output.sarifPath = writeSarif(result, path.join(artifactDir, 'usereye.sarif'), {
      minConfidence: options.sarif?.minConfidence ?? result.sarif?.minConfidence,
    });
  return output;
}

/**
 * One console line explaining what happened to the session video.
 *
 * Returns null when no video was configured, so calm runs that never record one
 * do not grow a line about a file that was never going to exist.
 */
function describeVideoOutcome(artifacts = {}) {
  if (artifacts.videoError) return `error — ${artifacts.videoError}`;
  if (artifacts.videoDiscarded) return "discarded — clean run (recordVideo: 'on-failure')";
  if (artifacts.video) return `kept — ${artifacts.videoRetainedBecause || 'recordVideo: true'}`;
  return null;
}

/**
 * One console line explaining what happened to the Playwright trace (7.5.1).
 * Mirrors `describeVideoOutcome`; null when tracing was off (`trace: 'never'`).
 */
function describeTraceOutcome(artifacts = {}) {
  if (artifacts.traceError) return `error — ${artifacts.traceError}`;
  if (artifacts.traceDiscarded) return "discarded — clean run (trace: 'on-failure')";
  if (artifacts.trace) return `kept — ${artifacts.traceRetainedBecause || "trace: 'always'"}`;
  return null;
}

module.exports = {
  catalog,
  generateHtml,
  generateMarkdown,
  generateMarkdownPr,
  writeReports,
  describeVideoOutcome,
  describeTraceOutcome,
  DEFAULT_EMBED_LIMIT,
};
