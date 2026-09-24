---
title: Quiz items in a course
sources: [src/pages/CourseView.tsx, server/content.js]
---
The learner opens `/courses/guide/_quiz/setup-check`. Which component renders the main
area?

## Options
- [ ] `CourseView`, which calls `getPage()` with `_quiz/setup-check`
- [ ] `QuizView`, after the router redirects to `/quizzes/setup-check`
- [x] `InlineQuiz` inside `CourseView`, which runs `QuizRunner`
- [ ] `Toc`, which opens the quiz in a dialog over the page

## Explanation
`CourseView` computes `quizSlug` from paths starting with `QUIZ_PREFIX = "_quiz/"` and
renders `InlineQuiz`, which fetches the quiz and runs `QuizRunner` with context
`course:<slug>`; its **Continue** goes to the next TOC item, or reads **Back to catalog**
and goes to `/` when the quiz is the course's last item. The TOC stays visible, and the
`_quiz/<slug>` paths come from `loadCourseToc()` in `server/content.js`.
