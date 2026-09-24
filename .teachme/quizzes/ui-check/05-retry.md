---
title: Retry
sources: [src/components/QuizRunner.tsx, src/components/QuizResults.tsx]
---
A learner finishes a quiz, reaches the results, and clicks **Retry**. What happens?

## Options
- [ ] The saved attempt is deleted and the start screen shows
- [ ] Last answers are pre-selected so only wrong ones change
- [x] Answers reset and question 1 shows; the attempt stays saved
- [ ] The quiz is re-fetched from the server and restarts

## Explanation
`retry()` in `src/components/QuizRunner.tsx` clears `answers`, `selected`, `checked` and
`lastAttempt`, and sets the phase to `"question"`. The attempt saved by `finish()` through
`addAttempt()` is untouched; a new one is saved when results are reached again. Retry works the same standalone and in
a course.
