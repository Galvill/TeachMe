A question file has three `[x]` checked options. How does TeachMe treat it?

## Options
- [ ] As an error — only one option may be marked correct
- [x] As a multi-select question, correct only if all three are chosen
- [ ] It ignores the extra checked options after the first

## Explanation
`parseQuestion` in `server/quizParser.js` sets `multi: true` whenever more
than one option is marked correct.
