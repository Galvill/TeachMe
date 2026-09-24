---
title: When a page counts as visited
sources: [src/pages/CourseView.tsx, src/progress.ts]
---
When does a lesson get added to the course's `visited` list?

## Options
- [ ] When its TOC link is hovered or focused
- [ ] When the learner scrolls to the bottom of the lesson
- [ ] When the learner leaves it with the pager's next link
- [x] When `getPage()` succeeds for it in `CourseView`

## Explanation
`CourseView` calls `update((p) => markVisited(p, slug, path))` in the `.then` of `getPage()`.
`markVisited()` in `src/progress.ts` adds the path once and sets it as `lastPage`, which is
where **Continue** resumes.
