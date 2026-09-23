---
title: Editing content while serving
sources: [server/api.js]
---
`teachme` is running and an agent rewrites a lesson on disk. What does the learner need to
do to see the new text?

## Options
- [ ] Restart `teachme`: content is loaded once at startup
- [x] Reload the page: every API request re-reads content
- [ ] Nothing: a file watcher pushes the change to the page
- [ ] Run `teachme validate` to refresh the server's cache

## Explanation
Every handler in `server/api.js` (`handleGetPage()`, `handleGetCourse()`, the catalog
route) calls `loadContent()` itself. There is no cache and no watcher, so the next request
sees the new file, but an already-open page does not update on its own.
