'use strict';

const fs = require('fs');
const path = require('path');
const { collectActionCandidates, collectAdaptiveFacts, collectFormFields } = require('./adaptive-browser');
const { capturePerception } = require('./perception');
const { buildJourney, prioritizeByGaze } = require('./user-gaze');
const { loadPatterns, serializePatterns } = require('./patterns');
// Phase 6 (M9): adaptive-explorer.js was a 1279-line monolith. Its cohesive,
// browser-independent parts now live in ./explorer/* and are unit-testable
// without launching a browser. This file keeps the orchestration — the part
// that genuinely needs a live page — and delegates the rest.
const { MODES, budgetExhausted, mergeBudget, wallClockExceeded } = require('./explorer/budget');
const {
  blockedName,
  blockedUrl,
  canonicalUrl,
  classifyPage,
  hostBlocked,
  matchesConfigured,
} = require('./explorer/targeting');
const { coverageKey, quickHash } = require('./explorer/state');
const { buildQualityReport } = require('./explorer/audit');
const { runPluginHook } = require('./plugins');

class AdaptiveExplorer {
  constructor(eye, options = {}) {
    this.eye = eye;
    this.options = {
      mode: options.mode || 'standard',
      baseURL: options.baseURL,
      allowWrite: options.allowWrite === true,
      allowDestructive: options.allowDestructive === true,
      credentials: options.credentials || null,
      storageState: options.storageState || null,
      authStrategy: options.authStrategy || 'form',
      authConfig: options.authConfig || null,
      hooks: options.hooks || {},
      plugins: options.plugins || [],
      blockPaths: options.blockPaths || [],
      blockNamePatterns: options.blockNamePatterns || [],
      allowedHosts: options.allowedHosts || [],
      respectRobots: options.respectRobots === true,
      seedPaths: options.seedPaths || [],
      ignoreQueryParams: options.ignoreQueryParams !== false,
      ignoreHash: options.ignoreHash === true,
      wallClockMs: Number.isFinite(Number(options.wallClockMs)) ? Number(options.wallClockMs) : null,
      ready: options.ready || null,
      diveIntoIframes: options.diveIntoIframes === 'same-origin' ? 'same-origin' : 'off',
      hints: options.hints || {},
      axe: options.axe !== false,
      axeSourcePath: options.axeSourcePath || null,
      budget: options.budget || {},
      quietMs: options.quietMs || 140,
      maxWaitMs: options.maxWaitMs || 1500,
    };
    this.patterns =
      options.compiledPatterns ||
      loadPatterns({
        packs: options.patternPack || ['en'],
        custom: options.patterns || {},
        baseDir: options.projectDir || process.cwd(),
      });
    this.browserPatterns = serializePatterns(this.patterns);
    this.budget = mergeBudget(this.options.mode, this.options.budget);
    this.states = [];
    this.stateByHash = new Map();
    this.testedActions = new Set();
    this.accountedCandidates = new Set();
    this.actions = [];
    this.skipped = [];
    this.discoveredCandidates = new Map();
    this.responsiveAudits = [];
    this.misclickAudit = [];
    this.axeStateHashes = new Set();
    this.screenshotCount = 0;
    this.auth = { detected: false, attempted: false, succeeded: false, reason: null };
    this.firstImpression = null;
    this.journey = null;
    this.vitals = null;
    this.duplicateStateHits = 0;
    this.startedAt = new Date().toISOString();
    this.startedMs = Date.now();
    this._stopReason = null;
  }

  /** Wall-clock budget reached (Phase 6: `maxWallClockMs` large-app control). */
  _wallClockExceeded() {
    return wallClockExceeded(this.startedMs, this.options.wallClockMs);
  }

  /** True when the state or action allowance for this mode is spent. */
  _budgetExhausted() {
    return budgetExhausted({ states: this.states.length, actions: this.actions.length }, this.budget);
  }

  /**
   * Phase 6 ready policy: an app that can't be inferred from mutation quiet can
   * declare `ready.selector` / `ready.strategy` so exploration starts only when
   * the shell is actually interactive. Opt-in; defaults to the quiet wait.
   */
  async waitForReady() {
    const ready = this.options.ready;
    if (!ready || !ready.selector) {
      return;
    }
    try {
      if (ready.strategy === 'load') {
        await this.eye.page.waitForLoadState('load', { timeout: ready.timeoutMs });
      } else if (ready.strategy === 'network-almost-idle') {
        await this.eye.page.waitForLoadState('networkidle', { timeout: ready.timeoutMs }).catch(() => {});
      }
      if (ready.selector) {
        await this.eye.page
          .locator(ready.selector)
          .first()
          .waitFor({ state: 'visible', timeout: ready.timeoutMs });
      }
    } catch {
      // A missing ready signal is evidence, not a fatal: report the state anyway.
      this._stopReason = 'ready-wait-timeout';
    }
  }

