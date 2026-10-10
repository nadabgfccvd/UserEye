'use strict';

/** Runs inside the browser; keep this function self-contained. */
function collectHumanSignals({ profile, strings, consent }) {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const normalize = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  // Localized finding strings injected by user-human.js / protocols/human.js
  // via i18n.findingStrings(locale); degrades gracefully when absent.
  const S = strings || {};
  const fmtLocal = (template, params) =>
    String(template).replace(/\{(\w+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
    );
  const titleFor = code => (S[code] && S[code].title) || code;
  const actualFor = (code, params) =>
    S[code] && S[code].actual ? fmtLocal(S[code].actual, params || {}) : '';
  const isRendered = element => {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') <= 0.02
    ) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
  const inFold = rect =>
    rect.bottom > 4 && rect.right > 4 && rect.top < viewport.height - 2 && rect.left < viewport.width - 2;
  const selectorFor = element => {
    if (!(element instanceof Element)) {
      return '';
    }
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }
    const tag = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent) {
      return tag;
    }
    const same = [...parent.children].filter(child => child.tagName === element.tagName);
    return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(element) + 1})` : tag;
  };
  const nameFor = element => {
    const aria = normalize(element.getAttribute('aria-label'));
    if (aria) {
      return aria;
    }
    if ('labels' in element && element.labels?.length) {
      const labeled = [...element.labels]
        .map(label => normalize(label.textContent))
        .filter(Boolean)
        .join(' ');
      if (labeled) {
        return labeled;
      }
    }
    return (
      normalize(element.getAttribute('alt')) ||
      normalize(element.getAttribute('title')) ||
      normalize(element.textContent).slice(0, 140) ||
      normalize(element.getAttribute('placeholder'))
    );
  };
  const describe = (element, extra = {}) => ({
    selector: selectorFor(element),
    tag: element.tagName.toLowerCase(),
    id: element.id || '',
    name: nameFor(element).slice(0, 160),
    ...extra,
  });

  const findings = [];
  const finding = (code, severity, title, actual, evidence = [], metadata = {}) =>
    findings.push({ code, severity, title, actual, evidence, ...metadata });

  const foldText = normalize(document.body?.innerText || '');
  const words = foldText.split(/\s+/).filter(Boolean);
  const readingTime = {
    words: words.length,
    minutes: Math.max(0.1, Math.round((words.length / 200) * 10) / 10),
    wpm: 200,
  };

  const spoken = [];
  const spokenNodes = [
    ...document.querySelectorAll(
      'h1,h2,h3,a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[aria-label],[alt]',
    ),
  ].filter(element => isRendered(element) && inFold(element.getBoundingClientRect()));
  for (const element of spokenNodes.slice(0, 40)) {
    const name = nameFor(element);
    if (name) {
      spoken.push({
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        name: name.slice(0, 140),
        selector: selectorFor(element),
      });
    }
  }

  // Phase 2.2 consent-wall gating. A candidate is a real *layer* (fixed/absolute/
  // sticky overlay, a <dialog>, or an explicit role=dialog / aria-modal container)
  // whose text is consent-related. Default (`consent.strict === false`) keeps the
  // historical area-threshold behaviour but only for genuine layers, which filters
  // static marketing copy that merely says "we use cookies" (roadmap §5 Phase 2.2).
  // With `consent.strict === true` a wall is only flagged when it also exposes an
  // interactive accept/reject control; `consent.selectors` adds custom layer
  // selectors and `consent.minWallArea` overrides the fold-area threshold.
  const CONSENT_TEXT =
    /cookie|consentimento|consent|aceitar todos|accept all|aceitar|privacidade|gdpr|lgpd|we use cookies|usamos cookies|privacy/i;
  const CONSENT_ACTION =
    /accept all|aceitar|accept|customize|configurar|reject|recusar|manage|gerir|agree|concordo|allow all|permitir|save preferences|salvar prefer|settings/i;
  const consentCfg = consent || {};
  const minWallArea = Number.isFinite(Number(consentCfg.minWallArea)) ? Number(consentCfg.minWallArea) : 0.18;
  const consentLayerBase = 'div,section,aside,dialog,[role="dialog"]';
  const consentLayerExtra =
    Array.isArray(consentCfg.selectors) && consentCfg.selectors.length ? consentCfg.selectors.join(',') : '';
  const consentLayerSelector = consentLayerExtra
    ? `${consentLayerBase},${consentLayerExtra}`
    : consentLayerBase;
  const consentLayers = [...document.querySelectorAll(consentLayerSelector)].filter(isRendered);
  const consentCandidates = consentLayers
    .map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const role = element.getAttribute('role') || element.tagName.toLowerCase();
      const isModal =
        element.tagName.toLowerCase() === 'dialog' || element.getAttribute('aria-modal') === 'true';
      const fullOrLayer =
        ['fixed', 'absolute', 'sticky'].includes(style.position) || role === 'dialog' || isModal;
      const areaRatio = (rect.width * rect.height) / Math.max(1, viewport.width * viewport.height);
      // Is there an interactive accept/reject control inside this layer?
      const controls = [
        ...element.querySelectorAll('button,a[href],[role="button"],input[type="button"],[role="link"]'),
      ];
      const hasConsentAction = controls.some(control =>
        CONSENT_ACTION.test(
          String(
            control.getAttribute('aria-label') ||
              control.getAttribute('title') ||
              control.textContent ||
              control.value ||
              '',
          ),
        ),
      );
      const text = normalize(element.innerText).slice(0, 240);
      const matches = fullOrLayer && areaRatio >= minWallArea && CONSENT_TEXT.test(text);
      return {
        element,
        areaRatio,
        fullOrLayer,
        role,
        isModal,
        hasConsentAction,
        text,
        matches: consentCfg.strict === true ? matches && hasConsentAction : matches,
      };
    })
    .filter(item => item.matches)
    .map(item =>
      describe(item.element, {
        text: item.text,
        areaRatio: Math.round(item.areaRatio * 100) / 100,
        role: item.role,
        hasConsentAction: item.hasConsentAction,
      }),
    );
  if (consentCandidates.length) {
    finding(
      'consent-wall',
      'major',
      titleFor('consent-wall'),
      actualFor('consent-wall', { count: consentCandidates.length }),
      consentCandidates.slice(0, 4),
    );
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = getComputedStyle(document.body);
  const locked =
    rootStyle.overflow === 'hidden' ||
    bodyStyle.overflow === 'hidden' ||
    rootStyle.overflowY === 'hidden' ||
    bodyStyle.overflowY === 'hidden';
  const scrollable = document.documentElement.scrollHeight > viewport.height + 24;
  const scrollTrap = locked && scrollable;
  if (scrollTrap) {
    finding(
      'scroll-trap',
      'major',
      titleFor('scroll-trap'),
      actualFor('scroll-trap', { scrollHeight: document.documentElement.scrollHeight }),
    );
  }

  const stickies = [...document.querySelectorAll('body *')]
    .filter(isRendered)
    .filter(element => ['fixed', 'sticky'].includes(getComputedStyle(element).position))
    .filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.top <= 8 && rect.height >= 32 && rect.width >= viewport.width * 0.5;
    });
  const firstHeading = document.querySelector('h1,h2,[role="heading"]');
  const stickyOverlap = [];
  if (firstHeading && isRendered(firstHeading) && stickies.length) {
    const rect = firstHeading.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.min(Math.max(rect.left + 12, 0), viewport.width - 1),
      Math.min(Math.max(rect.top + 8, 0), viewport.height - 1),
    );
    if (
      top &&
      stickies.some(bar => bar === top || bar.contains(top)) &&
      !stickies.some(bar => bar.contains(firstHeading))
    ) {
      stickyOverlap.push(describe(firstHeading, { coveredBy: selectorFor(top) }));
    }
  }
  if (stickyOverlap.length) {
    finding(
      'sticky-overlap',
      'minor',
      titleFor('sticky-overlap'),
      actualFor('sticky-overlap'),
      stickyOverlap,
    );
  }

  const fakeControls = [...document.querySelectorAll('div,span,p,li,img')]
    .filter(isRendered)
    .filter(element => {
      const style = getComputedStyle(element);
      const clickable =
        style.cursor === 'pointer' ||
        element.getAttribute('onclick') ||
        element.hasAttribute('ng-click') ||
        /click|tap/.test(element.getAttribute('data-action') || '');
      const semantic = element.closest('a,button,label,summary,[role="button"],[role="link"],[role="tab"]');
      return clickable && !semantic && nameFor(element);
    })
    .slice(0, 16)
    .map(describe);
  if (fakeControls.length) {
    finding(
      'fake-controls',
      'major',
      titleFor('fake-controls'),
      actualFor('fake-controls', { count: fakeControls.length }),
      fakeControls.slice(0, 10),
    );
  }

  const sampleButtons = [...document.querySelectorAll('button,a[href],[role="button"]')]
    .filter(element => isRendered(element) && inFold(element.getBoundingClientRect()))
    .slice(0, 6);
  const focusInvisible = [];
  const previous = document.activeElement;
  for (const element of sampleButtons) {
    try {
      element.focus({ preventScroll: true });
      const style = getComputedStyle(element);
      const outline = `${style.outlineStyle} ${style.outlineWidth} ${style.boxShadow}`;
      const hasRing =
        (style.outlineStyle && style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) ||
        (style.boxShadow && style.boxShadow !== 'none');
      if (!hasRing) {
        focusInvisible.push(describe(element, { outline }));
      }
    } catch {
      // Some elements reject programmatic focus.
    }
  }
  if (previous && previous.focus) {
    try {
      previous.focus({ preventScroll: true });
    } catch {
      // Restore is best-effort.
    }
  }
  if (focusInvisible.length && sampleButtons.length) {
    finding(
      'focus-not-visible',
      'minor',
      titleFor('focus-not-visible'),
      actualFor('focus-not-visible', { count: focusInvisible.length, total: sampleButtons.length }),
      focusInvisible,
    );
  }

  const fields = [
    ...document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]),textarea,select',
    ),
  ].filter(isRendered);
  const placeholderOnly = fields
    .filter(element => {
      const placeholder = normalize(element.getAttribute('placeholder'));
      const hasName =
        normalize(element.getAttribute('aria-label')) ||
        ('labels' in element && element.labels?.length) ||
        element.getAttribute('aria-labelledby');
      return placeholder && !hasName;
    })
    .map(element => describe(element, { placeholder: element.getAttribute('placeholder') }));
  if (placeholderOnly.length) {
    finding(
      'placeholder-as-label',
      'major',
      titleFor('placeholder-as-label'),
      actualFor('placeholder-as-label', { count: placeholderOnly.length }),
      placeholderOnly.slice(0, 10),
    );
  }

  const visibleErrors = [
    ...document.querySelectorAll('[role="alert"],.error,.invalid,[aria-invalid="true"]'),
  ].filter(isRendered);
  const unassociatedErrors = visibleErrors.filter(element => {
    if (element.matches('input,textarea,select')) {
      return !(element.getAttribute('aria-describedby') || element.getAttribute('aria-errormessage'));
    }
    const id = element.id;
    if (!id) {
      return true;
    }
    return !document.querySelector(
      `[aria-describedby~="${CSS.escape(id)}"],[aria-errormessage="${CSS.escape(id)}"]`,
    );
  });
  if (unassociatedErrors.length) {
    finding(
      'error-not-associated',
      'major',
      titleFor('error-not-associated'),
      actualFor('error-not-associated', { count: unassociatedErrors.length }),
      unassociatedErrors.slice(0, 8).map(describe),
    );
  }

  const autofocused = document.querySelector('[autofocus],:focus');
  if (document.querySelector('[autofocus]') && autofocused) {
    const tag = autofocused.tagName.toLowerCase();
    if (!['input', 'textarea', 'select'].includes(tag)) {
      finding(
        'autofocus-abuse',
        'minor',
        titleFor('autofocus-abuse'),
        actualFor('autofocus-abuse', { tag, id: autofocused.id || '' }),
        [describe(autofocused)],
      );
    }
  }

  const needsAutocomplete = fields.filter(element => {
    const type = (element.getAttribute('type') || element.tagName.toLowerCase()).toLowerCase();
    const name = `${element.name || ''} ${element.id || ''} ${element.autocomplete || ''}`.toLowerCase();
    const sensitive = ['email', 'password', 'tel', 'username'].some(
      token => type === token || name.includes(token),
    );
    return sensitive && !element.getAttribute('autocomplete');
  });
  if (needsAutocomplete.length) {
    finding(
      'missing-autocomplete',
      'minor',
      titleFor('missing-autocomplete'),
      actualFor('missing-autocomplete', { count: needsAutocomplete.length }),
      needsAutocomplete
        .slice(0, 8)
        .map(element =>
          describe(element, { type: element.getAttribute('type') || element.tagName.toLowerCase() }),
        ),
    );
  }

  const favicon = document.querySelector('link[rel~="icon"],link[rel="shortcut icon"]');
  const tabChrome = {
    title: document.title || '',
    hasTitle: Boolean(document.title),
    favicon: favicon?.href || null,
    hasFavicon: Boolean(favicon),
  };
  if (!tabChrome.hasTitle) {
    finding('missing-tab-title', 'minor', titleFor('missing-tab-title'), actualFor('missing-tab-title'));
  }
  if (!tabChrome.hasFavicon) {
    finding('missing-favicon', 'minor', titleFor('missing-favicon'), actualFor('missing-favicon'));
  }

  const hoverCandidates = [...document.querySelectorAll('[title],.tooltip,[data-tooltip]')]
    .filter(isRendered)
    .filter(element => {
      const visibleName = normalize(element.textContent);
      const hoverName = normalize(element.getAttribute('title') || element.getAttribute('data-tooltip'));
      return hoverName && visibleName.length < 2 && element.matches('button,a,[role="button"],span,i,svg');
    });
  const hasNonTooltipName = element => {
    if (normalize(element.getAttribute('aria-label'))) return true;
    const labelledBy = normalize(element.getAttribute('aria-labelledby'));
    if (labelledBy && labelledBy.split(/\s+/).some(id => normalize(document.getElementById(id)?.textContent)))
      return true;
    return Boolean(
      'labels' in element &&
      element.labels?.length &&
      [...element.labels].some(label => normalize(label.textContent)),
    );
  };
  const complementaryTooltipElements = hoverCandidates.filter(hasNonTooltipName);
  const complementaryTooltipSet = new Set(complementaryTooltipElements);
  const hoverOnly = hoverCandidates
    .filter(element => !complementaryTooltipSet.has(element))
    .map(element =>
      describe(element, { hover: element.getAttribute('title') || element.getAttribute('data-tooltip') }),
    );
  const complementaryTooltips = complementaryTooltipElements.map(element =>
    describe(element, {
      hover: element.getAttribute('title') || element.getAttribute('data-tooltip'),
      acceptedPattern: 'tooltip-complements-accessible-name',
    }),
  );
  if (hoverOnly.length) {
    finding(
      'hover-only-content',
      'minor',
      titleFor('hover-only-content'),
      actualFor('hover-only-content', { count: hoverOnly.length }),
      hoverOnly.slice(0, 8),
    );
  }
  if (complementaryTooltips.length) {
    finding(
      'complementary-tooltip',
      'minor',
      titleFor('complementary-tooltip'),
      actualFor('complementary-tooltip', { count: complementaryTooltips.length }),
      complementaryTooltips.slice(0, 8),
      {
        confidence: 'low',
        kind: 'opinion',
        triage: 'accepted-pattern',
        acceptedPattern: 'tooltip-complements-accessible-name',
      },
    );
  }

  const hitMismatches = [...document.querySelectorAll('button,a[href],[role="button"]')]
    .filter(element => isRendered(element) && inFold(element.getBoundingClientRect()))
    .map(element => {
      const visual = element.getBoundingClientRect();
      let padded = element;
      const parent = element.parentElement;
      if (parent && getComputedStyle(parent).cursor === 'pointer') {
        padded = parent;
      }
      const hit = padded.getBoundingClientRect();
      const extra = hit.width * hit.height - visual.width * visual.height;
      return extra > 2400 && hit.width - visual.width > 24
        ? describe(element, { extra: Math.round(extra) })
        : null;
    })
    .filter(Boolean);
  if (hitMismatches.length) {
    finding(
      'hitbox-mismatch',
      'minor',
      titleFor('hitbox-mismatch'),
      actualFor('hitbox-mismatch', { count: hitMismatches.length }),
      hitMismatches.slice(0, 8),
    );
  }

  const sample = words.slice(0, 80).join(' ');
  const ptHits = (sample.match(/\b(de|da|do|para|uma|não|senha|entrar|criar|salvar|buscar)\b/gi) || [])
    .length;
  const enHits = (sample.match(/\b(the|and|for|with|login|password|save|search|settings)\b/gi) || []).length;
  const mixedLanguage = ptHits >= 3 && enHits >= 3;
  if (mixedLanguage) {
    finding(
      'mixed-language',
      'minor',
      titleFor('mixed-language'),
      actualFor('mixed-language', { ptHits, enHits }),
    );
  }

  const emptyClicks = [...document.querySelectorAll('a,button,[role="button"],div')]
    .filter(isRendered)
    .filter(element => {
      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;
      const text = normalize(element.innerText || element.getAttribute('aria-label') || '');
      const style = getComputedStyle(element);
      return (
        area >= viewport.width * viewport.height * 0.35 &&
        text.length < 8 &&
        (style.cursor === 'pointer' || element.tagName === 'A' || element.tagName === 'BUTTON')
      );
    })
    .map(describe);
  if (emptyClicks.length) {
    finding(
      'empty-click-region',
      'minor',
      titleFor('empty-click-region'),
      actualFor('empty-click-region', { count: emptyClicks.length }),
      emptyClicks.slice(0, 4),
    );
  }

  const dialogs = [...document.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"]')].filter(
    isRendered,
  );
  const modalProblems = dialogs
    .filter(dialog => {
      const closer = dialog.querySelector(
        '[data-close],button[aria-label*="fech" i],button[aria-label*="close" i],.close',
      );
      return !closer;
    })
    .map(describe);
  if (modalProblems.length) {
    finding(
      'modal-without-close',
      'major',
      titleFor('modal-without-close'),
      actualFor('modal-without-close', { count: modalProblems.length }),
      modalProblems,
    );
  }

  const skeletonCandidates = [
    ...document.querySelectorAll(
      '[class*="skeleton" i],[class*="shimmer" i],[aria-busy="true"],.loading,.loader,[role="progressbar"]',
    ),
  ].filter(isRendered);
  const loadingIndicators = skeletonCandidates.map(element => {
    const rect = element.getBoundingClientRect();
    const roleProgress = element.getAttribute('role') === 'progressbar';
    const rawNow = element.getAttribute('aria-valuenow');
    const rawMax = element.getAttribute('aria-valuemax');
    const now = Number(rawNow);
    // ARIA range roles have an implicit maximum of 100 when aria-valuemax is
    // omitted. Preserve that standards-compliant form while recording whether
    // the maximum was explicit.
    const max = rawMax === null ? 100 : Number(rawMax);
    const validAria =
      roleProgress &&
      rawNow !== null &&
      Number.isFinite(now) &&
      Number.isFinite(max) &&
      max > 0 &&
      now >= 0 &&
      now <= max;
    const ariaRatio = validAria ? now / max : 0;
    const visualRatios = [...element.children].filter(isRendered).map(child => {
      const childRect = child.getBoundingClientRect();
      const style = getComputedStyle(child);
      const looksLikeFill =
        /(fill|progress|value|bar|indicator)/i.test(`${child.id} ${child.className}`) ||
        style.backgroundImage !== 'none' ||
        style.backgroundColor !== getComputedStyle(element).backgroundColor;
      return looksLikeFill && rect.width > 0 ? Math.max(0, Math.min(1, childRect.width / rect.width)) : 0;
    });
    // Chromium's bounding box reflects transforms such as scaleX(), so a
    // transformed fill is measured here just like a width-based fill.
    const visualRatio = visualRatios.length ? Math.max(...visualRatios) : 0;
    const measurableRatio = Math.max(ariaRatio, visualRatio);
    const accepted = roleProgress && validAria && measurableRatio >= 0.04;
    const missing = [];
    if (!roleProgress) missing.push('not role=progressbar');
    if (roleProgress && rawNow === null) missing.push('missing aria-valuenow');
    if (roleProgress && rawNow !== null && !validAria) missing.push('invalid aria value range');
    if (measurableRatio < 0.04) missing.push('measurable progress below 4%');
    return {
      ...describe(element),
      accepted,
      roleProgress,
      ariaValueNow: rawNow,
      ariaValueMax: rawMax,
      ariaValueMaxImplicit: rawMax === null ? 100 : null,
      ariaProgressPercent: Math.round(ariaRatio * 1000) / 10,
      visualFillPercent: Math.round(visualRatio * 1000) / 10,
      measurableProgressPercent: Math.round(measurableRatio * 1000) / 10,
      missing,
      criterion:
        'role=progressbar + valid aria-valuenow/range (aria-valuemax defaults to 100) + measurable progress >= 4%',
    };
  });
  const suspiciousSkeletons = loadingIndicators.filter(item => !item.accepted);
  if (suspiciousSkeletons.length && document.readyState === 'complete') {
    finding(
      'eternal-skeleton',
      'major',
      titleFor('eternal-skeleton'),
      actualFor('eternal-skeleton', { count: suspiciousSkeletons.length }),
      suspiciousSkeletons.slice(0, 6),
      {
        technical:
          'Acceptance criterion: role=progressbar with a valid aria-valuenow/range (aria-valuemax defaults to 100) and at least 4% measurable progress. Fill geometry uses getBoundingClientRect(), including CSS transforms such as scaleX().',
      },
    );
  }

  const skipLinks = [...document.querySelectorAll('a[href^="#"]')].filter(link =>
    /skip|pular|ir para o conteúdo|main content|conteúdo principal/i.test(
      `${link.textContent} ${link.getAttribute('aria-label') || ''}`,
    ),
  );
  const skipLink = skipLinks[0]
    ? {
        selector: selectorFor(skipLinks[0]),
        href: skipLinks[0].getAttribute('href'),
        targetExists: Boolean(document.querySelector(skipLinks[0].getAttribute('href'))),
        name: nameFor(skipLinks[0]),
      }
    : null;

  return {
    capturedAt: new Date().toISOString(),
    profile: profile || (viewport.width <= 600 ? 'mobile' : 'desktop'),
    url: location.href,
    readingTime,
    screenReaderPreview: spoken,
    consentWalls: consentCandidates,
    scrollTrap,
    stickyOverlap,
    fakeControls,
    focusInvisible,
    placeholderOnly,
    unassociatedErrors,
    tabChrome,
    loadingIndicators,
    skipLink,
    mixedLanguage: mixedLanguage ? { ptHits, enHits } : null,
    findings,
  };
}

module.exports = { collectHumanSignals };
