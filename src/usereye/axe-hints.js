'use strict';

const { format, section } = require('./i18n');

/**
 * Runs in the browser. For every axe target, look for a positioned sibling that
 * paints beneath a transparent text element at its centre point. axe computes
 * contrast from the target/ancestor paint chain and cannot treat that sibling as
 * the target's background, which is a frequent cause of confusing pill/slider
 * contrast failures.
 */
function detectSiblingOverlays(targets) {
  const selectorFor = element => {
    if (!(element instanceof Element)) return '';
    if (element.id) return `#${CSS.escape(element.id)}`;
    let selector = element.tagName.toLowerCase();
    const classes = [...element.classList].filter(Boolean).slice(0, 2);
    if (classes.length) selector += `.${classes.map(value => CSS.escape(value)).join('.')}`;
    return selector;
  };
  const alpha = color => {
    const match = String(color || '').match(
      /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([\d.]+))?\s*\)$/i,
    );
    if (!match) return 0;
    return match[1] === undefined ? 1 : Number(match[1]);
  };
  const rendered = element => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
      return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const resolveTarget = segments => {
    let root = document;
    let element = null;
    for (const selector of Array.isArray(segments) ? segments : [segments]) {
      try {
        element = root.querySelector(selector);
      } catch {
        return null;
      }
      if (!element) return null;
      root = element.shadowRoot || element;
    }
    return element;
  };
  const ancestorBackground = element => {
    let current = element;
    while (current instanceof Element) {
      const background = getComputedStyle(current).backgroundColor;
      if (alpha(background) >= 0.92) {
        return { selector: selectorFor(current), background };
      }
      current = current.parentElement;
    }
    return { selector: 'canvas', background: 'rgb(255, 255, 255)' };
  };

  return targets.map(target => {
    const element = resolveTarget(target);
    if (!rendered(element) || !element.parentElement) return null;
    const ownBackground = getComputedStyle(element).backgroundColor;
    // A real background on the text element is already in axe's paint chain; in
    // that case a sibling is not the likely root cause described by this hint.
    if (alpha(ownBackground) >= 0.92) return null;
    const rect = element.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(innerWidth - 1, 0));
    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(innerHeight - 1, 0));
    const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
    const siblings = [...element.parentElement.children].filter(candidate => {
      if (candidate === element || !rendered(candidate)) return false;
      const style = getComputedStyle(candidate);
      if (!['absolute', 'fixed', 'sticky'].includes(style.position)) return false;
      if (alpha(style.backgroundColor) < 0.05 && style.backgroundImage === 'none') return false;
      const candidateRect = candidate.getBoundingClientRect();
      if (
        x < candidateRect.left ||
        x > candidateRect.right ||
        y < candidateRect.top ||
        y > candidateRect.bottom
      )
        return false;
      // elementsFromPoint is top-to-bottom. When available, require the sibling
      // to be behind the target; the geometric fallback covers older DOM shims.
      if (stack.length) {
        const targetIndex = stack.findIndex(node => node === element || element.contains(node));
        const candidateIndex = stack.indexOf(candidate);
        if (targetIndex >= 0 && candidateIndex >= 0 && candidateIndex < targetIndex) return false;
      }
      return true;
    });
    const overlay = siblings[0];
    if (!overlay) return null;
    const overlayStyle = getComputedStyle(overlay);
    return {
      code: 'sibling-overlay-background',
      target: selectorFor(element),
      overlay: selectorFor(overlay),
      overlayBackground: overlayStyle.backgroundColor,
      overlayPosition: overlayStyle.position,
      overlayZIndex: overlayStyle.zIndex || 'auto',
      measuredAncestor: ancestorBackground(element),
    };
  });
}

function contrastSiblingHintText(hint, locale = 'en') {
  if (!hint) return '';
  const template =
    section(locale, 'issue').contrastSiblingOverlayHint ||
    'Possible root cause: a positioned sibling ({overlay}) is painted behind {target}. axe does not use sibling overlays as the text background; it measured {ancestor} ({background}). Give the element containing the text its own background-color, or verify contrast against the measured ancestor.';
  return format(template, {
    overlay: hint.overlay,
    target: hint.target,
    ancestor: hint.measuredAncestor?.selector || 'an ancestor',
    background: hint.measuredAncestor?.background || 'unknown',
  });
}

/**
 * Add an additive `usereyeHint` to color-contrast nodes. The original axe payload
 * is otherwise untouched, so consumers that do not know this field remain valid.
 */
async function annotateAxeContrastOverlays(page, axeResult, locale = 'en') {
  const contrast = (axeResult?.violations || []).filter(item => item.id === 'color-contrast');
  const nodes = contrast.flatMap(item => item.nodes || []);
  if (!nodes.length || !page || page.isClosed?.()) return axeResult;
  let hints;
  try {
    hints = await page.evaluate(
      detectSiblingOverlays,
      nodes.map(node => node.target || []),
    );
  } catch {
    return axeResult;
  }
  nodes.forEach((node, index) => {
    const hint = hints?.[index];
    if (!hint) return;
    node.usereyeHint = {
      ...hint,
      technical: contrastSiblingHintText(hint, locale),
    };
  });
  return axeResult;
}

module.exports = {
  annotateAxeContrastOverlays,
  contrastSiblingHintText,
  detectSiblingOverlays,
};
