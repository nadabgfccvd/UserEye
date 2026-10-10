<!-- HISTÓRICO DE ENTREGA: este documento descreve o bundle zip 7.5.1. Após a reorganização do repositório (2026-10-10), o pacote vive em `src/usereye/` e o harness em `demo/`. Caminhos já atualizados onde possível. -->

# UserEye 7.5.1 — start here

**Version:** 7.5.1 · single source of truth: `src/usereye/package.json` (also `usereye --version`)
**License / runtime:** MIT · Node >= 20.11 · Playwright 1.63.0 (pinned, checked in CI)
**Tests:** 446 total · 443 pass · 0 fail · 3 skipped (firefox not installed; webkit not installed; tree is dirty)
**Rating:** 9.3 / 10 — latest independent audit → [`src/usereye/docs/AUDITS.md`](src/usereye/docs/AUDITS.md)

> The `**Tests:**` line is **written by `npm run verify:delivery` from a real run**, never
> typed. Skips are environment-dependent (firefox/webkit absent, dirty tree); `fail` 0.

## What changed in 7.5.1

The 7.5.0 zip **failed its own gates** (a hand-bolded `**4 skipped**` broke the
`**Tests:**` regex; `DELIVERY.md` quoted the 7.4.1 count). Fixed in the docs **and** the
process: `verify:delivery` rewrites them from a real run; the packaging gate rejects
edited counts. The same line carries roadmap Fases 1–3 — measurement honesty (attributed
coverage, run-diff/auth/misclick tests), artifact economy (`trace` policy,
`report.embedLimit`, `keepLast`, `artifacts.totalBytes`), URL-only `--url` (pass
`--project` to opt back in), complete es/fr catalogs, localized steps/gates,
`observe --fail-on`, shell-free Windows `install-browsers`. See `src/usereye/HISTORY.md`.

## What changed in 7.5.0

**The code-execution boundary.** `usereye auto --project .` executes nothing from the
target repo unless you pass `--allow-project-commands …`; `shell: true` is gone; every
executed/blocked command lands in `result.json#commandAudit`. Plus Core Web Vitals,
`--log-level`/`--log-json`/`--timings`, `usereye doctor`, Node matrix 20/22/24 — the
contract `0 | 1 | 2` is unchanged.

## 60-second quick start

```bash
cd src/usereye && npm ci && npx playwright install chromium   # bare Linux: + sudo npx playwright install-deps chromium
node bin/usereye.js doctor && npm test                    # npm run verify adds lint/format/types/checks/coverage
node ../../demo/live-server.js                               # terminal 2 -> http://127.0.0.1:4200, demo at /vela/
node bin/usereye.js auto --url http://127.0.0.1:4200/vela/ --mode quick
```

Next: [`DELIVERY.md`](DELIVERY.md) · [`src/usereye/README.md`](src/usereye/README.md) · [`src/usereye/docs/README.md`](src/usereye/docs/README.md)
