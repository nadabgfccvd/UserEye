'use strict';

/** Runs inside the browser; keep this function self-contained. */
function collectUserGaze({ profile, maxBlocks, strings }) {
  const limit = Number(maxBlocks || 40);
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  };

  const normalize = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

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

  const luminance = color =>
    0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);

  const contrastRatio = (foreground, background) => {
    if (!foreground || !background) {
      return null;
    }
    const first = luminance(foreground);
    const second = luminance(background);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
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
    return rect.width > 2 && rect.height > 2;
  };

  const inFold = rect =>
    rect.bottom > 8 && rect.right > 8 && rect.top < viewport.height - 4 && rect.left < viewport.width - 4;

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
        part += `.${classes.map(item => CSS.escape(item)).join('.')}`;
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

  const accessibleName = element => {
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
      normalize(element.getAttribute('placeholder')) ||
      normalize(element.getAttribute('title')) ||
      normalize(element.textContent).slice(0, 160)
    );
  };

  const describe = (element, extra = {}) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const fontWeight = Number.parseFloat(style.fontWeight) || 400;
    const color = parseColor(style.color);
    const background = opaqueBackground(element);
    const contrast = contrastRatio(color, background);
    const area = Math.max(1, rect.width * rect.height);
    const foldArea = viewport.width * viewport.height;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const positionBias = 1.15 - Math.min(1, centerY / Math.max(1, viewport.height)) * 0.45;
    const centerBias = 1 - Math.min(0.35, Math.abs(centerX / Math.max(1, viewport.width) - 0.5));
    const visualWeight = Math.round(
      (fontSize / 16) * (fontWeight / 400) * Math.min(8, area / 4000) * positionBias * centerBias * 10,
    );
    return {
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || '',
      id: element.id || '',
      name: accessibleName(element).slice(0, 180),
      text: normalize(element.innerText || element.textContent).slice(0, 220),
      fontSize: Math.round(fontSize * 10) / 10,
      fontWeight,
      contrast,
      visualWeight,
      foldCoverage: Math.round((area / Math.max(1, foldArea)) * 1000) / 1000,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      ...extra,
    };
  };

  const foldText = normalize(document.body?.innerText || '')
    .split(/\s+/)
    .filter(Boolean);
  const wordCount = foldText.length;
  const headingNodes = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(
    element => isRendered(element) && inFold(element.getBoundingClientRect()),
  );
  const headlineNode =
    headingNodes.find(
      element => /^h1$/i.test(element.tagName) || element.getAttribute('aria-level') === '1',
    ) ||
    headingNodes.sort(
      (first, second) =>
        Number.parseFloat(getComputedStyle(second).fontSize) -
        Number.parseFloat(getComputedStyle(first).fontSize),
    )[0] ||
    null;

  const actionSelector = [
    'a[href]',
    'button',
    'input[type="submit"]',
    'input[type="button"]',
    '[role="button"]',
    '[role="link"]',
  ].join(',');
  const actionNodes = [...document.querySelectorAll(actionSelector)].filter(element => {
    if (!isRendered(element) || element.disabled || element.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return inFold(rect);
  });

  const primaryPattern =
    /entrar|login|sign in|começar|comecar|continuar|continue|criar|cadastr|salvar|save|enviar|submit|desbloquear|acessar|próximo|proximo|next|start|get started|try|explorar/i;
  const secondaryPattern = /cancelar|cancel|fechar|close|voltar|back|pular|skip|depois|later/i;
  const scoredActions = actionNodes
    .map(element => {
      const item = describe(element);
      const signature = `${item.name} ${item.id} ${element.className}`;
      const looksPrimary =
        element.classList.contains('primary') ||
        element.classList.contains('btn-primary') ||
        /primary|cta|hero/.test(element.className) ||
        primaryPattern.test(signature);
      const looksSecondary = secondaryPattern.test(signature) || element.classList.contains('secondary');
      const score = item.visualWeight + (looksPrimary ? 28 : 0) - (looksSecondary ? 18 : 0);
      return { ...item, looksPrimary, looksSecondary, score };
    })
    .sort((first, second) => second.score - first.score);

  const primaryCta = scoredActions[0] || null;
  const competingCtas = scoredActions
    .filter(item => item.looksPrimary || item.score >= (primaryCta?.score || 0) * 0.72)
    .slice(0, 6);

  const fieldNodes = [
    ...document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select',
    ),
  ].filter(element => isRendered(element) && inFold(element.getBoundingClientRect()));

  const readingOrder = [...headingNodes, ...actionNodes, ...fieldNodes]
    .filter((element, index, all) => all.indexOf(element) === index)
    .map(element => describe(element))
    .sort((first, second) => first.rect.y - second.rect.y || first.rect.x - second.rect.x)
    .slice(0, limit);

  const images = [...document.images]
    .filter(image => isRendered(image) && inFold(image.getBoundingClientRect()))
    .map(image => ({
      selector: selectorFor(image),
      src: String(image.currentSrc || image.src || '').slice(0, 180),
      alt: normalize(image.getAttribute('alt')),
      decorative: image.getAttribute('alt') === '' || image.getAttribute('role') === 'presentation',
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      broken: image.complete && image.naturalWidth === 0 && Boolean(image.currentSrc || image.src),
      rect: {
        width: Math.round(image.getBoundingClientRect().width),
        height: Math.round(image.getBoundingClientRect().height),
      },
    }));

  const passwordFields = fieldNodes.filter(element => (element.getAttribute('type') || '') === 'password');
  const https =
    location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const mixedPassword =
    passwordFields.length > 0 &&
    location.protocol === 'http:' &&
    !['localhost', '127.0.0.1'].includes(location.hostname);

  const landmarks = [
    ...document.querySelectorAll('main,nav,header,[role="main"],[role="navigation"],[role="banner"]'),
  ].filter(isRendered).length;
  const skipLink = [...document.querySelectorAll('a[href^="#"]')].some(link =>
    /skip|pular|ir para o conteúdo|main content/i.test(
      normalize(link.textContent + link.getAttribute('aria-label')),
    ),
  );

  // Localized scan lines injected by captureGaze via i18n.section(locale,'scan');
  // falls back to English templates when no strings are provided.
  const SC = strings || {};
  const scanLine = (key, fallback, params) =>
    SC[key]
      ? String(SC[key]).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      : fallback.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  const scan3s = [
    headlineNode
      ? scanLine('title', 'Title: {text}', { text: normalize(headlineNode.innerText).slice(0, 120) })
      : null,
    primaryCta
      ? scanLine('obviousAction', 'Obvious action: {name}', { name: primaryCta.name || primaryCta.text })
      : null,
    fieldNodes[0]
      ? scanLine('fieldInView', 'Field in view: {name}', {
          name:
            accessibleName(fieldNodes[0]) ||
            fieldNodes[0].getAttribute('type') ||
            SC.fieldFallback ||
            'input',
        })
      : null,
    competingCtas.length > 1
      ? scanLine('competingCtas', '{count} calls to action compete in the first fold', {
          count: competingCtas.length,
        })
      : null,
  ].filter(Boolean);

  return {
    capturedAt: new Date().toISOString(),
    profile: profile || (viewport.width <= 600 ? 'mobile' : 'desktop'),
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || '',
    viewport,
    fold: {
      wordCount,
      headingCount: headingNodes.length,
      actionCount: actionNodes.length,
      fieldCount: fieldNodes.length,
      imageCount: images.length,
      landmarkCount: landmarks,
    },
    headline: headlineNode ? describe(headlineNode, { level: headlineNode.tagName.toLowerCase() }) : null,
    primaryCta,
    competingCtas,
    readingOrder,
    images,
    fields: fieldNodes.slice(0, 20).map(element =>
      describe(element, {
        type: element.getAttribute('type') || element.tagName.toLowerCase(),
        required: element.required,
        autocomplete: element.getAttribute('autocomplete') || '',
      }),
    ),
    trust: {
      https,
      mixedPassword,
      hasLang: Boolean(document.documentElement.lang),
      skipLink,
      passwordFields: passwordFields.length,
    },
    scan3s,
  };
}

module.exports = { collectUserGaze };
