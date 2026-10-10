'use strict';

const { section, t } = require('./i18n');

const ISSUE_WEIGHTS = { blocker: 40, critical: 18, major: 6, minor: 2 };
const CATEGORY_CAPS = {
  feedback: 22,
  delay: 18,
  loading: 18,
  repetition: 10,
  error: 65,
  'browser-error': 18,
  misclick: 20,
  'cognitive-load': 16,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isNullish(value) {
  return value === null || value === undefined;
}

function percentile(values, percentage) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function moodFor(score, locale = 'en') {
  const P = section(locale, 'patience');
  const moods = [
    [90, 'calm', t(P, 'moodCalm'), 5, t(P, 'moodCalmDesc')],
    [75, 'attentive', t(P, 'moodAttentive'), 15, t(P, 'moodAttentiveDesc')],
    [55, 'impatient', t(P, 'moodImpatient'), 35, t(P, 'moodImpatientDesc')],
    [30, 'frustrated', t(P, 'moodFrustrated'), 60, t(P, 'moodFrustratedDesc')],
    [0, 'abandonment-risk', t(P, 'moodAbandonment'), 85, t(P, 'moodAbandonmentDesc')],
  ];
  const [, key, label, abandonmentRiskPercent, description] = moods.find(([minimum]) => score >= minimum);
  return { key, label, abandonmentRiskPercent, description };
}

function buildInteractions(events) {
  const interactionsByToken = new Map();
  for (const start of events.filter(event => event.kind === 'ux-interaction-start')) {
    interactionsByToken.set(start.token, {
      token: start.token,
      at: start.at,
      step: start.step,
      target: start.target,
      purpose: start.purpose || 'user',
      feedbackMs: null,
      loadingMs: null,
      loadingDetected: false,
      totalMs: null,
      settleReason: null,
    });
  }
  for (const event of events) {
    applyExperienceEvent(interactionsByToken.get(event.token), event);
  }
  return [...interactionsByToken.values()];
}

function applyExperienceEvent(interaction, event) {
  if (!interaction) {
    return;
  }
  if (event.kind === 'ux-visual-feedback' && isNullish(interaction.feedbackMs)) {
    interaction.feedbackMs = Math.round(event.delayMs);
  }
  if (event.kind === 'ux-loading-indicator') {
    interaction.loadingDetected = true;
    if (isNullish(interaction.loadingMs)) {
      interaction.loadingMs = Math.round(event.delayMs);
    }
  }
  if (event.kind !== 'ux-interaction-settled') {
    return;
  }
  interaction.totalMs = Math.round(event.totalMs);
  interaction.settleReason = event.reason;
  if (isNullish(interaction.feedbackMs) && !isNullish(event.feedbackMs)) {
    interaction.feedbackMs = Math.round(event.feedbackMs);
  }
  interaction.loadingDetected ||= Boolean(event.loadingDetected);
}

function createPenaltyCollector() {
  const penalties = [];
  const add = (points, category, reason, context = {}) => {
    const roundedPoints = Math.max(0, Math.round(points * 10) / 10);
    if (roundedPoints) {
      penalties.push({ points: roundedPoints, category, reason, ...context });
    }
  };
  return { penalties, add };
}

function interactionContext(interaction, locale = 'en') {
  const P = section(locale, 'patience');
  return {
    at: interaction.at,
    step: interaction.step,
    target:
      interaction.target?.name ||
      interaction.target?.id ||
      interaction.target?.tag ||
      t(P, 'controlFallback'),
    token: interaction.token,
  };
}

function addFeedbackPenalty(interaction, addPenalty, locale = 'en') {
  const P = section(locale, 'patience');
  const context = interactionContext(interaction, locale);
  if (isNullish(interaction.feedbackMs)) {
    addPenalty(3, 'feedback', t(P, 'noFeedback'), context);
    return 1;
  }
  const ms = interaction.feedbackMs;
  const thresholds = [
    [3000, 12, t(P, 'feedback3000', { ms })],
    [1000, 7, t(P, 'feedback1000', { ms })],
    [300, 3, t(P, 'feedback300', { ms })],
    [100, 1, t(P, 'feedback100', { ms })],
  ];
  const threshold = thresholds.find(([minimum]) => interaction.feedbackMs > minimum);
  if (threshold) {
    addPenalty(threshold[1], 'feedback', threshold[2], context);
  }
  return 0;
}

function addSettlePenalty(interaction, addPenalty, locale = 'en') {
  const P = section(locale, 'patience');
  if (isNullish(interaction.totalMs)) {
    return 0;
  }
  const context = interactionContext(interaction, locale);
  const delayThreshold = [
    [8000, 12],
    [3000, 6],
    [1000, 2],
  ].find(([minimum]) => interaction.totalMs > minimum);
  if (delayThreshold) {
    addPenalty(delayThreshold[1], 'delay', t(P, 'settle', { ms: interaction.totalMs }), context);
  }
  if (interaction.totalMs > 800 && !interaction.loadingDetected) {
    const points = interaction.totalMs > 3000 ? 8 : interaction.totalMs > 1500 ? 5 : 2;
    addPenalty(points, 'loading', t(P, 'waitNoLoader', { ms: interaction.totalMs }), context);
    return 1;
  }
  if (interaction.loadingDetected && interaction.loadingMs > 500) {
    addPenalty(2, 'loading', t(P, 'loaderLate', { ms: interaction.loadingMs }), context);
  }
  return 0;
}

function evaluateInteractionLatency(interactions, addPenalty, locale = 'en') {
  let noFeedbackCount = 0;
  let slowWithoutIndicator = 0;
  for (const interaction of interactions) {
    noFeedbackCount += addFeedbackPenalty(interaction, addPenalty, locale);
    slowWithoutIndicator += addSettlePenalty(interaction, addPenalty, locale);
  }
  return { noFeedbackCount, slowWithoutIndicator };
}

function detectRageClicks(interactions, addPenalty, locale = 'en') {
  const P = section(locale, 'patience');
  const rageClicks = [];
  const recentByTarget = new Map();
  for (const interaction of interactions) {
    const targetKey = interaction.target?.id || `${interaction.target?.tag}:${interaction.target?.name}`;
    const timestamp = Date.parse(interaction.at);
    if (!targetKey || Number.isNaN(timestamp)) {
      continue;
    }
    const recent = (recentByTarget.get(targetKey) || []).filter(item => timestamp - item.timestamp <= 1500);
    recent.push({ timestamp, interaction });
    recentByTarget.set(targetKey, recent);
    if (recent.length !== 3) {
      continue;
    }
    const poorlyAcknowledged = recent.filter(
      item => isNullish(item.interaction.feedbackMs) || item.interaction.feedbackMs > 300,
    ).length;
    if (poorlyAcknowledged < 2) {
      continue;
    }
    const rageClick = {
      target: targetKey,
      at: interaction.at,
      step: interaction.step,
      count: 3,
      poorlyAcknowledged,
    };
    rageClicks.push(rageClick);
    addPenalty(5, 'repetition', t(P, 'rageClicks', { name: interaction.target?.name || targetKey }), {
      at: interaction.at,
      step: interaction.step,
      target: interaction.target?.name || targetKey,
    });
  }
  return rageClicks;
}

function penalizeIssues(issues, addPenalty) {
  let total = 0;
  for (const issue of issues) {
    const points = ISSUE_WEIGHTS[issue.severity] || 2;
    total += points;
    addPenalty(points, 'error', `${issue.severity}: ${issue.title}`, {
      step: issue.step,
      issueId: issue.id,
    });
  }
  return total;
}

function flattenUnexpectedErrors(telemetry) {
  return [
    ...(telemetry.consoleErrors || []),
    ...(telemetry.pageErrors || []),
    ...(telemetry.requestFailures || []),
    ...(telemetry.httpErrors || []),
  ];
}

function penalizeBrowserErrors(errors, addPenalty, locale = 'en') {
  const P = section(locale, 'patience');
  for (const error of errors) {
    addPenalty(
      6,
      'browser-error',
      error.message || error.text || t(P, 'httpError', { status: error.status || t(P, 'httpErrorFallback') }),
      {
        at: error.at,
        step: error.step,
        url: error.url,
      },
    );
  }
}

function penalizeMisclicks(misclicks, addPenalty, locale = 'en') {
  const P = section(locale, 'patience');
  const weights = { harmful: 8, confusing: 3 };
  for (const misclick of misclicks) {
    const points = weights[misclick.outcome];
    if (!points) {
      continue;
    }
    const adjective = misclick.outcome === 'harmful' ? t(P, 'misclickHarmful') : t(P, 'misclickConfusing');
    addPenalty(
      points,
      'misclick',
      t(P, 'misclickPenalty', { adjective, effect: misclick.effect || misclick.point }),
      {
        step: misclick.step,
        target: misclick.target?.name,
      },
    );
  }
}

function scorePenalties(penalties) {
  const categoryTotals = {};
  for (const penalty of penalties) {
    categoryTotals[penalty.category] = (categoryTotals[penalty.category] || 0) + penalty.points;
  }
  const cappedTotal = Object.entries(categoryTotals).reduce(
    (sum, [category, points]) => sum + Math.min(points, CATEGORY_CAPS[category] ?? points),
    0,
  );
  return {
    score: clamp(Math.round(100 - cappedTotal), 0, 100),
    categoryTotals,
  };
}

function buildMoodTimeline(penalties, locale = 'en') {
  let runningScore = 100;
  return [...penalties]
    .sort(
      (first, second) =>
        (Date.parse(first.at || '') || Number.MAX_SAFE_INTEGER) -
        (Date.parse(second.at || '') || Number.MAX_SAFE_INTEGER),
    )
    .map(penalty => {
      runningScore = clamp(Math.round((runningScore - penalty.points) * 10) / 10, 0, 100);
      return { ...penalty, scoreAfter: runningScore, moodAfter: moodFor(runningScore, locale).label };
    });
}

/** Converts measured UI friction into an explainable heuristic score. */
function buildPatienceReport(input = {}) {
  const locale = input.locale || 'en';
  const P = section(locale, 'patience');
  const issues = input.issues || [];
  const misclicks = input.misclicks || [];
  const interactions = buildInteractions(input.experienceEvents || []);
  const userInteractions = interactions.filter(interaction => interaction.purpose === 'user');
  const { penalties, add: addPenalty } = createPenaltyCollector();
  const latency = evaluateInteractionLatency(userInteractions, addPenalty, locale);
  const rageClicks = detectRageClicks(userInteractions, addPenalty, locale);
  const issuePenalty = penalizeIssues(issues, addPenalty);
  const unexpectedErrors = flattenUnexpectedErrors(input.unexpectedTelemetry || {});
  penalizeBrowserErrors(unexpectedErrors, addPenalty, locale);
  penalizeMisclicks(misclicks, addPenalty, locale);

  const { score, categoryTotals } = scorePenalties(penalties);
  const feedbackValues = userInteractions.map(interaction => interaction.feedbackMs).filter(Number.isFinite);
  const totalValues = userInteractions.map(interaction => interaction.totalMs).filter(Number.isFinite);
  const sortedPenalties = [...penalties].sort((first, second) => second.points - first.points);

  return {
    modelVersion: 1,
    score,
    mood: moodFor(score, locale),
    disclaimer: t(P, 'disclaimer'),
    summary: {
      measuredInteractions: userInteractions.length,
      averageFeedbackMs: average(feedbackValues),
      p95FeedbackMs: percentile(feedbackValues, 95),
      averageSettleMs: average(totalValues),
      p95SettleMs: percentile(totalValues, 95),
      ...latency,
      loadingIndicatorsDetected: userInteractions.filter(interaction => interaction.loadingDetected).length,
      unexpectedErrors: unexpectedErrors.length,
      confirmedIssues: issues.length,
      issuePenaltyBeforeCap: issuePenalty,
      rageClicks: rageClicks.length,
      misclicks: misclicks.length,
      harmfulMisclicks: misclicks.filter(item => item.outcome === 'harmful').length,
      confusingMisclicks: misclicks.filter(item => item.outcome === 'confusing').length,
    },
    categoryTotals,
    categoryCaps: CATEGORY_CAPS,
    interactions,
    rageClicks,
    penalties: sortedPenalties,
    timeline: buildMoodTimeline(penalties, locale),
    topFriction: sortedPenalties.slice(0, 10),
  };
}

module.exports = { buildPatienceReport, moodFor };
