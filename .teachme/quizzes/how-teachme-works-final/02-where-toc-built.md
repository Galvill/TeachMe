---
title: Where the TOC is built
sources: [server/content.js, server/api.js, src/pages/CourseView.tsx, src/components/Toc.tsx, src/courseNav.ts]
---
A section's quiz shows up in the sidebar before the section's last page. Where would you look
for the bug?

## Options
- [ ] `Toc.tsx`, which sorts items by type before rendering
- [x] `loadCourseToc()` in `server/content.js`, which builds and orders the TOC
- [ ] `toCourseDetail()` in `server/api.js`, which reorders the TOC for the client
- [ ] `neighbors()` in `src/courseNav.ts`, which inserts quizzes between sections

## Explanation
`loadCourseToc()` pushes a section's pages and then its `_quiz/<slug>` item. The API passes
`course.toc` through unchanged, `Toc` renders it in order, and `neighbors()` only reads it.
