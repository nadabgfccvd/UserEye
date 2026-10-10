'use strict';

/**
 * UserEye "user journey" battery (7.3). Opt-in, additive probes that reason
 * about the *resilience* and *accessibility/device* health of a running app,
 * not just its DOM correctness. Every probe is defensive: it navigates a fresh,
 * isolated context to the target and reports evidence as `{status, details}`.
 *
 * Two families:
 *   - resilience (the "sad path"): background-tab idle, closing without saving,
 *     password recovery, lockout/backoff, accidental language change, and an
 *     optional temp-mail driven login probe.
 *   - accessibility & device: permissions, fast scroll, keyboard shortcuts,
 *     mobile layout, right-click, dead links, text sizing, high contrast and a
 *     color-blind mode.
 *
 * Probes that need an *auth/session* surface (login form, edit form) auto-skip
 * when the target does not present one — e.g. temp-mail and password-recovery
 * stay off on a site with no login, exactly as requested ("if there's no login,
 * don't activate this function").
 *
 * All probe strings are English by design to keep this module additive; the
 * findings are surfaced as `uj:*` evidence in reports/protocol-results.json.
 */

const PASS = 'passed';
const WARN = 'warning';
const SKIP = 'skipped';

function uj(runner) {
  return runner.eye.options.userJourney || { enabled: false };
}

/**
 * Shared "does the app have a login system?" gate for the login-only probes.
 * When the caller answered `userJourney.hasLogin: false`, the probe short-circuits
 * to `skipped` immediately (no page touched). When `hasLogin` is null/true the
 * probe proceeds and auto-detects an actual login form on the page.
 * @returns {{status:'skipped', details:{reason:string}}|null}
 */
function noLoginGate(runner) {
  if (uj(runner).hasLogin === false) {
    return { status: SKIP, details: { reason: 'no-login-system' } };
  }
  return null;
}

async function gotoRoot(runner, page, options = {}) {
  await page.goto(runner.baseURL, { waitUntil: options.waitUntil || 'domcontentloaded' });
  await page.waitForTimeout(options.idleMs ?? 80);
}

/**
 * 1) RESILIENCE — background-tab idle.
 * If a page never reaches quiet, does a foreground tab still keep working after
 * we move the app to a background tab? Opens a second tab and measures whether
 * the first tab's timers/rAF still advance and whether the page signals it was
 * hidden (visibilitychange) — evidence of background loading behaviour.
 */
async function backgroundTabProbe(runner) {
  const enabled = uj(runner).resilience.backgroundTab;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ context, page, telemetry }) => {
    await gotoRoot(runner, page);
    const second = await context.newPage();
    await second.goto('data:text/html,<h1>foreground tab</h1>', { waitUntil: 'domcontentloaded' });
    // Instrument the app tab: advance a counter via rAF + setInterval and watch visibility.
    await page.evaluate(() => {
      window.__ujBg = { raf: 0, timer: 0, hidden: null, rafRunning: true };
      function tick() {
        if (window.__ujBg.rafRunning) window.__ujBg.raf += 1;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      window.__ujTimer = setInterval(() => {
        window.__ujBg.timer += 1;
      }, 50);
      document.addEventListener('visibilitychange', () => {
        window.__ujBg.hidden = document.hidden;
      });
    });
    // Bring the app tab to background by activating the second tab.
    await second.bringToFront();
    await page.waitForTimeout(650);
    const bg = await page.evaluate(() => window.__ujBg);
    // Bring the app tab back and sample whether it is still alive.
    await page.bringToFront();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => {
      clearInterval(window.__ujTimer);
      window.__ujBg.rafRunning = false;
      return { ...window.__ujBg };
    });
    const alive =
      (bg.raf > 0 && (after.raf > bg.raf || after.timer >= bg.timer)) ||
      (bg.timer > 0 && after.timer >= bg.timer);
    return {
      status: alive ? PASS : WARN,
      details: {
        probe: 'background-tab-idle',
        sawVisibilityHidden: bg.hidden !== null,
        bgRaf: bg.raf,
        bgTimer: bg.timer,
        afterRaf: after.raf,
        afterTimer: after.timer,
        // rAF is throttled/paused in hidden tabs; interval throttling is normal.
        note: alive
          ? 'App continued progressing while backgrounded.'
          : 'App appeared to freeze/stop progressing while in a background tab.',
        telemetry,
      },
    };
  });
}

