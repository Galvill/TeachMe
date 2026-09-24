---
title: Headings inside code
sources: [server/quizParser.js]
---
A question's prompt contains a fenced code block that includes a `## Options` line, and the
real `## Options` heading comes after the fence. How does `parseQuestion()` handle it?

## Options
- [ ] It reports `Unexpected line in Options` for the code lines
- [ ] It uses the first `## Options` it sees, inside the fence
- [x] It ignores headings inside fences and uses the real `## Options` heading
- [ ] It reports `Missing "## Options" section`

## Explanation
`findHeadings()` in `server/quizParser.js` flips an `inFence` flag on every fence line and
skips lines while it is set, so the prompt can quote question syntax safely.
