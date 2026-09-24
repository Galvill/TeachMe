---
title: passingScore as a string
sources: [server/content.js]
---
A `quiz.md` contains `passingScore: "80"`. What happens?

## Options
- [ ] The quiz loads with a pass mark of 80
- [x] The quiz is dropped with `passingScore must be a number between 0 and 100`
- [ ] The value is ignored and the default of 70 is used
- [ ] The quiz loads, with a warning on `quiz.md`

## Explanation
`loadQuiz()` checks `typeof value !== "number"`, so a quoted `"80"` fails and the function
returns `null` after recording the error. Unlike `duration` or `syncedCommit`, it is not
converted with `String()` or `Number()`.