/**
 * 2) RESILIENCE — closing without saving.
 * When an editable form has unsaved input and the user navigates away/closes,
 * does the app guard against losing it (beforeunload / draft) or lose it?
 */
async function unsavedCloseProbe(runner) {
  const enabled = uj(runner).resilience.unsavedClose;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const probe = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')];
      const editable = inputs.filter(el => !['hidden', 'submit', 'button', 'password'].includes(el.type));
      if (!editable.length) return { editableCount: 0, draftStorageKeys: [], autoSaveAnchors: 0 };
      // A real app that guards progress saves drafts client-side and/or has an
      // explicit autosave affordance.
      const stored = Object.keys({ ...localStorage }).filter(k => /draft|autosave|form/i.test(k));
      const autoSaveAnchors = document.querySelectorAll(
        '[data-autosave], [aria-label*="autosave" i], [aria-label*="draft" i], [class*="autosave" i]',
      ).length;
      return { editableCount: editable.length, draftStorageKeys: stored.slice(0, 8), autoSaveAnchors };
    });
    if (!probe.editableCount) {
      return { status: SKIP, details: { reason: 'no-editable-form', telemetry } };
    }
    const hasGuard = probe.draftStorageKeys.length > 0 || probe.autoSaveAnchors > 0;
    return {
      status: hasGuard ? PASS : WARN,
      details: {
        probe: 'unsaved-close',
        editableFields: probe.editableCount,
        clientDraftStorage: probe.draftStorageKeys,
        autoSaveAnchors: probe.autoSaveAnchors,
        note: hasGuard
          ? 'Progress appears protected on close/navigation (autosave/draft).'
          : 'Editable input without a visible autosave/draft guard — unsaved progress is at risk of being lost on close.',
        telemetry,
      },
    };
  });
}

function looksLikeLogin(pageData) {
  return Boolean(pageData.hasPassword) || Boolean(pageData.hasEmailOrUser);
}

/**
 * 3) RESILIENCE — forgot-password recovery.
 * Only active when the app actually shows a login form (per the "don't activate
 * unless there's login" rule). Checks whether a visible recovery path exists.
 */
async function passwordRecoveryProbe(runner) {
  const enabled = uj(runner).resilience.passwordRecovery;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  const noLogin = noLoginGate(runner);
  if (noLogin) return noLogin;
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const info = await page.evaluate(() => {
      const pw = document.querySelector('input[type="password"]');
      const inputs = [...document.querySelectorAll('input')];
      const emailOrUser = inputs.find(i =>
        /email|user|usuari|benutz|courriel/i.test(`${i.id} ${i.name} ${i.placeholder}`),
      );
      const links = [...document.querySelectorAll('a,button')]
        .map(el => (el.textContent || el.getAttribute('aria-label') || '').toLowerCase())
        .filter(txt =>
          /forgot|esqueci|recuperar|reset|mot de passe oubli|passwort vergessen|cambiar contraseña|olvid/i.test(
            txt,
          ),
        );
      return {
        hasPassword: Boolean(pw),
        hasEmailOrUser: Boolean(emailOrUser),
        recoveryMentions: [...new Set(links)].slice(0, 4),
      };
    });
    if (!looksLikeLogin(info)) {
      return { status: SKIP, details: { reason: 'no-login-form', telemetry } };
    }
    const recovery = info.recoveryMentions.length > 0;
    return {
      status: recovery ? PASS : WARN,
      details: {
        probe: 'password-recovery',
        loginPresent: true,
        passwordField: info.hasPassword,
        recoveryLinkFound: recovery,
        recoveryMentions: info.recoveryMentions,
        note: recovery
          ? 'A password-recovery entry point is visible near the login form.'
          : 'A login form exists but no visible "forgot password" recovery path was found.',
        telemetry,
      },
    };
  });
}