  /** Same-origin frame inventory (Phase 6). Evidence note; never auto-dives cross-origin. */
  async _frameInventory() {
    try {
      return await this.eye.page.evaluate(() =>
        [...document.querySelectorAll('iframe')].map(frame => {
          const url = frame.src || '';
          let sameOrigin = false;
          try {
            sameOrigin = new URL(url).origin === window.location.origin;
          } catch {
            sameOrigin = false;
          }
          return {
            src: url,
            sameOrigin,
            name: frame.name || '',
            width: frame.offsetWidth,
            height: frame.offsetHeight,
          };
        }),
      );
    } catch {
      return [];
    }
  }

  async _facts() {
    return this.eye.page.evaluate(collectAdaptiveFacts);
  }

  async _candidateActions() {
    const candidates = await this.eye.page.evaluate(collectActionCandidates, this.browserPatterns);
    // Phase 6 hints: boost configured landmarks/CTAs (primaryCta, nav, main) so a
    // design-system app steers exploration without forking the engine. Still falls
    // back to full DOM discovery when no hint matches.
    const hinted = [];
    for (const key of ['primaryCta', 'nav', 'main']) {
      const raw = this.options.hints?.[key];
      if (!raw) continue;
      const list = Array.isArray(raw) ? raw : [raw];
      for (const hint of list) {
        if (!hint || typeof hint !== 'object') continue;
        hinted.push({
          name: hint.name,
          role: hint.role,
          nameBoost: key === 'primaryCta' ? 40 : 28,
          roleBoost: key === 'primaryCta' ? 20 : 14,
        });
      }
    }
    if (!hinted.length) return candidates;
    return candidates
      .map(candidate => {
        let priority = candidate.priority;
        for (const h of hinted) {
          const namePattern =
            h.name instanceof RegExp ? h.name : h.name ? new RegExp(String(h.name), 'i') : null;
          if (namePattern?.test(candidate.name || '')) priority += h.nameBoost;
          if (h.role && h.role === candidate.role) priority += h.roleBoost;
        }
        return { ...candidate, priority };
      })
      .sort((first, second) => second.priority - first.priority);
  }

  _matchesConfigured(pattern, value) {
    return matchesConfigured(pattern, value);
  }

  _blockedUrl(target) {
    return blockedUrl(target, this.options);
  }

  _hostBlocked(url) {
    return hostBlocked(url, this.options);
  }

  _blockedName(name) {
    return blockedName(name, this.options);
  }

  _canonicalUrl(target) {
    return canonicalUrl(target, this.options);
  }

  async _fillVisibleForm() {
    if (!this.options.allowWrite) {
      return { filled: 0, skipped: 'write-disabled' };
    }
    const seed = Date.now().toString(36).slice(-6);
    const fields = await this.eye.page.evaluate(collectFormFields, seed);

    let filled = 0;
    const passwordValue = this.options.credentials?.password || `UserEye#${seed}Aa1!`;
    for (const field of fields) {
      const locator = this.eye.page.locator(field.selector).first();
      try {
        if (field.tag === 'select') {
          const value = await locator
            .locator('option:not([disabled])')
            .evaluateAll(
              options => options.map(option => option.value).find(Boolean) || options[0]?.value || '',
            );
          if (value) {
            await locator.selectOption(value);
            filled += 1;
          }
        } else if (['checkbox', 'radio'].includes(field.type)) {
          if (field.required && !(await locator.isChecked())) {
            await locator.check();
            filled += 1;
          }
        } else {
          const value = field.sensitive ? passwordValue : field.value;
          await this.eye.fill(locator, value, `Fill adaptive field: ${field.signature.slice(0, 60)}`, {
            sensitive: field.sensitive,
          });
          filled += 1;
        }
      } catch {}
    }
    return { filled, discovered: fields.length };
  }

  async waitForQuiet() {
    await this.eye.page.evaluate(
      ({ quietMs, maxWaitMs }) =>
        new Promise(resolve => {
          let quietTimer;
          const finish = () => {
            observer.disconnect();
            clearTimeout(maxTimer);
            clearTimeout(quietTimer);
            resolve();
          };
          const schedule = () => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(finish, quietMs);
          };
          const observer = new MutationObserver(schedule);
          observer.observe(document, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          const maxTimer = setTimeout(finish, maxWaitMs);
          schedule();
        }),
      { quietMs: this.options.quietMs, maxWaitMs: this.options.maxWaitMs },
    );
    await this.eye.waitForStableUI(0);
  }

