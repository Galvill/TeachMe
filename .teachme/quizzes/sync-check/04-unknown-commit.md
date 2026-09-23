---
title: After a squash
sources: [server/git.js, server/status.js]
---
A branch was squashed, and a quiz's `syncedCommit` no longer exists in the repo. What does
`teachme status` do?

## Options
- [ ] Exits 1 with `Unknown commit <sha>`
- [ ] Treats every question in the quiz as stale
- [ ] Reports the quiz as `never-synced`
- [x] Reports the quiz as `unknown-commit` and carries on

## Explanation
`changesSince()` verifies the commit with `git rev-parse --verify` and throws
`UnknownCommitError`. `buildItem()` in `server/status.js` catches exactly that error and sets
`state: "unknown-commit"`; the other items are still reported and the command exits 0.
