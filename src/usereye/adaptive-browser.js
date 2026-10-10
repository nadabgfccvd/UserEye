'use strict';

/** Functions in this module execute inside page.evaluate and must be self-contained. */

function collectAdaptiveFacts() {
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
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number.parseFloat(style.opacity || '1') > 0.01 &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  return {
    forms: [...document.forms].filter(visible).length,
    inputs: queryAllDeep('input:not([type="hidden"]),textarea,select').filter(visible).length,
    passwordInputs: queryAllDeep('input[type="password"]').filter(visible).length,
    tables: queryAllDeep('table,[role="grid"],[role="table"]').filter(visible).length,
    cards: queryAllDeep('article,.card,[role="article"],li').filter(visible).length,
    navigation: queryAllDeep('nav,[role="navigation"],[role="tablist"]').filter(visible).length,
    headings: queryAllDeep('h1,h2,h3,[role="heading"]').filter(visible).length,
    shadowRoots: queryAllDeep('*').filter(element => element.shadowRoot).length,
    controls: queryAllDeep('button,a[href],input,select,textarea,[role="button"],[role="tab"]').filter(
      visible,
    ).length,
  };
}

function collectActionCandidates(patternInput = {}) {
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
  const normalize = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const intersectionWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const intersectionHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    const fraction = (intersectionWidth * intersectionHeight) / Math.max(1, rect.width * rect.height);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number.parseFloat(style.opacity || '1') > 0.01 &&
      rect.width > 0 &&
      rect.height > 0 &&
      fraction >= 0.25
    );
  };
  const selectorFor = element => {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }
    for (const attribute of ['data-testid', 'data-test', 'name']) {
      const value = element.getAttribute(attribute);
      if (value) {
        return `${element.tagName.toLowerCase()}[${attribute}="${CSS.escape(value)}"]`;
      }
    }
    const parts = [];
    let node = element;
    while (node && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(child => child.tagName === node.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return `body > ${parts.join(' > ')}`;
  };
  const nameFor = element => {
    const labelledBy = element.getAttribute('aria-labelledby');
    const labels =
      'labels' in element && element.labels?.length
        ? [...element.labels].map(label => normalize(label.textContent)).join(' ')
        : '';
    const referencedLabel = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map(id => normalize(document.getElementById(id)?.textContent))
          .join(' ')
      : '';
    return (
      normalize(element.getAttribute('aria-label')) ||
      referencedLabel ||
      labels ||
      normalize(element.textContent) ||
      normalize(element.getAttribute('title')) ||
      normalize(element.getAttribute('placeholder'))
    );
  };
  const elements = queryAllDeep(
    'a[href],button,input[type="submit"],input[type="button"],[role="button"],[role="tab"],[role="link"],[role="menuitem"],[role="switch"]',
  )
    .filter((element, index, all) => all.indexOf(element) === index)
    .filter(visible)
    .filter(element => !element.disabled && element.getAttribute('aria-disabled') !== 'true');
  const asPattern = (name, fallback) => {
    const input = patternInput?.[name];
    try {
      return input?.source ? new RegExp(input.source, input.flags || 'i') : fallback;
    } catch {
      return fallback;
    }
  };
  const patterns = {
    dangerous: asPattern('dangerous', /delete|remove|destroy|logout|purchase|checkout|pay|payment/i),
    write: asPattern('write', /new |add|create|save|edit|upload|attach|send|submit|publish/i),
    // Prefer the accessible name for auth. Loose ids such as "login-cancel"
    // must never classify cancel buttons as authentication submits.
    auth: asPattern('auth', /login|sign[ -]?in|continue|unlock|log in/i),
    navigation: asPattern('navigation', /menu|settings|profile|home|dashboard|back|next|tab/i),
    utility: asPattern('utility', /search|filter|copy|show|hide|generate|close|cancel|dismiss/i),
  };
  const priorities = { navigation: 90, auth: 85, utility: 65, write: 45, dangerous: -100, control: 55 };

  return elements
    .map(element => {
      const name = nameFor(element).slice(0, 180);
      const href = element instanceof HTMLAnchorElement ? element.href : '';
      const type = element.getAttribute('type') || '';
      const tag = element.tagName.toLowerCase();
      const signature = `${name} ${element.id} ${element.className}`;
      const dangerous = patterns.dangerous.test(signature) || element.classList.contains('danger');
      const write =
        patterns.write.test(signature) || type === 'submit' || (tag === 'button' && type !== 'button');
      const utility =
        patterns.utility.test(name) ||
        patterns.utility.test(signature) ||
        element.getAttribute('role') === 'switch';
      // Name-first auth signal; never treat cancel/close utility controls as auth submits.
      const auth =
        !dangerous &&
        !utility &&
        (patterns.auth.test(name) ||
          (patterns.auth.test(signature) && (type === 'submit' || tag === 'button' || tag === 'input')));
      const isNavigation =
        element.matches('a[href]') ||
        element.getAttribute('role') === 'tab' ||
        patterns.navigation.test(signature);
      const kind = dangerous
        ? 'dangerous'
        : auth
          ? 'auth'
          : write
            ? 'write'
            : isNavigation
              ? 'navigation'
              : utility
                ? 'utility'
                : 'control';
      // Real form submits must outrank nav links that only share the "Entrar" label.
      let priority = priorities[kind];
      if (kind === 'auth') {
        if (type === 'submit') {
          priority += 25;
        } else if (tag === 'button' && write) {
          priority += 20;
        } else if (tag === 'a' || href) {
          priority -= 15;
        }
      }
      return {
        selector: selectorFor(element),
        name,
        kind,
        priority,
        dangerous,
        write,
        auth,
        external: Boolean(href && new URL(href, location.href).origin !== location.origin),
        href,
        tag,
        role: element.getAttribute('role') || '',
        type,
      };
    })
    .filter(candidate => candidate.name || candidate.href)
    .sort((first, second) => second.priority - first.priority);
}

