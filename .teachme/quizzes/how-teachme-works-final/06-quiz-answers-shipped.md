---
title: Correct answers in the browser
sources: [server/api.js, shared/types.d.ts]
---
Which fields of a question does `GET /api/quizzes/:slug` send to the browser?
(Select all that apply.)

## Options
- [x] The options with their `correct` flags
- [x] The explanation
- [ ] The question's `sources:`
- [ ] The question's file path

## Explanation
`toQuestionDetail()` in `server/api.js` copies `prompt`, `options`, `multi`, `explanation`,
`slug` and `title`, matching `QuizDetail` in `shared/types.d.ts`, which omits `file` and
`sources`. Answers are in the browser on purpose: TeachMe is a learning tool, not an exam.