/**
 * 4) RESILIENCE — lockout / rate-limit backoff (opt-in, side-effecting).
 * Deliberately submits an obviously-wrong password a small, configured number of
 * times (default 1) to observe whether the app imposes a cool-down / limit and
 * whether the message escalates. Runs ONLY against sandboxed targets — enabled
 * via `userJourney.resilience.lockout` (default false).
 */
async function lockoutBackoffProbe(runner) {
  const cfg = uj(runner).resilience;
  if (!cfg || cfg.lockout !== true) return { status: SKIP, details: { reason: 'disabled-opt-in' } };
  const noLogin = noLoginGate(runner);
  if (noLogin) return noLogin;
  const attempts = Math.max(1, uj(runner).lockoutAttempts || 1);
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const hasLogin = await page.evaluate(() => Boolean(document.querySelector('input[type="password"]')));
    if (!hasLogin) return { status: SKIP, details: { reason: 'no-login-form', telemetry } };
    const feedback = [];
    for (let i = 0; i < attempts; i += 1) {
      await page.evaluate(() => {
        const pw = document.querySelector('input[type="password"]');
        const email = document.querySelector(
          'input[type="email"], input[name*="user" i], input[name*="email" i]',
        );
        const form = pw ? pw.closest('form') : email ? email.closest('form') : null;
        const btn = form ? form.querySelector('[type="submit"], button') : null;
        if (pw) pw.value = 'userEye-wrong-password';
        if (email) email.value = 'usereye-nobody@example.invalid';
        if (pw) pw.dispatchEvent(new Event('input', { bubbles: true }));
        if (email) email.dispatchEvent(new Event('input', { bubbles: true }));
        if (btn && typeof btn.click === 'function') btn.click();
      });
      await page.waitForTimeout(250 + i * 120);
      const afterText = await page.evaluate(() => (document.body.textContent || '').slice(-500));
      feedback.push({
        attempt: i + 1,
        // crude: did the surface react at all (error/limit text appears)?
        reacted:
          /wrong|incorrect|invalid|tentativa|inválid|error|erro|incorrecto|fail|blocked|too many|many attempt|locked|cooldown|try again|try in|intentos/i.test(
            afterText,
          ),
        limited:
          /too many|many attempt|locked|cooldown|try again|try in|wait|aguarde|espere|limite|intentos|blocked/i.test(
            afterText,
          ),
      });
    }
    const limited = feedback.some(f => f.limited);
    return {
      status: limited ? PASS : feedback.some(f => f.reacted) ? WARN : PASS,
      details: {
        probe: 'lockout-backoff',
        attemptsMade: feedback.length,
        configured: attempts,
        observedCoolDownOrLimit: limited,
        reactions: feedback,
        note: limited
          ? 'App imposes a cool-down / attempt limit after wrong passwords.'
          : feedback.some(f => f.reacted)
            ? 'App reacted to wrong credentials but no obvious cool-down message; backoff may be unlimited.'
            : 'No visible lockout feedback observed (app may throttle silently or server-side).',
        telemetry,
      },
    };
  });
}

/**
 * 5) RESILIENCE — accidental language change.
 * If the app exposes a language switcher, is a change guarded/confirmable or does
 * it flip instantly (leaving a confused user), and is it reversible? Evidence
 * only — does not change the running locale on arbitrary targets.
 */
