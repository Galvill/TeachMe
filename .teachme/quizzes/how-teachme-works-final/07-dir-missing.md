---
title: Running in the wrong folder
sources: [bin/teachme.js]
---
You run `teachme` in a repo that has no `.teachme/` folder. What happens?

## Options
- [ ] The server starts and the home screen says "No courses yet"
- [ ] `.teachme/` is created with example content
- [x] It prints `No TeachMe content at <path>…` and exits 1
- [ ] It walks up parent folders until it finds a `.teachme/`

## Explanation
`runServe()` calls `reportMissingDir()` on the resolved dir before starting anything. The
dir is resolved against the current directory with `resolveDir()`; there is no search of
parent folders.
