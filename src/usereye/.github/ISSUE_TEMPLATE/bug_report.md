---
name: Bug report
about: Something in UserEye misbehaves
title: '[bug] '
labels: bug
assignees: []
---

## What happened?

<!-- One paragraph: expected vs. actual behaviour. -->

## How can we reproduce it?

1. Target page/app (or attach a minimal HTML fixture):
2. Command: `usereye auto --url ... --mode ...`
3. Config (`usereye.config.js`) if any:

```js
// paste config — secrets are redacted in artifacts, but double-check before posting
```

## Environment

- UserEye version (`usereye --version`):
- Node version (`node -v`):
- OS / Docker image:
- Browser(s) (`--browser`):

## Evidence

<!-- Attach from the artifacts directory: result.json excerpt, screenshot, trace,
     relevant issues[] entries. Everything is secret-redacted by design. -->

- [ ] I ran `npm run verify` (or `npx usereye ... --dry-run`) and the problem persists
- [ ] I searched existing issues for this error message