function collectFormFields(seed) {
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
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 0 &&
      rect.height > 0 &&
      !element.disabled &&
      !element.readOnly
    );
  };
  const normalize = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  const selectorFor = element => {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }
    if (element.name) {
      return `${element.tagName.toLowerCase()}[name="${CSS.escape(element.name)}"]`;
    }
    const parts = [];
    let node = element;
    while (node && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(child => child.tagName === node.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return `body > ${parts.join(' > ')}`;
  };
  return queryAllDeep('input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select')
    .filter(visible)
    .map(element => {
      const label =
        'labels' in element && element.labels?.length
          ? [...element.labels].map(item => normalize(item.textContent)).join(' ')
          : '';
      const signature = normalize(
        `${label} ${element.name} ${element.id} ${element.placeholder} ${element.autocomplete}`,
      ).toLowerCase();
      const type = (element.getAttribute('type') || element.tagName.toLowerCase()).toLowerCase();
      let value = `UserEye ${seed}`;
      if (type === 'email' || /email|e-mail/.test(signature)) {
        value = `usereye+${seed}@example.test`;
      } else if (type === 'password' || /senha|password|passcode/.test(signature)) {
        value = `UserEye#${seed}Aa1!`;
      } else if (type === 'url' || /url|site|website/.test(signature)) {
        value = 'https://example.test/usereye';
      } else if (type === 'tel' || /telefone|phone|celular/.test(signature)) {
        value = '31999990000';
      } else if (type === 'number' || /quantidade|idade|number|número/.test(signature)) {
        value = '42';
      } else if (type === 'date') {
        value = '2026-08-11';
      } else if (type === 'time') {
        value = '10:30';
      } else if (/user|usuário|username/.test(signature)) {
        value = `usereye_${seed}`;
      } else if (/search|buscar|pesquisa/.test(signature)) {
        return null;
      }
      return {
        selector: selectorFor(element),
        type,
        value,
        sensitive: type === 'password',
        required: element.required,
        tag: element.tagName.toLowerCase(),
        signature,
      };
    })
    .filter(Boolean);
}

module.exports = { collectAdaptiveFacts, collectActionCandidates, collectFormFields };
