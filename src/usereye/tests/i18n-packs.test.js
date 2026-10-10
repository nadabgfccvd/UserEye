'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { catalog, PACKS, resolveReportLocale } = require('../i18n');

/**
 * Flatten a catalog to its leaf keys. Objects contribute dotted keys; arrays
 * contribute indexed keys — so a packs' *shape* is compared, not its wording.
 */
function leafKeys(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leafKeys(item, `${prefix}[${index}].`));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((item, key) => leafKeys(item, `${prefix}${key}.`));
  }
  return [prefix.slice(0, -1)];
}

test('shipped report packs are en, pt, es, fr and share the same report-label keys', () => {
  assert.deepEqual([...PACKS].sort(), ['en', 'es', 'fr', 'pt'].sort());
  const en = catalog('en');
  const reportScalarKeys = Object.keys(en).filter(
    key =>
      typeof en[key] === 'string' &&
      !['misclick', 'findings', 'scan', 'gaze', 'plan', 'patience'].includes(key),
  );
  for (const pack of ['pt', 'es', 'fr']) {
    const current = catalog(pack);
    for (const key of reportScalarKeys) {
      assert.ok(typeof current[key] === 'string', `${pack} is missing report label: ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Roadmap 7.5.0 item 3.2: total parity — every pack carries exactly the same
// key tree (including patience.*, which es/fr used to ship as a bare label).
// ---------------------------------------------------------------------------

test('all four packs share exactly the same leaf-key tree (total parity)', () => {
  const enKeys = leafKeys(catalog('en')).sort();
  assert.ok(enKeys.length > 200, `expected a full catalog, got ${enKeys.length} leaves`);
  for (const pack of ['pt', 'es', 'fr']) {
    const packKeys = leafKeys(catalog(pack)).sort();
    const missing = enKeys.filter(key => !packKeys.includes(key));
    const extra = packKeys.filter(key => !enKeys.includes(key));
    assert.deepEqual(
      missing,
      [],
      `${pack} is missing ${missing.length} key(s), e.g. ${missing.slice(0, 5).join(', ')}`,
    );
    assert.deepEqual(extra, [], `${pack} has extra key(s): ${extra.slice(0, 5).join(', ')}`);
  }
});

test('patience.* is a full translated section in every pack', () => {
  const en = catalog('en').patience;
  assert.equal(typeof en, 'object', 'en.patience must be the section object');
  const patienceKeys = Object.keys(en).sort();
  assert.ok(patienceKeys.includes('moodCalm') && patienceKeys.includes('disclaimer'));
  for (const pack of ['pt', 'es', 'fr']) {
    const current = catalog(pack).patience;
    assert.equal(typeof current, 'object', `${pack}.patience must be an object, not a bare label`);
    assert.deepEqual(Object.keys(current).sort(), patienceKeys, `${pack}.patience keys differ from en`);
  }
});

test('patienceLabel exists in every pack and builtin reports render it', () => {
  const labels = { en: 'Patience', pt: 'Paciência', es: 'Paciencia', fr: 'Patience' };
  for (const pack of PACKS) {
    assert.equal(typeof catalog(pack).patienceLabel, 'string', `${pack} lacks patienceLabel`);
    assert.ok(catalog(pack).patienceLabel.length > 0);
  }
  assert.equal(catalog('en').patienceLabel, labels.en);
  assert.equal(catalog('pt').patienceLabel, labels.pt);
});

test('report locale resolution maps tags and unknown -> en', () => {
  assert.equal(resolveReportLocale('pt-BR'), 'pt');
  assert.equal(resolveReportLocale('es-AR'), 'es');
  assert.equal(resolveReportLocale('fr-CA'), 'fr');
  assert.equal(resolveReportLocale('en-US'), 'en');
  assert.equal(resolveReportLocale('de-DE'), 'en');
  assert.equal(resolveReportLocale(''), 'en');
});

test('spanish and french catalogs report translated chrome labels', () => {
  const es = catalog('es');
  const fr = catalog('fr');
  assert.equal(es.actionable, 'Accionable (alta)');
  assert.equal(fr.actionable, 'Actionnable (élevé)');
  assert.equal(es.findingsLabel, 'Hallazgos');
  assert.equal(fr.findingsLabel, 'Constats');
  // And the patience section the audit flagged (M2) is translated too.
  assert.equal(es.patience.moodCalm, 'Tranquilo');
  assert.equal(fr.patience.moodCalm, 'Serein');
  assert.match(es.patience.disclaimer, /no mide emociones humanas/);
  assert.match(fr.patience.disclaimer, /émotions humaines/);
});
