---
title: Page requests
sources: [server/api.js]
---
A request arrives for `/api/courses/my-course/pages/..%2F..%2Fsecret`, which decodes to the
page path `../../secret`. Why can it never read a file outside the content folder?

## Options
- [ ] `decodePath()` strips every `..` segment before the lookup
- [ ] The route regex rejects page paths that contain dots
- [ ] `handleGetPage()` runs the same `realpathSync` check
- [x] The path is only a key into `course.pages`, not a file path

## Explanation
`handleGetPage()` checks `Object.hasOwn(course.pages, pagePath)` on the map the loader built
from the real folder, and returns 404 for unknown keys. No file is opened with the requested path, so no
containment check is needed on this route.
