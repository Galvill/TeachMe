---
title: Where progress is saved
sources: [server/progress.js, server/api.js]
---
You run `TEACHME_HOME=/tmp/tm teachme docs/.teachme` inside `/work/app`. Where is progress
written, and under which key?

## Options
- [ ] `~/.TeachMe/progress.json`, keyed by the repo name `app`
- [x] `/tmp/tm/progress.json`, keyed by `/work/app/docs/.teachme`
- [ ] `/tmp/tm/progress.json`, keyed by the repo root `/work/app`
- [ ] `/work/app/docs/.teachme/progress.json`, with no key

## Explanation
`createProgressStore()` prefers `process.env.TEACHME_HOME` over `~/.TeachMe`. The API calls
`store.get(contentDir)` and `store.put(contentDir, parsed)` with the absolute content dir, so
two content folders in one repo keep separate progress.
