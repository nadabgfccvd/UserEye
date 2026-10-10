'use strict';

/**
 * Regression tests for the 7.1.1 fixes:
 *  1. i18n leak — finding titles/details, scan lines, plan steps, patience and
 *     misclick strings must follow `reportLocale` (en default, pt preserved).
 *  2. dialog-context-blind occlusion — controls behind an *open* dialog are
 *     occluded by design (APG modal pattern) and must not create an
 *     `occluded-controls` finding, while genuine layout occlusion still does.
 *  3. aria-hidden dedup — nested aria-hidden subtrees are reported once
 *     (outermost element), not once per nested node.
 *
 * All browser-side assertions run the real collectors in the jsdom harness
 * (tests/helpers/browser-env.js), the Node-side ones call the modules directly.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBrowserEnv } = require('./helpers/browser-env');
const { collectBrowserPerception } = require('../browser-perception');
const { catalog, section, findingStrings, t } = require('../i18n');
const { buildUserPlan } = require('../user-plan');
const { buildPatienceReport, moodFor } = require('../patience');

const SETTINGS = { profile: 'desktop', touchTarget: 44, maxText: 5000, maxControls: 300 };

function perceive(html, settings = {}) {
  const env = createBrowserEnv(html);
  return env.evaluate(collectBrowserPerception, { ...SETTINGS, ...settings });
}

function page(body, attributes = '') {
  return `<!doctype html><html ${attributes}><head><title>i18n fixture</title></head><body>${body}</body></html>`;
}

function codes(result) {
  return Array.from(result.findings, finding => finding.code);
}

test('i18n: en and pt catalogs declare the same keys in every section', () => {
  const en = catalog('en');
  const pt = catalog('pt');
  for (const name of ['findings', 'scan', 'gaze', 'plan', 'patience', 'misclick']) {
    assert.deepEqual(
      Object.keys(en[name]).sort(),
      Object.keys(pt[name]).sort(),
      `${name} keys must match between en and pt`,
    );
  }
  assert.deepEqual(
    Object.keys(en.findings).sort(),
    [
      'visible-hidden-elements',
      'horizontal-overflow',
      'duplicate-ids',
      'multiple-visible-dialogs',
      'nameless-controls',
      'occluded-controls',
      'clipped-controls',
      'decorative-aria-hidden',
      'screen-reader-only-clipping',
      'complementary-tooltip',
      'small-touch-targets',
      'insufficient-contrast',
      'broken-images',
      'unlabeled-fields',
      'heading-order-skip',
      'missing-lang',
      'visible-aria-hidden',
      'text-overflow',
      'consent-wall',
      'scroll-trap',
      'sticky-overlap',
      'fake-controls',
      'focus-not-visible',
      'placeholder-as-label',
      'error-not-associated',
      'autofocus-abuse',
      'missing-autocomplete',
      'missing-tab-title',
      'missing-favicon',
      'hover-only-content',
      'hitbox-mismatch',
      'mixed-language',
      'empty-click-region',
      'modal-without-close',
      'eternal-skeleton',
    ].sort(),
  );
});

test('i18n: perception findings follow the requested report locale', () => {
  const html = page(
    `<button data-rect="20,100,140,44" aria-label="Covered">under</button>
     <div data-rect="10,90,300,70" style="position:fixed" data-overlay="true"></div>`,
    'lang="en"',
  );
  const en = perceive(html, { strings: findingStrings('en') });
  const pt = perceive(html, { strings: findingStrings('pt') });
  const enFinding = en.findings.find(item => item.code === 'occluded-controls');
  const ptFinding = pt.findings.find(item => item.code === 'occluded-controls');
  assert.equal(enFinding.title, 'Visible controls are blocked by other elements');
  assert.equal(enFinding.actual, '1 control(s) fail the center hit-test.');
  // The Portuguese pack keeps the exact strings shipped since 7.0.0.
  assert.equal(ptFinding.title, 'Controles visíveis estão bloqueados por outros elementos');
  assert.equal(ptFinding.actual, '1 controle(s) falham no hit-test central.');
});

test('i18n: format() substitutes placeholders and leaves unknown ones intact', () => {
  assert.equal(t({ a: '{count} item(s), {other}' }, 'a', { count: 2 }), '2 item(s), {other}');
  assert.equal(t({}, 'missing-key'), 'missing-key');
});

test('dialog context: controls behind an open dialog are not an occlusion defect', () => {
  // A modal backdrop (rendered) containing the dialog box covers the page.
  const html = page(
    `<button data-rect="20,100,140,44" aria-label="Background action">bg</button>
     <div class="modal-backdrop" data-rect="0,0,1440,900" style="position:fixed">
       <div role="dialog" aria-modal="true" data-rect="420,200,600,400">
         <button data-rect="460,520,120,40">Close</button>
       </div>
     </div>`,
    'lang="en"',
  );
  const result = perceive(html, { strings: findingStrings('en') });
  const background = result.controls.find(control => control.name === 'Background action');
  assert.equal(background.occluded, true, 'the hit-test still sees the backdrop');
  assert.equal(background.occludedByOpenDialog, true, '…and records why it is expected');
  assert.ok(
    !codes(result).includes('occluded-controls'),
    'designed modality must not surface as an occlusion defect',
  );
  assert.equal(result.counts.occludedByOpenDialog, 1);
  // The dialog itself is still observed as an open dialog.
  assert.equal(result.counts.dialogs, 1);
});

test('dialog context: stray backdrop without a dialog is still reported', () => {
  // Same geometry, but the overlay is NOT a dialog context (the classic
  // "hidden attribute overridden by CSS" bug class): finding must remain.
  const html = page(
    `<button data-rect="20,100,140,44" aria-label="Background action">bg</button>
     <div class="stray-backdrop" hidden data-rect="0,0,1440,900" style="position:fixed;display:block"></div>`,
    'lang="en"',
  );
  const result = perceive(html, { strings: findingStrings('en') });
  assert.ok(codes(result).includes('occluded-controls'));
  assert.ok(codes(result).includes('visible-hidden-elements'), 'the hidden override is flagged');
  assert.equal(result.counts.occludedByOpenDialog, 0);
});

test('aria-hidden: nested hidden subtrees are deduplicated to the outermost node', () => {
  const html = page(
    `<div aria-hidden="true" data-rect="10,10,200,60">
       <span aria-hidden="true" data-rect="10,10,200,30">inner</span>
     </div>`,
    'lang="en"',
  );
  const result = perceive(html, { strings: findingStrings('en') });
  const finding = result.findings.find(item => item.code === 'visible-aria-hidden');
  assert.ok(finding, 'visible aria-hidden content is still flagged');
  assert.equal(finding.evidence.length, 1, 'one subtree = one evidence entry');
  assert.equal(result.counts.ariaHiddenVisible, 1);
});

test('i18n: user plan steps follow the requested locale', () => {
  const gaze = {
    headline: { text: 'Ship faster' },
    primaryCta: { name: 'Get started' },
    fold: { fieldCount: 0, actionCount: 2 },
  };
  const en = buildUserPlan({ gaze, human: {}, journey: {}, locale: 'en' });
  const pt = buildUserPlan({ gaze, human: {}, journey: {}, locale: 'pt' });
  assert.equal(en.steps[0].action, 'Read “Ship faster”');
  assert.equal(en.steps[0].why, 'It is the visual anchor of the first fold.');
  assert.equal(pt.steps[0].action, 'Ler “Ship faster”');
  assert.equal(pt.steps[0].why, 'É a âncora visual da primeira dobra.');
  assert.equal(en.steps[2].action, 'Click “Get started”');
  assert.equal(pt.steps[2].action, 'Clicar em “Get started”');
});

test('i18n: patience moods, reasons and disclaimer follow the requested locale', () => {
  assert.equal(moodFor(100, 'en').label, 'Calm');
  assert.equal(moodFor(100, 'pt').label, 'Tranquilo');
  const report = buildPatienceReport({ locale: 'en', experienceEvents: [] });
  assert.match(report.disclaimer, /UX heuristic based on latency/);
  const reportPt = buildPatienceReport({ locale: 'pt', experienceEvents: [] });
  assert.match(reportPt.disclaimer, /Heurística de UX baseada em latência/);
  assert.equal(report.mood.key, reportPt.mood.key, 'scores/moods stay language-neutral');
});

test('i18n: patience penalty reasons are localized end-to-end', () => {
  const events = [
    {
      kind: 'ux-interaction-start',
      token: 'a',
      at: '2026-01-01T00:00:00.000Z',
      step: 'S',
      target: { name: 'Save' },
      purpose: 'user',
    },
    {
      kind: 'ux-interaction-settled',
      token: 'a',
      at: '2026-01-01T00:00:04.000Z',
      totalMs: 4000,
      feedbackMs: 3500,
    },
  ];
  const en = buildPatienceReport({ locale: 'en', experienceEvents: events });
  const pt = buildPatienceReport({ locale: 'pt', experienceEvents: events });
  const enReasons = en.penalties.map(item => item.reason);
  const ptReasons = pt.penalties.map(item => item.reason);
  assert.ok(
    enReasons.some(reason => reason === 'First feedback only after 3500 ms'),
    `en reasons: ${enReasons.join(' | ')}`,
  );
  assert.ok(
    ptReasons.some(reason => reason === 'Primeiro feedback somente após 3500 ms'),
    `pt reasons: ${ptReasons.join(' | ')}`,
  );
  assert.equal(en.score, pt.score, 'localization must not change the score');
});

test('i18n: UserEye keeps reportLocale in options (constructor wiring regression)', () => {
  const { UserEye } = require('../user-eye');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usereye-i18n-'));
  try {
    assert.equal(new UserEye({ artifactDir: dir }).options.reportLocale, 'en');
    assert.equal(new UserEye({ artifactDir: dir, reportLocale: 'pt' }).options.reportLocale, 'pt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('i18n: scan section exposes every template used by collectUserGaze', () => {
  for (const locale of ['en', 'pt']) {
    const scan = section(locale, 'scan');
    for (const key of ['title', 'obviousAction', 'fieldInView', 'competingCtas', 'fieldFallback']) {
      assert.ok(scan[key], `${locale}.scan.${key} must exist`);
    }
  }
});

// --- 7.2.0: es/fr issue-facing catalog parity --------------------------------

function deepKeyTree(node, prefix = '') {
  const leaves = [];
  for (const [key, value] of Object.entries(node)) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      leaves.push(...deepKeyTree(value, label));
    } else {
      leaves.push(label);
    }
  }
  return leaves.sort();
}

test('es and fr finding/misclick/scan sections match en key-for-key', () => {
  const en = catalog('en');
  for (const lang of ['es', 'fr']) {
    const o = catalog(lang);
    for (const section of ['findings', 'misclick', 'scan']) {
      assert.deepEqual(
        deepKeyTree(o[section]),
        deepKeyTree(en[section]),
        `${lang}.${section} must expose the exact same keys as en`,
      );
      // Every leaf must actually differ (translated) from English.
      const enText = JSON.stringify(en[section]);
      assert.notEqual(JSON.stringify(o[section]), enText, `${lang}.${section} should be translated`);
    }
  }
});

test('es/fr consent-wall, misclick title and scan title are translated', () => {
  const es = catalog('es');
  const fr = catalog('fr');
  assert.match(es.findings['consent-wall'].title, /consentimiento|muro/i);
  assert.match(fr.findings['consent-wall'].title, /consentement/i);
  assert.match(fr.misclick.issueTitle, /Clic/);
  assert.match(es.misclick.issueTitle, /Clic/);
  assert.match(es.scan.title, /Título/);
  assert.match(fr.scan.title, /Titre/);
});

test('es/fr preserve the copyIssue label', () => {
  assert.equal(catalog('es').copyIssue, 'Copiar issue de GitHub');
  assert.equal(catalog('fr').copyIssue, "Copier l'issue GitHub");
});

// --- 7.2.0 narrative pass: gaze + plan localized in es/fr --------------------

test('es and fr gaze/plan sections are translated (not English mirrors)', () => {
  for (const lang of ['es', 'fr']) {
    const o = catalog(lang);
    for (const section of ['gaze', 'plan']) {
      assert.notEqual(
        JSON.stringify(o[section]),
        JSON.stringify(catalog('en')[section]),
        `${lang}.${section} should not mirror English`,
      );
      assert.equal(
        deepKeyTree(o[section]).join(','),
        deepKeyTree(catalog('en')[section]).join(','),
        `${lang}.${section} must keep the exact en key set`,
      );
    }
  }
});

test('es/fr gaze narratives and plan steps read naturally', () => {
  const es = catalog('es');
  const fr = catalog('fr');
  assert.match(es.gaze.narrativeHeadline, /mirada/i);
  assert.match(fr.gaze.narrativeHeadline, /regard/i);
  assert.match(fr.gaze.purposeAuthenticate, /connecter/i);
  assert.match(es.plan.readWhy, /ancla/i);
  assert.match(fr.plan.click, /Cliquer/i);
});
