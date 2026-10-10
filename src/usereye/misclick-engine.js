'use strict';

const crypto = require('crypto');
const { section, t } = require('./i18n');

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

class MisclickEngine {
  constructor(eye) {
    this.eye = eye;
  }

  /** Report locale of the owning UserEye instance (English fallback). */
  locale() {
    return this.eye?.options?.reportLocale || 'en';
  }

  async quickUserState() {
    const state = await this.eye.page.evaluate(() => {
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
      const normalize = value =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim();
      const text = normalize(document.body?.innerText || '');
      let textHash = 2166136261;
      for (let index = 0; index < text.length; index++) {
        textHash ^= text.charCodeAt(index);
        textHash = Math.imul(textHash, 16777619);
      }
      const dialogs = [...document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"]')].filter(
        visible,
      );
      const alerts = [...document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')].filter(
        visible,
      );
      const controls = [
        ...document.querySelectorAll(
          'button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex]',
        ),
      ].filter(visible);
      return {
        url: location.href,
        title: document.title,
        textHash: String(textHash >>> 0),
        dialogs: dialogs.map(element =>
          normalize(element.getAttribute('aria-label') || element.textContent).slice(0, 160),
        ),
        alerts: alerts.map(element => normalize(element.textContent).slice(0, 160)),
        controlCount: controls.length,
        active:
          document.activeElement?.id ||
          document.activeElement?.getAttribute?.('aria-label') ||
          document.activeElement?.tagName ||
          '',
      };
    });
    const material = {
      url: state.url,
      title: state.title,
      textHash: state.textHash,
      dialogs: state.dialogs,
      alerts: state.alerts,
      controlCount: state.controlCount,
    };
    return this.eye._sanitize({
      ...state,
      materialHash: hash(JSON.stringify(material)),
      stateHash: hash(JSON.stringify(state)),
    });
  }

  async hitAtPoint(locator, x, y) {
    return locator.first().evaluate(
      (target, point) => {
        const normalize = value =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
        const hit = document.elementFromPoint(point.x, point.y);
        const interactive =
          hit?.closest?.(
            'button,a[href],input,select,textarea,[role="button"],[role="link"],[role="tab"],[tabindex]',
          ) || null;
        const describe = element =>
          element
            ? {
                tag: element.tagName.toLowerCase(),
                id: element.id || '',
                role: element.getAttribute('role') || '',
                type: element.getAttribute('type') || '',
                name: normalize(
                  element.getAttribute('aria-label') ||
                    element.textContent ||
                    element.getAttribute('placeholder'),
                ).slice(0, 180),
                classes: [...element.classList].slice(0, 8),
              }
            : null;
        const value = describe(interactive);
        const signature = normalize(
          [value?.name, value?.id, value?.classes?.join(' '), value?.type].join(' '),
        );
        return {
          x: point.x,
          y: point.y,
          hit: describe(hit),
          interactive: describe(interactive),
          insideTarget: Boolean(hit && (hit === target || target.contains(hit))),
          dangerous:
            Boolean(interactive) &&
            (/(^|\s)(excluir|delete|remover|apagar|logout|sair|bloquear|comprar|pagar)(\s|$)/i.test(
              signature,
            ) ||
              Boolean(interactive.classList?.contains('danger'))),
        };
      },
      { x, y },
    );
  }

  pointMap(box, distance) {
    return {
      left: { x: box.x - distance, y: box.y + box.height / 2 },
      right: { x: box.x + box.width + distance, y: box.y + box.height / 2 },
      top: { x: box.x + box.width / 2, y: box.y - distance },
      bottom: { x: box.x + box.width / 2, y: box.y + box.height + distance },
      'top-left': { x: box.x - distance, y: box.y - distance },
      'top-right': { x: box.x + box.width + distance, y: box.y - distance },
      'bottom-left': { x: box.x - distance, y: box.y + box.height + distance },
      'bottom-right': { x: box.x + box.width + distance, y: box.y + box.height + distance },
    };
  }

  outcome(hit, before, after, options = {}) {
    const state = {
      changed: before.materialHash !== after.materialHash,
      urlChanged: before.url !== after.url,
      dialogChanged: JSON.stringify(before.dialogs) !== JSON.stringify(after.dialogs),
      alertChanged: JSON.stringify(before.alerts) !== JSON.stringify(after.alerts),
      unintendedInteractive: Boolean(hit.interactive && !hit.insideTarget),
    };
    const stableOnly = options.stableOnly === true;
    // Phase 2.1 "stable-only": only hard signals (URL/dialog change, or a real
    // destructive activation) are harmful. A focus-revealed sibling or a skip
    // link that merely repaints is a confusion risk, not a defect.
    const harmful = stableOnly
      ? state.urlChanged || state.dialogChanged || (hit.dangerous && state.changed)
      : state.urlChanged ||
        state.dialogChanged ||
        (state.unintendedInteractive && state.changed) ||
        (hit.dangerous && state.changed);
    const confusing = state.changed || state.unintendedInteractive || state.alertChanged || hit.insideTarget;
    const M = section(this.locale(), 'misclick');
    const effects = [
      state.urlChanged && t(M, 'effectNavigation'),
      state.dialogChanged && t(M, 'effectDialog'),
      state.alertChanged && t(M, 'effectAlert'),
      state.unintendedInteractive &&
        t(M, 'effectHit', { name: hit.interactive?.name || hit.interactive?.tag }),
      hit.insideTarget && t(M, 'effectOutsideActivated'),
      state.changed && t(M, 'effectVisual'),
    ].filter(Boolean);
    return {
      outcome: harmful ? 'harmful' : confusing ? 'confusing' : 'harmless',
      effect: effects.join('; ') || t(M, 'effectNone'),
    };
  }

