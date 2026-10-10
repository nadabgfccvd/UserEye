'use strict';

const { collectUserGaze } = require('./browser-gaze');
const { section, t } = require('./i18n');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreCognitiveLoad(gaze, locale = 'en') {
  const G = section(locale, 'gaze');
  const fold = gaze.fold || {};
  const reasons = [];
  let points = 0;

  const extraActions = Math.max(0, (fold.actionCount || 0) - 3);
  if (extraActions) {
    const added = Math.min(24, extraActions * 4);
    points += added;
    reasons.push(t(G, 'reasonActions', { count: fold.actionCount }));
  }

  const extraFields = Math.max(0, (fold.fieldCount || 0) - 3);
  if (extraFields) {
    const added = Math.min(16, extraFields * 3);
    points += added;
    reasons.push(t(G, 'reasonFields', { count: fold.fieldCount }));
  }

  if ((fold.wordCount || 0) > 80) {
    const added = Math.min(20, Math.round((fold.wordCount - 80) / 25) * 4);
    points += added;
    reasons.push(t(G, 'reasonTextWall', { count: fold.wordCount }));
  }

  if (!gaze.headline) {
    points += 10;
    reasons.push(t(G, 'reasonNoHeadline'));
  }

  if (!gaze.primaryCta && (fold.actionCount || 0) > 1) {
    points += 12;
    reasons.push(t(G, 'reasonNoPrimaryCta'));
  }

  if ((gaze.competingCtas || []).length > 2) {
    points += 8;
    reasons.push(t(G, 'reasonCompetingCtas', { count: gaze.competingCtas.length }));
  }

  if (gaze.trust && !gaze.trust.hasLang) {
    points += 3;
    reasons.push(t(G, 'reasonNoLang'));
  }

  if (gaze.trust?.mixedPassword) {
    points += 14;
    reasons.push(t(G, 'reasonPasswordNoHttps'));
  }

  const score = clamp(Math.round(points), 0, 100);
  const level = score >= 75 ? 'overwhelming' : score >= 50 ? 'heavy' : score >= 25 ? 'moderate' : 'light';
  const label =
    {
      light: t(G, 'loadLight'),
      moderate: t(G, 'loadModerate'),
      heavy: t(G, 'loadHeavy'),
      overwhelming: t(G, 'loadOverwhelming'),
    }[level] || level;

  return { score, level, label, reasons };
}

function buildNarrative(gaze, load, locale = 'en') {
  const G = section(locale, 'gaze');
  const headline = gaze.headline?.text || gaze.title || '';
  const cta = gaze.primaryCta?.name || gaze.primaryCta?.text || '';
  const words = gaze.fold?.wordCount || 0;
  const actions = gaze.fold?.actionCount || 0;
  const parts = [];

  if (headline) {
    parts.push(t(G, 'narrativeHeadline', { headline: headline.slice(0, 140) }));
  } else {
    parts.push(t(G, 'narrativeNoHeadline'));
  }

  if (cta) {
    parts.push(t(G, 'narrativeCta', { cta: cta.slice(0, 80) }));
  } else if (actions) {
    parts.push(t(G, 'narrativeActions', { count: actions }));
  } else {
    parts.push(t(G, 'narrativeNoAction'));
  }

  if ((gaze.competingCtas || []).length > 1) {
    const names = gaze.competingCtas
      .slice(0, 3)
      .map(item => item.name || item.text)
      .filter(Boolean);
    if (names.length) {
      parts.push(t(G, 'narrativeCompeting', { names: names.map(name => `“${name}”`).join(', ') }));
    }
  }

  if (words) {
    parts.push(t(G, 'narrativeWords', { count: words }));
  }

  parts.push(t(G, 'narrativeLoad', { label: load.label.toLowerCase(), score: load.score }));

  if (gaze.trust?.mixedPassword) {
    parts.push(t(G, 'narrativePasswordNoHttps'));
  }

  return parts.join(' ');
}

