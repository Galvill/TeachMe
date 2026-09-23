---
title: Scoring multi-select
sources: [src/progress.ts, src/components/QuizRunner.tsx]
---
A multi-select question has options A, B and C, with A and C correct. Which selections score
the question as correct? (Select all that apply.)

## Options
- [ ] A only
- [x] A and C
- [ ] A, B and C
- [x] C and A, clicked in that order

## Explanation
`isCorrect()` in `src/progress.ts` compares the selected and correct indices as sets:
same size, and every correct index selected. Order does not matter (`toggleOption()` also
keeps the selection sorted), and there is no partial credit, so A alone and A, B, C both
fail.