  async saveEvidence(record, targetDescription, options) {
    const M2 = section(this.locale(), 'misclick');
    if (record.outcome !== 'harmless' && options.screenshotOnProblem) {
      record.screenshot = await this.eye.screenshot(
        `misclick-${record.point}-${this.eye.misclicks.length}`,
        false,
      );
    }
    if (options.addIssues && ['harmful', 'confusing'].includes(record.outcome)) {
      this.eye.addIssue({
        fingerprint: `misclick:${targetDescription.id || targetDescription.name}:${record.point}:${record.outcome}`,
        source: 'misclick',
        code: record.outcome,
        severity: record.outcome === 'harmful' ? 'major' : 'minor',
        title: t(M2, 'issueTitle', {
          point: record.point,
          name: targetDescription.name || targetDescription.id || t(M2, 'controlFallback'),
        }),
        expected: t(M2, 'issueExpected'),
        actual: record.effect,
        evidence: record.screenshot || null,
      });
    }
    if (typeof options.recover === 'function') {
      await options.recover(record, this.eye);
    }
  }

  async execute(locator, targetDescription, pointName, point, distance, options) {
    const hit = await this.hitAtPoint(locator, point.x, point.y);
    const base = {
      kind: 'near-misclick',
      at: new Date().toISOString(),
      step: this.eye.currentStep?.name || null,
      point: pointName,
      coordinates: point,
      distance,
      target: targetDescription,
      hit,
    };
    if (hit.dangerous && !options.allowDangerous) {
      return this.eye._sanitize({
        ...base,
        outcome: 'skipped-dangerous',
        effect: t(section(this.locale(), 'misclick'), 'destructiveSkip'),
      });
    }
    const before = await this.quickUserState();
    await this.eye.page.evaluate(() => {
      window.__userEyeNextPurpose = 'misclick';
    });
    const started = Date.now();
    await this.eye.page.mouse.click(point.x, point.y);
    await this.eye.page.waitForTimeout(options.waitMs ?? 280);
    const after = await this.quickUserState();
    return this.eye._sanitize({
      ...base,
      durationMs: Date.now() - started,
      ...this.outcome(hit, before, after, { stableOnly: options.stableOnly }),
      policy: options.stableOnly ? 'stable-only' : 'aggressive',
      before,
      after,
    });
  }

  async test(target, options = {}) {
    const locator = typeof target?.boundingBox === 'function' ? target : this.eye.locate(target);
    const box = await locator.first().boundingBox();
    if (!box) {
      throw new Error('Target has no visible bounding box for misclick testing');
    }
    const viewport = this.eye.page.viewportSize() || { width: 1440, height: 1000 };
    const distance = options.distance ?? this.eye.options.misclickDistance;
    const stableOnly =
      options.stableOnly === true ||
      (options.policy || this.eye?.options?.misclickPolicy || 'aggressive') === 'stable-only';
    options = { ...options, stableOnly };
    const requestedPoints = options.points || ['left', 'right', 'top', 'bottom'];
    const pointMap = this.pointMap(box, distance);
    const targetDescription = await this.eye._describeLocator(locator);
    const results = [];
    for (const pointName of requestedPoints) {
      const rawPoint = pointMap[pointName];
      if (!rawPoint) {
        continue;
      }
      const point = {
        x: Math.round(clamp(rawPoint.x, 1, viewport.width - 2)),
        y: Math.round(clamp(rawPoint.y, 1, viewport.height - 2)),
      };
      const record = await this.execute(locator, targetDescription, pointName, point, distance, options);
      this.eye.misclicks.push(record);
      results.push(record);
      if (record.outcome !== 'skipped-dangerous') {
        await this.saveEvidence(record, targetDescription, options);
      }
    }
    return results;
  }

  async testRapid(target, options = {}) {
    const locator = typeof target?.boundingBox === 'function' ? target : this.eye.locate(target);
    const box = await locator.first().boundingBox();
    if (!box) {
      throw new Error('Target has no visible bounding box for rapid-click testing');
    }
    const count = options.count || 3;
    const before = await this.quickUserState();
    const started = Date.now();
    for (let index = 0; index < count; index++) {
      await this.eye.page.evaluate(() => {
        window.__userEyeNextPurpose = 'rapid-test';
      });
      await this.eye.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      if (options.intervalMs) {
        await this.eye.page.waitForTimeout(options.intervalMs);
      }
    }
    await this.eye.page.waitForTimeout(options.waitMs ?? 350);
    const after = await this.quickUserState();
    const record = this.eye._sanitize({
      kind: 'rapid-click',
      at: new Date().toISOString(),
      step: this.eye.currentStep?.name || null,
      target: await this.eye._describeLocator(locator),
      count,
      durationMs: Date.now() - started,
      stateChanged: before.materialHash !== after.materialHash,
      dialogsAdded: Math.max(0, after.dialogs.length - before.dialogs.length),
      outcome: after.dialogs.length - before.dialogs.length > 1 ? 'harmful' : 'observed',
      before,
      after,
    });
    this.eye.misclicks.push(record);
    return record;
  }
}

module.exports = { MisclickEngine };
