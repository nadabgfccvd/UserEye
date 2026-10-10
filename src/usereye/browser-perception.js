'use strict';

/** Runs inside the browser; keep this function self-contained. */
function collectBrowserPerception({ profile, touchTarget, maxText, maxControls, strings }) {
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
  };

  const normalize = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  // Localized finding strings injected by perception.js via
  // i18n.findingStrings(locale). Degrades gracefully: without them the finding
  // code is used as title and the actual line stays empty.
  const S = strings || {};
  const fmtLocal = (template, params) =>
    String(template).replace(/\{(\w+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
    );
  const titleFor = code => (S[code] && S[code].title) || code;
  const actualFor = (code, params) =>
    S[code] && S[code].actual ? fmtLocal(S[code].actual, params || {}) : '';
  const rectObject = rect => ({
    x: Math.round(rect.x * 10) / 10,
    y: Math.round(rect.y * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
    top: Math.round(rect.top * 10) / 10,
    right: Math.round(rect.right * 10) / 10,
    bottom: Math.round(rect.bottom * 10) / 10,
    left: Math.round(rect.left * 10) / 10,
  });

  const isRendered = element => {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
    if (Number.parseFloat(style.opacity || '1') <= 0.01) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    return true;
  };

  const isInViewport = rect =>
    rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width;
  const queryAllDeep = (selector, root = document) => {
    const found = root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
    const all = root.querySelectorAll ? [...root.querySelectorAll('*')] : [];
    for (const node of all) {
      if (node.shadowRoot) {
        found.push(...queryAllDeep(selector, node.shadowRoot));
      }
    }
    return found;
  };

  const parseColor = value => {
    const match = String(value || '').match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/i);
    if (!match) {
      return null;
    }
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: match[4] === undefined ? 1 : Number(match[4]),
    };
  };

  const linearize = channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const luminanceOf = color =>
    0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);

  const contrastRatio = (foreground, background) => {
    if (!foreground || !background || foreground.a < 0.6) {
      return null;
    }
    const lighter = Math.max(luminanceOf(foreground), luminanceOf(background));
    const darker = Math.min(luminanceOf(foreground), luminanceOf(background));
    return (lighter + 0.05) / (darker + 0.05);
  };

  const opaqueBackground = element => {
    let node = element;
    while (node && node.nodeType === 1) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color && color.a >= 0.92) {
        return color;
      }
      node = node.parentElement;
    }
    // The computed body background is usually transparent rgba(0,0,0,0); the
    // canvas actually painted behind it is white unless an ancestor is opaque.
    // Using the transparent value as-is would rate black-on-white text as 1:1.
    const bodyColor = parseColor(getComputedStyle(document.body).backgroundColor);
    return bodyColor && bodyColor.a >= 0.92 ? bodyColor : { r: 255, g: 255, b: 255, a: 1 };
  };

  const colorText = color =>
    color ? `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(color.a * 100) / 100})` : '';

  // Positioned pills/indicators are often siblings behind a transparent button.
  // They are visible to a person, but are not in the element's ancestor background
  // chain. Capture that context beside the contrast sample as a root-cause clue.
  const siblingOverlayBehind = element => {
    if (!element.parentElement) return null;
    const own = parseColor(getComputedStyle(element).backgroundColor);
    if (own && own.a >= 0.92) return null;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const candidate = [...element.parentElement.children].find(sibling => {
      if (sibling === element || !isRendered(sibling)) return false;
      const style = getComputedStyle(sibling);
      if (!['absolute', 'fixed', 'sticky'].includes(style.position)) return false;
      const background = parseColor(style.backgroundColor);
      if ((!background || background.a < 0.05) && style.backgroundImage === 'none') return false;
      const siblingRect = sibling.getBoundingClientRect();
      return (
        x >= siblingRect.left && x <= siblingRect.right && y >= siblingRect.top && y <= siblingRect.bottom
      );
    });
    if (!candidate) return null;
    const style = getComputedStyle(candidate);
    return {
      selector: selectorFor(candidate),
      background: style.backgroundColor,
      position: style.position,
      zIndex: style.zIndex || 'auto',
      hint: 'A positioned sibling is painted behind this transparent text element; contrast engines measure the ancestor background, not the sibling overlay.',
    };
  };

  const selectorFor = element => {
    if (!(element instanceof Element)) {
      return '';
    }
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter(Boolean).slice(0, 2);
      if (classes.length) {
        part += `.${classes.map(c => CSS.escape(c)).join('.')}`;
      }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter(child => child.tagName === node.tagName);
        if (same.length > 1) {
          part += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };

  const roleFor = element => {
    const explicit = element.getAttribute('role');
    if (explicit) {
      return explicit;
    }
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') {
      return 'button';
    }
    if (tag === 'a' && element.hasAttribute('href')) {
      return 'link';
    }
    if (tag === 'textarea') {
      return 'textbox';
    }
    if (tag === 'select') {
      return 'combobox';
    }
    if (tag === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) {
        return 'button';
      }
      if (type === 'checkbox') {
        return 'checkbox';
      }
      if (type === 'radio') {
        return 'radio';
      }
      if (type === 'range') {
        return 'slider';
      }
      return 'textbox';
    }
    return tag;
  };

  const nameFor = element => {
    const aria = normalize(element.getAttribute('aria-label'));
    if (aria) {
      return aria;
    }
    const labelledBy = normalize(element.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const value = labelledBy
        .split(/\s+/)
        .map(id => normalize(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(' ');
      if (value) {
        return value;
      }
    }
    if ('labels' in element && element.labels?.length) {
      const value = [...element.labels]
        .map(label => normalize(label.textContent))
        .filter(Boolean)
        .join(' ');
      if (value) {
        return value;
      }
    }
    const alt = normalize(element.getAttribute('alt'));
    if (alt) {
      return alt;
    }
    const title = normalize(element.getAttribute('title'));
    if (title) {
      return title;
    }
    const text = normalize(element.textContent);
    if (text) {
      return text.slice(0, 180);
    }
    const placeholder = normalize(element.getAttribute('placeholder'));
    if (placeholder) {
      return placeholder;
    }
    const value = ['button', 'submit', 'reset'].includes((element.getAttribute('type') || '').toLowerCase())
      ? normalize(element.getAttribute('value'))
      : '';
    return value.slice(0, 180);
  };

  const describe = element => {
    if (!(element instanceof Element)) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return {
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      role: roleFor(element),
      name: nameFor(element),
      id: element.id || '',
      classes: [...element.classList].slice(0, 8),
      rect: rectObject(rect),
    };
  };

  const interactiveSelector = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="switch"]',
    '[role="slider"]',
    '[contenteditable="true"]',
    '[tabindex]',
  ].join(',');

  // Rendered dialog elements, queried before the control sweep so occlusion
  // hits can be judged against them (see dialogContextFor below).
  const dialogElements = [
    ...document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]'),
  ].filter(isRendered);
  // Returns the open dialog an element belongs to (or contains, e.g. the
  // backdrop wrapper that holds the dialog box). Used to tell "broken layout"
  // apart from "modal dialog open by design" (APG modal pattern).
  const dialogContextFor = element =>
    dialogElements.find(
      dialog => dialog === element || dialog.contains(element) || element.contains(dialog),
    ) || null;

  const interactiveElements = queryAllDeep(interactiveSelector)
    .filter((element, index, all) => all.indexOf(element) === index)
    .filter(isRendered)
    .slice(0, maxControls);

  const controls = interactiveElements.map(element => {
    const rect = element.getBoundingClientRect();
    const centerX = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(viewport.width - 1, 0));
    const centerY = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(viewport.height - 1, 0));
    const intersectionWidth = Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0));
    const intersectionHeight = Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
    const visibleFraction = (intersectionWidth * intersectionHeight) / Math.max(1, rect.width * rect.height);
    // A transformed off-canvas menu can leave a 1–3 px sliver. It is not
    // meaningfully visible to a user and should not create clipping/touch noise.
    const inViewport = isInViewport(rect) && visibleFraction >= 0.1;
    const topAtCenter = inViewport ? document.elementFromPoint(centerX, centerY) : null;
    const occluded = Boolean(topAtCenter && topAtCenter !== element && !element.contains(topAtCenter));
    // Controls behind an *open* dialog fail the center hit-test by design: the
    // modal backdrop is meant to block the background. Record the context so
    // the occluded-controls finding can ignore designed modality while still
    // reporting genuine layout occlusion (e.g. a stray always-on backdrop).
    const occluderContext = occluded ? dialogContextFor(topAtCenter) : null;
    const occludedByOpenDialog = Boolean(occluderContext && !occluderContext.contains(element));
    const clipped = inViewport && visibleFraction < 0.98;
    const style = getComputedStyle(element);
    const disabled = Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true');
    return {
      ...describe(element),
      type: element.getAttribute('type') || '',
      disabled,
      tabIndex: element.tabIndex,
      inViewport,
      visibleFraction: Math.round(visibleFraction * 1000) / 1000,
      clipped,
      occluded,
      occludedByOpenDialog,
      occludedBy: occluded ? describe(topAtCenter) : null,
      pointerEvents: style.pointerEvents,
      touchTargetSmall: rect.width < touchTarget || rect.height < touchTarget,
    };
  });

  const hiddenVisible = queryAllDeep('[hidden]').filter(isRendered).map(describe);
  const ariaHiddenCandidates = queryAllDeep('[aria-hidden="true"]')
    .filter(isRendered)
    // Deduplicate nested aria-hidden subtrees: keep only the outermost element
    // of each hidden subtree. (The previous filter was a no-op because every
    // queried element matches '[aria-hidden="true"]' by construction.)
    .filter(element => !(element.parentElement && element.parentElement.closest('[aria-hidden="true"]')));
  // Accepted pattern: an aria-hidden SVG/image inside an explicitly named parent
  // control is decorative. Reporting it as an accessibility defect penalizes the
  // exact pattern recommended by the accessible-name APIs.
  const decorativeAriaHiddenElements = ariaHiddenCandidates.filter(element => {
    if (!element.matches('svg,img,[role="presentation"],[role="none"]')) return false;
    const control = element.closest(interactiveSelector);
    if (!control || control === element) return false;
    const labelledBy = normalize(control.getAttribute('aria-labelledby'));
    const referencedName = labelledBy
      .split(/\s+/)
      .map(id => normalize(document.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(' ');
    return Boolean(normalize(control.getAttribute('aria-label')) || referencedName);
  });
  const decorativeAriaHidden = decorativeAriaHiddenElements.map(element => ({
    ...describe(element),
    acceptedPattern: 'decorative-aria-hidden-in-named-control',
    namedParent: describe(element.closest(interactiveSelector)),
  }));
  const decorativeAriaHiddenSet = new Set(decorativeAriaHiddenElements);
  const ariaHiddenVisible = ariaHiddenCandidates
    .filter(element => !decorativeAriaHiddenSet.has(element))
    .map(describe);

  const duplicateIds = Object.entries(
    [...document.querySelectorAll('[id]')].reduce((out, element) => {
      out[element.id] = (out[element.id] || 0) + 1;
      return out;
    }, {}),
  )
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));

  const visibleDialogs = dialogElements.map(describe);
  const alerts = [...document.querySelectorAll('[role="alert"], [role="status"], [aria-live]')]
    .filter(isRendered)
    .map(element => ({
      ...describe(element),
      text: normalize(element.innerText || element.textContent).slice(0, 500),
    }));
  const headings = queryAllDeep('h1,h2,h3,h4,h5,h6,[role="heading"]')
    .filter(isRendered)
    .map(element => ({
      level: Number(element.getAttribute('aria-level')) || Number(element.tagName.slice(1)) || null,
      text: normalize(element.innerText || element.textContent).slice(0, 300),
      selector: selectorFor(element),
    }));
  const landmarks = [
    ...document.querySelectorAll(
      'main,nav,aside,header,footer,[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"]',
    ),
  ]
    .filter(isRendered)
    .map(describe);

  const overlays = [...document.querySelectorAll('body *')]
    .filter(element => {
      if (!isRendered(element)) {
        return false;
      }
      const style = getComputedStyle(element);
      if (!['fixed', 'sticky'].includes(style.position)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const area =
        Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0)) *
        Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
      return area / Math.max(1, viewport.width * viewport.height) >= 0.15;
    })
    .map(element => ({
      ...describe(element),
      position: getComputedStyle(element).position,
      zIndex: getComputedStyle(element).zIndex,
    }))
    .slice(0, 30);

  const visibleText = normalize(document.body?.innerText || '').slice(0, maxText);
  const activeElement = describe(document.activeElement);
  const horizontalOverflow = Math.max(0, document.documentElement.scrollWidth - viewport.width);
  const nameless = controls.filter(control => !control.name && !['textbox'].includes(control.role));
  const occluded = controls.filter(
    control => control.inViewport && control.occluded && !control.disabled && !control.occludedByOpenDialog,
  );
  const occludedByOpenDialogCount = controls.filter(control => control.occludedByOpenDialog).length;
  const clipped = controls.filter(control => control.inViewport && control.clipped);
  const smallTouchTargets = controls.filter(
    control => control.inViewport && control.touchTargetSmall && !control.disabled,
  );

  const findings = [];
  const finding = (code, severity, title, actual, evidence = [], metadata = {}) =>
    findings.push({ code, severity, title, actual, evidence, ...metadata });
  if (hiddenVisible.length) {
    finding(
      'visible-hidden-elements',
      'blocker',
      titleFor('visible-hidden-elements'),
      actualFor('visible-hidden-elements', { count: hiddenVisible.length }),
      hiddenVisible.slice(0, 12),
    );
  }
  if (horizontalOverflow > 1) {
    finding(
      'horizontal-overflow',
      'minor',
      titleFor('horizontal-overflow'),
      actualFor('horizontal-overflow', { px: Math.round(horizontalOverflow) }),
    );
  }
  if (duplicateIds.length) {
    finding(
      'duplicate-ids',
      'major',
      titleFor('duplicate-ids'),
      actualFor('duplicate-ids', { count: duplicateIds.length }),
      duplicateIds.slice(0, 20),
    );
  }
  if (visibleDialogs.length > 1) {
    finding(
      'multiple-visible-dialogs',
      'major',
      titleFor('multiple-visible-dialogs'),
      actualFor('multiple-visible-dialogs', { count: visibleDialogs.length }),
      visibleDialogs,
    );
  }
  if (nameless.length) {
    finding(
      'nameless-controls',
      'major',
      titleFor('nameless-controls'),
      actualFor('nameless-controls', { count: nameless.length }),
      nameless.slice(0, 20),
    );
  }
  if (occluded.length) {
    finding(
      'occluded-controls',
      hiddenVisible.length ? 'minor' : 'major',
      titleFor('occluded-controls'),
      actualFor('occluded-controls', { count: occluded.length }),
      occluded.slice(0, 20),
    );
  }
  if (clipped.length) {
    finding(
      'clipped-controls',
      'minor',
      titleFor('clipped-controls'),
      actualFor('clipped-controls', { count: clipped.length }),
      clipped.slice(0, 20),
    );
  }
  if (profile === 'mobile' && smallTouchTargets.length) {
    finding(
      'small-touch-targets',
      'minor',
      titleFor('small-touch-targets'),
      actualFor('small-touch-targets', { count: smallTouchTargets.length, touch: touchTarget }),
      smallTouchTargets.slice(0, 25),
    );
  }

  const contrastSamples = queryAllDeep(
    'h1,h2,h3,h4,p,a,button,label,legend,th,td,li,[role="button"],[role="link"]',
  )
    .filter(isRendered)
    .filter(element => isInViewport(element.getBoundingClientRect()))
    .slice(0, 80)
    .map(element => {
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const fontWeight = Number.parseFloat(style.fontWeight) || 400;
      const measuredBackground = opaqueBackground(element);
      const ratio = contrastRatio(parseColor(style.color), measuredBackground);
      const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const minimum = large ? 3 : 4.5;
      return {
        ...describe(element),
        fontSize,
        foreground: style.color,
        measuredBackground: colorText(measuredBackground),
        siblingOverlay: siblingOverlayBehind(element),
        ratio: ratio ? Math.round(ratio * 100) / 100 : null,
        minimum,
        fails: Boolean(ratio && ratio < minimum && normalize(element.innerText || element.textContent)),
      };
    })
    .filter(item => item.fails);
  if (contrastSamples.length) {
    finding(
      'insufficient-contrast',
      'major',
      titleFor('insufficient-contrast'),
      actualFor('insufficient-contrast', { count: contrastSamples.length }),
      contrastSamples.slice(0, 16),
    );
  }

  const brokenImages = [...document.images]
    .filter(image => image.complete && image.naturalWidth === 0 && Boolean(image.currentSrc || image.src))
    .map(image => ({
      selector: selectorFor(image),
      src: String(image.currentSrc || image.src || '').slice(0, 180),
      alt: normalize(image.getAttribute('alt')),
    }));
  if (brokenImages.length) {
    finding(
      'broken-images',
      'major',
      titleFor('broken-images'),
      actualFor('broken-images', { count: brokenImages.length }),
      brokenImages.slice(0, 12),
    );
  }

  const unlabeledFields = queryAllDeep(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]),textarea,select',
  )
    .filter(isRendered)
    .map(element => ({ ...describe(element), named: Boolean(nameFor(element)) }))
    .filter(item => !item.named);
  if (unlabeledFields.length) {
    finding(
      'unlabeled-fields',
      'major',
      titleFor('unlabeled-fields'),
      actualFor('unlabeled-fields', { count: unlabeledFields.length }),
      unlabeledFields.slice(0, 16),
    );
  }

  const headingLevels = headings.map(item => item.level).filter(level => Number.isFinite(level));
  const headingSkips = headingLevels.filter(
    (level, index) => index > 0 && level - headingLevels[index - 1] > 1,
  );
  if (headingSkips.length) {
    finding(
      'heading-order-skip',
      'minor',
      titleFor('heading-order-skip'),
      actualFor('heading-order-skip', { seq: headingLevels.join(' → ') }),
      headingLevels,
    );
  }

  if (!document.documentElement.lang) {
    finding('missing-lang', 'minor', titleFor('missing-lang'), actualFor('missing-lang'));
  }

  if (ariaHiddenVisible.length) {
    finding(
      'visible-aria-hidden',
      'minor',
      titleFor('visible-aria-hidden'),
      actualFor('visible-aria-hidden', { count: ariaHiddenVisible.length }),
      ariaHiddenVisible.slice(0, 12),
    );
  }
  if (decorativeAriaHidden.length) {
    finding(
      'decorative-aria-hidden',
      'minor',
      titleFor('decorative-aria-hidden'),
      actualFor('decorative-aria-hidden', { count: decorativeAriaHidden.length }),
      decorativeAriaHidden.slice(0, 12),
      {
        confidence: 'low',
        kind: 'opinion',
        triage: 'accepted-pattern',
        acceptedPattern: 'decorative-aria-hidden-in-named-control',
      },
    );
  }

  const overflowingTextElements = queryAllDeep('h1,h2,h3,p,span,a,button,label')
    .filter(isRendered)
    .filter(element => {
      const style = getComputedStyle(element);
      return (
        (style.overflow === 'hidden' || style.whiteSpace === 'nowrap') &&
        element.scrollWidth > element.clientWidth + 2 &&
        normalize(element.innerText || element.textContent)
      );
    });
  const screenReaderOnlyElements = overflowingTextElements.filter(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const namedClass = /(^|[-_])(sr-only|visually-hidden|screen-reader)([-_]|$)/i.test(
      [...element.classList].join(' '),
    );
    const clippedTechnique =
      style.position === 'absolute' &&
      rect.width <= 2 &&
      rect.height <= 2 &&
      style.overflow === 'hidden' &&
      (style.clip !== 'auto' || style.clipPath !== 'none');
    return namedClass || clippedTechnique;
  });
  const screenReaderOnlySet = new Set(screenReaderOnlyElements);
  const overflowingText = overflowingTextElements
    .filter(element => !screenReaderOnlySet.has(element))
    .map(describe)
    .slice(0, 16);
  const screenReaderOnly = screenReaderOnlyElements
    .map(element => ({
      ...describe(element),
      acceptedPattern: 'screen-reader-only-clipping',
      clip: getComputedStyle(element).clip,
      clipPath: getComputedStyle(element).clipPath,
    }))
    .slice(0, 16);
  if (overflowingText.length) {
    finding(
      'text-overflow',
      'minor',
      titleFor('text-overflow'),
      actualFor('text-overflow', { count: overflowingText.length }),
      overflowingText,
    );
  }
  if (screenReaderOnly.length) {
    finding(
      'screen-reader-only-clipping',
      'minor',
      titleFor('screen-reader-only-clipping'),
      actualFor('screen-reader-only-clipping', { count: screenReaderOnly.length }),
      screenReaderOnly,
      {
        confidence: 'low',
        kind: 'opinion',
        triage: 'accepted-pattern',
        acceptedPattern: 'screen-reader-only-clipping',
      },
    );
  }

  return {
    capturedAt: new Date().toISOString(),
    profile,
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || '',
    viewport,
    activeElement,
    visibleText,
    headings,
    landmarks,
    dialogs: visibleDialogs,
    alerts,
    overlays,
    controls,
    counts: {
      controls: controls.length,
      controlsInViewport: controls.filter(c => c.inViewport).length,
      headings: headings.length,
      landmarks: landmarks.length,
      dialogs: visibleDialogs.length,
      alerts: alerts.length,
      overlays: overlays.length,
      visibleHidden: hiddenVisible.length,
      ariaHiddenVisible: ariaHiddenVisible.length,
      acceptedPatterns: decorativeAriaHidden.length + screenReaderOnly.length,
      brokenImages: brokenImages.length,
      unlabeledFields: unlabeledFields.length,
      contrastFails: contrastSamples.length,
      duplicateIds: duplicateIds.length,
      occludedControls: occluded.length,
      occludedByOpenDialog: occludedByOpenDialogCount,
      clippedControls: clipped.length,
      namelessControls: nameless.length,
      smallTouchTargets: smallTouchTargets.length,
    },
    hiddenVisible,
    ariaHiddenVisible,
    acceptedPatterns: [...decorativeAriaHidden, ...screenReaderOnly],
    brokenImages,
    unlabeledFields,
    contrastSamples,
    overflowingText,
    duplicateIds,
    horizontalOverflow,
    findings,
  };
}

module.exports = { collectBrowserPerception };
