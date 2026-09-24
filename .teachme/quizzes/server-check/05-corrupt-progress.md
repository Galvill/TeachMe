---
title: Corrupt progress file
sources: [server/progress.js]
---
`progress.json` contains truncated JSON after a disk problem. What happens on the next
`GET /api/progress`?

## Options
- [ ] The server returns 500 until the file is fixed by hand
- [ ] The server repairs the JSON and keeps the readable projects
- [x] The file is renamed to `progress.json.bak` and empty progress is returned
- [ ] The file is deleted and empty progress is returned

## Explanation
`loadProjects()` in `server/progress.js` catches the parse error, renames the file to
`progress.json.bak` and returns `{}`. The data is kept for manual recovery, and the app keeps
working.
