---
title: A renamed source
sources: [server/status.js]
---
A lesson lists `src/db.ts` in `sources:`, and that file was renamed to `src/db/index.ts`
after the course's `syncedCommit`. Where does the course's status item mention it?
(Select all that apply.)

## Options
- [x] In `stale`, with the commits that touched the file
- [x] In `broken`, with `status: "renamed"` and the `newPath`
- [x] In `uncovered`, because no page lists `src/db/index.ts` yet
- [ ] Nowhere: renames without content changes are ignored

## Explanation
`collectEntityChanges()` in `server/status.js` adds modified and renamed sources to `stale`,
and deleted or renamed ones to `broken`. `computeUncovered()` checks
`change.newPath ?? change.path` against the referenced sources, so the new path shows up as
uncovered until `sources:` is updated.