  async _quickHash() {
    const state = await this.eye._quickUserState();
    return quickHash(state, this.options, url => this._canonicalUrl(url));
  }

  async captureState(label, depth = 0, forceScreenshot = false) {
    const quickHash = await this._quickHash();
    if (this.stateByHash.has(quickHash)) {
      this.duplicateStateHits += 1;
      return { node: this.stateByHash.get(quickHash), duplicate: true };
    }
    if (this.states.length >= this.budget.maxStates) {
      this._stopReason ||= 'state-budget';
      return { node: null, budgetExceeded: true };
    }
    const screenshot = forceScreenshot || this.screenshotCount < this.budget.screenshots;
    const observation = await this.eye.observe(label, { screenshot, fullPage: screenshot, addIssues: false });
    if (screenshot) {
      this.screenshotCount += 1;
    }
    for (const finding of observation.findings) {
      if (['blocker', 'critical', 'major'].includes(finding.severity)) {
        this.eye.addIssue({
          fingerprint: `adaptive-visual:${finding.code}:${observation.url}:${observation.profile}`,
          severity: finding.severity,
          title: `Visual adaptation: ${finding.title}`,
          expected: 'The rendered interface remains usable and semantically consistent.',
          actual: finding.actual,
          technical: JSON.stringify(finding.evidence || [], null, 2),
          evidence: observation.screenshot || null,
        });
      }
    }
    const facts = await this._facts();
    const pageType = classifyPage(observation, facts, this.patterns);
    // 7.5.1 (item 5.2): hooks are isolated — a throwing/hanging plugin never
    // breaks exploration; failures are recorded in pluginDiagnostics.
    for (const plugin of this.options.plugins) {
      await runPluginHook(plugin, 'afterObservation', [
        observation,
        { eye: this.eye, explorer: this, facts, pageType },
      ]);
    }
    const ranked = prioritizeByGaze(await this._candidateActions(), observation.gaze || this.firstImpression);
    const candidates = ranked;
    for (const candidate of candidates) {
      const key = `${observation.url}|${candidate.selector}|${candidate.name}`;
      if (!this.discoveredCandidates.has(key)) {
        this.discoveredCandidates.set(key, candidate);
      }
    }
    const node = {
      id: `STATE-${String(this.states.length + 1).padStart(3, '0')}`,
      hash: quickHash,
      observationId: observation.id,
      observationPath: observation.path,
      url: observation.url,
      title: observation.title,
      depth,
      pageType,
      facts,
      candidates,
      screenshot: observation.screenshot || null,
    };
    this.states.push(node);
    this.stateByHash.set(quickHash, node);
    for (const plugin of this.options.plugins) {
      await runPluginHook(plugin, 'afterState', [node, { eye: this.eye, explorer: this }]);
    }
    if (pageType === 'authentication' || pageType === 'registration/setup') {
      this.auth.detected = true;
    }
    if (!this.firstImpression && observation.gaze) {
      this.firstImpression = observation.gaze;
      this.journey = buildJourney({
        gaze: observation.gaze,
        facts,
        pageType,
      });
    }

    if (
      this.options.axe &&
      this.options.axeSourcePath &&
      this.axeStateHashes.size < this.budget.axeStates &&
      !this.axeStateHashes.has(quickHash)
    ) {
      this.axeStateHashes.add(quickHash);
      await this.eye.runAxe(`auto ${node.id} — ${pageType}`, this.options.axeSourcePath);
    }
    return { node, duplicate: false };
  }

  _coverageKey(node, candidate) {
    return coverageKey(this._canonicalUrl(node.url), candidate);
  }

  _skip(candidate, reason, node) {
    this.accountedCandidates.add(this._coverageKey(node, candidate));
    this.skipped.push({ stateId: node.id, url: node.url, candidate, reason });
  }

  async _restore(node) {
    const currentHash = await this._quickHash().catch(() => null);
    if (currentHash === node.hash) {
      // PERF (2026-09-06): the page is already at the node state, so the
      // hash the caller is about to compute is already known — return it and
      // spare one redundant DOM round-trip in the per-candidate hot loop.
      return node.hash;
    }
    if (this.eye.page.url() !== node.url) {
      await this.eye.goto(node.url);
    } else {
      await this.eye.page.reload({ waitUntil: 'domcontentloaded' });
      await this.waitForQuiet();
    }
    return null; // re-navigated: the caller must re-hash the fresh page
  }

