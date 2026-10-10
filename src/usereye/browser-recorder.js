'use strict';

/** Browser-context recorder. Must remain self-contained for addInitScript(). */
function installUserEyeRecorder() {
  if (window.__userEyeRecorderInstalled) {
    return;
  }
  window.__userEyeRecorderInstalled = true;
  const normalize = value =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  const targetInfo = raw => {
    const element =
      raw instanceof Element
        ? raw.closest(
            'button,a[href],input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="menuitem"],[tabindex],[contenteditable="true"]',
          ) || raw
        : null;
    if (!element) {
      return null;
    }
    const labels =
      'labels' in element && element.labels
        ? [...element.labels].map(label => normalize(label.textContent)).join(' ')
        : '';
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      role: element.getAttribute('role') || '',
      type: element.getAttribute('type') || '',
      name:
        normalize(element.getAttribute('aria-label')) ||
        labels ||
        normalize(element.textContent).slice(0, 160) ||
        normalize(element.getAttribute('placeholder')),
      classes: [...element.classList].slice(0, 6),
      sensitive: element.matches('input[type="password"],[data-sensitive="true"]'),
    };
  };
  const emit = payload => {
    try {
      Promise.resolve(
        window.__userEyeRecord({
          at: new Date().toISOString(),
          trusted: payload.originalEvent?.isTrusted ?? null,
          viewport: { width: innerWidth, height: innerHeight },
          ...payload,
          originalEvent: undefined,
        }),
      ).catch(() => {});
    } catch {}
  };

  // Perceived-response monitor: starts on a real pointer/keyboard action,
  // watches DOM feedback and loading indicators, then measures settlement.
  let uxSequence = 0;
  let uxCurrent = null;
  const isVisible = element => {
    if (!(element instanceof Element)) {
      return false;
    }
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
  const loadingElement = () =>
    [
      ...document.querySelectorAll(
        [
          '[aria-busy="true"]',
          '[role="progressbar"]',
          '.spinner',
          '.spin',
          '.loading',
          '.loader',
          '[class*="spinner"]',
          '[class*="loading"]',
          'button:disabled',
        ].join(','),
      ),
    ].find(element => {
      if (!isVisible(element)) {
        return false;
      }
      const text = normalize(element.textContent);
      return (
        element.matches(
          '[aria-busy="true"],[role="progressbar"],.spinner,.spin,.loading,.loader,[class*="spinner"],[class*="loading"]',
        ) ||
        /carregando|loading|salvando|aguarde|processando|criando|desbloqueando|criptografando|re-criptografando/i.test(
          text,
        )
      );
    }) || null;
  const finishUx = reason => {
    if (!uxCurrent) {
      return;
    }
    const current = uxCurrent;
    uxCurrent = null;
    clearTimeout(current.settleTimer);
    clearTimeout(current.maxTimer);
    emit({
      kind: 'ux-interaction-settled',
      token: current.token,
      purpose: current.purpose,
      target: current.target,
      totalMs: performance.now() - current.startedPerf,
      feedbackMs: current.feedbackMs,
      loadingDetected: current.loadingDetected,
      reason,
    });
  };
  const scheduleUxFinish = (delay, reason) => {
    if (!uxCurrent) {
      return;
    }
    clearTimeout(uxCurrent.settleTimer);
    uxCurrent.settleTimer = setTimeout(() => finishUx(reason), delay);
  };
  const startUx = (event, source) => {
    if (uxCurrent) {
      finishUx('next-interaction');
    }
    const purpose = window.__userEyeNextPurpose || 'user';
    window.__userEyeNextPurpose = null;
    const token = `ux-${Date.now()}-${++uxSequence}`;
    uxCurrent = {
      token,
      purpose,
      source,
      target: targetInfo(event.target),
      startedPerf: performance.now(),
      feedbackMs: null,
      loadingDetected: false,
      settleTimer: null,
      maxTimer: null,
    };
    emit({
      kind: 'ux-interaction-start',
      token,
      purpose,
      source,
      target: uxCurrent.target,
      originalEvent: event,
    });
    scheduleUxFinish(1200, 'no-visual-change');
    uxCurrent.maxTimer = setTimeout(() => finishUx('max-timeout'), 10000);
  };
  const feedbackUx = signal => {
    if (!uxCurrent || (uxCurrent.feedbackMs !== null && uxCurrent.feedbackMs !== undefined)) {
      return;
    }
    uxCurrent.feedbackMs = performance.now() - uxCurrent.startedPerf;
    emit({
      kind: 'ux-visual-feedback',
      token: uxCurrent.token,
      purpose: uxCurrent.purpose,
      target: uxCurrent.target,
      delayMs: uxCurrent.feedbackMs,
      signal,
    });
  };
  const uxObserver = new MutationObserver(mutations => {
    if (!uxCurrent) {
      return;
    }
    const meaningful = mutations.some(
      mutation => mutation.type !== 'attributes' || mutation.attributeName !== 'style',
    );
    feedbackUx(meaningful ? 'dom-change' : 'cosmetic-style-change');
    const loading = loadingElement();
    if (loading) {
      clearTimeout(uxCurrent.settleTimer);
      if (!uxCurrent.loadingDetected) {
        uxCurrent.loadingDetected = true;
        emit({
          kind: 'ux-loading-indicator',
          token: uxCurrent.token,
          purpose: uxCurrent.purpose,
          target: uxCurrent.target,
          delayMs: performance.now() - uxCurrent.startedPerf,
          indicator: targetInfo(loading),
        });
      }
    } else {
      scheduleUxFinish(meaningful ? 450 : 1200, meaningful ? 'visual-stable' : 'cosmetic-only');
    }
  });
  uxObserver.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-busy', 'aria-hidden'],
  });
  window.__userEyeFlushExperience = () => finishUx('flush');
  document.addEventListener('pointerdown', event => startUx(event, 'pointer'), true);
  document.addEventListener(
    'focusin',
    event => {
      if (!uxCurrent) {
        return;
      }
      // Focus is meaningful feedback for an editable control, but merely
      // focusing a button does not prove its requested action happened.
      if (event.target?.matches?.('input,textarea,select,[contenteditable="true"]')) {
        feedbackUx('focus');
        if (!loadingElement()) {
          scheduleUxFinish(180, 'focus-stable');
        }
      }
    },
    true,
  );
  document.addEventListener(
    'keydown',
    event => {
      if (!['Enter', ' '].includes(event.key)) {
        return;
      }
      if (
        event.target?.matches?.(
          'button,a[href],[role="button"],[role="link"],input[type="submit"],input[type="button"]',
        )
      ) {
        startUx(event, 'keyboard');
      }
    },
    true,
  );

  document.addEventListener(
    'click',
    event => emit({ kind: 'click', target: targetInfo(event.target), originalEvent: event }),
    true,
  );
  document.addEventListener(
    'submit',
    event => emit({ kind: 'submit', target: targetInfo(event.target), originalEvent: event }),
    true,
  );
  document.addEventListener(
    'input',
    event =>
      emit({
        kind: 'input',
        target: targetInfo(event.target),
        valueLength: typeof event.target?.value === 'string' ? event.target.value.length : null,
        originalEvent: event,
      }),
    true,
  );
  document.addEventListener(
    'change',
    event => {
      feedbackUx('control-change');
      if (uxCurrent && !loadingElement()) {
        scheduleUxFinish(180, 'control-change-stable');
      }
      emit({
        kind: 'change',
        target: targetInfo(event.target),
        checked: typeof event.target?.checked === 'boolean' ? event.target.checked : undefined,
        files: event.target?.files
          ? [...event.target.files].map(file => ({ name: file.name, size: file.size, type: file.type }))
          : undefined,
        originalEvent: event,
      });
    },
    true,
  );
  document.addEventListener(
    'keydown',
    event => {
      const editable = event.target?.matches?.('input,textarea,select,[contenteditable="true"]');
      const notable =
        ['Tab', 'Escape', 'Enter', ' '].includes(event.key) ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (!editable && ['/', 'n', 'N'].includes(event.key));
      if (notable) {
        emit({
          kind: 'keydown',
          key: event.key,
          modifiers: {
            alt: event.altKey,
            ctrl: event.ctrlKey,
            meta: event.metaKey,
            shift: event.shiftKey,
          },
          target: targetInfo(event.target),
          originalEvent: event,
        });
      }
    },
    true,
  );
  document.addEventListener(
    'drop',
    event =>
      emit({
        kind: 'drop',
        target: targetInfo(event.target),
        files: event.dataTransfer?.files
          ? [...event.dataTransfer.files].map(file => ({
              name: file.name,
              size: file.size,
              type: file.type,
            }))
          : [],
        originalEvent: event,
      }),
    true,
  );
}

module.exports = { installUserEyeRecorder };
