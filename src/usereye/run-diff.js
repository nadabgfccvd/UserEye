'use strict';

function indexBy(items, key) {
  return new Map((items || []).map(item => [item[key] || item.id || item.code, item]));
}

// Delta entries carry provenance/classification so regression gates can fail on
// *new high-confidence majors* rather than absolute counts (Phase 3).
function deltaEntry(issue) {
  return {
    id: issue.id,
    severity: issue.severity,
    title: issue.title,
    confidence: issue.confidence,
    kind: issue.kind,
    code: issue.code,
    fingerprint: issue.fingerprint,
  };
}

function collectIssueDelta(previousIssues, currentIssues) {
  const prevIssues = indexBy(previousIssues, 'fingerprint');
  const nextIssues = indexBy(currentIssues, 'fingerprint');
  const introduced = [];
  const resolved = [];
  const persisted = [];
  for (const [fingerprint, issue] of nextIssues) {
    if (!prevIssues.has(fingerprint)) {
      introduced.push(deltaEntry(issue));
    } else {
      persisted.push(deltaEntry(issue));
    }
  }
  for (const [fingerprint, issue] of prevIssues) {
    if (!nextIssues.has(fingerprint)) {
      resolved.push(deltaEntry(issue));
    }
  }
  return { introduced, resolved, persisted };
}

function compareResults(previous = {}, current = {}) {
  const { introduced, resolved, persisted } = collectIssueDelta(previous.issues, current.issues);
  const prevCta =
    previous.firstImpression?.primaryCta?.name || previous.firstImpression?.primaryCta?.text || null;
  const nextCta =
    current.firstImpression?.primaryCta?.name || current.firstImpression?.primaryCta?.text || null;
  const prevScore = previous.adaptive?.quality?.score ?? previous.patience?.score ?? null;
  const nextScore = current.adaptive?.quality?.score ?? current.patience?.score ?? null;
  return {
    comparedAt: new Date().toISOString(),
    previousFinishedAt: previous.finishedAt || null,
    currentFinishedAt: current.finishedAt || null,
    issues: {
      introduced,
      resolved,
      persisted,
      introducedCount: introduced.length,
      resolvedCount: resolved.length,
      persistedCount: persisted.length,
    },
    firstImpression: {
      previousCta: prevCta,
      currentCta: nextCta,
      ctaChanged: prevCta !== nextCta,
      previousHeadline: previous.firstImpression?.headline?.text || null,
      currentHeadline: current.firstImpression?.headline?.text || null,
    },
    scores: {
      previous: prevScore,
      current: nextScore,
      delta: prevScore === null || nextScore === null ? null : nextScore - prevScore,
    },
  };
}

module.exports = { compareResults };
