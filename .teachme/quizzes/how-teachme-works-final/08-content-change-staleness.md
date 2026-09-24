---
title: Committing content changes
sources: [server/status.js]
---
After stamping a course, an agent commits only fixes to files under `.teachme/`. What does
`teachme status` report for the course afterwards?

## Options
- [x] `ok`, because changes under the content dir are excluded
- [ ] `stale`, with the `.teachme/` files under `uncovered`
- [ ] `stale`, with every page listed under `stale`
- [ ] `unknown-commit`, because HEAD moved past `syncedCommit`

## Explanation
`computeUncovered()` in `server/status.js` skips paths equal to or under the content dir, and
pages only go stale through their `sources:`, which point at code. That is why the skill
lets you commit content after stamping it.
