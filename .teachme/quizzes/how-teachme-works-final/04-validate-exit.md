---
title: Exit codes
sources: [bin/teachme.js, server/serve.js, server/validate.js]
---
A CI job runs `teachme validate`. Content has one lesson whose `sources:` lists a file that was
deleted. What does the job see?

## Options
- [x] A `WARN … Source not found` line, `0 errors, 1 warnings`, exit 0
- [ ] An `ERROR … Source not found` line and exit 1
- [ ] Exit 1, because any issue fails validation
- [ ] No output, because `sources:` is only checked by `teachme status`

## Explanation
`checkSources()` in `server/validate.js` pushes a warning, not an error. `runValidate()` in
`bin/teachme.js` sets `process.exitCode` to 1 only when `content.errors.length > 0`.
`formatIssues()` prints the `WARN` line and the summary.
