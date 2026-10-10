'use strict';

/**
 * Targeting policy (roadmap M9, Phase 6 — extracted from adaptive-explorer.js).
 *
 * Everything that answers "may the explorer touch this?" lives here: URL
 * canonicalization, block paths, host allow-listing, blocked control names and
 * page classification. These are pure functions of (config, candidate), which
 * is what makes them the safety-critical part of the engine worth unit-testing
 * in isolation — no browser required.
 */

const { loadPatterns } = require('../patterns');

/**
 * Match a configured pattern against a value.
 * A pattern may be a RegExp, a `/…/flags` string literal, or a plain string
 * (matched as equality, prefix or substring — the forgiving reading, because a
 * block list that silently fails to block is the worst possible outcome).
 *
 * @param {RegExp|string} pattern
 * @param {string} value
 * @returns {boolean}
 */
function matchesConfigured(pattern, value) {
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(value);
  }
  const string = String(pattern || '');
  const literal = string.match(/^\/(.*)\/([dgimsuvy]*)$/);
  if (literal) {
    try {
      return new RegExp(literal[1], literal[2]).test(value);
    } catch {
      return false;
    }
  }
  return value === string || value.startsWith(string) || value.includes(string);
}

/**
 * Host allow-list safety. An empty list permits everything; a non-empty list
 * permits the base origin plus any matching host, and nothing else.
 *
 * @param {URL} url
 * @param {{baseURL:string, allowedHosts?:Array}} options
 * @returns {boolean} true when the host must NOT be visited.
 */
function hostBlocked(url, options) {
  const allowlist = options.allowedHosts || [];
  if (!allowlist.length) return false;
  try {
    const base = new URL(options.baseURL);
    if (url.host === base.host) return false;
    return !allowlist.some(pattern => matchesConfigured(pattern, url.host));
  } catch {
    // An unparseable base URL means we cannot prove the target is in scope.
    return true;
  }
}

/**
 * Is this navigation target off-limits (block path or disallowed host)?
 *
 * @param {string} target
 * @param {{baseURL:string, blockPaths?:Array, allowedHosts?:Array}} options
 */
function blockedUrl(target, options) {
  if (!target) return false;
  try {
    const url = new URL(target, options.baseURL);
    if (
      (options.blockPaths || []).some(pattern => matchesConfigured(pattern, `${url.pathname}${url.search}`))
    ) {
      return true;
    }
    return hostBlocked(url, options);
  } catch {
    return false;
  }
}

/**
 * Is this control name on the never-activate list?
 *
 * @param {string} name
 * @param {{blockNamePatterns?:Array}} options
 */
function blockedName(name, options) {
  return (options.blockNamePatterns || []).some(pattern => matchesConfigured(pattern, String(name || '')));
}

/**
 * Canonicalize a URL for state identity: optionally drop the query string and
 * the hash so `/list?page=1` and `/list?page=2` are one state, not two.
 *
 * @param {string} target
 * @param {{baseURL:string, ignoreQueryParams?:boolean, ignoreHash?:boolean}} options
 */
function canonicalUrl(target, options) {
  try {
    const url = new URL(target, options.baseURL);
    if (options.ignoreQueryParams) url.search = '';
    if (options.ignoreHash) url.hash = '';
    return url.href;
  } catch {
    return target;
  }
}

/**
 * Classify a page from its perceived text plus counted facts.
 * Pure, pattern-pack driven, and therefore language-independent.
 *
 * @param {{title:string, visibleText:string}} observation
 * @param {object} facts
 * @param {object} [patterns]
 * @returns {string} Page kind.
 */
function classifyPage(observation, facts, patterns = loadPatterns()) {
  const text = `${observation.title} ${observation.visibleText}`.toLowerCase();
  if (patterns.errorPage.test(text) && facts.controls <= 4) return 'error';
  if (facts.passwordInputs > 0 && patterns.setupPage.test(text)) return 'registration/setup';
  if (facts.passwordInputs > 0 && patterns.authPage.test(text)) return 'authentication';
  if (facts.forms > 0 && facts.inputs >= 2) return 'form';
  if (facts.tables > 0) return 'table/list';
  if (facts.navigation > 0 && facts.headings > 0) return 'dashboard/content';
  if (facts.cards > 0 || patterns.emptyPage.test(text)) return 'collection/empty';
  return 'content';
}

module.exports = {
  blockedName,
  blockedUrl,
  canonicalUrl,
  classifyPage,
  hostBlocked,
  matchesConfigured,
};
