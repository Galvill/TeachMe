---
title: An unquoted sha
sources: [server/content.js, server/status.js, skill/teachme-authoring/reference/format.md]
---
An author writes `syncedCommit: 12e4567` without quotes. What goes wrong?

## Options
- [ ] `teachme validate` reports `Invalid frontmatter`
- [x] Validation reports `syncedCommit must be a quoted string`; status says `never-synced`
- [ ] Status looks up a commit named `Infinity` and reports `unknown-commit`
- [ ] Nothing: the loader converts it back with `String()`

## Explanation
YAML parses `12e4567` as a float that overflows to `Infinity`. The YAML itself is valid, so
there is no `Invalid frontmatter` error. `readSyncedCommit()` in `server/content.js` only
accepts a string: it records `syncedCommit must be a quoted string`, keeps the course, and
sets `syncedCommit` to `null`, which `server/status.js` reports as `never-synced`. Converting
with `String()` would have produced `"Infinity"`, not the sha. Always quote it, as
`skill/teachme-authoring/reference/format.md` says.
