/* ==========================================================================
   Vela Analytics — app.js
   Progressive enhancement only: every page is fully usable without JS.
   Modules: theme, nav, reveal, cookies, demo modal, tabs, charts, counters,
   blog filters, pricing switch, form validation, misc.
   ========================================================================== */
'use strict';

(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------------------------------------------------------- theme */
  const THEME_KEY = 'vela-theme';

  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = $('[data-theme-toggle]');
    if (btn) {
      // aria-label only — no title attribute: essential info must not be hover-only.
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
  }

  function initTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (_) {
      /* storage blocked — ignore */
    }
    applyTheme(stored === 'dark' || stored === 'light' ? stored : systemTheme());

    const btn = $('[data-theme-toggle]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (_) {
        /* ignore */
      }
    });
  }

  /* ------------------------------------------------------------------ nav */
  function initNav() {
    const header = $('[data-header]');
    const toggle = $('[data-nav-toggle]');
    const nav = $('#site-nav');
    if (header && toggle && nav) {
      toggle.addEventListener('click', () => {
        const open = header.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      });
      nav.addEventListener('click', (event) => {
        if (event.target.closest('a')) {
          header.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-label', 'Open menu');
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && header.classList.contains('open')) {
          header.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
      });
    }

    const onScroll = () => {
      if (header) header.setAttribute('data-scrolled', String(window.scrollY > 8));
      const bar = $('.progress-bar');
      if (bar) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0).toFixed(2) + '%';
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* --------------------------------------------------------------- reveal */
  function initReveal() {
    if (!('IntersectionObserver' in window) || prefersReducedMotion.matches) return;
    document.documentElement.classList.add('js-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    $$('[data-reveal]').forEach((el) => io.observe(el));
  }

  /* --------------------------------------------------------------- cookie */
  function initCookieBanner() {
    const banner = $('#cookie-banner');
    if (!banner) return;
    let choice = null;
    try {
      choice = localStorage.getItem('vela-cookies');
    } catch (_) {
      /* ignore */
    }
    if (choice) return;
    banner.hidden = false;
    const remember = (value) => {
      try {
        localStorage.setItem('vela-cookies', value);
      } catch (_) {
        /* ignore */
      }
      banner.hidden = true;
    };
    $('[data-cookie-accept]', banner).addEventListener('click', () => remember('accepted'));
    $('[data-cookie-decline]', banner).addEventListener('click', () => remember('declined'));
  }

  /* ---------------------------------------------------------------- modal */
  const MODAL_HTML = `
  <div class="modal-backdrop" data-modal-backdrop hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="demo-modal-title" data-modal>
      <div class="modal-head">
        <h2 id="demo-modal-title">Book a live demo</h2>
        <button type="button" class="icon-btn" data-modal-close aria-label="Close dialog">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="modal-sub">30 minutes with a product engineer. We will show Vela on your own telemetry — no slides, no sales script.</p>
      <form data-demo-form novalidate>
        <div class="field">
          <label class="label" for="demo-name">Full name <span class="req" aria-hidden="true">*</span></label>
          <input class="input" id="demo-name" name="name" type="text" autocomplete="name" required aria-describedby="demo-name-error" />
          <p class="field-error" id="demo-name-error" aria-live="polite"></p>
        </div>
        <div class="field">
          <label class="label" for="demo-email">Work email <span class="req" aria-hidden="true">*</span></label>
          <input class="input" id="demo-email" name="email" type="email" autocomplete="email" required aria-describedby="demo-email-error demo-email-hint" />
          <p class="field-hint" id="demo-email-hint">We will only use this to schedule the demo.</p>
          <p class="field-error" id="demo-email-error" aria-live="polite"></p>
        </div>
        <div class="field">
          <label class="label" for="demo-size">Team size</label>
          <select class="select" id="demo-size" name="team_size">
            <option value="1-10">1–10 engineers</option>
            <option value="11-50">11–50 engineers</option>
            <option value="51-200">51–200 engineers</option>
            <option value="200+">200+ engineers</option>
          </select>
        </div>
        <button class="btn btn-primary btn-lg" type="submit" style="width:100%">Request demo</button>
        <p class="form-status" role="status" data-demo-status></p>
      </form>
    </div>
  </div>`;

  function initModal() {
    const openers = $$('[data-demo-open]');
    if (!openers.length) return;

    document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
    const backdrop = $('[data-modal-backdrop]');
    const modal = $('[data-modal]');
    let lastFocused = null;

    const focusables = () =>
      $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modal).filter(
        (el) => !el.disabled && el.offsetParent !== null,
      );

    function openModal(event) {
      lastFocused = event && event.currentTarget ? event.currentTarget : document.activeElement;
      backdrop.hidden = false;
      // APG modal-dialog pattern: mark everything behind the dialog inert so
      // the browser itself blocks background clicks, focus and AT traversal.
      Array.from(document.body.children).forEach((el) => {
        if (el !== backdrop && !el.contains(backdrop)) el.inert = true;
      });
      lockScroll();
      const first = $('#demo-name');
      if (first) first.focus();
    }

    function closeModal() {
      backdrop.hidden = true;
      Array.from(document.body.children).forEach((el) => {
        el.inert = false;
      });
      unlockScroll();
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    /* Scroll lock without `overflow:hidden` on body/html: the fixed-position
       lock keeps computed overflow visible (no "scroll trap" heuristics, no
       scrollbar jump) while genuinely freezing the background. */
    let savedScroll = 0;
    function lockScroll() {
      savedScroll = window.scrollY;
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      const b = document.body;
      b.style.position = 'fixed';
      b.style.top = `-${savedScroll}px`;
      b.style.left = '0';
      b.style.right = '0';
      b.style.width = '100%';
      if (scrollbar > 0) b.style.paddingRight = `${scrollbar}px`;
    }
    function unlockScroll() {
      const b = document.body;
      b.style.position = '';
      b.style.top = '';
      b.style.left = '';
      b.style.right = '';
      b.style.width = '';
      b.style.paddingRight = '';
      window.scrollTo({ top: savedScroll, behavior: 'instant' in window ? 'instant' : 'auto' });
    }

    openers.forEach((btn) => btn.addEventListener('click', openModal));
    $('[data-modal-close]', modal).addEventListener('click', closeModal);
    /* Deliberately NO close-on-backdrop-click: this dialog contains a form,
       and an accidental click must not discard typed input. Explicit exits
       only: the Close button and Escape. */
    document.addEventListener('keydown', (event) => {
      if (backdrop.hidden) return;
      if (event.key === 'Escape') {
        closeModal();
        return;
      }
      if (event.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    const form = $('[data-demo-form]');
    const status = $('[data-demo-status]');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const ok = validateForm(form);
      if (!ok) return;
      status.textContent = 'Thanks! This is a demo site — in production we would email you within one business day.';
      form.reset();
      setTimeout(closeModal, 2600);
    });
  }

  /* ------------------------------------------------------- form validation */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function fieldRules(input) {
    const name = input.name || input.id;
    if (input.type === 'email') return { required: true, email: true, label: name };
    if (input.tagName === 'TEXTAREA') return { required: input.required, minLength: 20, label: name };
    return { required: input.required, label: name };
  }

  function validateField(input) {
    const rules = fieldRules(input);
    const errorEl = document.getElementById(input.getAttribute('aria-describedby')?.split(' ')[0] || '');
    const errorSlot =
      (errorEl && errorEl.classList.contains('field-error') ? errorEl : null) ||
      document.getElementById(input.id + '-error');
    let message = '';
    const value = input.value.trim();
    if (rules.required && !value) {
      message = 'This field is required.';
    } else if (rules.email && value && !EMAIL_RE.test(value)) {
      message = 'Enter a valid email address, e.g. ada@vela.io.';
    } else if (rules.minLength && value && value.length < rules.minLength) {
      message = `Please write at least ${rules.minLength} characters (you have ${value.length}).`;
    }
    if (errorSlot) errorSlot.textContent = message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
    return !message;
  }

  function validateForm(form) {
    const inputs = $$('input, textarea, select', form).filter((el) => el.type !== 'submit');
    let firstBad = null;
    let allOk = true;
    for (const input of inputs) {
      const ok = validateField(input);
      if (!ok && !firstBad) firstBad = input;
      allOk = allOk && ok;
    }
    if (firstBad) firstBad.focus();
    return allOk;
  }

  function initForms() {
    $$('form[data-validate]').forEach((form) => {
      $$('input, textarea, select', form).forEach((input) => {
        input.addEventListener('blur', () => validateField(input));
        input.addEventListener('input', () => {
          if (input.getAttribute('aria-invalid') === 'true') validateField(input);
        });
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const ok = validateForm(form);
        const status = $('[data-form-status]', form);
        if (!ok) {
          if (status) status.textContent = 'Please fix the highlighted fields and try again.';
          return;
        }
        if (status) status.textContent = '';
        const success = $('[data-form-success]');
        if (success) {
          const name = ($('#name', form) && $('#name', form).value.trim().split(' ')[0]) || 'there';
          form.hidden = true;
          success.hidden = false;
          $('[data-success-name]', success).textContent = name;
          success.focus();
        }
      });
    });

    $$('form[data-newsletter]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = $('input[type="email"]', form);
        const status = $('[data-newsletter-status]', form.parentElement);
        const ok = validateField(input);
        if (!ok) {
          if (status) status.textContent = '';
          return;
        }
        if (status) status.textContent = 'You are on the list — see you next month!';
        form.reset();
        input.removeAttribute('aria-invalid');
      });
    });
  }

  /* ----------------------------------------------------------------- tabs */
  function initTabs() {
    $$('[role="tablist"]').forEach((tablist) => {
      const tabs = $$('[role="tab"]', tablist);
      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectTab(index));
        tab.addEventListener('keydown', (event) => {
          let next = null;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          if (next !== null) {
            event.preventDefault();
            selectTab(next);
            tabs[next].focus();
          }
        });
      });
      function selectTab(index) {
        tabs.forEach((tab, i) => {
          const selected = i === index;
          tab.setAttribute('aria-selected', String(selected));
          tab.setAttribute('tabindex', selected ? '0' : '-1');
        });
        // Hide every referenced panel first, then reveal the active one —
        // correct both for one-panel-per-tab and for a shared panel.
        const panels = new Set(
          tabs.map((t) => document.getElementById(t.getAttribute('aria-controls'))).filter(Boolean),
        );
        panels.forEach((panel) => {
          panel.hidden = true;
        });
        const activePanel = document.getElementById(tabs[index].getAttribute('aria-controls'));
        if (activePanel) {
          activePanel.hidden = false;
          activePanel.setAttribute('aria-labelledby', tabs[index].id);
        }
        const active = tabs[index];
        if (active && window.__velaCharts && active.dataset.chart) {
          window.__velaCharts.setDataset(active.dataset.chart);
          const title = $('.chart-title');
          if (title) title.textContent = active.dataset.chartTitle || title.textContent;
        }
      }
    });
  }

  /* ------------------------------------------------------------- counters */
  function initCounters() {
    const counters = $$('[data-count]');
    if (!counters.length) return;

    function run(el) {
      const target = parseFloat(el.dataset.count);
      const decimals = (el.dataset.decimals | 0) || 0;
      const suffix = el.dataset.suffix || '';
      const prefix = el.dataset.prefix || '';
      if (prefersReducedMotion.matches || !('IntersectionObserver' in window)) {
        el.textContent = prefix + target.toFixed(decimals) + suffix;
        return;
      }
      const duration = 1400;
      const start = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = prefix + (target * eased).toFixed(decimals) + suffix;
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    if (!('IntersectionObserver' in window)) {
      counters.forEach(run);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            run(entry.target);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.4 },
    );
    counters.forEach((el) => io.observe(el));
  }

  /* ----------------------------------------------------------- blog filter */
  function initBlogFilter() {
    const grid = $('[data-post-grid]');
    if (!grid) return;
    const cards = $$('[data-tags]', grid);
    const chips = $$('[data-tag-filter]');
    const search = $('[data-blog-search]');
    const countEl = $('[data-blog-count]');
    let activeTag = 'all';

    // deep link: /blog?tag=changelog
    const urlTag = new URLSearchParams(window.location.search).get('tag');
    if (urlTag && chips.some((c) => c.dataset.tagFilter === urlTag)) activeTag = urlTag;

    function apply() {
      const q = (search ? search.value : '').trim().toLowerCase();
      let shown = 0;
      for (const card of cards) {
        const tags = card.dataset.tags.split(' ');
        const tagOk = activeTag === 'all' || tags.includes(activeTag);
        const textOk = !q || card.textContent.toLowerCase().includes(q);
        const visible = tagOk && textOk;
        card.hidden = !visible;
        if (visible) shown++;
      }
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.tagFilter === activeTag)));
      if (countEl) {
        countEl.textContent =
          shown === cards.length
            ? `Showing all ${shown} posts`
            : `Showing ${shown} of ${cards.length} posts`;
      }
    }

    chips.forEach((chip) => chip.addEventListener('click', () => { activeTag = chip.dataset.tagFilter; apply(); }));
    if (search) search.addEventListener('input', apply);
    apply();
  }

  /* ------------------------------------------------------- pricing switch */
  function initPricing() {
    const toggle = $('#billing-switch');
    if (!toggle) return;
    const monthlyLabel = $('[data-billing="monthly"]');
    const annualLabel = $('[data-billing="annual"]');

    function update() {
      const annual = toggle.checked;
      $$('[data-monthly]').forEach((el) => {
        el.textContent = '$' + (annual ? el.dataset.annual : el.dataset.monthly);
      });
      $$('[data-billing-note]').forEach((el) => {
        el.textContent = annual ? 'per editor / month, billed annually' : 'per editor / month, billed monthly';
      });
      if (monthlyLabel) monthlyLabel.classList.toggle('active', !annual);
      if (annualLabel) annualLabel.classList.toggle('active', annual);
    }
    toggle.addEventListener('change', update);
    // "Monthly"/"Annual" are real buttons: clicking one sets the switch deterministically.
    $$('[data-billing]').forEach((btn) => {
      if (btn.tagName !== 'BUTTON') return;
      btn.addEventListener('click', () => {
        toggle.checked = btn.dataset.billing === 'annual';
        update();
      });
    });
    update();
  }

  /* ----------------------------------------------------------------- misc */
  function initMisc() {
    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    $$('[data-copy-link]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const status = $('[data-copy-status]');
        try {
          await navigator.clipboard.writeText(window.location.href);
          if (status) status.textContent = 'Link copied to clipboard.';
        } catch (_) {
          if (status) status.textContent = 'Copy failed — the URL is in your address bar.';
        }
        setTimeout(() => {
          if (status) status.textContent = '';
        }, 3000);
      });
    });
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    initTheme();
    initNav();
    initReveal();
    initCookieBanner();
    initModal();
    initTabs();
    if (window.velaInitCharts) window.velaInitCharts();
    initCounters();
    initBlogFilter();
    initPricing();
    initForms();
    initMisc();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
