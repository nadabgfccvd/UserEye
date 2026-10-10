/**
 * UserEye project policy for the Vela Analytics demo site.
 * Consumed via: node bin/usereye.js auto --config ../demo/vela-site/usereye.config.js
 * (run from UserEye/), or with --project ../demo/vela-site to let UserEye pick it up.
 *
 * No calm-profile knobs are set here on purpose: since 7.4.1 the built-in defaults
 * ARE the calm profile (video on failure, stable-only misclick, medium listing
 * confidence), so this file only carries Vela-specific policy. Add
 * `recordVideo: true` + `misclick: { policy: 'aggressive' }` for a forensic run.
 *
 * The site is fully static and client-side; form submits are demo-only
 * (preventDefault + inline success), so write actions are safe to allow.
 */
/** @type {import('usereye').UserEyeConfig} */
module.exports = {
  baseURL: process.env.USEREYE_BASE_URL || 'http://127.0.0.1:3000',
  mode: 'standard',
  outDir: 'artifacts/vela',
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
  viewport: { width: 1440, height: 900 },
  allowWrite: true,
  allowDestructive: false,
  allowDownloads: false,
  blockPaths: [],
  seedPaths: [
    '/',
    '/product',
    '/pricing',
    '/blog',
    '/blog/scaling-observability-to-10-trillion-events',
    '/about',
    '/contact',
    '/legal',
  ],
  patternPack: ['en'],
  reportLocale: 'en',
  reportFormat: ['html', 'md', 'sarif'],
  gates: {
    minAdaptiveScore: 70,
    maxBlocker: 0,
    maxCritical: 0,
    maxUnexpectedBrowserErrors: 0,
  },
};
