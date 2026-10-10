# UserEye plugins

Plugins extend a run without forking the engine. They are loaded from
`usereye.config.js` (or `--config`), resolved relative to the config file, and
may be local paths or npm package ids.

```js
// usereye.config.js
module.exports = {
  plugins: [
    './tools/usereye-run-logger.js', // local file
    'acme-usereye-slack', // npm package resolved from the project
  ],
};
```

## Shape

A plugin is a plain object (or a module exporting one, or a factory function
returning one — including `export default` from ESM):

```js
module.exports = {
  id: 'my-plugin',

  // Extra protocols; scheduled with the built-in ones in isolated contexts.
  protocols: [
    {
      id: 'my-protocol', // unique id, appears in protocol-results.json
      category: 'custom', // free-form grouping
      modes: ['quick', 'standard', 'deep'], // which modes select it
      serial: false, // true forces serialized execution
      async run(runner) {
        // runner: the ProtocolRunner (baseURL, mode, timeoutMs, eye, ...)
        return runner.withContext({}, async ({ page, context, telemetry }) => {
          await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
          const ok = (await page.title()).length > 0;
          return { status: ok ? 'passed' : 'warning', details: { title: await page.title() } };
        });
      },
    },
  ],

  // Called after every observe() snapshot.
  async afterObservation(observation, context) {},

  // Called once with the final result.json payload, before reports are written.
  async afterRun(result, { config, artifactDir }) {},
};
```

Protocol results must return `{ status: 'passed'|'warning'|'skipped'|'failed', details? }`.
A `failed` protocol becomes a `major` issue automatically, exactly like a
built-in one.

## Hook contract

All hooks are optional functions on the plugin object; they are called by the `auto`
command (plugins are not loaded by `observe`). The engine calls them at
well-defined times; a hook that **throws, hangs or rejects never breaks the
run** — it is cut after a 30 s budget, warned on the console and recorded in
`result.json#pluginDiagnostics` (`[{ id, hook, error, durationMs }]`).

| Hook               | When                                                           | Arguments                                           |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------- |
| `beforeRun`        | Once, before the target starts (auto only)                     | `{ config, artifactDir, projectDir }`               |
| `afterObservation` | After every snapshot during exploration (auto)                 | `(observation, { eye, explorer, facts, pageType })` |
| `afterState`       | After each new state is recorded                               | `(state, { eye, explorer })`                        |
| `afterRun`         | Once with the final payload, before reports are written (auto) | `(result, { config, artifactDir })`                 |

At load time the engine validates the contract: a hook that is not a function
or a misspelled member (`afterRunn`) produces a warning, so a typo is never a
silent no-op. `id` and `protocols` are the only other members allowed.

```js
module.exports = {
  id: 'my-plugin',
  async beforeRun({ config, artifactDir }) {
    /* target not up yet */
  },
  async afterState(state, { eye }) {
    /* state recorded, page live */
  },
  async afterRun(result, { artifactDir }) {
    await fs.promises.writeFile(
      path.join(artifactDir, 'plugin-my-plugin-summary.json'),
      JSON.stringify({ score: result.adaptive?.quality?.score }),
    );
  },
};
```

## Guarantees and limits

- Plugin protocols run inside the same isolated scheduler as built-in
  protocols: fresh browser context, shared storage state, `protocolTimeoutMs`
  timeout, and abort support.
- Plugins run with the full privileges of the UserEye process. Only install
  plugins you trust — the same rule as any `devDependency`.
- Artifacts written by plugins land in the run's `artifactDir`; keep filenames
  prefixed (e.g. `plugin-<id>-*.json`) to avoid collisions.
- Secrets registered via credentials are redacted from UserEye's own artifacts;
  plugin-written files are the plugin's responsibility.

## A worked example

`examples/plugins/run-logger.js` in this repository is a complete, tested
example: one custom protocol (`example-title-check`) plus an `afterRun` hook
that writes `plugin-run-logger.json`.

```bash
node bin/usereye.js auto --url http://127.0.0.1:4173 \
  --config examples/plugins/usereye.config.example.cjs
```

## Post-run intelligence (roadmap 5.5)

The engine core is deterministic by design — no AI, no network, no hidden state.
If a smarter layer ever comes back, it belongs **here**: an `afterRun` plugin
that receives the completed payload (the exact object later written to
`result.json`) and writes its own artifacts. Runs never depend on a plugin's
output, so the deterministic core stays byte-identical.

`examples/plugins/result-insights.js` is that pattern reduced to a pure function
(score / LCP / issues → `plugin-result-insights.json`). A future LLM plugin would
be the same shape with an API call inside `afterRun` — opt-in, isolated, and
time-budgeted by the hook contract above.

## Publishing a plugin

There is no registry yet (roadmap item 6.2): publish it as a normal npm
package whose main export is the plugin object, and reference it by name.
Name it something discoverable like `usereye-plugin-<thing>` and open a PR
adding it to the catalog section of `docs/PLUGINS.md` — the catalog lives in
this file.

### Community catalog

- _(none listed yet — send the first PR!)_