function inferPurpose(gaze, facts = {}, pageType = '', locale = 'en') {
  const G = section(locale, 'gaze');
  const blob =
    `${gaze.title || ''} ${gaze.headline?.text || ''} ${gaze.primaryCta?.name || ''} ${pageType}`.toLowerCase();
  if (/login|sign in|entrar|desbloquear|senha mestre|unlock/.test(blob) || (facts.passwordInputs || 0) > 0) {
    return { id: 'authenticate', label: t(G, 'purposeAuthenticate') };
  }
  if (/cadastro|sign up|criar conta|registr|setup|primeiro acesso/.test(blob)) {
    return { id: 'register', label: t(G, 'purposeRegister') };
  }
  if (/checkout|pagamento|pagar|cartão|cartao/.test(blob)) {
    return { id: 'checkout', label: t(G, 'purposeCheckout') };
  }
  if (/dashboard|painel|início|inicio|home|overview/.test(blob)) {
    return { id: 'overview', label: t(G, 'purposeOverview') };
  }
  if (/config|settings|preferenc/.test(blob)) {
    return { id: 'configure', label: t(G, 'purposeConfigure') };
  }
  if ((facts.forms || 0) > 0 && (facts.inputs || 0) >= 2) {
    return { id: 'complete-form', label: t(G, 'purposeCompleteForm') };
  }
  return { id: 'explore', label: t(G, 'purposeExplore') };
}

async function captureGaze(page, options = {}) {
  const locale = options.locale || 'en';
  const raw = await page.evaluate(collectUserGaze, {
    profile: options.profile || 'desktop',
    maxBlocks: options.maxBlocks || 40,
    strings: section(locale, 'scan'),
  });
  const cognitiveLoad = scoreCognitiveLoad(raw, locale);
  return {
    ...raw,
    cognitiveLoad,
    narrative: buildNarrative(raw, cognitiveLoad, locale),
  };
}

function buildJourney(input = {}) {
  const gaze = input.gaze || {};
  const facts = input.facts || {};
  const pageType = input.pageType || '';
  const locale = input.locale || 'en';
  const G = section(locale, 'gaze');
  const purpose = inferPurpose(gaze, facts, pageType, locale);
  const goals = [purpose];
  if ((gaze.fold?.fieldCount || 0) > 0 && purpose.id !== 'complete-form') {
    goals.push({
      id: 'fill-visible-fields',
      label: t(G, 'goalFillFields'),
    });
  }
  if ((gaze.fold?.actionCount || 0) > 1) {
    goals.push({ id: 'choose-safely', label: t(G, 'goalChooseSafely') });
  }
  return {
    purpose,
    goals,
    obviousNextAction: gaze.primaryCta
      ? {
          name: gaze.primaryCta.name || gaze.primaryCta.text,
          selector: gaze.primaryCta.selector,
          score: gaze.primaryCta.score,
        }
      : null,
    firstImpression: gaze.narrative || '',
    cognitiveLoad: gaze.cognitiveLoad || null,
    scan3s: gaze.scan3s || [],
    deadEndRisk: Boolean(!gaze.primaryCta && (gaze.fold?.actionCount || 0) === 0),
  };
}

function prioritizeByGaze(candidates, gaze) {
  const ctaName = String(gaze?.primaryCta?.name || gaze?.primaryCta?.text || '')
    .toLowerCase()
    .trim();
  const ctaSelector = gaze?.primaryCta?.selector || '';
  return [...(candidates || [])]
    .map(candidate => {
      const sameSelector = ctaSelector && candidate.selector === ctaSelector;
      const sameName =
        ctaName &&
        String(candidate.name || '')
          .toLowerCase()
          .trim() === ctaName;
      return {
        ...candidate,
        userPriority: (candidate.priority || 0) + (sameSelector || sameName ? 50 : 0),
      };
    })
    .sort((first, second) => second.userPriority - first.userPriority);
}

module.exports = {
  captureGaze,
  scoreCognitiveLoad,
  buildNarrative,
  inferPurpose,
  buildJourney,
  prioritizeByGaze,
};
