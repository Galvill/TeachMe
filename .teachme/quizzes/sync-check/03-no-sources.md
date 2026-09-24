---
title: Pages without sources
sources: [server/status.js]
---
A lesson describes `server/api.js` in detail but has no `sources:` field. Since the course's
`syncedCommit`, `server/api.js` was rewritten, and no other page of that course lists it in
`sources:`. What does `teachme status` report for the course?

## Options
- [ ] `ok`, because pages without `sources:` are never checked
- [x] `stale`, but only through `uncovered`; the lesson itself is not listed
- [ ] `stale`, with the lesson listed under `stale`
- [ ] `never-synced`, because a page has no `sources:`

## Explanation
Staleness is computed from `sources:` only: `collectEntityChanges()` loops over
`entity.sources`, so the lesson cannot appear in `stale`. The changed file is referenced by no
page, so `computeUncovered()` reports it and `buildItem()` marks the item `stale`. The fix is
to list every file a lesson describes.
