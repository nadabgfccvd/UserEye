'use strict';

/**
 * i18n.js — single entry point for UserEye's runtime string catalogs.
 *
 * Before this module existed, the report chrome (headings, table labels) was
 * translated through `report.js`'s private `catalog()` helper while every
 * finding title, gaze narrative, user-plan step, patience reason and misclick
 * effect was hard-coded in Portuguese inside the engine. That meant a run with
 * `--report-locale en` still produced Portuguese findings (documented as
 * "i18n leak" in the VELA test report).
 *
 * This module fixes that by exposing:
 *  - `catalog(locale)`        → the whole locales/<en|pt>.json dictionary.
 *  - `section(locale, name)`  → one nested dictionary (findings/scan/gaze/…).
 *  - `findingStrings(locale)` → the JSON-serializable `{code:{title,actual}}`
 *                               map injected into the browser-side collectors
 *                               (`collectBrowserPerception`,
 *                               `collectHumanSignals`, `collectUserGaze`) via
 *                               `page.evaluate` arguments.
 *  - `format(template, params)` → `{placeholder}` substitution used both in
 *                               Node and inside the browser collectors.
 *  - `t(cat, key, params)`    → dotted-free flat lookup with graceful fallback
 *                               to the key itself, so a missing translation can
 *                               never crash a run.
 *
 * Locale selection mirrors the previous behavior: anything starting with "pt"
 * resolves to the Portuguese pack, everything else falls back to English.
 */

const fs = require('fs');
const path = require('path');

const cache = new Map();

/** Shipped report/locale pack names. */
const PACKS = ['en', 'pt', 'es', 'fr'];

/**
 * Resolve a BCP-47 browser/target locale tag to a shipped report pack.
 * `auto` (Phase 7) maps from the run locale; unknown tags fall back to `en`.
 */
function resolveReportLocale(localeTag) {
  const base = String(localeTag || 'en')
    .toLowerCase()
    .split('-')[0];
  if (base === 'pt') return 'pt';
  if (base === 'es') return 'es';
  if (base === 'fr') return 'fr';
  return 'en';
}

/** Resolves a locale tag / pack name ("auto", "en", "pt-BR"…) to a shipped pack. */
function packName(locale = 'en') {
  const value = String(locale || 'en').toLowerCase();
  if (value === 'auto') {
    return 'en'; // caller should resolve via resolveReportLocale(runLocale) first
  }
  return resolveReportLocale(value);
}

/** Loads (and memoizes) locales/<pack>.json. */
function catalog(locale = 'en') {
  const pack = packName(locale);
  if (!cache.has(pack)) {
    const file = path.join(__dirname, 'locales', `${pack}.json`);
    cache.set(pack, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return cache.get(pack);
}

/** Returns one nested dictionary of the catalog, e.g. section('en','gaze'). */
function section(locale, name) {
  const value = catalog(locale)[name];
  return value && typeof value === 'object' ? value : {};
}

/** The `{code:{title,actual}}` map consumed by the browser-side collectors. */
function findingStrings(locale = 'en') {
  return section(locale, 'findings');
}

/** Replaces `{name}` placeholders; unknown placeholders are left untouched. */
function format(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
}

/** Looks up `key` inside a catalog/section and formats it with `params`. */
function t(cat, key, params) {
  const raw = cat && Object.prototype.hasOwnProperty.call(cat, key) ? cat[key] : key;
  return format(raw, params);
}

module.exports = {
  catalog,
  section,
  findingStrings,
  format,
  t,
  packName,
  PACKS,
  resolveReportLocale,
};
