'use strict';

/**
 * Finding confidence & kind model (ROADMAP-NEXT Phase 1).
 *
 * Pure, additive classification of UserEye findings so reports and CI gates can
 * separate *actionable, high-confidence defects* from *heuristic signals*.
 *
 *  - confidence: 'high' | 'medium' | 'low'   how sure we are the finding is real
 *  - kind:       'defect' | 'risk' | 'signal' | 'opinion'  defect = concrete breakage,
 *               risk = likely-but-context-dependent, signal = informational heuristic, opinion = recognized accepted pattern
 *
 * The classifier keys on issue `source`/`code` when the engine provided them,
 * else it parses them from the stable `fingerprint` (e.g. `visual:horizontal-overflow:...`,
 * `axe:<label>:<rule-id>`, `misclick:<target>:<point>:harmful`, `code-quality:<id>`).
 * Explicit `issue.confidence`/`issue.kind` always win, then config policy overrides.
 */

const CONFIDENCE_LEVELS = ['low', 'medium', 'high'];
const KINDS = ['defect', 'risk', 'signal', 'opinion'];
const ORDER = { low: 0, medium: 1, high: 2 };

const DEFAULT_FINDING_POLICY = Object.freeze({
  minConfidence: 'low',
  gateConfidence: 'high',
  suppress: [],
  elevate: [],
  treatAsSignal: [],
});

/** Human/perception heuristics that are informational, not actionable breakage. */
const SIGNAL_CODES = new Set([
  'missing-favicon',
  'missing-tab-title',
  'missing-lang',
  'missing-title',
  'heading-order-skip',
  'skip-link',
  'horizontal-overflow',
]);

function isSeverityIn(severity, allowed) {
  return allowed.includes(severity);
}

/**
 * Derive {source, code, outcome} from a fingerprint prefix when the engine has not
 * supplied an explicit source/code. Stable, additive, never changes identity.
 */
function parseFingerprint(fingerprint, issue = {}) {
  const fp = String(fingerprint || '');
  const parts = fp.split(':');
  const source = issue.source || parts[0] || null;
  let code = issue.code;
  let outcome;
  if (source === 'visual' || source === 'perception') {
    // visual:<code>:<url>:<profile>
    code = code || parts[1] || null;
  } else if (source === 'a11y' || source === 'axe') {
    // axe:<label>:<rule-id>
    code = code || parts[2] || parts[1] || null;
  } else if (source === 'misclick') {
    // misclick:<target>:<point>:<outcome>
    outcome = parts[parts.length - 1] || null;
    code = code || outcome || null;
  } else if (source === 'code-quality' || source === 'code-quality-static') {
    code = code || parts[1] || null;
  } else {
    code = code || parts[1] || null;
  }
  return { source, code, outcome };
}

/**
 * Default confidence/kind for an issue with no explicit tags.
 * Order: explicit > source/code rules > severity fallback.
 */
function defaultConfidence(issue) {
  const severity = issue.severity || 'major';
  const { source, code, outcome } = parseFingerprint(issue.fingerprint, issue);
  // Real, deterministic automation failures.
  if (source === 'engine' || source === 'code-quality') {
    return { confidence: 'high', kind: 'defect' };
  }
  if (source === 'a11y' || source === 'axe') {
    // axe serious/critical (critical/major severity) are high; moderate (minor) medium.
    return {
      confidence: severity === 'minor' ? 'medium' : 'high',
      kind: 'defect',
    };
  }
  if (source === 'misclick') {
    if (outcome === 'harmful') return { confidence: 'high', kind: 'defect' };
    if (outcome === 'confusing') return { confidence: 'medium', kind: 'risk' };
    return null; // harmless / observed -> not surfaced
  }
  if (source === 'consent' || code === 'consent-wall' || (code || '').includes('consent')) {
    return { confidence: 'low', kind: 'risk' };
  }
  // Perception / visual heuristics.
  if (source === 'perception' || source === 'visual') {
    if (isSeverityIn(severity, ['blocker', 'critical'])) {
      return { confidence: 'high', kind: 'defect' };
    }
    if (SIGNAL_CODES.has(code)) return { confidence: 'low', kind: 'signal' };
    // Genuine high-signal contrast/occlusion when the engine can be specific.
    if (code === 'insufficient-contrast') return { confidence: 'high', kind: 'defect' };
    // Everything else from heuristics is a risk until a team elevates it.
    return severity === 'major'
      ? { confidence: 'medium', kind: 'risk' }
      : { confidence: 'low', kind: severity === 'minor' ? 'risk' : 'signal' };
  }
  // Fallback by severity (defensive).
  if (isSeverityIn(severity, ['blocker', 'critical'])) return { confidence: 'high', kind: 'defect' };
  if (severity === 'major') return { confidence: 'medium', kind: 'risk' };
  return { confidence: 'low', kind: 'signal' };
}

