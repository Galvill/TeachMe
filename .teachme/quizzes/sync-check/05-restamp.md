---
title: When to re-stamp
sources: [skill/teachme-authoring/SKILL.md]
---
`teachme status` reports a course as `stale`. An agent reads the diffs, finds that two of
three stale lessons are still correct, and fixes the third. What should it do with
`syncedCommit`?

## Options
- [ ] Leave it, since two lessons did not change
- [x] Set it to the current `git rev-parse --short HEAD` on the course, quoted
- [ ] Set it on the fixed lesson's frontmatter only
- [ ] Remove it, so the course is re-checked from scratch next time

## Explanation
The update workflow in `skill/teachme-authoring/SKILL.md` re-stamps every course and quiz the
agent reviewed, including content found still correct. `syncedCommit` belongs on
`course.md` and `quiz.md` only; pages inherit it. Removing it would make the course
`never-synced`.
