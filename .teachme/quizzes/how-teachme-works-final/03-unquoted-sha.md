---
title: An unquoted sha
sources: [server/content.js, skill/teachme-authoring/reference/format.md]
---
An author writes `syncedCommit: 12e4567` without quotes. What goes wrong?

## Options
- [ ] `teachme validate` reports `Invalid frontmatter`
- [ ] The loader rejects the course with `Missing required "title"`
- [x] YAML reads it as a number, so status looks up a commit named `Infinity`
- [ ] Nothing: the loader converts it back with `String()`

## Explanation
YAML parses `12e4567` as a float that overflows to `Infinity`. `loadCourse()` does run
`String(data.syncedCommit)`, but that yields `"Infinity"`, not the sha, so `changesSince()`
throws `UnknownCommitError` and the course is reported as `unknown-commit`. Always quote it,
as `skill/teachme-authoring/reference/format.md` says.