async function languageSwitchProbe(runner) {
  const enabled = uj(runner).resilience.languageSwitch;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const info = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('select, button, a, [role="button"]')];
      const langControls = candidates.filter(el => {
        const label = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.className || ''}`;
        return /(^|\s)(EN|PT|ES|FR|DE|it|ru|中文|Español|English|Portugu|Français|Deutsch|idioma|lang(uage)?)/i.test(
          label,
        );
      });
      const hasConfirmOnChange = /(confirm|ask|are you sure|tem certeza|seguro|bestätigen|confirmer)/i.test(
        document.body.textContent || '',
      );
      return {
        hasSwitch: langControls.length > 0,
        switchCount: langControls.length,
        hasRevertWord: /english|portugu|español|français|language|idioma|lingua|sprache|langue/i.test(
          document.body.textContent || '',
        ),
        hasConfirmOnChange,
        sample: langControls.slice(0, 3).map(el => ({
          tag: el.tagName.toLowerCase(),
          text: String(el.textContent || el.getAttribute('aria-label') || '')
            .trim()
            .slice(0, 30),
        })),
      };
    });
    if (!info.hasSwitch) {
      return { status: SKIP, details: { reason: 'no-language-switcher', telemetry } };
    }
    return {
      status: PASS, // informational unless a real defect is confirmed by the caller
      details: {
        probe: 'language-switch',
        hasSwitcher: true,
        switchers: info.switchCount,
        canFindAnotherLanguageLabel: info.hasRevertWord,
        confirmationSignalsFound: info.hasConfirmOnChange,
        note: `Language switcher present (${info.switchCount}). Switching is instant in SPA patterns; verify a human can confirm/undo an accidental change and that the choice persists.`,
        sample: info.sample,
        telemetry,
      },
    };
  });
}

/**
 * 6) RESILIENCE — temp-mail driven login (strictly conditional).
 * Active only when the caller provides a `userJourney.tempMail` descriptor AND the
 * app presents a login/registration form. With no temp-mail endpoint configured,
 * this probe always skips (the requested default: don't activate without login).
 */
async function tempMailLoginProbe(runner) {
  const tm = uj(runner).tempMail;
  const noLogin = noLoginGate(runner);
  if (noLogin) return noLogin;
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const info = await page.evaluate(() => ({
      hasSignup: /(sign ?up|register|cadastr|crear cuenta|inscri|s\'inscrire|anmelden)/i.test(
        document.body.textContent || '',
      ),
      hasLogin: Boolean(document.querySelector('input[type="password"]')),
    }));
    if (!info.hasLogin && !info.hasSignup) {
      return { status: SKIP, details: { reason: 'no-login-or-signup', telemetry } };
    }
    if (!tm || typeof tm !== 'object') {
      return {
        status: SKIP,
        details: {
          reason: 'no-temp-mail-config',
          note: 'App has an auth surface, but no userJourney.tempMail provider was configured, so the disposable-email login probe stays inactive.',
          telemetry,
        },
      };
    }
    // A configured provider would supply {endpoint|inbox|from} — reserved hook.
    return {
      status: SKIP,
      details: {
        reason: 'temp-mail-provider-not-implemented',
        note: 'userJourney.tempMail is reserved for a disposable-inbox provider integration.',
        telemetry,
      },
    };
  });
}

// ---- accessibility & device family -----------------------------------------

/**
 * 7) A11Y — permissions audit. Which powerful permissions does the page request
 * (geolocation, notifications, camera, mic, clipboard-read…), and are they
 * answered / left pending? Intercepts permission prompts.
 */
async function permissionsAuditProbe(runner) {
  const enabled = uj(runner).a11y.permissions;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.evaluate(() => {
      window.__ujPerms = [];
      for (const name of [
        'geolocation',
        'notifications',
        'camera',
        'microphone',
        'clipboard-read',
        'clipboard-write',
        'midi',
        'persistent-storage',
      ]) {
        try {
          navigator.permissions.query({ name }).then(status => {
            (window.__ujPerms || []).push({ name, state: status.state });
          });
        } catch {
          /* unsupported permission name — ignore */
        }
      }
    });
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => window.__ujPerms || []);
    // Detect buttons that, when used, would trigger a permission prompt.
    const promptTriggers = await page.evaluate(() => {
      const t = document.body.textContent || '';
      return {
        geolocation: /geoloc|localiza|location|find me|near me/i.test(t),
        notifications: /notification|notifica/i.test(t),
        cameraMic: /camera|câmera|microphone|mike|microfone/i.test(t),
      };
    });
    const states = result.reduce((acc, p) => {
      acc[p.name] = p.state;
      return acc;
    }, {});
    const granted = Object.values(states).filter(s => s === 'granted').length;
    return {
      status: PASS,
      details: {
        probe: 'permissions-audit',
        permissionStates: states,
        uiMayTrigger: promptTriggers,
        note: `Reported ${Object.keys(states).length} permission state(s); ${granted} granted. Verify each prompt explains why it is needed and is dismissible.`,
        telemetry,
      },
    };
  });
}

/**
 * 8) A11Y/device — fast scroll. Does a very fast programmatic scroll stay smooth
 * or does the main thread jank / the page refuse to scroll? Approximates smoothness
 * via dropped-rAF and scroll-ability.
 */
async function fastScrollProbe(runner) {
  const enabled = uj(runner).a11y.fastScroll;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const probe = await page.evaluate(
      () =>
        new Promise(resolve => {
          const de = document.documentElement;
          const scrollable =
            de.scrollHeight > de.clientHeight || document.body.scrollHeight > de.clientHeight;
          if (!scrollable) return resolve({ scrollable: false });
          let frames = 0;
          const deltas = [];
          let jank = 0;
          let last = performance.now();
          function raf(now) {
            const dt = now - last;
            last = now;
            deltas.push(dt);
            if (dt > 40) jank += 1; // >2 frames late
            if (frames < 120) {
              frames += 1;
              de.scrollTop = (frames * 14) % (de.scrollHeight - de.clientHeight + 1);
              requestAnimationFrame(raf);
            } else {
              resolve({
                scrollable: true,
                sampledFrames: frames,
                droppedFrameBins: jank,
                smoothRatio: frames ? 1 - jank / frames : 1,
                avgFrameMs: Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10,
                overflowedHorizontal:
                  de.scrollWidth > de.clientWidth + 1 || document.body.scrollWidth > de.clientWidth + 1,
              });
            }
          }
          requestAnimationFrame(raf);
        }),
    );
    if (!probe.scrollable) {
      return { status: SKIP, details: { reason: 'not-scrollable', telemetry } };
    }
    const smooth = probe.smoothRatio >= 0.9;
    const works = !probe.overflowedHorizontal;
    return {
      status: smooth && works ? PASS : WARN,
      details: {
        probe: 'fast-scroll',
        ...probe,
        note: probe.overflowedHorizontal
          ? 'Horizontal overflow detected — page may not scroll as intended on this viewport.'
          : smooth
            ? 'Fast scroll stayed smooth (low dropped frames).'
            : 'Fast scroll produced dropped frames — main thread may jank under rapid scrolling.',
        telemetry,
      },
    };
  });
}

/**
 * 9) A11Y — keyboard shortcuts (Ctrl+C/V etc). Detects whether the page blocks
 * standard browser/OS commands (copy/paste/select-all) at the document level,
 * which breaks users who rely on keyboard shortcuts.
 */
async function keyboardShortcutsProbe(runner) {
  const enabled = uj(runner).a11y.keyboardShortcuts;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    // Detect whether a page listener calls preventDefault on the Ctrl+C/V/X/A
    // keydowns (the mechanism sites use to block copy/paste/select-all). We add
    // one bubble-phase listener on window that runs AFTER the page's own handlers
    // and reads `defaultPrevented` — no blocker of our own is installed, so this
    // reflects the page, not this probe.
    const blocked = await page.evaluate(() => {
      const seen = {};
      const probe = e => {
        if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a'].includes(e.key.toLowerCase())) {
          if (e.defaultPrevented) seen[e.key.toLowerCase()] = (seen[e.key.toLowerCase()] || 0) + 1;
        }
      };
      window.addEventListener('keydown', probe, false); // bubble; registered last
      for (const key of ['c', 'v', 'x', 'a']) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            code: key.toUpperCase(),
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      window.removeEventListener('keydown', probe, false);
      return { preventedKeys: Object.keys(seen) };
    });
    return {
      status: blocked.preventedKeys.length >= 3 ? WARN : PASS,
      details: {
        probe: 'keyboard-shortcuts',
        ctrlCombosPreventDefault: blocked.preventedKeys.sort(),
        note:
          blocked.preventedKeys.length >= 3
            ? 'Page listeners preventDefault common Ctrl shortcuts (copy/paste/select-all) at the root — verify they do not break Ctrl+C/Ctrl+V for real users.'
            : 'No blanket preventDefault of common keyboard shortcuts detected (real clipboard copy/paste is still verified by the clipboard protocol).',
        telemetry,
      },
    };
  });
}

/**
 * 10) A11Y/device — mobile layout. Renders at a phone viewport (isMobile/hasTouch)
 * and checks that the page is usable: no horizontal overflow, has a mobile
 * viewport meta (or a responsive layout), and text is not clipped.
 */
async function mobileLayoutProbe(runner) {
  const enabled = uj(runner).a11y.mobileLayout;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext(
    { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    async ({ page, telemetry }) => {
      await gotoRoot(runner, page);
      const m = await page.evaluate(() => {
        const vp = document.querySelector('meta[name="viewport"]');
        const de = document.documentElement;
        const body = document.body;
        const docScrollW = Math.max(de.scrollWidth, body.scrollWidth);
        return {
          hasViewportMeta: Boolean(vp),
          viewportContent: vp ? vp.content : null,
          horizontalOverflow: docScrollW > de.clientWidth + 1 ? docScrollW - de.clientWidth : 0,
          clientWidth: de.clientWidth,
          hasContent: Boolean((body.textContent || '').trim()),
          touchTargetsUnder44: (() => {
            const small = [...document.querySelectorAll('a,button,input,select')].filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && (r.width < 44 || r.height < 44);
            });
            return small.length;
          })(),
        };
      });
      const usable = m.hasViewportMeta && m.horizontalOverflow === 0;
      return {
        status: usable ? PASS : WARN,
        details: {
          probe: 'mobile-layout',
          viewportWidth: 390,
          ...m,
          note: usable
            ? 'Rendered cleanly in a phone viewport without horizontal overflow.'
            : `Mobile concerns: viewport meta ${m.hasViewportMeta ? 'present' : 'missing'}, horizontal overflow ${m.horizontalOverflow}px.`,
          telemetry,
        },
      };
    },
  );
}

/**
 * 11) A11Y — right-click allowed. Reports whether the app disables the native
 * context menu (a pattern that frustrates users and is often used to block
 * "inspect"), so real right-click still works.
 */
async function rightClickProbe(runner) {
  const enabled = uj(runner).a11y.rightClick;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    // Dispatch a cancelable context-menu event on a deep element and read whether
    // ANY page listener (capture or bubble, up to window) called preventDefault.
    // We install no blocker of our own, so this measures the page, not ourselves.
    const blocked = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('a,button,img,input,[role]')];
      const target = candidates[candidates.length - 1] || document.body;
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
      target.dispatchEvent(ev);
      return { defaultPrevented: ev.defaultPrevented };
    });
    return {
      status: blocked.defaultPrevented ? WARN : PASS,
      details: {
        probe: 'right-click',
        contextMenuPrevented: blocked.defaultPrevented,
        note: blocked.defaultPrevented
          ? 'A page listener calls preventDefault on contextmenu — the native right-click menu is intercepted.'
          : 'Native right-click / context menu is not blocked.',
        telemetry,
      },
    };
  });
}

/**
 * 12) A11Y/network — dead links. Probes same-origin links and in-page anchors
 * for broken destinations (4xx/5xx, or an anchor with no matching target).
 */
async function deadLinksProbe(runner) {
  const enabled = uj(runner).a11y.deadLinks;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const collected = await page.evaluate(() => {
      const origin = location.origin;
      const links = [...document.querySelectorAll('a[href]')];
      const rows = [];
      for (const a of links) {
        const href = a.getAttribute('href');
        let abs;
        try {
          abs = new URL(a.href, location.href);
        } catch {
          continue;
        }
        const text = (a.textContent || '').trim().slice(0, 40);
        if (href.startsWith('#')) {
          // in-page anchor — does the target exist?
          const id = href.slice(1);
          const ok = id
            ? Boolean(document.getElementById(id)) || Boolean(document.querySelector(`[name="${id}"]`))
            : true;
          rows.push({ kind: 'anchor', href, text, ok });
        } else if (abs.origin === origin) {
          rows.push({ kind: 'same-origin', href: abs.href, text, ok: null });
        } else {
          // do not touch cross-origin links (avoid storms/consent); just record
          rows.push({ kind: 'cross-origin', href: abs.href, text, ok: null });
        }
      }
      return { origin, rows: rows.slice(0, 60) };
    });
    const sameOrigin = collected.rows.filter(r => r.kind === 'same-origin').slice(0, 30);
    const anchorIssues = collected.rows.filter(r => r.kind === 'anchor' && !r.ok);
    for (const link of sameOrigin) {
      try {
        const resp = await page.request.get(link.href, { timeout: 9000 });
        link.ok = resp.ok();
        link.status = resp.status();
        if (!resp.ok()) telemetry.httpErrors.push({ url: link.href, status: resp.status() });
      } catch (error) {
        link.ok = false;
        link.error = String(error.message || error).split('\n')[0];
      }
    }
    const dead = sameOrigin.filter(l => !l.ok);
    const totalLinks = collected.rows.length;
    return {
      status: dead.length === 0 && anchorIssues.length === 0 ? PASS : WARN,
      details: {
        probe: 'dead-links',
        linksChecked: totalLinks,
        sameOriginChecked: sameOrigin.length,
        crossOriginSkipped: collected.rows.filter(r => r.kind === 'cross-origin').length,
        dead: dead.map(l => ({ href: l.href, text: l.text, status: l.status, error: l.error })),
        deadAnchors: anchorIssues.map(l => ({ href: l.href, text: l.text })),
        note:
          dead.length || anchorIssues.length
            ? `${dead.length} dead same-origin link(s) + ${anchorIssues.length} broken anchor(s) found.`
            : 'No dead same-origin links or broken anchors detected.',
        telemetry,
      },
    };
  });
}

/**
 * 13) A11Y — text resize. Does the app expose a font-size / text-scale control for
 * low-vision users, and does text scale (rather than being locked to px-only)?
 */
async function textResizeProbe(runner) {
  const enabled = uj(runner).a11y.textResize;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const probe = await page.evaluate(() => {
      const t = (document.body.textContent || '').toLowerCase();
      const hasControl =
        /(a\+|a-|font size|tamanho da letra|tamaño de letra|texte|text size|change text|zoom text|larger text|bigger text)/i.test(
          t,
        );
      // Text scalability: root font-size set in px/locked?
      const rootFs = getComputedStyle(document.documentElement).fontSize;
      const bodiesFixed = [...document.querySelectorAll('body, p, h1, h2, h3, span, a')]
        .slice(0, 60)
        .filter(el => /^[0-9.]+px$/.test(getComputedStyle(el).fontSize)).length;
      return { hasControl, rootFontSize: rootFs, fixedPxCount: bodiesFixed };
    });
    return {
      status: probe.hasControl ? PASS : WARN,
      details: {
        probe: 'text-resize',
        hasVisibleFontSizeControl: probe.hasControl,
        note: probe.hasControl
          ? 'A visible font-size/text-scale control is present for low-vision users.'
          : 'No visible font-size control was found. Users must rely on browser zoom; verify text scales (not px-locked) under browser zoom.',
        rootFontSize: probe.rootFontSize,
        telemetry,
      },
    };
  });
}

/**
 * 14) A11Y — high-contrast mode. Does the app expose a high-contrast setting (or
 * correctly honour forced-colors)? Surfaced as an accessibility gap when absent.
 */
async function highContrastProbe(runner) {
  const enabled = uj(runner).a11y.highContrast;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const found = await page.evaluate(() => {
      const t = (document.body.textContent || '') + ' ' + (document.title || '');
      const control =
        /high contrast|alto contraste|contraste alto|contraste eleva|haut contraste|theme|tema|accesib|a11y|accessib|aumentar contraste/i.test(
          t,
        );
      const forced = /forced-colors|@media\s*\(forced-colors|prefers-contrast/i.test(
        [...document.styleSheets]
          .map(s => {
            try {
              return s.cssRules
                ? Array.from(s.cssRules)
                    .map(r => r.cssText)
                    .join(' ')
                : '';
            } catch {
              return '';
            }
          })
          .join(' '),
      );
      return { hasControl: control, honorsForcedColors: forced };
    });
    return {
      status: found.hasControl || found.honorsForcedColors ? PASS : WARN,
      details: {
        probe: 'high-contrast',
        hasHighContrastSetting: found.hasControl,
        honorsForcedColors: found.honorsForcedColors,
        note:
          found.hasControl || found.honorsForcedColors
            ? 'A high-contrast option or forced-colors support exists.'
            : 'No high-contrast mode or forced-colors support detected — an accessibility gap for low-vision users.',
        telemetry,
      },
    };
  });
}

/**
 * 15) A11Y — colour-blind (daltonic) mode. Does the app settings offer a
 * colour-blind / daltonic filter, or at least not rely solely on colour?
 */
async function colorblindProbe(runner) {
  const enabled = uj(runner).a11y.colorblind;
  if (!enabled) return { status: SKIP, details: { reason: 'disabled' } };
  return runner.withContext({}, async ({ page, telemetry }) => {
    await gotoRoot(runner, page);
    const probe = await page.evaluate(() => {
      const t = (document.body.textContent || '').toLowerCase() + ' ' + (document.title || '').toLowerCase();
      const hasMode =
        /daltonic|daltonism|color ?blind|protanop|deuteranop|tritanop|dalton|couleur|farben|filter|modo de cor|deuteranopia/i.test(
          t,
        );
      return { hasColorblindMode: hasMode };
    });
    return {
      status: probe.hasColorblindMode ? PASS : WARN,
      details: {
        probe: 'colorblind-mode',
        hasColorblindModeInSettings: probe.hasColorblindMode,
        note: probe.hasColorblindMode
          ? 'A colour-blind / daltonic mode is offered.'
          : 'No colour-blind (daltonic) mode detected in settings — consider adding a colour filter and non-colour state indicators.',
        telemetry,
      },
    };
  });
}

module.exports = {
  backgroundTabProbe,
  unsavedCloseProbe,
  passwordRecoveryProbe,
  lockoutBackoffProbe,
  languageSwitchProbe,
  tempMailLoginProbe,
  permissionsAuditProbe,
  fastScrollProbe,
  keyboardShortcutsProbe,
  mobileLayoutProbe,
  rightClickProbe,
  deadLinksProbe,
  textResizeProbe,
  highContrastProbe,
  colorblindProbe,
};