  /**
   * Pick the control that actually submits credentials.
   * Nav links often share labels like "Entrar"/"Login" with the real submit button;
   * ranking by type/tag/write avoids clicking the wrong target (verified on live SPA).
   */
  _pickAuthSubmit(candidates = []) {
    const pool = candidates.filter(candidate => candidate.kind === 'auth' || candidate.auth);
    if (!pool.length) {
      return null;
    }
    const score = candidate => {
      let value = Number(candidate.priority) || 0;
      if (candidate.type === 'submit') {
        value += 100;
      }
      if (candidate.tag === 'button') {
        value += 50;
      }
      if (candidate.tag === 'input') {
        value += 40;
      }
      if (candidate.write) {
        value += 30;
      }
      if (candidate.tag === 'a' || candidate.href) {
        value -= 40;
      }
      this.patterns.utility.lastIndex = 0;
      if (this.patterns.utility.test(candidate.name || '')) value -= 100;
      return value;
    };
    return [...pool].sort((first, second) => score(second) - score(first))[0] || null;
  }

  async _attemptAuthentication(node, depth) {
    if (this.auth.attempted) {
      return null;
    }
    this.auth.attempted = true;
    const credentials = this.options.credentials;
    if (this.options.authStrategy === 'hook') {
      if (typeof this.options.hooks.login !== 'function') {
        this.auth.reason = 'login-hook-required';
        return null;
      }
      try {
        const beforeUrl = this.eye.page.url();
        const beforeHash = await this._quickHash().catch(() => null);
        await this.options.hooks.login(this.eye.page, {
          credentials,
          baseURL: this.options.baseURL,
          eye: this.eye,
        });
        await this._waitForAuthTransition(beforeUrl, beforeHash);
        await this.waitForQuiet();
        const after = await this.captureState('State after login hook', depth + 1, true);
        const live = await this._liveAuthSignals().catch(() => null);
        this.auth.succeeded =
          Boolean(after.node && !['authentication', 'registration/setup'].includes(after.node.pageType)) ||
          Boolean(live && !live.looksLikeAuth);
        if (!this.auth.succeeded) {
          const successAssert = await this._authSuccessAssert().catch(() => null);
          if (successAssert?.passed) this.auth.succeeded = true;
        }
        this.auth.reason = this.auth.succeeded ? 'authenticated-by-hook' : 'login-hook-did-not-transition';
        this.actions.push({
          stateId: node.id,
          outcome: this.auth.reason,
          resultingState: after.node?.id || null,
        });
        return after.node;
      } catch (error) {
        this.auth.reason = `login-hook-error: ${error.message}`;
        this.actions.push({ stateId: node.id, outcome: 'error', error: error.message });
        return null;
      }
    }
    if (this.options.authStrategy === 'storageState') {
      const successAssert = await this._authSuccessAssert();
      if (successAssert && successAssert.passed) {
        this.auth.succeeded = true;
        this.auth.reason = 'authenticated-by-storage-state';
        this.actions.push({ stateId: node.id, outcome: 'authenticated-by-storage-state' });
        return null;
      }
      this.auth.reason = successAssert
        ? `storage-state-failed:${successAssert.reason || 'success-assert'}`
        : 'storage-state-did-not-authenticate';
      return null;
    }
    if (!credentials?.password) {
      this.auth.reason = 'credentials-required';
      const submit = this._pickAuthSubmit(node.candidates);
      if (submit) {
        // Empty submit is safe and reveals whether validation feedback exists.
        try {
          await this.eye.click(submit.selector, `Validate empty authentication: ${submit.name}`, {
            timeout: 5000,
          });
          await this.waitForQuiet();
          const after = await this.captureState('Empty authentication validation', depth + 1);
          this.actions.push({
            stateId: node.id,
            candidate: submit,
            outcome: 'validation-only',
            resultingState: after.node?.id || null,
          });
        } catch (error) {
          this.actions.push({ stateId: node.id, candidate: submit, outcome: 'error', error: error.message });
        }
      }
      return null;
    }

    this.eye.registerSecret(credentials.password);
    const fields = await this.eye.page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
      const identity = [
        ...document.querySelectorAll(
          'input[type="email"],input[name*="email" i],input[name*="user" i],input[autocomplete="username"],input[type="text"]',
        ),
      ].find(visible);
      const selector = element =>
        element?.id
          ? `#${CSS.escape(element.id)}`
          : element?.name
            ? `input[name="${CSS.escape(element.name)}"]`
            : null;
      return { passwords: passwords.map(selector).filter(Boolean), identity: selector(identity) };
    });
    if (fields.identity && (credentials.email || credentials.username)) {
      await this.eye.fill(fields.identity, credentials.email || credentials.username, 'Fill test identity');
    }
    for (let index = 0; index < (fields.passwords || []).length; index++) {
      await this.eye.fill(
        fields.passwords[index],
        credentials.password,
        index === 0 ? 'Fill test password' : 'Confirm test password',
        { sensitive: true },
      );
    }
    const submit = this._pickAuthSubmit(node.candidates);
    if (!submit) {
      this.auth.reason = 'submit-not-found';
      return null;
    }
    try {
      const beforeUrl = this.eye.page.url();
      const beforeHash = await this._quickHash().catch(() => null);
      await this.eye.click(submit.selector, `Autenticar: ${submit.name}`, { timeout: 5000 });
      // Many apps delay the post-login route change (toasts, redirects). waitForQuiet alone
      // can finish during the quiet gap before that transition and mis-classify auth.
      await this._waitForAuthTransition(beforeUrl, beforeHash);
      await this.waitForQuiet();
      const after = await this.captureState('State after authentication', depth + 1, true);
      this.auth.succeeded = Boolean(
        after.node && !['authentication', 'registration/setup'].includes(after.node.pageType),
      );
      // If capture hit a duplicate of the login page, re-check live signals once more.
      if (!this.auth.succeeded) {
        const live = await this._liveAuthSignals().catch(() => null);
        if (live && !live.looksLikeAuth) {
          this.auth.succeeded = true;
        }
        const successAssert = await this._authSuccessAssert().catch(() => null);
        if (successAssert?.passed) {
          this.auth.succeeded = true;
        }
      }
      this.auth.reason = this.auth.succeeded ? 'authenticated' : 'authentication-did-not-transition';
      this.actions.push({
        stateId: node.id,
        candidate: submit,
        outcome: this.auth.reason,
        resultingState: after.node?.id || null,
      });
      return after.node;
    } catch (error) {
      this.auth.reason = `error: ${error.message}`;
      this.actions.push({ stateId: node.id, candidate: submit, outcome: 'error', error: error.message });
      return null;
    }
  }

  /**
   * Phase 5.2: post-auth assertions (`auth.successAssert`) let complex shells
   * prove a login instead of relying on page-type heuristics alone.
   * Returns {passed, reason} or null when no assertion is configured.
   */
  async _authSuccessAssert() {
    const successAssert = this.options.authConfig?.successAssert;
    if (!successAssert) {
      return null;
    }
    const url = this.eye.page.url();
    let passed = true;
    const failures = [];
    if (successAssert.urlNotMatch) {
      const re =
        successAssert.urlNotMatch instanceof RegExp
          ? successAssert.urlNotMatch
          : new RegExp(String(successAssert.urlNotMatch), 'i');
      if (re.test(url)) {
        passed = false;
        failures.push(`url-still-login:${url}`);
      }
    }
    if (successAssert.selector) {
      const ok = await this.eye.page
        .locator(successAssert.selector)
        .first()
        .isVisible()
        .catch(() => false);
      if (!ok) {
        passed = false;
        failures.push(`shell-not-visible:${successAssert.selector}`);
      }
    }
    if (successAssert.noSelector) {
      const present = await this.eye.page
        .locator(successAssert.noSelector)
        .first()
        .isVisible()
        .catch(() => false);
      if (present) {
        passed = false;
        failures.push(`password-still-visible:${successAssert.noSelector}`);
      }
    }
    return { passed, reason: failures.join(', ') || null };
  }

  async _liveAuthSignals() {
    return this.eye.page.evaluate(
      patternInput => {
        const visible = element => {
          if (!element) {
            return false;
          }
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          );
        };
        const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
        const text = String(document.body?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        let authPage = /login|sign[ -]?in|password|passcode|unlock/i;
        try {
          if (patternInput?.source) authPage = new RegExp(patternInput.source, patternInput.flags || 'i');
        } catch {}
        const looksLikeAuth = passwords.length > 0 && authPage.test(text);
        return {
          url: location.href,
          passwordInputs: passwords.length,
          looksLikeAuth,
        };
      },
      { source: this.patterns.authPage.source, flags: this.patterns.authPage.flags },
    );
  }

  async _waitForAuthTransition(beforeUrl, beforeHash, timeoutMs = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const url = this.eye.page.url();
      if (url !== beforeUrl) {
        return { changed: true, reason: 'url' };
      }
      const hash = await this._quickHash().catch(() => null);
      if (hash && beforeHash && hash !== beforeHash) {
        const live = await this._liveAuthSignals().catch(() => null);
        if (live && !live.looksLikeAuth) {
          return { changed: true, reason: 'state' };
        }
        // State changed but still looks like auth (e.g. validation error) — keep waiting briefly.
      }
      const live = await this._liveAuthSignals().catch(() => null);
      if (live && !live.looksLikeAuth && live.passwordInputs === 0) {
        return { changed: true, reason: 'no-password' };
      }
      await this.eye.page.waitForTimeout(120);
    }
    return { changed: false, reason: 'timeout' };
  }

  _candidateSkipReason(candidate) {
    if (candidate.external) return 'external-link';
    if (this._blockedUrl(candidate.href) || this._blockedName(candidate.name)) return 'config-block';
    if (candidate.dangerous && !this.options.allowDestructive) {
      return 'destructive-safety';
    }
    if (candidate.write && !this.options.allowWrite) {
      return 'write-disabled';
    }
    if (candidate.auth) {
      return 'auth-handled-separately';
    }
    const isSafeKind = ['navigation', 'utility', 'control'].includes(candidate.kind);
    return !isSafeKind && !this.options.allowWrite ? 'unsupported-safe-kind' : null;
  }

  async _visibleDialogCount() {
    return this.eye.page
      .locator('dialog:visible,[role="dialog"]:visible,[aria-modal="true"]:visible')
      .count();
  }

  async _performCandidate(node, candidate, depth) {
    const restoredHash = await this._restore(node);
    const before = {
      // PERF (2026-09-06): reuse the hash `_restore` already confirmed
      // when the page was left untouched; re-hash only after a real restore.
      hash: restoredHash ?? (await this._quickHash()),
      url: this.eye.page.url(),
      dialogs: await this._visibleDialogCount(),
    };
    const record = {
      stateId: node.id,
      candidate,
      startedAt: new Date().toISOString(),
      outcome: 'unknown',
    };
    try {
      const locator = this.eye.page.locator(candidate.selector).first();
      if (candidate.write && this.options.allowWrite) {
        record.formFill = await this._fillVisibleForm();
      }
      if (!(await locator.isVisible())) {
        record.outcome = 'not-visible-after-restore';
        return;
      }
      await this.eye.click(locator, `Autoexplore: ${candidate.name || candidate.kind}`, { timeout: 5000 });
      await this.waitForQuiet();
      if (this._blockedUrl(this.eye.page.url())) {
        record.outcome = 'config-block';
        record.blockedUrl = this.eye.page.url();
        await this.eye.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
        return;
      }
      const after = {
        hash: await this._quickHash(),
        url: this.eye.page.url(),
        dialogs: await this._visibleDialogCount(),
      };
      record.stateChanged = before.hash !== after.hash;
      record.urlChanged = before.url !== after.url;
      record.dialogOpened = after.dialogs > before.dialogs;
      await this._captureCandidateOutcome(record, candidate, depth);
    } catch (error) {
      record.outcome = 'error';
      record.error = error.message;
    } finally {
      record.finishedAt = new Date().toISOString();
      this.actions.push(record);
    }
  }

  async _captureCandidateOutcome(record, candidate, depth) {
    if (!record.stateChanged && !record.urlChanged && !record.dialogOpened) {
      record.outcome = 'no-visible-change';
      return;
    }
    const captured = await this.captureState(`After ${candidate.name || candidate.kind}`, depth + 1);
    record.outcome = captured.duplicate
      ? 'known-state'
      : captured.budgetExceeded
        ? 'state-budget'
        : 'new-state';
    record.resultingState = captured.node?.id || null;
    if (captured.node && !captured.duplicate) {
      await this._exploreNode(captured.node, depth + 1);
    }
  }

  async _exploreNode(node, depth) {
    const budgetReached =
      !node ||
      depth >= this.budget.maxDepth ||
      this.actions.length >= this.budget.maxActions ||
      this._wallClockExceeded();
    if (budgetReached) {
      if (this._wallClockExceeded()) this._stopReason ||= 'wall-clock';
      return;
    }
    if (['authentication', 'registration/setup'].includes(node.pageType)) {
      const authenticatedNode = await this._attemptAuthentication(node, depth);
      if (authenticatedNode && authenticatedNode.id !== node.id) {
        await this._exploreNode(authenticatedNode, depth + 1);
      }
      if (!this.auth.succeeded) {
        return;
      }
    }

    let attemptedHere = 0;
    for (const candidate of node.candidates) {
      const actionBudgetReached =
        this.actions.length >= this.budget.maxActions || attemptedHere >= this.budget.actionsPerState;
      if (actionBudgetReached) {
        break;
      }
      const actionKey = `${node.hash}|${candidate.selector}|${candidate.name}`;
      if (this.testedActions.has(actionKey)) {
        continue;
      }
      this.testedActions.add(actionKey);
      this.accountedCandidates.add(this._coverageKey(node, candidate));

      const skipReason = this._candidateSkipReason(candidate);
      if (skipReason) {
        this._skip(candidate, skipReason, node);
        continue;
      }
      attemptedHere += 1;
      await this._performCandidate(node, candidate, depth);
    }
  }

  async auditMisclickSample() {
    const targets = await this.eye.page.evaluate(
      ({ limit, dangerPattern }) => {
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width >= 24 &&
            rect.height >= 24 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < innerHeight &&
            rect.left < innerWidth
          );
        };
        const name = element =>
          String(element.getAttribute('aria-label') || element.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);
        const selector = element => {
          if (element.id) {
            return `#${CSS.escape(element.id)}`;
          }
          const parent = element.parentElement;
          const same = parent
            ? [...parent.children].filter(child => child.tagName === element.tagName)
            : [element];
          const base = element.tagName.toLowerCase();
          return same.length > 1 ? `${base}:nth-of-type(${same.indexOf(element) + 1})` : base;
        };
        const controls = [...document.querySelectorAll('button,a[href],[role="button"],[role="tab"]')]
          .filter(visible)
          .filter(element => !element.closest('[data-usereye-skip-misclick]'));
        let dangerous = /delete|remove|logout|purchase|pay/i;
        try {
          dangerous = new RegExp(dangerPattern.source, dangerPattern.flags || 'i');
        } catch {}
        return controls
          .map(element => {
            const rect = element.getBoundingClientRect();
            const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            const nearest = controls
              .filter(other => other !== element)
              .reduce((best, other) => {
                const value = other.getBoundingClientRect();
                const dx = Math.max(0, Math.max(value.left - rect.right, rect.left - value.right));
                const dy = Math.max(0, Math.max(value.top - rect.bottom, rect.top - value.bottom));
                return Math.min(best, Math.hypot(dx, dy));
              }, 9999);
            const label = name(element);
            const isDangerous =
              dangerous.test(`${label} ${element.id} ${element.className}`) ||
              element.classList.contains('danger');
            const score =
              (nearest < 12 ? 100 : nearest < 30 ? 70 : 30) +
              (element.classList.contains('btn-primary') ? 20 : 0) +
              (rect.width < 48 || rect.height < 44 ? 15 : 0);
            return {
              selector: selector(element),
              name: label,
              dangerous: isDangerous,
              nearest: Math.round(nearest),
              score,
              center,
            };
          })
          .filter(item => !item.dangerous && item.name)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
      },
      {
        limit: this.budget.misclickTargets,
        dangerPattern: { source: this.patterns.dangerous.source, flags: this.patterns.dangerous.flags },
      },
    );

    const results = [];
    for (const target of targets) {
      try {
        const misses = await this.eye.testMisclicks(target.selector, {
          points: this.budget.misclickPoints,
          distance: 5,
          waitMs: 180,
          addIssues: true,
          policy: this.eye.options.misclickPolicy || 'aggressive',
          screenshotOnProblem: true,
          recover: async record => {
            if (['harmful', 'confusing'].includes(record.outcome)) {
              await this.eye.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
              await this.waitForQuiet().catch(() => {});
            }
          },
        });
        results.push({ target, misses });
      } catch (error) {
        results.push({ target, error: error.message });
      }
    }
    return results;
  }

  async auditResponsive(url) {
    const dir = path.join(this.eye.artifactDir, 'responsive');
    fs.mkdirSync(dir, { recursive: true });
    const audits = await Promise.all(
      this.budget.viewports.map(async viewport => {
        const page = await this.eye.context.newPage();
        try {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: this.eye.options?.navigationTimeoutMs || 15_000,
          });
          await page.evaluate(
            () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const perception = await capturePerception(page, {
            profile: viewport.name.includes('mobile') ? 'mobile' : viewport.name,
            touchTarget: this.eye.options.touchTarget,
            locale: this.eye.options.reportLocale,
          });
          const screenshotPath = path.join(dir, `${viewport.name}.jpg`);
          await page.screenshot({
            path: screenshotPath,
            type: 'jpeg',
            quality: 72,
            fullPage: true,
            animations: 'disabled',
          });
          const jsonPath = path.join(dir, `${viewport.name}.json`);
          fs.writeFileSync(jsonPath, JSON.stringify(this.eye._sanitize(perception), null, 2));
          return {
            ...viewport,
            url: page.url(),
            counts: perception.counts,
            findings: perception.findings.map(finding => ({
              code: finding.code,
              severity: finding.severity,
              title: finding.title,
              actual: finding.actual,
            })),
            screenshot: path.relative(this.eye.artifactDir, screenshotPath).replace(/\\/g, '/'),
            observation: path.relative(this.eye.artifactDir, jsonPath).replace(/\\/g, '/'),
            status: 'completed',
          };
        } catch (error) {
          return { ...viewport, status: 'error', error: error.message };
        } finally {
          await page.close().catch(() => {});
        }
      }),
    );
    this.responsiveAudits.push(...audits);
    return audits;
  }

  qualityReport() {
    return buildQualityReport(this);
  }

  async _exploreSeeds() {
    for (const seed of this.options.seedPaths) {
      if (
        this.states.length >= this.budget.maxStates ||
        this.actions.length >= this.budget.maxActions ||
        this._wallClockExceeded()
      )
        break;
      let target;
      try {
        target = new URL(seed, this.options.baseURL);
        if (target.origin !== new URL(this.options.baseURL).origin) {
          this.skipped.push({ url: target.href, reason: 'external-seed' });
          continue;
        }
      } catch {
        this.skipped.push({ url: String(seed), reason: 'invalid-seed' });
        continue;
      }
      if (this._blockedUrl(target.href)) {
        this.skipped.push({ url: target.href, reason: 'config-block' });
        continue;
      }
      await this.eye.goto(target.href);
      await this.waitForQuiet().catch(() => {});
      const captured = await this.captureState(`Seed: ${target.pathname}`, 0);
      if (captured.node && !captured.duplicate) await this._exploreNode(captured.node, 0);
    }
  }

  async explore() {
    if (typeof this.options.hooks.beforeExplore === 'function') {
      await this.options.hooks.beforeExplore(this.eye);
    }
    await this.waitForReady().catch(() => {});
    this.frames = await this._frameInventory().catch(() => []);
    const initial = await this.captureState('Initial adaptive state', 0, true);
    if (initial.node) await this._exploreNode(initial.node, 0);
    await this._exploreSeeds();
    this.vitals = await this.eye.collectVitals();
    if (this.vitals?.rated?.findings?.length && /^https?:/.test(this.eye.page?.url?.() || '')) {
      for (const finding of this.vitals.rated.findings.filter(item => item.severity === 'major')) {
        this.eye.addIssue({
          fingerprint: `vitals:${finding.code}`,
          severity: finding.severity,
          title: `Perceived experience: ${finding.title}`,
          expected: 'First paint and interaction stay within Web Vitals thresholds.',
          actual: finding.actual,
        });
      }
    }
    // PERF (2026-09-06): the misclick sample runs against the live page
    // while the responsive audit opens its own pages from the same context;
    // the two never touch the same page, so they can run concurrently instead
    // of serially. `responsiveURL` is captured first (same value as before) so
    // a misclick navigation on the main page cannot change the audit target.
    const responsiveURL = this.eye.page.url() || this.options.baseURL;
    const [misclickAudit] = await Promise.all([
      this.auditMisclickSample(),
      responsiveURL ? this.auditResponsive(responsiveURL) : Promise.resolve(null),
    ]);
    this.misclickAudit = misclickAudit;
    this.finishedAt = new Date().toISOString();
    const result = this.result();
    if (typeof this.options.hooks.afterExplore === 'function') {
      await this.options.hooks.afterExplore(this.eye, result);
    }
    return result;
  }

  result() {
    return {
      mode: this.options.mode,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt || new Date().toISOString(),
      auth: this.auth,
      states: this.states,
      actions: this.actions,
      skipped: this.skipped,
      misclickAudit: this.misclickAudit,
      responsiveAudits: this.responsiveAudits,
      frames: this.frames || [],
      quality: this.qualityReport(),
    };
  }
}

module.exports = { AdaptiveExplorer, MODES, classifyPage, mergeBudget };
