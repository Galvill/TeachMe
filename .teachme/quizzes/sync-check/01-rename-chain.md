---
title: A chain of renames
sources: [server/git.js]
---
Since a course's `syncedCommit`, `src/a.ts` was renamed to `src/b.ts` in one commit and to
`src/c.ts` in a later one. What does `changesSince()` return for it?

## Options
- [ ] Two `renamed` entries, `a.ts → b.ts` and `b.ts → c.ts`
- [ ] A `deleted` entry for `src/a.ts` and an `added` one for `src/c.ts`
- [x] One `renamed` entry for `src/a.ts` with `newPath` `src/c.ts`
- [ ] One `modified` entry for `src/c.ts`

## Explanation
`aggregateChanges()` in `server/git.js` keeps one lineage per original path and moves it to
the new path on every `R` line, so the chain stays a single `FileChange` with
`path: "src/a.ts"`, `status: "renamed"` and `newPath: "src/c.ts"`, listing both commits.
