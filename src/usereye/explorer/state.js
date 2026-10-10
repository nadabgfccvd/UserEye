'use strict';

/**
 * State identity (roadmap M9, Phase 6 — extracted from adaptive-explorer.js).
 *
 * The explorer decides "have I already seen this?" by hashing a small,
 * deliberately coarse description of the page. Coarse is the point: hashing the
 * full DOM would make every timestamp or animation frame a brand-new state and
 * the crawl would never terminate.
 */

const crypto = require('crypto');

/**
 * Hash the material that defines a state.
 *
 * @param {object} material Canonical url/title/textHash/dialogs/alerts/controlCount.
 * @returns {string} 20-char sha256 prefix — collision risk is negligible at
 *   crawl scale and short hashes keep `result.json` readable.
 */
function hashMaterial(material) {
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 20);
}

/**
 * Build the state fingerprint for a quick user-state snapshot.
 *
 * When neither `ignoreQueryParams` nor `ignoreHash` is set, the engine's own
 * `materialHash` is authoritative and reused verbatim — that keeps the 7.4.1
 * fingerprints byte-identical for the default configuration.
 *
 * @param {object} state Snapshot from `UserEye._quickUserState()`.
 * @param {{ignoreQueryParams?:boolean, ignoreHash?:boolean}} options
 * @param {(url:string) => string} canonicalize
 * @returns {string}
 */
function quickHash(state, options, canonicalize) {
  if (!options.ignoreQueryParams && !options.ignoreHash) {
    return state.materialHash;
  }
  return hashMaterial({
    url: canonicalize(state.url),
    title: state.title,
    textHash: state.textHash,
    dialogs: state.dialogs,
    alerts: state.alerts,
    controlCount: state.controlCount,
  });
}

/**
 * Coverage bookkeeping key for one (state, candidate) pair. Every discovered
 * candidate is either tested or explicitly accounted as skipped under this key,
 * which is what makes the coverage percentage honest.
 */
function coverageKey(canonicalStateUrl, candidate) {
  return `${canonicalStateUrl}|${candidate.selector}|${candidate.name}`;
}

module.exports = { coverageKey, hashMaterial, quickHash };
