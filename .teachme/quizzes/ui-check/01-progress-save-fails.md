---
title: When saving progress fails
sources: [src/ProgressProvider.tsx]
---
The server is stopped while a learner keeps reading, so `PUT /api/progress` fails. What does
the learner see?

## Options
- [x] Pages keep working and a `Progress could not be saved` toast appears
- [ ] An error screen replaces the page until the server is back
- [ ] The visited mark is rolled back and a retry button appears
- [ ] Nothing visible: the failed request is silently ignored

## Explanation
`update()` in `src/ProgressProvider.tsx` sets the new state first, then `flush()` calls
`putProgress()` with the latest state; a failure only sets `saveError`, which renders the
toast. State is not rolled back and navigation is never blocked.