function normalizeLevel(value, fallback) {
  return CONFIDENCE_LEVELS.includes(value) ? value : fallback;
}

/**
 * Classify a single issue into {confidence, kind}. Deterministic and pure.
 * @param {object} issue
 * @param {object} [policy]
 */
function classifyFinding(issue, policy = {}) {
  if (!issue) return null;
  const explicit = issue.confidence && issue.kind ? { confidence: issue.confidence, kind: issue.kind } : null;
  const derived = explicit || defaultConfidence(issue);
  if (!derived) return null;
  let { confidence, kind } = derived;
  const treatAsSignal = policy.treatAsSignal || [];
  const elevate = policy.elevate || [];
  const { code } = parseFingerprint(issue.fingerprint, issue);
  if (
    treatAsSignal.includes(code) ||
    treatAsSignal.includes(issue.code) ||
    treatAsSignal.includes(issue.source)
  ) {
    kind = 'signal';
    confidence = 'low';
  }
  if (elevate.includes(code) || elevate.includes(issue.code) || elevate.includes(issue.source)) {
    confidence = 'high';
  }
  return { confidence: normalizeLevel(confidence, 'medium'), kind: KINDS.includes(kind) ? kind : 'risk' };
}

function confidenceRank(issue) {
  if (!issue) return ORDER.high; // unknown issues count (back-compat)
  if (issue.confidence === undefined) {
    const classified = classifyFinding(issue);
    return classified ? ORDER[classified.confidence] : ORDER.high;
  }
  return ORDER[issue.confidence] ?? ORDER.high;
}

function suppressKey(code) {
  return String(code || '').trim();
}

/**
 * Presentation/gating predicate: does an annotated finding make the primary list?
 * Extracted from `applyFindingsPolicy` so the *same* rule can be reused by the
 * SARIF writer without duplicating the confidence/suppress logic.
 *
 * @param {{confidence?: string, source?: string, fingerprint?: string}} issue
 * @param {number} minRank ORDER rank of `findings.minConfidence`
 * @param {Set<string>} suppress normalized `findings.suppress` keys
 * @returns {boolean}
 */
function isSurfaced(issue, minRank, suppress) {
  if (issue.confidence && ORDER[issue.confidence] === undefined) return true;
  if (issue.confidence && ORDER[issue.confidence] < minRank) return false;
  const { code } = parseFingerprint(issue.fingerprint, issue);
  if (
    suppress.has(suppressKey(code)) ||
    suppress.has(suppressKey(issue.source)) ||
    suppress.has(suppressKey(issue.fingerprint))
  ) {
    return false;
  }
  return true;
}

/**
 * Apply the `findings` policy to a finalized result:
 *  - classify & annotate every issue with confidence/kind
 *  - drop `suppress`ed codes and issues below `minConfidence` from the surfaced list
 *  - recompute severity summary + actionable/review buckets over the surfaced list
 * Returns a new issues array + a `findings` policy snapshot (pure; caller replaces result).
 */
