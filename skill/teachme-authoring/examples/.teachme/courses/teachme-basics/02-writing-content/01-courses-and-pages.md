---
title: Courses and pages
sources:
  - server/content.js
---
A course lives at `.teachme/courses/<course-slug>/course.md`. That file's
YAML frontmatter needs a `title`; everything else — `description`,
`duration`, `order`, `quiz`, `syncedCommit` — is optional.

Pages are the `.md` files beside `course.md`, numbered so they sort in
order:

```
courses/teachme-basics/
  course.md
  01-welcome.md
  02-writing-content/
    _section.md
    01-courses-and-pages.md
    02-quizzes.md
```

A page's slug is its filename with the leading `NN-` prefix and `.md`
extension stripped, so `01-welcome.md` becomes `welcome`. Pages inside a
section get a compound slug, `<section-slug>/<page-slug>` — this very
page's path is `writing-content/courses-and-pages`.

Loading this structure into a table of contents is `server/content.js`'s
job: it walks `courses/` and `quizzes/` in the order shown above and builds
the TOC you're browsing right now.
