'use strict';

const { section, t } = require('./i18n');

/**
 * Builds the 3-step "what would a first-time user do" plan from the gaze and
 * human-signals snapshots. `input.locale` (reportLocale) selects the language
 * of every action/why string; defaults to English.
 */
function buildUserPlan(input = {}) {
  const P = section(input.locale || 'en', 'plan');
  const gaze = input.gaze || {};
  const human = input.human || {};
  const journey = input.journey || {};
  const steps = [];

  const headline = gaze.headline?.text || gaze.title;
  if (headline) {
    steps.push({
      order: 1,
      action: t(P, 'read', { headline: String(headline).slice(0, 80) }),
      why: t(P, 'readWhy'),
    });
  } else {
    steps.push({
      order: 1,
      action: t(P, 'scan'),
      why: t(P, 'scanWhy'),
    });
  }

  const firstField = (human.placeholderOnly && human.placeholderOnly[0]) || (gaze.fields && gaze.fields[0]);
  if (firstField) {
    steps.push({
      order: 2,
      action: t(P, 'fill', {
        name: firstField.name || firstField.placeholder || firstField.type || t(P, 'fieldFallback'),
      }),
      why: t(P, 'fillWhy'),
    });
  } else if (journey.purpose?.id === 'authenticate') {
    steps.push({
      order: 2,
      action: t(P, 'auth'),
      why: t(P, 'authWhy'),
    });
  } else {
    steps.push({
      order: 2,
      action: t(P, 'confirm'),
      why: t(P, 'confirmWhy'),
    });
  }

  const cta = gaze.primaryCta?.name || gaze.primaryCta?.text || journey.obviousNextAction?.name;
  if (cta) {
    steps.push({
      order: 3,
      action: t(P, 'click', { cta: String(cta).slice(0, 80) }),
      why: t(P, 'clickWhy'),
    });
  } else {
    steps.push({
      order: 3,
      action: t(P, 'seek'),
      why: t(P, 'seekWhy'),
    });
  }

  const blockers = (human.findings || [])
    .filter(item => ['blocker', 'critical', 'major'].includes(item.severity))
    .slice(0, 3)
    .map(item => item.title);

  return {
    purpose: journey.purpose || null,
    steps,
    blockers,
    summary: steps.map(item => item.action).join(' → '),
  };
}

module.exports = { buildUserPlan };
