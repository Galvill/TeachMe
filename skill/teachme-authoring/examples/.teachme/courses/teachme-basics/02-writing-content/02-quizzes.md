---
title: Quizzes
sources:
  - shared/types.d.ts
---
Quizzes live under `.teachme/quizzes/<quiz-slug>/`, independent of any
course. A `quiz.md` needs a `title`; `passingScore` defaults to 70
(percent). Each question is its own file, numbered like pages.

A quiz can be taken standalone, or attached to a course: a section's
`_section.md` can point at one with `quiz: <slug>`, and so can a course's
`course.md`. Either way, the quiz shows up as the last item of that
section's or course's table of contents. This diagram shows how the files
in this section's folder (left) become its TOC entries (right), and how the
`writing-content-check` quiz you're about to take joins them as the last
entry:

```mermaid
flowchart LR
  lesson1["01-courses-and-pages.md"] --> toc1["TOC: Courses and pages"]
  lesson2["02-quizzes.md"] --> toc2["TOC: Quizzes"]
  sectionMd["_section.md"] -->|"quiz: writing-content-check"| quiz["quizzes/writing-content-check/quiz.md"]
  quiz --> toc3["TOC: Writing Content Check (quiz)"]
```

The shapes sent to the browser are typed once, in `shared/types.d.ts`, and
imported by both the server and the React app — a `TocItem` is exactly
`{ type, path, title, section, quizSlug? }`.
