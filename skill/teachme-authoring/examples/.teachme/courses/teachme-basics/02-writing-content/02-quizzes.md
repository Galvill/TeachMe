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
section's or course's table of contents. This diagram shows how the
`writing-content-check` quiz you're about to take fits into this section's
folder and TOC:

```mermaid
graph LR
  subgraph Folder
    A["_section.md<br/>quiz: writing-content-check"]
    B["01-courses-and-pages.md"]
    C["02-quizzes.md"]
    Q["quizzes/writing-content-check/quiz.md"]
  end
  subgraph TOC
    T1["Courses and pages"]
    T2["Quizzes"]
    T3["Writing Content Check (quiz)"]
  end
  B --> T1
  C --> T2
  A -. quiz reference .-> Q
  Q --> T3
```

The shapes sent to the browser are typed once, in `shared/types.d.ts`, and
imported by both the server and the React app — a `TocItem` is exactly
`{ type, path, title, section, quizSlug? }`.
