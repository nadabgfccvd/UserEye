'use strict';

// Example config wiring the example plugin into a run:
//   node bin/usereye.js auto --url http://127.0.0.1:4173 \
//     --config examples/plugins/usereye.config.example.cjs
module.exports = {
  mode: 'quick',
  outDir: 'artifacts/plugin-example',
  plugins: ['./examples/plugins/run-logger.js'],
  protocols: ['example-title-check', 'http-document'],
};
