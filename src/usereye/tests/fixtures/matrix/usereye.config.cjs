/**
 * Roadmap 7.5.0 item 5.3 — multi-app matrix fixture: two tiny static sites, each
 * served by the project adapter (python http.server, as in fixtures/static).
 *
 * Used directly (outDir is the fixture's own ./out, gitignored):
 *   node bin/usereye.js auto --config tests/fixtures/matrix/usereye.config.cjs
 * and by tests/matrix-apps.test.js (which copies the same shape into a temp dir).
 */
const path = require('path');

module.exports = {
  outDir: path.join(__dirname, 'out'),
  mode: 'quick',
  reportLocale: 'en',
  apps: [
    { name: 'app-a', projectDir: path.join(__dirname, 'app-a') },
    { name: 'app-b', projectDir: path.join(__dirname, 'app-b') },
  ],
};
