If a `quiz.md` file has no `passingScore` field, what score is required to pass?

## Options
- [ ] 0%
- [x] 70%
- [ ] 100%

## Explanation
`passingScore` defaults to 70 when the field is absent — see `loadQuiz` in
`server/content.js`.