function applyFindingsPolicy(result, rawPolicy = {}) {
  const policy = { ...DEFAULT_FINDING_POLICY, ...rawPolicy };
  const minRank = ORDER[normalizeLevel(policy.minConfidence, 'low')];
  const suppress = new Set((policy.suppress || []).map(suppressKey));
  const annotated = (result.issues || []).map(issue => {
    const meta = classifyFinding(issue, policy);
    const enriched = {
      ...issue,
      confidence: issue.confidence || meta?.confidence || 'high',
      kind: issue.kind || meta?.kind || 'risk',
    };
    // 7.4.1: the confidence/suppress filter is *presentation + gating* only. Every
    // finding stays in `allAnnotated` (written to result.json as `issuesAll`) and
    // carries an explicit `surfaced` flag so a quiet report never means lost
    // evidence — a reader can always tell "clean" from "filtered".
    enriched.surfaced = isSurfaced(enriched, minRank, suppress);
    return enriched;
  });
  const surfaced = annotated.filter(issue => issue.surfaced);
  const severity = { blocker: 0, critical: 0, major: 0, minor: 0 };
  const actionable = { defect: { blocker: 0, critical: 0, major: 0, minor: 0 }, risk: 0 };
  for (const issue of surfaced) {
    severity[issue.severity] = (severity[issue.severity] || 0) + 1;
    if (issue.kind === 'defect')
      actionable.defect[issue.severity] = (actionable.defect[issue.severity] || 0) + 1;
    else if (issue.kind === 'risk') actionable.risk += 1;
  }
  const highConfidenceCount = surfaced.filter(i => i.confidence === 'high').length;
  // Console/report calmness (7.4.1 Phase E): a run that exits 0 must not look
  // empty. `signals` counts informational findings that *were* surfaced and
  // `heldBack` counts findings kept in result.json but below the confidence floor.
  const signalCount = surfaced.filter(issue => issue.kind === 'signal').length;
  const opinionCount = annotated.filter(issue => issue.kind === 'opinion').length;
  const heldBack = annotated.length - surfaced.length;
  return {
    issues: surfaced,
    allAnnotated: annotated,
    summary: { issues: surfaced.length, severity },
    findings: {
      policy: {
        minConfidence: policy.minConfidence,
        gateConfidence: policy.gateConfidence,
        suppress: policy.suppress,
        elevate: policy.elevate,
        treatAsSignal: policy.treatAsSignal,
      },
      actionable: {
        blocker: actionable.defect.blocker,
        critical: actionable.defect.critical,
        major: actionable.defect.major,
        risk: actionable.risk,
        total: actionable.defect.blocker + actionable.defect.critical + actionable.defect.major,
      },
      review: Math.max(
        0,
        surfaced.filter(issue => issue.kind !== 'opinion').length -
          (actionable.defect.blocker + actionable.defect.critical + actionable.defect.major),
      ),
      highConfidenceCount,
      signals: signalCount,
      opinions: opinionCount,
      heldBack,
      totalRecorded: annotated.length,
    },
  };
}

/**
 * Count issues at-or-above a confidence rank (used by gateConfidence).
 */
function countSeverityAtConfidence(issues, severity, policy) {
  const gateRank = ORDER[normalizeLevel(policy?.gateConfidence || 'low', 'low')];
  return issues.filter(
    issue =>
      issue.kind !== 'opinion' &&
      issue.triage !== 'accepted-pattern' &&
      issue.severity === severity &&
      confidenceRank(issue) >= gateRank,
  ).length;
}

module.exports = {
  CONFIDENCE_LEVELS,
  KINDS,
  DEFAULT_FINDING_POLICY,
  ORDER,
  parseFingerprint,
  classifyFinding,
  confidenceRank,
  isSurfaced,
  suppressKey,
  normalizeLevel,
  applyFindingsPolicy,
  countSeverityAtConfidence,
};
