'use strict';

/**
 * Example UserEye plugin (roadmap item 6.2).
 *
 * A plugin is a plain object with:
 *   - id: string used in logs and artifacts;
 *   - protocols: extra protocols scheduled with the built-in ones (isolated
 *     contexts, same timeout/retry rules);
 *   - afterObservation(observation, context): optional hook;
 *   - afterRun(result, context): optional hook receiving the final result.
 *
 * Reference it from usereye.config.js:
 *   plugins: ['./examples/plugins/run-logger.js']
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  id: 'run-logger-example',

  protocols: [
    {
      id: 'example-title-check',
      category: 'example',
      modes: ['quick', 'standard', 'deep'],
      async run(runner) {
        return runner.withContext({}, async ({ page }) => {
          await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
          const title = await page.title();
          return {
            status: title && title.trim() ? 'passed' : 'warning',
            details: {
              title,
              hint: title && title.trim() ? null : 'The document has no <title>.',
            },
          };
        });
      },
    },
  ],

  async afterRun(result, { artifactDir }) {
    const payload = {
      plugin: this.id,
      generatedAt: new Date().toISOString(),
      application: result.application?.name || null,
      issues: result.summary?.issues ?? null,
      severity: result.summary?.severity ?? null,
      qualityGatesPassed: result.qualityGates?.passed ?? null,
      unexpectedBrowserErrors: result.summary?.unexpectedBrowserErrors ?? null,
    };
    fs.writeFileSync(
      path.join(artifactDir, 'plugin-run-logger.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  },
};
