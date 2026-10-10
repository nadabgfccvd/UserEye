'use strict';

const fs = require('fs');
const path = require('path');
const { ORDER } = require('./findings');

const LEVELS = { blocker: 'error', critical: 'error', major: 'error', minor: 'warning' };

const TOOL_VERSION = require('./package.json').version;

/**
 * Resolve the SARIF `informationUri` from package.json's declared repository.
 * Returns null when the package ships no repository (the honest state for an
 * unpublished delivery), so the field is omitted instead of pointing at a 404.
 *
 * @param {{repository?: string|{url?: string}}} [pkg]
 * @returns {string|null}
 */
function resolveInformationUri(pkg = require('./package.json')) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!url) return null;
  // npm allows the shorthand "owner/repo" as well as git+/ssh/https URLs.
  const shorthand = /^[\w.-]+\/[\w.-]+$/.test(url) ? `https://github.com/${url}` : url;
  const normalized = shorthand
    .replace(/^git\+/, '')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
  return /^https?:\/\//.test(normalized) ? normalized : null;
}

const INFORMATION_URI = resolveInformationUri();

/**
 * Phase E (7.4.1): SARIF is consumed by GitHub code scanning, where a wall of
 * low-confidence heuristics trains reviewers to ignore the tab. The export
 * therefore has its own confidence floor, defaulting to `medium` (high + medium),
 * configurable via `sarif.minConfidence`. `result.json` is unaffected and still
 * holds every finding.
 */
const SARIF_MIN_CONFIDENCE_LEVELS = ['low', 'medium', 'high'];
const DEFAULT_SARIF_MIN_CONFIDENCE = 'medium';

function normalizeSarifMinConfidence(value) {
  return SARIF_MIN_CONFIDENCE_LEVELS.includes(value) ? value : DEFAULT_SARIF_MIN_CONFIDENCE;
}

/**
 * Unclassified findings (confidence absent — e.g. axe violations synthesized from
 * `result.accessibility` below) are always kept: an authoritative axe rule hit is
 * not a heuristic, and dropping it would be a real loss of signal.
 */
function passesSarifFloor(issue, minRank) {
  if (issue.kind === 'opinion' || issue.triage === 'accepted-pattern') return false;
  const rank = ORDER[issue.confidence];
  return rank === undefined || rank >= minRank;
}

function sarifResult(issue) {
  const result = {
    ruleId: issue.fingerprint || issue.id || 'usereye-finding',
    level: LEVELS[issue.severity] || 'warning',
    message: { text: `${issue.title || 'UserEye finding'}: ${issue.actual || issue.expected || ''}` },
    properties: {
      severity: issue.severity || 'major',
      confidence: issue.confidence || null,
      kind: issue.kind || null,
      code: issue.code || null,
      source: issue.source || null,
      issueId: issue.id || null,
      step: issue.step || null,
      evidence: issue.evidence || null,
    },
  };
  if (issue.file) {
    result.locations = [
      {
        physicalLocation: {
          artifactLocation: { uri: String(issue.file).replace(/\\/g, '/') },
          region: { startLine: Math.max(1, Number(issue.line) || 1) },
        },
      },
    ];
  }
  return result;
}

function buildSarif(result, options = {}) {
  const minConfidence = normalizeSarifMinConfidence(options.minConfidence);
  const minRank = ORDER[minConfidence];
  const recorded = [...(result.issues || [])];
  const issues = recorded.filter(issue => passesSarifFloor(issue, minRank));
  const heldBack = recorded.length - issues.length;
  for (const run of result.accessibility || []) {
    for (const violation of run.violations || []) {
      issues.push({
        id: `axe-${violation.id}`,
        fingerprint: `axe/${violation.id}`,
        severity: ['critical', 'serious'].includes(violation.impact) ? 'critical' : 'minor',
        title: `axe: ${violation.help || violation.id}`,
        actual: `${violation.nodes?.length || violation.nodes || 0} affected node(s). ${violation.helpUrl || ''}`,
      });
    }
  }
  const rules = [
    ...new Map(
      issues.map(issue => {
        const id = issue.fingerprint || issue.id || 'usereye-finding';
        return [
          id,
          {
            id,
            name: issue.id || id,
            shortDescription: { text: issue.title || 'UserEye finding' },
            defaultConfiguration: { level: LEVELS[issue.severity] || 'warning' },
            properties: { tags: ['usereye', issue.severity || 'finding'] },
          },
        ];
      }),
    ).values(),
  ];
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'UserEye',
            // Single source of version truth (Phase A): fall back to package.json,
            // never to a hardcoded generation.
            version: result.toolVersion || TOOL_VERSION,
            // `informationUri` is only emitted when package.json declares a real
            // repository. Shipping a link to an org that 404s is worse than
            // shipping no link (Phase B5).
            ...(INFORMATION_URI ? { informationUri: INFORMATION_URI } : {}),
            rules,
          },
        },
        results: issues.map(sarifResult),
        invocations: [{ executionSuccessful: !result.fatalError, endTimeUtc: result.finishedAt }],
        // Transparency: a SARIF consumer can see that findings were filtered and
        // where the unfiltered set lives, instead of assuming the run was clean.
        properties: {
          minConfidence,
          heldBackBelowFloor: heldBack,
          fullEvidence: 'result.json#issuesAll',
        },
      },
    ],
  };
}

function writeSarif(result, filePath, options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(buildSarif(result, options), null, 2)}\n`);
  return filePath;
}

module.exports = {
  buildSarif,
  writeSarif,
  normalizeSarifMinConfidence,
  resolveInformationUri,
  DEFAULT_SARIF_MIN_CONFIDENCE,
};
