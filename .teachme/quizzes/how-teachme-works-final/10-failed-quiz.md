---
title: Failing a section quiz
sources: [src/components/QuizResults.tsx, src/components/Toc.tsx]
---
A learner scores 1/5 on a section quiz inside a course (pass mark 70%). What can they do
next? (Select all that apply.)

## Options
- [x] Click **Continue** to go to the next TOC item
- [x] Click **Retry** to take the quiz again
- [ ] Nothing until they retry and pass the quiz
- [x] See the score on the quiz's TOC item, with a failed marker

## Explanation
In course context `QuizResults` shows both **Retry** and **Continue**, whatever the score:
nothing blocks navigation. `Toc` shows `best.score/best.total` on quiz items and adds the
`is-failed` class when the best percentage is below `passingScore`.
