# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets).

To release a change:

1. `npm run changeset` — answer the prompts (patch/minor/major + summary) and commit the generated file.
2. Open a PR. CI enforces that the documented version always matches `package.json`
   (`scripts/sync-version.js` accepts entries in `CHANGELOG.md` **or** `HISTORY.md`).
3. `npm run version-packages` — consumes pending changesets, bumps `package.json`, writes `CHANGELOG.md`.
4. Push the release tag; `.github/workflows/publish.yml` publishes to npm with provenance
   (`id-token: write`, `environment: npm`) and builds the pinned Playwright Docker image.
